/**
 * Sistema Y: link inteligente -> registro do clique no CRM + WhatsApp Business 1174.
 * Não acessa conversas, não cria leads confirmados e não usa a Cloud API.
 */
import { and, desc, eq, gte } from "drizzle-orm";
import type { Hono } from "hono";
import * as schema from "../database/schema";
import { getDb, sha256Hex } from "../lib/auth";
import { propertyWhatsapp1174Link } from "../lib/property-publication-link";
import { campaignWhatsapp1174Link, isCampaignPropertyType } from "../lib/campaign-publication";

const CHANNELS = ["facebook", "instagram", "tiktok", "youtube", "site"] as const;
type Channel = (typeof CHANNELS)[number];

export function parseAtendimentoSource(value: string | undefined): Channel | null {
  return CHANNELS.find((channel) => channel === value) ?? null;
}

export function registerPropertyContactRoutes(app: Hono) {
  // Endereço curto: /w/CODIGO/f (Facebook), /i (Instagram),
  // /t (TikTok), /y (YouTube), /s (site).
  // O registro acontece apenas na rota original, sem duplicar eventos.
  app.get("/w/:code/:network", (c) => {
    const sourceByLetter: Record<string, Channel> = {
      f: "facebook", i: "instagram", t: "tiktok", y: "youtube", s: "site",
    };
    const code = (c.req.param("code") ?? "").trim();
    const source = sourceByLetter[c.req.param("network") ?? ""];
    if (!code || code.length > 80 || !source) return c.text("Link inválido", 400);
    const path = `/api/atendimento/imovel/${encodeURIComponent(code)}?origem=${source}`;
    c.header("Cache-Control", "no-store, private");
    return c.redirect(path, 302);
  });
  app.get("/api/atendimento/imovel/:code", async (c) => {
    const code = (c.req.param("code") ?? "").trim();
    const source = parseAtendimentoSource(c.req.query("origem"));
    if (!code || code.length > 80 || !source) return c.text("Link de atendimento inválido", 400);
    const db = await getDb();
    const [property] = await db.select({
      id: schema.properties.id,
      code: schema.properties.code,
      purpose: schema.properties.purpose,
      type: schema.properties.type,
    }).from(schema.properties).where(and(
      eq(schema.properties.code, code),
      eq(schema.properties.published, 1),
      eq(schema.properties.status, "disponivel"),
    )).limit(1);
    if (!property) return c.text("Imóvel indisponível ou não encontrado", 404);

    // GET pode ser aberto por robôs ou pré-visualizadores: NÃO é um lead confirmado.
    // Evita contabilizar pré-busca explícita. Não salva telefone nem IP de visitantes.
    const prefetch = (c.req.header("purpose") ?? "") + " " + (c.req.header("sec-purpose") ?? "");
    if (!/prefetch|prerender/i.test(prefetch)) {
      const agent = (c.req.header("user-agent") ?? "").slice(0, 160);
      const ip = (c.req.header("x-forwarded-for") ?? "").split(",")[0]?.trim() ?? "";
      const fingerprint = await sha256Hex(
        [new Date().toISOString().slice(0, 10), property.id, source, ip, agent].join("|"),
      );
      const since = new Date(Date.now() - 15 * 60_000);
      const recent = await db.select({ detail: schema.auditLog.detail })
        .from(schema.auditLog).where(and(
          eq(schema.auditLog.action, "contato_iniciado_whatsapp"),
          eq(schema.auditLog.entityId, String(property.id)),
          gte(schema.auditLog.createdAt, since),
        )).orderBy(desc(schema.auditLog.createdAt)).limit(100);
      if (!recent.some((event) => {
        try { return JSON.parse(event.detail ?? "{}").fingerprint === fingerprint; }
        catch { return false; }
      })) {
        await db.insert(schema.auditLog).values({
          action: "contato_iniciado_whatsapp",
          entity: "property",
          entityId: String(property.id),
          detail: JSON.stringify({ code: property.code, source, fingerprint, status: "clique_nao_confirmado" }),
        });
      }
    }
    c.header("Cache-Control", "no-store, private");
    c.header("Referrer-Policy", "no-referrer");
    const isCampaign = await isCampaignPropertyType(db, property.type);
    const destination = isCampaign
      ? campaignWhatsapp1174Link(source, property.code)
      : propertyWhatsapp1174Link(property, source, property.purpose);
    return c.redirect(destination, 302);
  });
}

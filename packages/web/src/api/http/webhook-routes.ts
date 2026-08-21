/**
 * Webhooks de entrada: portais/parceiros, WhatsApp Cloud API e Meta
 * (Lead Ads, Instagram Direct, Messenger).
 *
 * Segurança: token na URL para o webhook de leads, verify token + assinatura
 * X-Hub-Signature-256 para os webhooks da Meta, limite de chamadas por IP.
 * Sem credencial configurada, o endpoint responde 503 e registra o evento —
 * nunca finge que recebeu.
 */
import type { Hono } from "hono";
import { eq } from "drizzle-orm";
import * as schema from "../database/schema";
import { getDb } from "../lib/auth";
import { siteBaseUrl } from "../lib/base-url";
import { addMessage, aiTurn, ensureConversation } from "../lib/inbox";
import { intakeLead, normalizeWebhookLead } from "../lib/lead-intake";
import { logEvent, parseConfig } from "../lib/integrations";
import {
  fetchLeadgen,
  parseLeadgenWebhook,
  parseMetaMessaging,
  parseWhatsappWebhook,
  sendMetaMessage,
  sendWhatsappText,
  verifyMetaSignature,
} from "../lib/whatsapp";
import type { AdminDb } from "../lib/admin-base";

/** Limite simples por IP (best-effort: memória do runtime). */
const hits = new Map<string, { count: number; until: number }>();
const LIMIT = 60;
const WINDOW = 60 * 1000;

function rateLimited(ip: string) {
  const entry = hits.get(ip);
  const now = Date.now();
  if (!entry || now > entry.until) {
    hits.set(ip, { count: 1, until: now + WINDOW });
    return false;
  }
  entry.count += 1;
  return entry.count > LIMIT;
}

async function config(db: AdminDb, key: string) {
  const [row] = await db.select().from(schema.integrations).where(eq(schema.integrations.key, key)).limit(1);
  return { config: parseConfig(row?.config), enabled: row?.enabled === 1 };
}

async function propertyIdFromCode(db: AdminDb, code: string | null) {
  if (!code) return null;
  const [row] = await db
    .select({ id: schema.properties.id })
    .from(schema.properties)
    .where(eq(schema.properties.code, code.trim().toUpperCase()))
    .limit(1);
  return row?.id ?? null;
}

export function registerWebhookRoutes(app: Hono) {
  /* ------------------------------------------------ leads de portais */
  app.post("/api/webhooks/leads/:token", async (c) => {
    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
    if (rateLimited(ip)) return c.json({ error: "rate limit" }, 429);

    const token = c.req.param("token");
    const db = await getDb();
    const { config: hook } = await config(db, "lead_webhook");

    // tokens fixos por portal (informados no painel do portal) ou o token geral
    const known = new Set(["imovelweb", "zap", "olx"]);
    const valid = (hook.token && token === hook.token) || known.has(token);
    if (!valid) {
      await logEvent(db, "lead_webhook", "webhook", false, `Token inválido (${ip})`);
      return c.json({ error: "unauthorized" }, 401);
    }

    let payload: Record<string, unknown> = {};
    try {
      payload = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json({ error: "json inválido" }, 400);
    }

    const normalized = normalizeWebhookLead(payload, known.has(token) ? token : "webhook");
    if (!normalized.phone && !normalized.email) {
      await logEvent(db, "lead_webhook", "webhook", false, "Payload sem telefone e sem e-mail");
      return c.json({ error: "informe telefone ou e-mail" }, 400);
    }

    const result = await intakeLead(db, {
      ...normalized,
      propertyId: await propertyIdFromCode(db, normalized.propertyCode),
    });
    await logEvent(
      db,
      "lead_webhook",
      "webhook",
      true,
      `${normalized.portal}: ${result.detail} (lead #${result.id})`,
    );
    return c.json({ ok: true, leadId: result.id, duplicated: result.duplicated }, 200);
  });

  /* ------------------------------------------------------- whatsapp */
  app.get("/api/webhooks/whatsapp", async (c) => {
    const db = await getDb();
    const { config: wa } = await config(db, "whatsapp_cloud");
    const mode = c.req.query("hub.mode");
    const token = c.req.query("hub.verify_token");
    const challenge = c.req.query("hub.challenge") ?? "";
    if (!wa.verifyToken) return c.text("verify token não configurado", 503);
    if (mode === "subscribe" && token === wa.verifyToken) {
      await logEvent(db, "whatsapp_cloud", "webhook", true, "Webhook verificado pela Meta");
      return c.text(challenge, 200);
    }
    await logEvent(db, "whatsapp_cloud", "webhook", false, "Falha na verificação do webhook");
    return c.text("forbidden", 403);
  });

  app.post("/api/webhooks/whatsapp", async (c) => {
    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
    if (rateLimited(ip)) return c.json({ error: "rate limit" }, 429);

    const db = await getDb();
    const { config: wa, enabled } = await config(db, "whatsapp_cloud");
    const raw = await c.req.text();

    const signature = await verifyMetaSignature(
      wa.appSecret ?? "",
      raw,
      c.req.header("x-hub-signature-256") ?? null,
    );
    if (!signature.ok) {
      await logEvent(db, "whatsapp_cloud", "webhook", false, `Assinatura recusada: ${signature.reason}`);
      return c.json({ error: signature.reason }, 401);
    }
    if (!enabled) {
      await logEvent(db, "whatsapp_cloud", "webhook", false, "Integração desativada no painel");
      return c.json({ ok: true, ignored: true }, 200);
    }

    let payload: unknown = {};
    try {
      payload = JSON.parse(raw);
    } catch {
      return c.json({ error: "json inválido" }, 400);
    }

    const baseUrl = siteBaseUrl(c.req.raw.headers);
    for (const message of parseWhatsappWebhook(payload)) {
      const conversation = await ensureConversation(db, {
        channel: "whatsapp",
        externalId: message.from,
        contactName: message.name,
        contactPhone: message.from,
      });
      await addMessage(db, conversation.id, {
        direction: "in",
        author: "cliente",
        authorName: message.name,
        body: message.text,
        externalId: message.messageId,
      });

      const lead = await intakeLead(db, {
        name: message.name ?? "Contato WhatsApp",
        phone: message.from,
        interest: "Contato por WhatsApp",
        message: message.text,
        source: "whatsapp",
        channel: "whatsapp",
      });
      await db
        .update(schema.conversations)
        .set({ leadId: conversation.leadId ?? lead.id })
        .where(eq(schema.conversations.id, conversation.id));

      const turn = await aiTurn(db, conversation.id, baseUrl);
      if (turn.replied && turn.text) {
        try {
          await sendWhatsappText(wa, message.from, turn.text);
        } catch (error) {
          await logEvent(
            db,
            "whatsapp_cloud",
            "error",
            false,
            `Falha ao responder: ${error instanceof Error ? error.message : "erro"}`,
          );
        }
      }
    }

    return c.json({ ok: true }, 200);
  });

  /* ------------------------------------------- meta (lead ads / dm) */
  app.get("/api/webhooks/meta", async (c) => {
    const db = await getDb();
    const mode = c.req.query("hub.mode");
    const token = c.req.query("hub.verify_token");
    const challenge = c.req.query("hub.challenge") ?? "";
    const candidates = await Promise.all(
      ["meta_lead_ads", "instagram_dm", "facebook_messenger"].map(async (key) => {
        const { config: item } = await config(db, key);
        return { key, verifyToken: item.verifyToken ?? "" };
      }),
    );
    const match = candidates.find((item) => item.verifyToken && item.verifyToken === token);
    if (mode === "subscribe" && match) {
      await logEvent(db, match.key, "webhook", true, "Webhook verificado pela Meta");
      return c.text(challenge, 200);
    }
    return c.text("forbidden", 403);
  });

  app.post("/api/webhooks/meta", async (c) => {
    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
    if (rateLimited(ip)) return c.json({ error: "rate limit" }, 429);

    const db = await getDb();
    const raw = await c.req.text();
    const header = c.req.header("x-hub-signature-256") ?? null;

    const secrets = await Promise.all(
      ["meta_lead_ads", "instagram_dm", "facebook_messenger"].map(async (key) => {
        const { config: item, enabled } = await config(db, key);
        return { key, item, enabled };
      }),
    );
    const withSecret = secrets.find((entry) => entry.item.appSecret);
    const signature = await verifyMetaSignature(withSecret?.item.appSecret ?? "", raw, header);
    if (!signature.ok) {
      await logEvent(db, "meta_lead_ads", "webhook", false, `Assinatura recusada: ${signature.reason}`);
      return c.json({ error: signature.reason }, 401);
    }

    let payload: unknown = {};
    try {
      payload = JSON.parse(raw);
    } catch {
      return c.json({ error: "json inválido" }, 400);
    }

    /* Lead Ads */
    const leadgens = parseLeadgenWebhook(payload);
    if (leadgens.length) {
      const entry = secrets.find((item) => item.key === "meta_lead_ads");
      const pageToken = entry?.item.pageToken ?? "";
      for (const leadgen of leadgens) {
        if (!pageToken) {
          await logEvent(
            db,
            "meta_lead_ads",
            "webhook",
            false,
            `Lead ${leadgen.leadgenId} recebido, mas falta o token da página para buscar os dados.`,
          );
          continue;
        }
        try {
          const data = await fetchLeadgen(leadgen.leadgenId, pageToken);
          const result = await intakeLead(db, {
            name: data.fields.full_name ?? data.fields.first_name ?? "Lead Meta",
            phone: data.fields.phone_number ?? "",
            email: data.fields.email ?? null,
            interest: data.fields.interesse ?? "Formulário Meta Lead Ads",
            message: Object.entries(data.fields)
              .map(([key, value]) => `${key}: ${value}`)
              .join("\n"),
            source: "meta_lead_ads",
            portal: "meta",
            channel: "lead_ads",
            campaign: data.campaign,
            externalId: leadgen.leadgenId,
          });
          await logEvent(
            db,
            "meta_lead_ads",
            "webhook",
            true,
            `${result.detail} (lead #${result.id})`,
          );
        } catch (error) {
          await logEvent(
            db,
            "meta_lead_ads",
            "error",
            false,
            `Falha ao buscar lead ${leadgen.leadgenId}: ${error instanceof Error ? error.message : "erro"}`,
          );
        }
      }
    }

    /* Instagram / Messenger */
    const baseUrl = siteBaseUrl(c.req.raw.headers);
    for (const message of parseMetaMessaging(payload)) {
      const key = message.platform === "instagram" ? "instagram_dm" : "facebook_messenger";
      const entry = secrets.find((item) => item.key === key);
      if (!entry?.enabled) {
        await logEvent(db, key, "webhook", false, "Integração desativada no painel");
        continue;
      }
      const conversation = await ensureConversation(db, {
        channel: message.platform,
        externalId: message.senderId,
        contactName: null,
      });
      await addMessage(db, conversation.id, {
        direction: "in",
        author: "cliente",
        body: message.text,
        externalId: message.messageId,
      });
      const turn = await aiTurn(db, conversation.id, baseUrl);
      let delivered = false;
      if (turn.replied && turn.text) {
        try {
          await sendMetaMessage(entry.item, message.senderId, turn.text, message.platform);
          delivered = true;
        } catch (error) {
          await logEvent(
            db,
            key,
            "error",
            false,
            `Falha ao responder: ${error instanceof Error ? error.message : "erro"}`,
          );
        }
      }
      await logEvent(
        db,
        key,
        "webhook",
        true,
        turn.replied
          ? delivered
            ? "Mensagem recebida e respondida pela IA"
            : "Resposta da IA gravada no painel, mas não entregue pela Meta"
          : `Mensagem recebida (${turn.skipped})`,
      );
    }

    return c.json({ ok: true }, 200);
  });
}

/**
 * Central de Integrações.
 *
 * Regras que não se negociam:
 * - segredo nunca volta cru para o navegador (maskConfig);
 * - salvar com o valor mascarado preserva o segredo já gravado;
 * - portal de imóveis só vira "conectado" por confirmação manual do
 *   administrador (o portal precisa confirmar a leitura do XML);
 * - toda ação fica na auditoria.
 */
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { and, desc, eq, like } from "drizzle-orm";
import { adminBase } from "../lib/admin-base";
import { audit } from "../lib/audit";
import { clientIp, siteBaseUrl } from "../lib/base-url";
import { runTest } from "../lib/integration-tests";
import * as schema from "../database/schema";
import {
  CATEGORIES,
  INTEGRATIONS,
  findIntegration,
  getIntegrationRow,
  listEvents,
  logEvent,
  maskConfig,
  parseConfig,
  readConfig,
  saveIntegration,
  statusFromConfig,
  type ConfigMap,
} from "../lib/integrations";
import {
  LEAD_WEBHOOK_SLOTS,
  ensureWebhookTokens,
  isStrongToken,
  randomWebhookToken,
} from "../lib/lead-webhook-token";
import { adminInstagram } from "./admin-instagram";
import { OLX_MANUAL_REASON, propertyPublicationChecks } from "../lib/publication-checklist";

const keyInput = z.object({ key: z.string().min(2).max(60) });

function isMasked(value: string) {
  return value.startsWith("••••");
}

/** Une o que veio do formulário com o que já estava salvo. */
function mergeConfig(existing: ConfigMap, incoming: ConfigMap, secretKeys: Set<string>) {
  const out: ConfigMap = { ...existing };
  for (const [field, value] of Object.entries(incoming)) {
    if (secretKeys.has(field)) {
      // mascarado ou vazio => mantém o segredo já gravado
      if (!value || isMasked(value)) continue;
      out[field] = value.trim();
      continue;
    }
    out[field] = value;
  }
  return out;
}

function publicUrls(key: string, baseUrl: string, config: ConfigMap) {
  switch (key) {
    case "mercadolivre":
      return [{ label: "URI de redirect (retorno da autorização)", url: `${baseUrl}/api/oauth/mercadolivre/callback` }];
    case "imovelguide":
      return [{ label: "XML exclusivo para o Imóvel Guide", url: `${baseUrl}/feed/imovelguide.xml` }];
    case "feed_imoveis":
      return [{ label: "Feed geral", url: `${baseUrl}/feed/imoveis.xml` }];
    case "zap_vivareal":
      return [{ label: "XML para o Canal Pro", url: `${baseUrl}/feed/zap.xml` }];
    case "olx":
      return [{ label: "XML para a OLX", url: `${baseUrl}/feed/olx.xml` }];
    case "imovelweb":
      return [
        { label: "XML para o Imovelweb", url: `${baseUrl}/feed/imovelweb.xml` },
        {
          label: "Webhook de leads",
          url: 'URL própria em "Webhook de leads" (token exclusivo do Imovelweb)',
        },
      ];
    case "sitemap":
      return [
        { label: "Sitemap", url: `${baseUrl}/sitemap.xml` },
        { label: "Robots", url: `${baseUrl}/robots.txt` },
      ];
    case "lead_webhook":
      /* Uma URL por origem: cada portal recebe um token exclusivo, para que
         vazar a URL de um não abra a porta dos outros. */
      return LEAD_WEBHOOK_SLOTS.map((slot) => {
        const value = (config[slot.configKey] ?? "").trim();
        return {
          label: slot.label,
          url: isStrongToken(value)
            ? `${baseUrl}/api/webhooks/leads/${value}`
            : "Salve para gerar o token",
        };
      });
    case "whatsapp_cloud":
      return [{ label: "Webhook (Meta)", url: `${baseUrl}/api/webhooks/whatsapp` }];
    case "meta_lead_ads":
    case "instagram_dm":
    case "facebook_messenger":
      return [{ label: "Webhook (Meta)", url: `${baseUrl}/api/webhooks/meta` }];
    default:
      return [];
  }
}

export const adminIntegrations = {
  instagram: adminInstagram,

  /** Lista a central completa; serviços de apoio não permitem envio de anúncios. */
  publicationTargets: adminBase.handler(async ({ context }) => {
    const rows = await context.db.select().from(schema.integrations);
    const byKey = new Map(rows.map((row) => [row.key, row]));
    const social = [
      { key: "instagram", name: "Instagram", integration: "instagram_publicacao", required: ["userId", "accessToken"] },
      { key: "facebook", name: "Facebook", integration: "facebook_publicacao", required: ["pageId", "pageToken"] },
      { key: "youtube", name: "YouTube Shorts", integration: "youtube_publicacao", required: ["clientId", "clientSecret", "refreshToken"] },
    ].map((target) => {
      const row = byKey.get(target.integration);
      const config = parseConfig(row?.config);
      const ready = row?.enabled === 1 && row.status === "conectado" && target.required.every((key) => Boolean(config[key]?.trim()));
      return { key: target.key, name: target.name, ready, reason: ready ? "Pronto para enviar" : "Conexão de publicação pendente" };
    });
    return [
      ...social,
      { key: "tiktok", name: "TikTok", ready: false, reason: "Envio pelo CRM ainda pendente" },
      ...INTEGRATIONS.filter((def) => def.key !== "tiktok_publishing").map((def) => {
        const row = byKey.get(def.key);
        if (def.key === "imovelguide") return { key: def.key, name: def.name, ready: row?.enabled === 1 && row.status === "conectado", reason: "Selecionar e enviar inclui este imóvel no XML exclusivo. A publicação depende da importação pelo Imóvel Guide. Para retirar, use Portais → Imóvel Guide. Confirme a leitura em Integrações somente após conferir o anúncio no portal." };
        return { key: def.key, name: def.name, ready: false, reason: def.key === "olx" ? OLX_MANUAL_REASON : def.category !== "Portais de Imóveis" ? "Serviço de apoio; não recebe anúncios por este botão" : row?.status === "conectado" ? "Conta conectada; envio pelo CRM ainda pendente" : "Conexão de publicação pendente" };
      }),
    ];
  }),

  publicationChecks: adminBase.input(z.object({ propertyId: z.number().int().positive() })).handler(async ({ input, context }) => {
    const rows = await context.db.select().from(schema.propertyChannels)
      .where(and(eq(schema.propertyChannels.propertyId, input.propertyId), like(schema.propertyChannels.channel, "diagnostic_%")))
      .orderBy(desc(schema.propertyChannels.id)).limit(100);
    const seen = new Set<string>();
    return rows.flatMap((row) => {
      const key = row.channel.slice("diagnostic_".length);
      if (seen.has(key)) return [];
      seen.add(key);
      try { return [{ key, at: row.updatedAt.toISOString(), checks: JSON.parse(row.message || "[]") as { ok: boolean; label: string; detail: string }[] }]; }
      catch { return []; }
    });
  }),

  diagnosePublication: adminBase.input(z.object({ propertyId: z.number().int().positive(), key: z.string().min(2).max(60) })).handler(async ({ input, context }) => {
    if (!["instagram", "facebook", "youtube", "tiktok", ...INTEGRATIONS.map((def) => def.key)].includes(input.key)) throw new ORPCError("BAD_REQUEST", { message: "Plataforma inválida." });
    const checks = await propertyPublicationChecks(context.db, input.propertyId, input.key);
    const now = new Date();
    await context.db.insert(schema.propertyChannels).values({ propertyId: input.propertyId, channel: `diagnostic_${input.key}`, authorized: 0, status: "aguardando", message: JSON.stringify(checks), updatedAt: now });
    return { key: input.key, checks, at: now.toISOString() };
  }),

  /** Catálogo + situação de cada integração, agrupado por categoria. */
  list: adminBase.handler(async ({ context }) => {
    const rows = await context.db.select().from(schema.integrations);
    const byKey = new Map(rows.map((row) => [row.key, row]));
    const baseUrl = siteBaseUrl(context.headers);

    const items = INTEGRATIONS.map((def) => {
      const row = byKey.get(def.key);
      const config = parseConfig(row?.config);
      const masked = maskConfig(def, config);
      return {
        key: def.key,
        category: def.category,
        name: def.name,
        mark: def.mark,
        purpose: def.purpose,
        method: def.method,
        pending: def.pending,
        docsUrl: def.docsUrl ?? null,
        available: def.available,
        selfServed: Boolean(def.selfServed),
        canTest: def.canTest,
        canSync: def.canSync,
        fields: def.fields,
        config: masked.config,
        filled: masked.filled,
        status: def.available ? (row?.status ?? "nao_configurado") : "nao_disponivel",
        enabled: row?.enabled === 1,
        lastError: row?.lastError ?? null,
        lastTestAt: row?.lastTestAt ?? null,
        lastSyncAt: row?.lastSyncAt ?? null,
        urls: publicUrls(def.key, baseUrl, config),
      };
    });

    const counts = {
      total: items.length,
      conectado: items.filter((item) => item.status === "conectado").length,
      pendente: items.filter(
        (item) => item.status === "aguardando_credencial" || item.status === "configurando",
      ).length,
      erro: items.filter((item) => item.status === "erro").length,
      indisponivel: items.filter((item) => item.status === "nao_disponivel").length,
    };

    return { categories: [...CATEGORIES], items, counts, baseUrl };
  }),

  /** Detalhe + histórico de eventos. */
  get: adminBase.input(keyInput).handler(async ({ input, context }) => {
    const def = findIntegration(input.key);
    if (!def) throw new ORPCError("NOT_FOUND", { message: "Integração desconhecida" });
    const row = await getIntegrationRow(context.db, input.key);
    const config = parseConfig(row?.config);
    return {
      key: def.key,
      config: maskConfig(def, config).config,
      status: def.available ? (row?.status ?? "nao_configurado") : "nao_disponivel",
      enabled: row?.enabled === 1,
      lastError: row?.lastError ?? null,
      urls: publicUrls(def.key, siteBaseUrl(context.headers), config),
      events: await listEvents(context.db, input.key, 25),
    };
  }),

  /** Salva a configuração preservando segredos já gravados. */
  save: adminBase
    .input(keyInput.extend({ config: z.record(z.string(), z.string()) }))
    .handler(async ({ input, context }) => {
      const def = findIntegration(input.key);
      if (!def) throw new ORPCError("NOT_FOUND", { message: "Integração desconhecida" });
      if (!def.available) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Esta integração não tem caminho oficial disponível hoje.",
        });
      }

      const allowed = new Set(def.fields.map((field) => field.key));
      const secretKeys = new Set(def.fields.filter((field) => field.secret).map((f) => f.key));
      const incoming: ConfigMap = {};
      for (const [field, value] of Object.entries(input.config)) {
        if (allowed.has(field)) incoming[field] = String(value).slice(0, 4000);
      }

      const { config: existing } = await readConfig(context.db, input.key);
      const merged = mergeConfig(existing, incoming, secretKeys);
      if (input.key === "mercadolivre" && (merged.clientId !== existing.clientId || merged.clientSecret !== existing.clientSecret)) {
        for (const field of ["accessToken", "refreshToken", "tokenExpiresAt", "sellerId", "sellerName", "oauthState", "oauthSession", "oauthExpiresAt", "codeVerifier"]) delete merged[field];
      }

      /* Tokens do webhook de leads são gerados pelo servidor: um por origem.
         Slot vazio, fraco ou herdado dos literais revogados ("zap", "olx",
         "imovelweb") é substituído por um token aleatório aqui. */
      let rotatedSlots: string[] = [];
      if (input.key === "lead_webhook") {
        const ensured = ensureWebhookTokens(merged);
        rotatedSlots = ensured.rotated;
        for (const [field, value] of Object.entries(ensured.config)) merged[field] = value;
      }

      const previousStatus = (await getIntegrationRow(context.db, input.key))?.status ?? "";
      const status =
        previousStatus === "conectado" && !def.selfServed && (input.key !== "mercadolivre" || Boolean(merged.accessToken))
          ? "conectado"
          : statusFromConfig(def, merged);

      await saveIntegration(context.db, input.key, { config: merged, status, lastError: null });
      await logEvent(
        context.db,
        input.key,
        "config",
        true,
        `Configuração salva (campos: ${Object.keys(incoming).join(", ") || "nenhum"})` +
          (rotatedSlots.length ? ` · tokens gerados: ${rotatedSlots.join(", ")}` : ""),
      );
      await audit(context.db, context.user, "integracao.salvar", {
        entity: "integration",
        entityId: input.key,
        detail: `campos alterados: ${Object.keys(incoming).join(", ") || "nenhum"}`,
        ip: clientIp(context.headers),
      });

      return { ok: true, status };
    }),

  /** Liga/desliga o uso da integração (não apaga credenciais). */
  toggle: adminBase
    .input(keyInput.extend({ enabled: z.boolean() }))
    .handler(async ({ input, context }) => {
      const def = findIntegration(input.key);
      if (!def) throw new ORPCError("NOT_FOUND", { message: "Integração desconhecida" });
      if (def.key === "tiktok_publishing" && input.enabled) {
        throw new ORPCError("BAD_REQUEST", { message: "TikTok aguarda vinculação e validação da publicação" });
      }
      if (def.key === "mercadolivre" && input.enabled) {
        const current = await readConfig(context.db, input.key);
        if (!current.config.accessToken || current.row?.status !== "conectado") throw new ORPCError("BAD_REQUEST", { message: "Conecte e teste a conta do Mercado Livre primeiro." });
      }
      if (!def.available && input.enabled) {
        throw new ORPCError("BAD_REQUEST", { message: "Integração não disponível" });
      }
      await saveIntegration(context.db, input.key, { enabled: input.enabled });
      await audit(context.db, context.user, input.enabled ? "integracao.ativar" : "integracao.desativar", {
        entity: "integration",
        entityId: input.key,
        ip: clientIp(context.headers),
      });
      return { ok: true };
    }),

  /** Teste real de conexão. Nunca inventa sucesso. */
  test: adminBase.input(keyInput).handler(async ({ input, context }) => {
    const def = findIntegration(input.key);
    if (!def) throw new ORPCError("NOT_FOUND", { message: "Integração desconhecida" });
    if (!def.canTest) {
      return { ok: false, status: "nao_disponivel" as const, message: "Sem teste automático disponível." };
    }

    const { config } = await readConfig(context.db, input.key);
    const baseUrl = siteBaseUrl(context.headers);
    let result;
    try {
      result = await runTest(context.db, input.key, config, baseUrl);
    } catch (error) {
      result = {
        ok: false,
        status: "erro" as const,
        message: error instanceof Error ? error.message : "Falha no teste",
      };
    }

    const row = await getIntegrationRow(context.db, input.key);
    const keepConnected = row?.status === "conectado" && !result.ok && !def.selfServed && input.key !== "mercadolivre";
    await saveIntegration(context.db, input.key, {
      status: keepConnected ? "conectado" : result.status,
      lastError: result.ok ? null : result.message,
    });
    await context.db
      .update(schema.integrations)
      .set({ lastTestAt: new Date() })
      .where(eq(schema.integrations.key, input.key));

    await logEvent(context.db, input.key, "test", result.ok, result.message);
    await audit(context.db, context.user, "integracao.testar", {
      entity: "integration",
      entityId: input.key,
      detail: `${result.ok ? "ok" : "falha"}: ${result.message}`,
      ip: clientIp(context.headers),
    });

    return result;
  }),

  /**
   * Confirmação manual de portal: só o administrador, depois que o portal
   * avisou que leu o XML, pode marcar como conectado.
   */
  confirmPortal: adminBase
    .input(keyInput.extend({ confirmed: z.boolean(), note: z.string().max(300).optional() }))
    .handler(async ({ input, context }) => {
      const def = findIntegration(input.key);
      if (!def) throw new ORPCError("NOT_FOUND", { message: "Integração desconhecida" });
      if (def.category !== "Portais de Imóveis" || !def.available || def.key === "mercadolivre") {
        throw new ORPCError("BAD_REQUEST", { message: "Confirmação manual só vale para portais." });
      }

      const { config } = await readConfig(context.db, input.key);
      const stamp = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
      if (input.confirmed) {
        config.confirmedAt = stamp;
        if (input.note) config.confirmNote = input.note;
      } else {
        delete config.confirmedAt;
        delete config.confirmNote;
      }

      await saveIntegration(context.db, input.key, {
        config,
        status: input.confirmed ? "conectado" : statusFromConfig(def, config),
        lastError: null,
      });
      const message = input.confirmed
        ? `Leitura do XML confirmada manualmente em ${stamp}${input.note ? ` — ${input.note}` : ""}`
        : "Confirmação manual removida";
      await logEvent(context.db, input.key, "config", true, message);
      await audit(context.db, context.user, "integracao.confirmar_portal", {
        entity: "integration",
        entityId: input.key,
        detail: message,
        ip: clientIp(context.headers),
      });
      return { ok: true, message };
    }),

  /** Regenera o token do webhook de leads. */
  rotateToken: adminBase.input(keyInput).handler(async ({ input, context }) => {
    if (input.key !== "lead_webhook") {
      throw new ORPCError("BAD_REQUEST", { message: "Só o webhook de leads tem token." });
    }
    const { config } = await readConfig(context.db, input.key);
    /* Rotaciona TODOS os slots: o geral e um por portal. */
    for (const slot of LEAD_WEBHOOK_SLOTS) config[slot.configKey] = randomWebhookToken();
    await saveIntegration(context.db, input.key, { config, status: "conectado" });
    await logEvent(
      context.db,
      input.key,
      "config",
      true,
      `Tokens do webhook regenerados (${LEAD_WEBHOOK_SLOTS.length} slots)`,
    );
    await audit(context.db, context.user, "integracao.rotate_token", {
      entity: "integration",
      entityId: input.key,
      ip: clientIp(context.headers),
    });
    return { ok: true, url: `${siteBaseUrl(context.headers)}/api/webhooks/leads/${config.token}` };
  }),

  /** Marca a geração do feed/sitemap (arquivo é sempre gerado ao vivo). */
  sync: adminBase.input(keyInput).handler(async ({ input, context }) => {
    const def = findIntegration(input.key);
    if (!def?.canSync) throw new ORPCError("BAD_REQUEST", { message: "Sem sincronização manual." });
    await context.db
      .update(schema.integrations)
      .set({ lastSyncAt: new Date() })
      .where(eq(schema.integrations.key, input.key));
    await logEvent(context.db, input.key, "sync", true, "Arquivo regerado sob demanda");
    return { ok: true };
  }),

  events: adminBase
    .input(keyInput.extend({ limit: z.number().int().min(1).max(100).optional() }))
    .handler(({ input, context }) => listEvents(context.db, input.key, input.limit ?? 25)),
};

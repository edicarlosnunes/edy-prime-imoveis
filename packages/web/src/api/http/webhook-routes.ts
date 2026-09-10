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
import {
  advanceInboundEvent,
  claimInboundEvent,
  completeInboundEvent,
  failInboundEvent,
  stageReached,
} from "../lib/inbound-idempotency";
import { intakeLead, normalizeWebhookLead } from "../lib/lead-intake";
import { logEvent, parseConfig } from "../lib/integrations";
import { createRateLimiter, resolveWebhookPortal } from "../lib/lead-webhook-token";
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

/**
 * Limite simples por IP (best-effort: memória do runtime), compartilhado por
 * todos os webhooks — mesmo comportamento de sempre, agora testável.
 */
const rateLimited = createRateLimiter(60, 60 * 1000);

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

    /* Só tokens fortes gravados no config autenticam. Os literais "zap",
       "olx" e "imovelweb" foram revogados na correção de segurança de
       10/09/2026 — ver lib/lead-webhook-token.ts. */
    const portal = resolveWebhookPortal(hook, token);
    if (!portal) {
      await logEvent(db, "lead_webhook", "webhook", false, `Token inválido (${ip})`);
      return c.json({ error: "unauthorized" }, 401);
    }

    let payload: Record<string, unknown> = {};
    try {
      payload = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json({ error: "json inválido" }, 400);
    }

    const normalized = normalizeWebhookLead(payload, portal);
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
    let processed = 0;
    let duplicated = 0;
    let resumed = 0;
    let failed = 0;
    for (const message of parseWhatsappWebhook(payload)) {
      /* IDEMPOTÊNCIA (10/09/2026) — trava ANTES de qualquer efeito colateral.
         A Meta reenvia o mesmo webhook quando não recebe 200 rápido. A reserva
         do wamid em `inbound_events` é atômica: se o evento já foi CONCLUÍDO
         (ou está sendo processado agora por uma requisição concorrente),
         paramos aqui, sem gravar mensagem, sem mexer em lead e — o ponto
         crítico — sem acionar a IA uma segunda vez.

         Se uma tentativa anterior morreu no meio, a reserva volta como órfã
         (`failed` ou prazo expirado) e este processo a assume com
         `resumed: true`, retomando de `claim.stage`. É isso que impede uma
         reserva órfã de bloquear a mensagem para sempre. */
      const claim = await claimInboundEvent(db, "whatsapp", message.messageId);
      if (!claim.claimed) {
        duplicated++;
        continue;
      }
      if (claim.resumed) resumed++;

      try {
        const conversation = await ensureConversation(db, {
          channel: "whatsapp",
          externalId: message.from,
          contactName: message.name,
          contactPhone: message.from,
        });

        /* Etapa 1 — histórico. Segunda linha de defesa: o índice UNIQUE em
           (conversation_id, external_id) impede segunda inserção; nesse caso
           `inserted: false` e nada de unread/histórico/qualificação é refeito. */
        if (!stageReached(claim.stage, "stored")) {
          await addMessage(db, conversation.id, {
            direction: "in",
            author: "cliente",
            authorName: message.name,
            body: message.text,
            externalId: message.messageId,
          });
          await advanceInboundEvent(db, claim.eventId, "stored");
        }

        /* Etapa 2 — lead no CRM. */
        if (!stageReached(claim.stage, "lead_linked")) {
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
          await advanceInboundEvent(db, claim.eventId, "lead_linked");
        }

        /* Etapa 3 — IA. A etapa é marcada ANTES da chamada, de propósito: a IA
           é no MÁXIMO uma vez por wamid. Se a chamada falhar, o retry retoma
           daqui e NÃO chama a IA de novo — a mensagem fica no inbox para
           atendimento humano e a falha vai para o histórico da integração.
           Responder duas vezes ao cliente é pior que não responder. */
        if (!stageReached(claim.stage, "replied")) {
          await advanceInboundEvent(db, claim.eventId, "replied");
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

        await completeInboundEvent(db, claim.eventId);
        processed++;
      } catch (error) {
        /* Falha controlada: libera a reserva para que o reenvio da Meta possa
           retomar imediatamente, em vez de esperar o prazo expirar. */
        await failInboundEvent(db, claim.eventId, error);
        failed++;
        await logEvent(
          db,
          "whatsapp_cloud",
          "error",
          false,
          `Falha ao processar mensagem (retry liberado): ${
            error instanceof Error ? error.message : "erro"
          }`,
        );
      }
    }

    /* Duplicata é evento já processado, não erro: 200 para a Meta parar de
       reenviar. Erro aqui só geraria retry e mais duplicata. */
    if (duplicated > 0) {
      await logEvent(
        db,
        "whatsapp_cloud",
        "webhook",
        true,
        `Reenvio da Meta ignorado: ${duplicated} mensagem(ns) já processada(s)`,
      );
    }
    /* Falha de verdade é o caso em que o retry da Meta é DESEJADO: devolvemos
       502 para que ela reenvie e o processamento retome de onde parou. */
    if (failed > 0) {
      return c.json({ ok: false, processed, duplicated, resumed, failed }, 502);
    }
    return c.json({ ok: true, processed, duplicated, resumed }, 200);
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

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
import { addMessage, aiTurn, conversationTurns, ensureConversation } from "../lib/inbox";
import {
  advanceInboundEvent,
  claimInboundEvent,
  completeInboundEvent,
  failInboundEvent,
  stageReached,
} from "../lib/inbound-idempotency";
import { intakeLead, normalizeWebhookLead } from "../lib/lead-intake";
import { classifyMetaContact, metaPropertyReference, parseMetaContactEvents } from "../lib/meta-contact-events";
import { logEvent, parseConfig } from "../lib/integrations";
import { createRateLimiter, resolveWebhookPortal } from "../lib/lead-webhook-token";
import { addOwnerPhotos, serializeOwnerPhotos } from "../lib/capture-photos";
import {
  bindCaptureShareToCapture,
  latestCaptureShareForSender,
  redeemCaptureShareToken,
} from "../lib/capture-share-tokens";
import { captureSnapshot, linkCaptureSession } from "../agent/owner-capture";
import {
  isReusableGenericLinkEntry,
  propertyInquiryTurns,
  linkCaptacaoState,
} from "../agent/link-captacao";
import {
  fetchLeadgen,
  parseLeadgenWebhook,
  downloadWhatsappMedia,
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

async function whatsappMediaHex(mediaId: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`whatsapp:${mediaId}`),
  );
  return Array.from(new Uint8Array(digest).slice(0, 12), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
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
        const shareTokenMatch = /^LINK_CAPTACAO:([a-f0-9]{64})$/i.exec(message.text.trim());
        const redeemedShare = shareTokenMatch
          ? await redeemCaptureShareToken(db, shareTokenMatch[1]!, message.from)
          : null;
        const conversation = await ensureConversation(db, {
          channel: "whatsapp",
          externalId: message.from,
          contactName: message.name,
          contactPhone: message.from,
        });
        const {receiveReviewReply} = await import("../lib/property-review");
        if (await receiveReviewReply(db, message.from, message.text)) {
          await addMessage(db, conversation.id, {direction:"in",author:"cliente",authorName:message.name ?? "Proprietário",body:message.text});
          await completeInboundEvent(db, claim.eventId);
          processed++;
          continue;
        }
        const senderShare = await latestCaptureShareForSender(db, message.from);
        const priorCaptureState = senderShare?.status === "completed"
          ? await linkCaptacaoState(
              db,
              message.from,
              await conversationTurns(db, conversation.id),
            )
          : null;
        const inquiryTurns = propertyInquiryTurns([
          ...await conversationTurns(db, conversation.id),
          { role: "user", content: message.text },
        ]);
        const completionGuard = !inquiryTurns && senderShare?.status === "completed" &&
          !isReusableGenericLinkEntry(message.text) &&
          !priorCaptureState?.genericPublic;
        const snapshotBeforeInbound = !inquiryTurns && senderShare?.status === "redeemed"
          ? await captureSnapshot(db, message.from, senderShare.captureId ?? undefined)
          : null;
        const sessionBeforeInbound = snapshotBeforeInbound?.ownerId
          ? await linkCaptureSession(db, snapshotBeforeInbound.ownerId)
          : null;

        /* O marcador de imagem é interno: texto digitado não prova que
           a Meta entregou uma mídia, nem pode avançar o lead do corretor. */
        if (!message.mediaId && /^\[imagem:/i.test(message.text.trim())) {
          message.text = "[texto de imagem não verificado]";
        }
        let trustedCaptureMedia = false;
        if (message.mediaId) {
          if (completionGuard) {
            message.text = "[imagem recebida]";
          } else {
            const priorTurns = await conversationTurns(db, conversation.id);
            const captureState = await linkCaptacaoState(
              db,
              message.from,
              priorTurns,
            );
            const activeShare = senderShare?.status === "redeemed" ? senderShare : null;
            const authorizedShare = activeShare?.id === captureState?.shareTokenId
              ? activeShare
              : null;
            const brokerMedia = captureState?.presenter === "corretor" &&
              captureState.active && !captureState.completionGuard &&
              captureState.nextStep === "fotoFrente" &&
              (captureState.shareTokenId == null ||
                (activeShare?.id === captureState.shareTokenId && activeShare.captureId === null));
            let validatedCaptureId: number | null = null;
            if (!brokerMedia) {
              const publicCaptureId = captureState?.genericPublic && captureState.active &&
                !captureState.completionGuard
                ? captureState.snapshot.captureId
                : null;
              const captureId = authorizedShare?.captureId ?? publicCaptureId;
              if (captureId == null) {
                await completeInboundEvent(db, claim.eventId);
                processed++;
                continue;
              }
              const snapshot = await captureSnapshot(db, message.from, captureId);
              const origin = String(
                (snapshot.answers as Record<string, string | undefined>).origem ?? "",
              ).trim().toUpperCase();
              const validCaptureBinding = authorizedShare
                ? captureState?.shareTokenId === authorizedShare.id &&
                  captureState.shareCaptureId === captureId
                : captureState?.genericPublic === true &&
                  captureState.snapshot.captureId === captureId;

              /* Imagem só entra na ficha ativa deste remetente, na pergunta
                 de fachada. Lead de corretor não cria ficha de imóvel. */
              if (
                snapshot.captureId !== captureId ||
                origin !== "LINK_CAPTACAO" ||
                !captureState?.active ||
                !validCaptureBinding ||
                captureState.completionGuard ||
                captureState.nextStep !== "fotoFrente"
              ) {
                await completeInboundEvent(db, claim.eventId);
                processed++;
                continue;
              }
              validatedCaptureId = captureId;
            }

            const media = await downloadWhatsappMedia(wa, message.mediaId);
            const mediaKey = await whatsappMediaHex(message.mediaId);
            await db.insert(schema.media).values({
              id: mediaKey,
              mime: media.mime,
              size: media.size,
              data: media.data,
              name: "fachada-whatsapp",
              alt: "Foto provisória enviada pelo contato via WhatsApp",
            }).onConflictDoNothing();
            const url = `/api/media/${mediaKey}`;
            message.text = `[imagem:${url}]`;
            trustedCaptureMedia = true;

            if (validatedCaptureId !== null) {
              const [capture] = await db
                .select()
                .from(schema.propertyCaptures)
                .where(eq(schema.propertyCaptures.id, validatedCaptureId))
                .limit(1);
              if (!capture) throw new Error("Ficha ativa não encontrada para a foto da fachada");
              const photos = addOwnerPhotos(
                capture.ownerPhotos,
                [{ url, caption: "Fachada" }],
                { source: "proprietario" },
              );
              await db
                .update(schema.propertyCaptures)
                .set({ ownerPhotos: serializeOwnerPhotos(photos), updatedAt: new Date() })
                .where(eq(schema.propertyCaptures.id, validatedCaptureId));
            }
          }
        }

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
          let turn = completionGuard
            ? { replied: true, text: "Solicite outro link para cadastro." }
            : await aiTurn(db, conversation.id, baseUrl, {
                trustedWhatsappMedia: trustedCaptureMedia,
              });
          if (completionGuard && turn.text) {
            await addMessage(db, conversation.id, {
              direction: "out",
              author: "ia",
              body: turn.text,
            });
          }
          if (snapshotBeforeInbound) {
            const authorizedState = await linkCaptacaoState(
              db,
              message.from,
              await conversationTurns(db, conversation.id),
            );
            const snapshot = await captureSnapshot(
              db,
              message.from,
              senderShare?.captureId ?? undefined,
            );
            const sessionAfterInbound = snapshot.ownerId
              ? await linkCaptureSession(db, snapshot.ownerId)
              : null;
            const addressSavedNow = Boolean(
              snapshot.captureId &&
              (sessionBeforeInbound?.awaitingAddress
                ? !sessionAfterInbound?.awaitingAddress
                : snapshotBeforeInbound.nextStep === "endereco" &&
                  snapshot.answered.includes("endereco")),
            );
            const origin = String(
              (snapshot.answers as Record<string, string | undefined>).origem ?? "",
            ).trim().toUpperCase();
            if (
              addressSavedNow &&
              snapshot.captureId &&
              snapshot.address &&
              origin === "LINK_CAPTACAO" &&
              authorizedState?.presenter === "proprietario" &&
              authorizedState?.shareTokenId === senderShare?.id &&
              authorizedState?.genericPublic !== true &&
              redeemedShare?.ok !== false
            ) {
              const binding = await bindCaptureShareToCapture(
                db,
                message.from,
                snapshot.captureId,
                senderShare!.id,
              );
              if (!binding.ok) {
                turn = { ...turn, text: "Solicite outro link para cadastro." };
              }
            }
          }
          /* A conclusão do link exclusivo é feita no próprio fluxo de
             captação, vinculada ao token e à ficha que autorizaram o turno.
             Concluir aqui pelo "último token" poderia encerrar outro link
             resgatado pelo mesmo remetente entre o cadastro e a resposta. */
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
    // Cada integração pode usar um App Secret diferente. Validar somente o
    // primeiro configurado rejeita eventos legítimos das demais integrações.
    // Nunca aceitar eventos sem uma assinatura válida.
    const configuredSecrets = secrets.filter((entry) => entry.item.appSecret);
    let signedBy: string | null = null;
    for (const entry of configuredSecrets) {
      const signature = await verifyMetaSignature(entry.item.appSecret ?? "", raw, header);
      if (signature.ok) {
        signedBy = entry.key;
        break;
      }
    }
    if (!signedBy) {
      await logEvent(db, "meta_lead_ads", "webhook", false, "Assinatura Meta ausente ou inválida");
      return c.json({ error: "assinatura inválida" }, 401);
    }

    let payload: unknown = {};
    try {
      payload = JSON.parse(raw);
    } catch {
      return c.json({ error: "json inválido" }, 400);
    }

    /* Lead Ads — não confirmar recebimento bem-sucedido se a busca/gravação falhar.
       A Meta poderá reenviar; intakeLead deduplica pelo externalId. */
    const leadgens = parseLeadgenWebhook(payload);
    let failedLeadgens = 0;
    if (leadgens.length) {
      const entry = secrets.find((item) => item.key === "meta_lead_ads");
      const pageToken = entry?.item.pageToken ?? "";
      // Um evento leadgen deve ser assinado pelo app configurado para Lead Ads.
      if (signedBy !== "meta_lead_ads") {
        await logEvent(db, "meta_lead_ads", "webhook", false, "Evento leadgen assinado por outro aplicativo");
        return c.json({ error: "app de lead ads não corresponde à assinatura" }, 401);
      }
      for (const leadgen of leadgens) {
        if (!entry?.enabled || !pageToken) {
          failedLeadgens++;
          await logEvent(
            db,
            "meta_lead_ads",
            "webhook",
            false,
            `Lead ${leadgen.leadgenId} recebido, mas a integração está desativada ou falta token da página.`,
          );
          continue;
        }
        try {
          const data = await fetchLeadgen(leadgen.leadgenId, pageToken);
          // Um teste com identificador fictício pode não retornar dados pela Graph API.
          // Não criar um lead vazio no CRM e não afirmar sucesso nesse cenário.
          if (!data.fields.phone_number && !data.fields.email) {
            throw new Error("Graph API não retornou telefone nem e-mail do lead");
          }
          const formFields = Object.entries(data.fields)
            .map(([key, value]) => `${key}: ${value}`)
            .join("\n");
          // O anúncio e o formulário devem identificar o imóvel quando a Meta
          // entrega esse dado. Formulários genéricos continuam funcionando.
          const propertyCode = metaPropertyReference(
            [formFields, data.ad ?? ""].join("\n"), null,
          );
          const [property] = propertyCode ? await db.select({ id: schema.properties.id })
            .from(schema.properties).where(eq(schema.properties.code, propertyCode)).limit(1) : [];
          const statedInterest = Object.entries(data.fields)
            .find(([key]) => /interesse|objetivo|finalidade|assunto|deseja/i.test(key))?.[1] ?? "";
          const result = await intakeLead(db, {
            name: data.fields.full_name ?? data.fields.first_name ?? "Lead Meta",
            phone: data.fields.phone_number ?? "",
            email: data.fields.email ?? null,
            interest: statedInterest || (data.ad ? classifyMetaContact(data.ad) : "Formulário Meta Lead Ads"),
            message: [formFields,
              leadgen.formId ? `Formulário Meta: ${leadgen.formId}` : "",
              data.ad ? `Anúncio: ${data.ad}` : "",
              propertyCode ? `Imóvel: ${propertyCode}` : "",
            ].filter(Boolean).join("\n"),
            source: "meta_lead_ads",
            portal: "meta",
            channel: "lead_ads",
            campaign: data.campaign,
            externalId: leadgen.leadgenId,
            propertyId: effectivePropertyId,
          });
          if (!result.id) throw new Error("CRM não confirmou o ID do lead");
          await logEvent(
            db,
            "meta_lead_ads",
            "webhook",
            true,
            `${result.detail} (lead #${result.id})`,
          );
        } catch (error) {
          failedLeadgens++;
          await logEvent(
            db,
            "meta_lead_ads",
            "error",
            false,
            `Falha ao processar lead ${leadgen.leadgenId}: ${error instanceof Error ? error.message : "erro"}`,
          );
        }
      }
    }

    /* Instagram / Messenger: cada primeiro contato vira lead no CRM.
       Guardar o identificador do remetente da Meta (sem inventar telefone),
       o código do imóvel, o anúncio de origem e a conversa já existente.
       Reentregas não criam duplicatas nem geram resposta da IA novamente. */
    const baseUrl = siteBaseUrl(c.req.raw.headers);
    let failedMessages = 0;
    for (const message of parseMetaContactEvents(payload)) {
      const key = message.platform === "instagram" ? "instagram_dm" : "facebook_messenger";
      const entry = secrets.find((item) => item.key === key);
      if (!entry?.enabled) {
        await logEvent(db, key, "webhook", false, "Integração desativada no painel");
        continue;
      }
      try {
        const code = metaPropertyReference(message.text, message.referral);
        const [property] = code ? await db.select({ id: schema.properties.id })
          .from(schema.properties).where(eq(schema.properties.code, code)).limit(1) : [];
        const conversation = await ensureConversation(db, {
          channel: message.platform,
          externalId: message.senderId,
          contactName: null,
          propertyId: property?.id ?? null,
        });
        if (property?.id && property.id !== conversation.propertyId) {
          await db.update(schema.conversations).set({ propertyId: property.id })
            .where(eq(schema.conversations.id, conversation.id));
        }
        // A referência de um link m.me chega às vezes ANTES da mensagem.
        // Preservá-la na conversa não cria lead até haver manifestação real.
        if (!message.text) continue;
        const effectivePropertyId = property?.id ?? conversation.propertyId ?? null;
        const [priorProperty] = !code && effectivePropertyId
          ? await db.select({ code: schema.properties.code })
            .from(schema.properties).where(eq(schema.properties.id, effectivePropertyId)).limit(1)
          : [];
        const contextCode = code ?? priorProperty?.code ?? null;
        const recorded = await addMessage(db, conversation.id, {
          direction: "in",
          author: "cliente",
          body: message.text,
          externalId: message.messageId,
        });
        if (!conversation.leadId) {
          const result = await intakeLead(db, {
            name: `Contato ${message.platform === "instagram" ? "Instagram" : "Messenger"} ${message.senderId.slice(-6)}`,
            phone: "",
            interest: classifyMetaContact(message.text),
            message: [
              message.text,
              contextCode ? `Código do imóvel: ${contextCode}` : "",
              message.referral ? `Referência Meta: ${message.referral}` : "",
              message.adId ? `Anúncio Meta: ${message.adId}` : "",
            ].filter(Boolean).join("\n"),
            source: key,
            portal: "meta",
            channel: message.platform,
            campaign: message.adId ? `Meta ad ${message.adId}` : null,
            externalId: `meta-contact:${message.platform}:${message.senderId}`,
            propertyId: property?.id ?? null,
          });
          if (!result.id) throw new Error("CRM não confirmou ID do contato Meta");
          await db.update(schema.conversations)
            .set({ leadId: result.id, propertyId: conversation.propertyId ?? property?.id ?? null })
            .where(eq(schema.conversations.id, conversation.id));
          await logEvent(db, key, "webhook", true,
            `Contato Meta vinculado ao lead #${result.id}${contextCode ? ` · imóvel ${contextCode}` : ""}`);
        } else if (effectivePropertyId && !conversation.propertyId) {
          await db.update(schema.leads).set({ propertyId: effectivePropertyId })
            .where(eq(schema.leads.id, conversation.leadId));
        }
        if (!recorded.inserted) continue;
        const turn = await aiTurn(db, conversation.id, baseUrl);
        let delivered = false;
        if (turn.replied && turn.text) {
          try {
            await sendMetaMessage(entry.item, message.senderId, turn.text, message.platform);
            delivered = true;
          } catch (error) {
            await logEvent(db, key, "error", false,
              `Falha ao responder: ${error instanceof Error ? error.message : "erro"}`);
          }
        }
        await logEvent(db, key, "webhook", true,
          turn.replied
            ? delivered ? "Mensagem recebida, lead vinculado e IA respondeu"
              : "Mensagem e lead gravados; resposta da IA não foi entregue"
            : `Mensagem e lead gravados (${turn.skipped})`);
      } catch (error) {
        failedMessages++;
        await logEvent(db, key, "error", false,
          `Falha no contato Meta ${message.messageId ?? message.senderId}: ${error instanceof Error ? error.message : "erro"}`);
      }
    }

    // Falhas reais devem pedir reentrega à Meta; IDs de mensagem e lead
    // preservam a idempotência. A rota de WhatsApp permanece intocada.
    if (failedLeadgens > 0 || failedMessages > 0) {
      return c.json({ ok: false, failedLeadgens, failedMessages }, 502);
    }
    return c.json({ ok: true }, 200);
  });
}

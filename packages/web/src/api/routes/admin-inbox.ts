/**
 * Caixa de entrada / conversas.
 * O humano assume com um clique; a partir daí a IA para de responder.
 */
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { and, asc, desc, eq } from "drizzle-orm";
import { adminBase } from "../lib/admin-base";
import { audit } from "../lib/audit";
import { clientIp, siteBaseUrl } from "../lib/base-url";
import { addMessage, aiTurn, ensureConversation, transferToHuman } from "../lib/inbox";
import { readConfig } from "../lib/integrations";
import { sendWhatsappText } from "../lib/whatsapp";
import * as schema from "../database/schema";

const idInput = z.object({ id: z.number().int() });

export const adminInbox = {
  list: adminBase
    .input(
      z
        .object({
          status: z.enum(["aberta", "fechada"]).optional(),
          mode: z.enum(["ia", "humano"]).optional(),
          channel: z.enum(["whatsapp", "instagram", "facebook", "site", "teste"]).optional(),
        })
        .optional(),
    )
    .handler(async ({ input, context }) => {
      const filters = [];
      if (input?.status) filters.push(eq(schema.conversations.status, input.status));
      if (input?.mode) filters.push(eq(schema.conversations.mode, input.mode));
      if (input?.channel) filters.push(eq(schema.conversations.channel, input.channel));

      const rows = await context.db
        .select()
        .from(schema.conversations)
        .where(filters.length ? and(...filters) : undefined)
        .orderBy(desc(schema.conversations.lastMessageAt), desc(schema.conversations.id))
        .limit(200);

      return {
        conversations: rows,
        counts: {
          total: rows.length,
          ia: rows.filter((row) => row.mode === "ia").length,
          humano: rows.filter((row) => row.mode === "humano").length,
          naoLidas: rows.filter((row) => row.unread > 0).length,
        },
      };
    }),

  get: adminBase.input(idInput).handler(async ({ input, context }) => {
    const [conversation] = await context.db
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.id, input.id))
      .limit(1);
    if (!conversation) throw new ORPCError("NOT_FOUND", { message: "Conversa não encontrada" });

    const messages = await context.db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.conversationId, input.id))
      .orderBy(asc(schema.messages.id))
      .limit(300);

    await context.db
      .update(schema.conversations)
      .set({ unread: 0 })
      .where(eq(schema.conversations.id, input.id));

    return { conversation, messages };
  }),

  /** Humano assume: IA silencia imediatamente. */
  takeOver: adminBase
    .input(idInput.extend({ reason: z.string().max(200).optional() }))
    .handler(async ({ input, context }) => {
      const [conversation] = await context.db
        .select()
        .from(schema.conversations)
        .where(eq(schema.conversations.id, input.id))
        .limit(1);
      if (!conversation) throw new ORPCError("NOT_FOUND", { message: "Conversa não encontrada" });
      if (conversation.mode === "humano") return { ok: true, already: true };

      await transferToHuman(
        context.db,
        input.id,
        input.reason || `assumido por ${context.user.name ?? "corretor"}`,
      );
      await context.db
        .update(schema.conversations)
        .set({ assignedTo: context.user.id, assignedName: context.user.name ?? null })
        .where(eq(schema.conversations.id, input.id));
      await audit(context.db, context.user, "conversa.assumida", {
        entity: "conversation",
        entityId: input.id,
        ip: clientIp(context.headers),
      });
      return { ok: true, already: false };
    }),

  /** Devolve o atendimento para a IA. */
  returnToAi: adminBase.input(idInput).handler(async ({ input, context }) => {
    await context.db
      .update(schema.conversations)
      .set({ mode: "ia", assignedTo: null, assignedName: null, transferReason: null })
      .where(eq(schema.conversations.id, input.id));
    await addMessage(context.db, input.id, {
      direction: "out",
      author: "sistema",
      body: "Atendimento devolvido para a IA.",
    });
    await audit(context.db, context.user, "conversa.devolvida_ia", {
      entity: "conversation",
      entityId: input.id,
      ip: clientIp(context.headers),
    });
    return { ok: true };
  }),

  /**
   * Mensagem escrita por humano. Se o modo ainda for IA, assume automaticamente
   * (nunca deixa os dois respondendo).
   */
  send: adminBase
    .input(idInput.extend({ body: z.string().min(1).max(3000) }))
    .handler(async ({ input, context }) => {
      const [conversation] = await context.db
        .select()
        .from(schema.conversations)
        .where(eq(schema.conversations.id, input.id))
        .limit(1);
      if (!conversation) throw new ORPCError("NOT_FOUND", { message: "Conversa não encontrada" });

      if (conversation.mode !== "humano") {
        await transferToHuman(
          context.db,
          input.id,
          `resposta manual de ${context.user.name ?? "corretor"}`,
        );
        await context.db
          .update(schema.conversations)
          .set({ assignedTo: context.user.id, assignedName: context.user.name ?? null })
          .where(eq(schema.conversations.id, input.id));
      }

      let delivery: { sent: boolean; detail: string } = {
        sent: false,
        detail: "Registrado no painel (canal sem envio automático).",
      };

      if (conversation.channel === "whatsapp" && conversation.contactPhone) {
        const { config } = await readConfig(context.db, "whatsapp_cloud");
        if (config.accessToken && config.phoneNumberId) {
          try {
            await sendWhatsappText(config, conversation.contactPhone, input.body);
            delivery = { sent: true, detail: "Enviado pelo WhatsApp Cloud API." };
          } catch (error) {
            delivery = {
              sent: false,
              detail: `Falha no envio: ${error instanceof Error ? error.message : "erro"}`,
            };
          }
        } else {
          delivery = { sent: false, detail: "WhatsApp Cloud API ainda sem credencial." };
        }
      }

      await addMessage(context.db, input.id, {
        direction: "out",
        author: "humano",
        authorName: context.user.name ?? null,
        body: input.body,
      });

      return { ok: true, delivery };
    }),

  close: adminBase.input(idInput).handler(async ({ input, context }) => {
    await context.db
      .update(schema.conversations)
      .set({ status: "fechada" })
      .where(eq(schema.conversations.id, input.id));
    await audit(context.db, context.user, "conversa.fechada", {
      entity: "conversation",
      entityId: input.id,
      ip: clientIp(context.headers),
    });
    return { ok: true };
  }),

  reopen: adminBase.input(idInput).handler(async ({ input, context }) => {
    await context.db
      .update(schema.conversations)
      .set({ status: "aberta" })
      .where(eq(schema.conversations.id, input.id));
    return { ok: true };
  }),

  /**
   * Conversa de teste interna (canal "teste"): grava a mensagem do cliente e
   * deixa a IA responder, exatamente como no canal real. Serve para validar o
   * fluxo IA -> humano sem depender de WhatsApp.
   */
  simulate: adminBase
    .input(z.object({ body: z.string().min(1).max(2000), conversationId: z.number().int().optional() }))
    .handler(async ({ input, context }) => {
      const conversation = input.conversationId
        ? (
            await context.db
              .select()
              .from(schema.conversations)
              .where(eq(schema.conversations.id, input.conversationId))
              .limit(1)
          )[0]
        : await ensureConversation(context.db, {
            channel: "teste",
            externalId: `teste-${Date.now()}`,
            contactName: "Conversa de teste",
          });
      if (!conversation) throw new ORPCError("NOT_FOUND", { message: "Conversa não encontrada" });

      await addMessage(context.db, conversation.id, {
        direction: "in",
        author: "cliente",
        body: input.body,
      });
      const result = await aiTurn(context.db, conversation.id, siteBaseUrl(context.headers));
      return { conversationId: conversation.id, ...result };
    }),

  remove: adminBase.input(idInput).handler(async ({ input, context }) => {
    await context.db.delete(schema.messages).where(eq(schema.messages.conversationId, input.id));
    await context.db.delete(schema.conversations).where(eq(schema.conversations.id, input.id));
    await audit(context.db, context.user, "conversa.removida", {
      entity: "conversation",
      entityId: input.id,
      ip: clientIp(context.headers),
    });
    return { ok: true };
  }),
};

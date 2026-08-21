import { and, asc, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { base } from "../__core/app";
import * as schema from "../database/schema";
import { getDb } from "../lib/auth";
import { clientIp, siteBaseUrl } from "../lib/base-url";
import { gatewayConfigured } from "../agent/gateway";
import {
  activeAgentFor,
  addMessage,
  aiTurn,
  ensureConversation,
  transferToHuman,
} from "../lib/inbox";
import { intakeLead } from "../lib/lead-intake";
import { codeFromSlug, propertySlug as buildSlug } from "../lib/slug";
import {
  MAX_MESSAGE_CHARS,
  SITE_CHAT_CHANNEL,
  conversationRateLimited,
  externalIdFor,
  ipRateLimited,
  newVisitorToken,
  normalizeVisitorToken,
  publicCards,
  registerIpHit,
  sanitizeMessage,
  sanitizeShort,
  toPublicMessage,
  toPublicState,
  type PublicChatCard,
  type PublicChatMessage,
  type PublicChatState,
} from "../lib/site-chat";

/**
 * Chat público do site (canal `site`).
 *
 * É a mesma central de conversas do painel: o visitante fala com o agente de IA
 * já configurado em /admin/ia e, quando pede uma pessoa, a conversa vira
 * atendimento humano em /admin/conversas — a IA cala pela trava do inbox.
 *
 * Rota pública, sem sessão. Por isso: token opaco no lugar de id, entrada
 * saneada, limites de uso e whitelist de saída (lib/site-chat.ts).
 */

const FALLBACK_UNAVAILABLE =
  "Nosso atendimento por chat está indisponível agora. Chame no WhatsApp ou deixe seus dados no formulário e um corretor responde em seguida.";

interface ChatTurn {
  state: PublicChatState;
  messages: PublicChatMessage[];
  properties: PublicChatCard[];
  notice: string | null;
}

async function loadMessages(db: Awaited<ReturnType<typeof getDb>>, conversationId: number) {
  const rows = await db
    .select({
      id: schema.messages.id,
      author: schema.messages.author,
      body: schema.messages.body,
      createdAt: schema.messages.createdAt,
    })
    .from(schema.messages)
    .where(
      and(
        eq(schema.messages.conversationId, conversationId),
        ne(schema.messages.author, "sistema"),
      ),
    )
    .orderBy(asc(schema.messages.id))
    .limit(80);
  /* Mensagens internas ("sistema") nunca vão para o visitante: podem carregar
     motivo de transferência e outros textos administrativos. */
  return rows.map(toPublicMessage);
}

function countClientMessages(messages: PublicChatMessage[]) {
  return messages.filter((message) => message.author === "cliente").length;
}

/** Conversa do visitante pelo token. Não cria nada. */
async function findConversation(db: Awaited<ReturnType<typeof getDb>>, token: string) {
  const [row] = await db
    .select()
    .from(schema.conversations)
    .where(
      and(
        eq(schema.conversations.channel, SITE_CHAT_CHANNEL),
        eq(schema.conversations.externalId, externalIdFor(token)),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function propertyIdFromSlug(db: Awaited<ReturnType<typeof getDb>>, slug: string) {
  const wanted = slug.trim().toLowerCase();
  if (!wanted) return null;
  const rows = await db
    .select()
    .from(schema.properties)
    .where(eq(schema.properties.published, 1))
    .limit(500);
  const code = codeFromSlug(wanted).toUpperCase();
  const row =
    rows.find((item) => (item.slug ?? buildSlug(item)).toLowerCase() === wanted) ??
    rows.find((item) => item.code.toUpperCase() === code);
  return row?.id ?? null;
}

const tokenInput = z.string().min(8).max(120);

export const siteChat = {
  /**
   * Abre (ou retoma) o chat. Não grava nada no banco enquanto o visitante não
   * escrever — só devolve token, saudação do agente e histórico, se houver.
   */
  start: base
    .input(
      z.object({
        token: z.string().max(120).optional(),
        propertySlug: z.string().max(160).optional(),
      }),
    )
    .handler(async ({ input }) => {
      const db = await getDb();
      const agent = await activeAgentFor(db, SITE_CHAT_CHANNEL);
      const available = Boolean(agent) && gatewayConfigured();

      const token = normalizeVisitorToken(input.token) ?? newVisitorToken();
      const conversation = await findConversation(db, token);
      const messages = conversation ? await loadMessages(db, conversation.id) : [];

      const state = toPublicState(
        token,
        conversation ?? { mode: "ia", status: "aberta", contactName: null, contactPhone: null },
        countClientMessages(messages),
      );

      return {
        available,
        greeting:
          agent?.greeting?.trim() ||
          "Olá! Sou o atendimento da Edy Premi. Me conte o que você procura em Praia Grande.",
        notice: available ? null : FALLBACK_UNAVAILABLE,
        state,
        messages,
      };
    }),

  /** Histórico da conversa do visitante (usado no polling enquanto a janela está aberta). */
  history: base.input(z.object({ token: tokenInput })).handler(async ({ input }) => {
    const db = await getDb();
    const token = normalizeVisitorToken(input.token);
    if (!token) return { state: null, messages: [] as PublicChatMessage[] };
    const conversation = await findConversation(db, token);
    if (!conversation) return { state: null, messages: [] as PublicChatMessage[] };
    const messages = await loadMessages(db, conversation.id);
    return {
      state: toPublicState(token, conversation, countClientMessages(messages)),
      messages,
    };
  }),

  /** Mensagem do visitante + turno da IA (quando a conversa está no modo IA). */
  send: base
    .input(
      z.object({
        token: tokenInput,
        body: z.string().min(1).max(MAX_MESSAGE_CHARS + 200),
        propertySlug: z.string().max(160).optional(),
      }),
    )
    .handler(async ({ input, context }): Promise<ChatTurn> => {
      const db = await getDb();
      const token = normalizeVisitorToken(input.token);
      const body = sanitizeMessage(input.body);

      const emptyState: PublicChatState = {
        token: token ?? "",
        mode: "ia",
        status: "aberta",
        identified: false,
        askName: false,
        askPhone: false,
      };
      if (!token) {
        return {
          state: emptyState,
          messages: [],
          properties: [],
          notice: "Sessão do chat inválida. Recarregue a página.",
        };
      }
      if (!body) {
        return { state: emptyState, messages: [], properties: [], notice: "Escreva uma mensagem." };
      }

      const ip = clientIp(context.headers);
      if (ipRateLimited(ip)) {
        return {
          state: emptyState,
          messages: [],
          properties: [],
          notice: "Muitas mensagens em pouco tempo. Aguarde um instante.",
        };
      }
      registerIpHit(ip);

      const conversation = await ensureConversation(db, {
        channel: SITE_CHAT_CHANNEL,
        externalId: externalIdFor(token),
      });

      const limited = await conversationRateLimited(db, conversation.id);
      if (limited) {
        const messages = await loadMessages(db, conversation.id);
        return {
          state: toPublicState(token, conversation, countClientMessages(messages)),
          messages,
          properties: [],
          notice: limited,
        };
      }

      /* Contexto de página: chat aberto dentro de um imóvel. */
      if (!conversation.propertyId && input.propertySlug) {
        const propertyId = await propertyIdFromSlug(db, input.propertySlug);
        if (propertyId) {
          await db
            .update(schema.conversations)
            .set({ propertyId })
            .where(eq(schema.conversations.id, conversation.id));
        }
      }

      /* Visitante voltou a escrever numa conversa fechada: reabre sem mexer no modo. */
      if (conversation.status !== "aberta") {
        await db
          .update(schema.conversations)
          .set({ status: "aberta" })
          .where(eq(schema.conversations.id, conversation.id));
      }

      await addMessage(db, conversation.id, {
        direction: "in",
        author: "cliente",
        authorName: conversation.contactName ?? null,
        body,
      });

      const turn = await aiTurn(db, conversation.id, siteBaseUrl(context.headers));

      const [fresh] = await db
        .select()
        .from(schema.conversations)
        .where(eq(schema.conversations.id, conversation.id))
        .limit(1);
      const messages = await loadMessages(db, conversation.id);
      const clientCount = countClientMessages(messages);

      let notice: string | null = null;
      if (!turn.replied) {
        if (turn.skipped === "humano no controle") {
          notice = "Um corretor está acompanhando esta conversa e responde em seguida.";
        } else if (turn.skipped === "nenhum agente ativo neste canal" || turn.skipped === "provedor de IA não configurado") {
          notice = FALLBACK_UNAVAILABLE;
        } else {
          notice = "Não consegui responder agora. Um corretor vai continuar seu atendimento.";
        }
      }

      return {
        state: toPublicState(
          token,
          fresh ?? conversation,
          clientCount,
        ),
        messages,
        properties: await publicCards(db, turn.usedProperties ?? []),
        notice,
      };
    }),

  /**
   * Captação progressiva: nome primeiro, WhatsApp depois. Quando os dois
   * existem, o contato entra no CRM pela entrada única (com deduplicação).
   */
  identify: base
    .input(
      z.object({
        token: tokenInput,
        name: z.string().max(120).optional(),
        phone: z.string().max(30).optional(),
        interest: z.string().max(160).optional(),
      }),
    )
    .handler(async ({ input }) => {
      const db = await getDb();
      const token = normalizeVisitorToken(input.token);
      if (!token) return { ok: false, state: null };
      const conversation = await findConversation(db, token);
      if (!conversation) return { ok: false, state: null };

      const name = input.name ? sanitizeShort(input.name, 120) : "";
      const phoneDigits = (input.phone ?? "").replace(/\D/g, "").slice(0, 20);

      const nextName = name.length >= 2 ? name : conversation.contactName;
      const nextPhone = phoneDigits.length >= 8 ? phoneDigits : conversation.contactPhone;

      await db
        .update(schema.conversations)
        .set({ contactName: nextName ?? null, contactPhone: nextPhone ?? null })
        .where(eq(schema.conversations.id, conversation.id));

      let leadId = conversation.leadId;
      if (nextName && nextPhone && !leadId) {
        const interest = input.interest ? sanitizeShort(input.interest, 160) : "";
        const result = await intakeLead(db, {
          name: nextName,
          phone: nextPhone,
          interest: interest || "Contato pelo chat do site",
          message: conversation.lastMessage ?? null,
          source: "site_chat",
          channel: "site",
          propertyId: conversation.propertyId ?? null,
        });
        leadId = result.id;
        await db
          .update(schema.conversations)
          .set({ leadId })
          .where(eq(schema.conversations.id, conversation.id));
        await addMessage(db, conversation.id, {
          direction: "out",
          author: "sistema",
          body: `Contato informado no chat do site: ${nextName} · ${nextPhone}`,
        });
      }

      const messages = await loadMessages(db, conversation.id);
      return {
        ok: true,
        state: toPublicState(
          token,
          { ...conversation, contactName: nextName ?? null, contactPhone: nextPhone ?? null },
          countClientMessages(messages),
        ),
      };
    }),

  /** "Falar com um corretor": transfere dentro do próprio chat. */
  requestHuman: base.input(z.object({ token: tokenInput })).handler(async ({ input }) => {
    const db = await getDb();
    const token = normalizeVisitorToken(input.token);
    if (!token) return { ok: false, state: null };
    const conversation = await findConversation(db, token);
    if (!conversation) return { ok: false, state: null };

    if (conversation.mode !== "humano") {
      await transferToHuman(db, conversation.id, "cliente pediu corretor no chat do site");
    }
    if (conversation.status !== "aberta") {
      await db
        .update(schema.conversations)
        .set({ status: "aberta" })
        .where(eq(schema.conversations.id, conversation.id));
    }

    const messages = await loadMessages(db, conversation.id);
    return {
      ok: true,
      state: toPublicState(
        token,
        { ...conversation, mode: "humano", status: "aberta" },
        countClientMessages(messages),
      ),
      messages,
    };
  }),
};

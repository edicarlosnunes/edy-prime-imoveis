/**
 * Conversas: gravação de mensagens, resposta da IA e transferência para humano.
 *
 * Regra central: IA e humano NUNCA respondem juntos. Se `mode = humano`, a IA
 * não é chamada. Quando a IA pede transferência, o modo muda para humano na
 * mesma transação lógica e a IA para de responder daquele ponto em diante.
 */
import { and, asc, desc, eq } from "drizzle-orm";
import * as schema from "../database/schema";
import { agentReply, type AgentRow } from "../agent/broker";
import { gatewayConfigured } from "../agent/gateway";
import { fireTrigger } from "./automations";
import { logLeadEvent, qualifyLeadFromText } from "./lead-profile";
import type { AdminDb } from "./admin-base";

export type Channel = "whatsapp" | "instagram" | "facebook" | "site" | "teste";

export async function ensureConversation(
  db: AdminDb,
  params: {
    channel: Channel;
    externalId: string;
    contactName?: string | null;
    contactPhone?: string | null;
    leadId?: number | null;
    propertyId?: number | null;
  },
) {
  const [existing] = await db
    .select()
    .from(schema.conversations)
    .where(
      and(
        eq(schema.conversations.channel, params.channel),
        eq(schema.conversations.externalId, params.externalId),
      ),
    )
    .limit(1);
  if (existing) return existing;

  const [created] = await db
    .insert(schema.conversations)
    .values({
      channel: params.channel,
      externalId: params.externalId,
      contactName: params.contactName ?? null,
      contactPhone: params.contactPhone ?? null,
      leadId: params.leadId ?? null,
      propertyId: params.propertyId ?? null,
      mode: "ia",
      status: "aberta",
    })
    .returning();
  return created!;
}

export async function addMessage(
  db: AdminDb,
  conversationId: number,
  message: {
    direction: "in" | "out";
    author: "cliente" | "ia" | "humano" | "sistema";
    authorName?: string | null;
    body: string;
    externalId?: string | null;
  },
) {
  await db.insert(schema.messages).values({
    conversationId,
    direction: message.direction,
    author: message.author,
    authorName: message.authorName ?? null,
    body: message.body.slice(0, 4000),
    externalId: message.externalId ?? null,
  });
  const [conversation] = await db
    .select({ unread: schema.conversations.unread, leadId: schema.conversations.leadId })
    .from(schema.conversations)
    .where(eq(schema.conversations.id, conversationId))
    .limit(1);
  await db
    .update(schema.conversations)
    .set({
      lastMessage: message.body.slice(0, 240),
      lastMessageAt: new Date(),
      unread:
        message.direction === "in" ? (conversation?.unread ?? 0) + 1 : (conversation?.unread ?? 0),
    })
    .where(eq(schema.conversations.id, conversationId));

  /* Qualificação determinística SOMENTE sobre fala do cliente. Resposta da IA,
     do corretor ou do sistema nunca é tratada como dado declarado. */
  if (message.author === "cliente" && conversation?.leadId) {
    try {
      await logLeadEvent(db, conversation.leadId, {
        kind: "mensagem",
        title: "Mensagem do cliente",
        detail: message.body.slice(0, 300),
        actorType: "cliente",
        actorName: message.authorName ?? null,
        dedupeMinutes: 0,
      });
      await qualifyLeadFromText(db, conversation.leadId, message.body, {
        actorType: "cliente",
        actorName: message.authorName ?? null,
        countMessage: true,
      });
    } catch {
      /* qualificação nunca pode derrubar o atendimento */
    }
  }
}

export async function conversationTurns(db: AdminDb, conversationId: number) {
  const rows = await db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.conversationId, conversationId))
    .orderBy(asc(schema.messages.id))
    .limit(60);
  return rows
    .filter((row) => row.author !== "sistema")
    .map((row) => ({
      role: (row.direction === "in" ? "user" : "assistant") as "user" | "assistant",
      content: row.body,
    }));
}

/** Agente ativo para um canal, se houver. */
export async function activeAgentFor(db: AdminDb, channel: string): Promise<AgentRow | null> {
  const rows = await db
    .select()
    .from(schema.aiAgents)
    .where(eq(schema.aiAgents.active, 1))
    .orderBy(desc(schema.aiAgents.updatedAt));
  /* O canal "teste" é a simulação interna do painel: qualquer agente ativo atende. */
  const match =
    channel === "teste"
      ? rows[0]
      : rows.find((row) => {
          try {
            const list = JSON.parse(row.channels) as unknown;
            return Array.isArray(list) && list.map(String).includes(channel);
          } catch {
            return false;
          }
        });
  if (!match) return null;
  return {
    id: match.id,
    name: match.name,
    model: match.model,
    greeting: match.greeting,
    instructions: match.instructions,
    tone: match.tone,
    qualification: match.qualification,
    transferRules: match.transferRules,
    transferMessage: match.transferMessage,
    humanConditions: match.humanConditions,
    hoursStart: match.hoursStart,
    hoursEnd: match.hoursEnd,
  };
}

export async function transferToHuman(db: AdminDb, conversationId: number, reason: string) {
  await db
    .update(schema.conversations)
    .set({
      mode: "humano",
      transferReason: reason.slice(0, 300),
      transferredAt: new Date(),
    })
    .where(eq(schema.conversations.id, conversationId));
  await addMessage(db, conversationId, {
    direction: "out",
    author: "sistema",
    body: `Transferido para atendimento humano: ${reason}`,
  });
  const [conversation] = await db
    .select()
    .from(schema.conversations)
    .where(eq(schema.conversations.id, conversationId))
    .limit(1);
  await fireTrigger(db, "conversa_transferida", {
    conversationId,
    leadId: conversation?.leadId ?? null,
    propertyId: conversation?.propertyId ?? null,
    phone: conversation?.contactPhone ?? null,
    name: conversation?.contactName ?? null,
    source: conversation?.channel ?? null,
  });
}

export interface AiTurnResult {
  replied: boolean;
  text?: string;
  handoff?: boolean;
  reason?: string;
  skipped?: string;
  /** Códigos dos imóveis reais citados no turno (para os cards do chat do site). */
  usedProperties?: string[];
}

/**
 * Faz a IA responder, se e somente se: existe agente ativo no canal, o gateway
 * está configurado e a conversa ainda está no modo IA.
 * Não envia nada para fora — só grava a resposta. O envio é do adaptador do canal.
 */
export async function aiTurn(
  db: AdminDb,
  conversationId: number,
  baseUrl: string,
): Promise<AiTurnResult> {
  const [conversation] = await db
    .select()
    .from(schema.conversations)
    .where(eq(schema.conversations.id, conversationId))
    .limit(1);
  if (!conversation) return { replied: false, skipped: "conversa inexistente" };
  if (conversation.mode !== "ia") return { replied: false, skipped: "humano no controle" };
  if (conversation.status !== "aberta") return { replied: false, skipped: "conversa fechada" };
  if (!gatewayConfigured()) return { replied: false, skipped: "provedor de IA não configurado" };

  const agent = await activeAgentFor(db, conversation.channel);
  if (!agent) return { replied: false, skipped: "nenhum agente ativo neste canal" };

  const turns = await conversationTurns(db, conversationId);
  if (turns.length === 0) return { replied: false, skipped: "sem mensagens" };

  try {
    const reply = await agentReply(db, agent, turns, baseUrl);
    await addMessage(db, conversationId, {
      direction: "out",
      author: "ia",
      authorName: agent.name,
      body: reply.text,
    });
    await db
      .update(schema.conversations)
      .set({ agentId: agent.id })
      .where(eq(schema.conversations.id, conversationId));
    if (reply.handoff) {
      await transferToHuman(db, conversationId, reply.handoffReason ?? "regra do agente");
    }
    return {
      replied: true,
      text: reply.text,
      handoff: reply.handoff,
      reason: reply.handoffReason ?? undefined,
      usedProperties: reply.usedProperties,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "falha na IA";
    await transferToHuman(db, conversationId, `falha da IA: ${message}`);
    return { replied: false, skipped: message };
  }
}

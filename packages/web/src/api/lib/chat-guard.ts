/**
 * Proteção persistente do chat público (canal `site`) contra abuso e custo.
 *
 * Por que existe: o limite por IP em memória do processo desaparece a cada cold
 * start na Vercel e o limite por conversa não impede alguém de abrir dezenas de
 * conversas novas. Este arquivo grava contadores no banco (tabela
 * `chat_guard_events`), então o limite sobrevive a reinício e vale para todas as
 * instâncias.
 *
 * Regras de privacidade e escopo:
 * - o IP nunca é gravado em claro: guardamos só um hash SHA-256 com segredo do
 *   servidor (`SITE_CHAT_HASH_SECRET` ou `BETTER_AUTH_SECRET`), sem sal fixo no
 *   código e sem possibilidade de leitura reversa no painel;
 * - só o canal `site` é contado. Admin, WhatsApp, Instagram e Messenger não
 *   passam por aqui;
 * - bloqueio nunca chama o modelo e nunca devolve detalhe técnico ao navegador:
 *   o visitante recebe uma mensagem amigável com WhatsApp/formulário;
 * - todo bloqueio fica registrado (`kind = "block"`, com o motivo interno) para
 *   auditoria.
 */
import { and, eq, gte, lt, sql } from "drizzle-orm";
import * as schema from "../database/schema";
import type { AdminDb } from "./admin-base";
import { sha256Hex } from "./auth";

export const GUARD_CHANNEL = "site" as const;

/** Limites por visitante (hash de IP). */
const NEW_CONVERSATIONS_PER_HOUR = 3;
const NEW_CONVERSATIONS_PER_DAY = 8;
const AI_CALLS_PER_HOUR = 30;
const AI_CALLS_PER_DAY = 80;

/** Teto diário de segurança para o chat público inteiro (custo do modelo). */
const GLOBAL_AI_CALLS_PER_DAY = 600;

/** Mensagem única mostrada ao visitante — sem detalhe de segurança. */
export const GUARD_NOTICE =
  "Chegamos ao limite de atendimento automático para este acesso agora. Deixe seu nome e WhatsApp no formulário ou chame a gente no WhatsApp: um corretor responde em seguida.";

export type GuardKind = "conversation" | "ai" | "block";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function guardSecret() {
  return (
    process.env.SITE_CHAT_HASH_SECRET ||
    process.env.BETTER_AUTH_SECRET ||
    /* Sem segredo configurado o hash ainda protege o IP em repouso: só não é
       resistente a força bruta. Nunca gravamos o IP puro de qualquer forma. */
    "edy-premi-site-chat"
  );
}

/**
 * Identificador estável e anônimo do visitante para fins de limite.
 * Nunca reversível para IP no painel: só o hash sai daqui.
 */
export async function visitorFingerprint(ip: string) {
  const clean = (ip || "desconhecido").trim().slice(0, 80);
  return (await sha256Hex(`${guardSecret()}:${GUARD_CHANNEL}:${clean}`)).slice(0, 40);
}

async function countEvents(
  db: AdminDb,
  kind: GuardKind,
  since: Date,
  fingerprint?: string,
) {
  const filters = [
    eq(schema.chatGuardEvents.channel, GUARD_CHANNEL),
    eq(schema.chatGuardEvents.kind, kind),
    gte(schema.chatGuardEvents.createdAt, since),
  ];
  if (fingerprint) filters.push(eq(schema.chatGuardEvents.fingerprint, fingerprint));
  const [row] = await db
    .select({ total: sql<number>`count(*)` })
    .from(schema.chatGuardEvents)
    .where(and(...filters));
  return Number(row?.total ?? 0);
}

/** Registra um evento do guard. Nunca derruba a operação principal. */
export async function recordGuardEvent(
  db: AdminDb,
  fingerprint: string,
  kind: GuardKind,
  reason?: string,
) {
  try {
    await db.insert(schema.chatGuardEvents).values({
      channel: GUARD_CHANNEL,
      fingerprint,
      kind,
      reason: reason ? reason.slice(0, 120) : null,
    });
  } catch {
    /* contador é proteção, não pode quebrar o atendimento */
  }
}

/** Limpeza oportunista: o guard só precisa de 7 dias de histórico. */
export async function pruneGuardEvents(db: AdminDb) {
  try {
    await db
      .delete(schema.chatGuardEvents)
      .where(lt(schema.chatGuardEvents.createdAt, new Date(Date.now() - 7 * DAY_MS)));
  } catch {
    /* idem */
  }
}

export interface GuardDecision {
  /** true quando a chamada pode seguir (inclusive chamar o modelo). */
  allowed: boolean;
  /** Mensagem amigável para o visitante quando bloqueado. */
  notice: string | null;
}

const ALLOWED: GuardDecision = { allowed: true, notice: null };

/**
 * Decide se o turno pode acontecer.
 * `newConversation` = este turno vai criar uma conversa nova no banco.
 * Quando bloqueia, grava o motivo interno para auditoria e o chamador NÃO deve
 * chamar a IA.
 */
export async function guardSiteChat(
  db: AdminDb,
  fingerprint: string,
  options: { newConversation: boolean },
): Promise<GuardDecision> {
  const now = Date.now();
  const hourAgo = new Date(now - HOUR_MS);
  const dayAgo = new Date(now - DAY_MS);

  const block = async (reason: string): Promise<GuardDecision> => {
    await recordGuardEvent(db, fingerprint, "block", reason);
    return { allowed: false, notice: GUARD_NOTICE };
  };

  try {
    if (options.newConversation) {
      const [perHour, perDay] = await Promise.all([
        countEvents(db, "conversation", hourAgo, fingerprint),
        countEvents(db, "conversation", dayAgo, fingerprint),
      ]);
      if (perHour >= NEW_CONVERSATIONS_PER_HOUR) return block("conversas_novas_hora");
      if (perDay >= NEW_CONVERSATIONS_PER_DAY) return block("conversas_novas_dia");
    }

    const [aiHour, aiDay, aiGlobal] = await Promise.all([
      countEvents(db, "ai", hourAgo, fingerprint),
      countEvents(db, "ai", dayAgo, fingerprint),
      countEvents(db, "ai", dayAgo),
    ]);
    if (aiHour >= AI_CALLS_PER_HOUR) return block("ia_hora");
    if (aiDay >= AI_CALLS_PER_DAY) return block("ia_dia");
    if (aiGlobal >= GLOBAL_AI_CALLS_PER_DAY) return block("teto_global_dia");

    return ALLOWED;
  } catch {
    /* Falha de leitura do contador não pode derrubar o atendimento: o limite
       por conversa (site-chat.ts) continua valendo. */
    return ALLOWED;
  }
}

/** Limites em vigor (para o relatório/documentação, não vai para o navegador). */
export const GUARD_LIMITS = {
  NEW_CONVERSATIONS_PER_HOUR,
  NEW_CONVERSATIONS_PER_DAY,
  AI_CALLS_PER_HOUR,
  AI_CALLS_PER_DAY,
  GLOBAL_AI_CALLS_PER_DAY,
};

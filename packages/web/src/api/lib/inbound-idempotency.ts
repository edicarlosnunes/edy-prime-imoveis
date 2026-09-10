/**
 * Idempotência dos webhooks de entrada (10/09/2026).
 *
 * Problema: a Meta reenvia o mesmo evento quando não recebe 200 rápido. Sem
 * trava, a mesma mensagem entrava duas vezes no inbox, gerava histórico
 * duplicado e — o pior — acionava o agente de IA de novo, mandando duas
 * respostas ao mesmo cliente.
 *
 * Solução: antes de qualquer processamento, a rota "reserva" o id externo do
 * evento em `inbound_events`. A reserva é um único INSERT protegido por índice
 * UNIQUE em (channel, external_id) — atômico no SQLite/Turso. Em duas
 * requisições concorrentes com o mesmo id, apenas uma vence.
 *
 * MAS reserva sozinha perde mensagem: se o processamento falhar depois de
 * reservar, o reenvio da Meta bateria numa reserva órfã e seria descartado
 * para sempre. Por isso a reserva tem ESTADO e PRAZO:
 *
 *   status = processing  -> alguém está processando agora (dono do lease)
 *   status = completed   -> concluído; reenvio é descartado de vez
 *   status = failed      -> falhou de forma controlada; retry é liberado JÁ
 *
 *   claimed_at + lease   -> se o processo morreu sem conseguir marcar `failed`
 *                           (timeout, kill, cold start), a reserva expira em
 *                           LEASE_MS e o próximo reenvio assume o trabalho.
 *
 *   stage                -> até onde o processamento chegou. O retry retoma do
 *                           ponto em que parou, em vez de repetir os efeitos
 *                           colaterais que já aconteceram.
 *
 * A tomada de posse (takeover) é um UPDATE condicional em `attempts`
 * (compare-and-swap): dois processos tentando assumir a mesma reserva expirada,
 * só um consegue, porque o segundo não encontra mais `attempts` no valor antigo.
 *
 * Nada aqui envia mensagem, altera credencial ou liga integração.
 */
import { and, eq } from "drizzle-orm";
import * as schema from "../database/schema";
import type { AdminDb } from "./admin-base";

/**
 * Etapas do processamento, em ordem. Gravadas na reserva para que um retry
 * saiba o que já foi feito e não repita.
 */
export const INBOUND_STAGES = ["claimed", "stored", "lead_linked", "replied"] as const;
export type InboundStage = (typeof INBOUND_STAGES)[number];

/**
 * Prazo da reserva. Passado esse tempo sem conclusão nem falha registrada,
 * assume-se que o processo morreu e a reserva pode ser assumida por outro.
 * 60s cobre com folga o tempo de um webhook (a Meta espera bem menos que isso).
 */
export const LEASE_MS = 60_000;

export type ClaimReason =
  /** primeira vez que este evento é visto */
  | "new"
  /** já concluído antes: descartar sem tocar em nada */
  | "completed"
  /** outro processo está trabalhando nele agora, dentro do prazo */
  | "in_flight"
  /** reserva órfã (falhou ou expirou) assumida por este processo */
  | "takeover"
  /** evento sem id externo: não dedupável */
  | "unidentified";

export interface ClaimResult {
  /** true = este processo é o dono do evento e deve processá-lo. */
  claimed: boolean;
  /** true = não processar; o evento já foi concluído ou está em andamento. */
  duplicated: boolean;
  /** true = o evento veio sem id externo, então não dá para deduplicar. */
  unidentified: boolean;
  /** id da reserva, para marcar progresso/conclusão/falha. */
  eventId: number | null;
  /** última etapa concluída em tentativas anteriores. */
  stage: InboundStage;
  /** quantas vezes este evento já foi assumido (1 = primeira). */
  attempts: number;
  /** true = retomada de uma tentativa anterior que não terminou. */
  resumed: boolean;
  reason: ClaimReason;
}

/** Erro de violação de unicidade do SQLite/libsql, em qualquer formato. */
export function isUniqueViolation(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /unique constraint failed|sqlite_constraint_unique|constraint failed: unique/i.test(
    message,
  );
}

/** true se `stage` já alcançou (ou passou de) `target`. */
export function stageReached(stage: InboundStage, target: InboundStage) {
  return INBOUND_STAGES.indexOf(stage) >= INBOUND_STAGES.indexOf(target);
}

const asStage = (value: string | null | undefined): InboundStage =>
  (INBOUND_STAGES as readonly string[]).includes(value ?? "") ? (value as InboundStage) : "claimed";

const skip = (reason: ClaimReason, stage: InboundStage, attempts: number): ClaimResult => ({
  claimed: false,
  duplicated: true,
  unidentified: false,
  eventId: null,
  stage,
  attempts,
  resumed: false,
  reason,
});

/**
 * Reserva o id externo do evento.
 *
 * `claimed: false` quando o evento já foi concluído (`completed`) ou está sendo
 * processado agora por outra requisição (`in_flight`) — nesses casos o chamador
 * deve parar antes de gravar mensagem, mexer em lead ou chamar a IA.
 *
 * `claimed: true` com `resumed: true` quando uma tentativa anterior morreu no
 * meio: o chamador retoma a partir de `stage`, sem repetir o que já foi feito.
 *
 * Evento sem id externo não é dedupável: é processado (`claimed: true`) com
 * `unidentified: true`, para nunca perder mensagem legítima de cliente.
 */
export async function claimInboundEvent(
  db: AdminDb,
  channel: string,
  externalId: string | null | undefined,
  options?: { leaseMs?: number; now?: Date },
): Promise<ClaimResult> {
  const key = externalId?.trim();
  if (!key) {
    return {
      claimed: true,
      duplicated: false,
      unidentified: true,
      eventId: null,
      stage: "claimed",
      attempts: 1,
      resumed: false,
      reason: "unidentified",
    };
  }

  const leaseMs = options?.leaseMs ?? LEASE_MS;
  const now = options?.now ?? new Date();
  const id = key.slice(0, 200);

  /* 1) Caminho normal: primeira vez que o evento aparece. */
  let inserted: { id: number }[] = [];
  try {
    inserted = await db
      .insert(schema.inboundEvents)
      .values({
        channel,
        externalId: id,
        status: "processing",
        stage: "claimed",
        attempts: 1,
        claimedAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: schema.inboundEvents.id });
  } catch (error) {
    /* Driver que lança em vez de ignorar o conflito: cai no passo 2. */
    if (!isUniqueViolation(error)) throw error;
  }
  if (inserted.length > 0) {
    return {
      claimed: true,
      duplicated: false,
      unidentified: false,
      eventId: inserted[0]!.id,
      stage: "claimed",
      attempts: 1,
      resumed: false,
      reason: "new",
    };
  }

  /* 2) Já existe reserva. Decidir entre descartar e assumir. */
  const [row] = await db
    .select({
      id: schema.inboundEvents.id,
      status: schema.inboundEvents.status,
      stage: schema.inboundEvents.stage,
      attempts: schema.inboundEvents.attempts,
      claimedAt: schema.inboundEvents.claimedAt,
    })
    .from(schema.inboundEvents)
    .where(
      and(eq(schema.inboundEvents.channel, channel), eq(schema.inboundEvents.externalId, id)),
    )
    .limit(1);

  /* Sumiu entre o INSERT e o SELECT (expurgo concorrente): trata como duplicata,
     que é o lado seguro — não reprocessa nem responde erro para a Meta. */
  if (!row) return skip("completed", "claimed", 0);

  const stage = asStage(row.stage);
  const attempts = row.attempts ?? 1;

  /* Concluído: é exatamente o caso que a idempotência existe para barrar. */
  if (row.status === "completed") return skip("completed", stage, attempts);

  /* Em andamento e dentro do prazo: outra requisição é a dona. Não concorrer. */
  const claimedAtMs = row.claimedAt instanceof Date ? row.claimedAt.getTime() : 0;
  const expired = now.getTime() - claimedAtMs >= leaseMs;
  if (row.status === "processing" && !expired) return skip("in_flight", stage, attempts);

  /* Órfã: falhou de forma controlada, ou o prazo estourou sem conclusão.
     Assume o trabalho com compare-and-swap em `attempts` — dois processos
     tentando assumir ao mesmo tempo, só um encontra o valor antigo. */
  const taken = await db
    .update(schema.inboundEvents)
    .set({
      status: "processing",
      attempts: attempts + 1,
      claimedAt: now,
      updatedAt: now,
    })
    .where(and(eq(schema.inboundEvents.id, row.id), eq(schema.inboundEvents.attempts, attempts)))
    .returning({ id: schema.inboundEvents.id });

  if (taken.length === 0) return skip("in_flight", stage, attempts);

  return {
    claimed: true,
    duplicated: false,
    unidentified: false,
    eventId: row.id,
    stage,
    attempts: attempts + 1,
    resumed: true,
    reason: "takeover",
  };
}

/**
 * Marca que uma etapa terminou. Também renova o prazo da reserva, para que uma
 * etapa lenta não seja assumida por outro processo no meio do caminho.
 */
export async function advanceInboundEvent(
  db: AdminDb,
  eventId: number | null,
  stage: InboundStage,
) {
  if (!eventId) return;
  const now = new Date();
  await db
    .update(schema.inboundEvents)
    .set({ stage, claimedAt: now, updatedAt: now })
    .where(eq(schema.inboundEvents.id, eventId));
}

/** Conclui a reserva: daqui em diante todo reenvio do mesmo id é descartado. */
export async function completeInboundEvent(db: AdminDb, eventId: number | null) {
  if (!eventId) return;
  const now = new Date();
  await db
    .update(schema.inboundEvents)
    .set({ status: "completed", stage: "replied", updatedAt: now, lastError: null })
    .where(eq(schema.inboundEvents.id, eventId));
}

/**
 * Libera a reserva depois de uma falha controlada, para que o reenvio da Meta
 * possa retomar imediatamente — sem esperar o prazo expirar.
 */
export async function failInboundEvent(db: AdminDb, eventId: number | null, error: unknown) {
  if (!eventId) return;
  const detail = error instanceof Error ? error.message : String(error ?? "erro");
  await db
    .update(schema.inboundEvents)
    .set({ status: "failed", updatedAt: new Date(), lastError: detail.slice(0, 500) })
    .where(eq(schema.inboundEvents.id, eventId));
}

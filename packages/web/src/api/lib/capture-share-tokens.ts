import { and, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import * as schema from "../database/schema";
import type { getDb } from "./auth";
import { sha256Hex } from "./auth";

export type CaptureShareDb = Awaited<ReturnType<typeof getDb>>;

function randomOpaqueToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizeSenderPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (!digits) throw new Error("Telefone do remetente inválido");
  return digits.startsWith("55") ? digits : `55${digits}`;
}

const UNUSED_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Emite e persiste somente o hash. O chamador deve entregar o valor uma vez. */
export async function issueCaptureShareTokenRecord(db: CaptureShareDb, createdBy: number) {
  const token = randomOpaqueToken();
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + UNUSED_TOKEN_TTL_MS);
  const [row] = await db.insert(schema.captureShareTokens)
    .values({ tokenHash, createdBy, expiresAt })
    .returning({ id: schema.captureShareTokens.id });
  if (!row) throw new Error("Não foi possível emitir o link de captação");
  return { id: row.id, token, expiresAt };
}

/** Compatibility helper for integrations that need only the one-time token. */
export async function issueCaptureShareToken(db: CaptureShareDb, createdBy: number) {
  const { token } = await issueCaptureShareTokenRecord(db, createdBy);
  return token;
}

/** Revokes an unused link by its admin-visible row ID, never by bearer token. */
export async function revokeCaptureShareToken(db: CaptureShareDb, id: number) {
  const rows = await db.update(schema.captureShareTokens)
    .set({ revokedAt: new Date() })
    .where(and(
      eq(schema.captureShareTokens.id, id),
      eq(schema.captureShareTokens.status, "active"),
      isNull(schema.captureShareTokens.revokedAt),
    ))
    .returning({ id: schema.captureShareTokens.id });
  return rows.length > 0;
}

/** Confirma que um token existe e continua disponível para um primeiro uso. */
export async function validateCaptureShareToken(db: CaptureShareDb, token: string) {
  if (!/^[a-f0-9]{64}$/i.test(token)) return null;
  const tokenHash = await sha256Hex(token);
  const [row] = await db
    .select({
      id: schema.captureShareTokens.id,
      status: schema.captureShareTokens.status,
      senderPhone: schema.captureShareTokens.senderPhone,
    })
    .from(schema.captureShareTokens)
    .where(and(
      eq(schema.captureShareTokens.tokenHash, tokenHash),
      eq(schema.captureShareTokens.status, "active"),
      isNull(schema.captureShareTokens.revokedAt),
      gt(schema.captureShareTokens.expiresAt, new Date()),
    ))
    .limit(1);
  return row ?? null;
}

/**
 * Consome o link com compare-and-set: apenas um remetente pode vincular um
 * link ativo. Repetições do mesmo remetente são idempotentes; outro remetente
 * não pode tomar o link já resgatado.
 */
export async function redeemCaptureShareToken(
  db: CaptureShareDb,
  token: string,
  senderPhone: string,
) {
  if (!/^[a-f0-9]{64}$/i.test(token)) return { ok: false as const, status: "invalid" as const };
  const tokenHash = await sha256Hex(token);
  const sender = normalizeSenderPhone(senderPhone);
  const updated = await db
    .update(schema.captureShareTokens)
    .set({ status: "redeemed", senderPhone: sender, redeemedAt: new Date() })
    .where(and(
      eq(schema.captureShareTokens.tokenHash, tokenHash),
      eq(schema.captureShareTokens.status, "active"),
      isNull(schema.captureShareTokens.revokedAt),
      gt(schema.captureShareTokens.expiresAt, new Date()),
    ))
    .returning({ id: schema.captureShareTokens.id });
  if (updated.length) return { ok: true as const, status: "redeemed" as const };

  const [existing] = await db
    .select({ status: schema.captureShareTokens.status, senderPhone: schema.captureShareTokens.senderPhone })
    .from(schema.captureShareTokens)
    .where(eq(schema.captureShareTokens.tokenHash, tokenHash))
    .limit(1);
  if (existing?.status === "redeemed" && existing.senderPhone === sender) {
    return { ok: true as const, status: "redeemed" as const };
  }
  return {
    ok: false as const,
    status: existing?.status === "completed" ? "completed" as const : "unavailable" as const,
  };
}

/** Marca a jornada do link concluída sem reabrir nem substituir o remetente. */
export async function completeCaptureShareToken(
  db: CaptureShareDb,
  token: string,
  senderPhone?: string,
) {
  if (!/^[a-f0-9]{64}$/i.test(token)) return false;
  const tokenHash = await sha256Hex(token);
  const sender = senderPhone ? normalizeSenderPhone(senderPhone) : undefined;
  const conditions = [
    eq(schema.captureShareTokens.tokenHash, tokenHash),
    eq(schema.captureShareTokens.status, "redeemed"),
  ];
  if (sender) conditions.push(eq(schema.captureShareTokens.senderPhone, sender));
  const rows = await db
    .update(schema.captureShareTokens)
    .set({ status: "completed", completedAt: new Date() })
    .where(and(...conditions))
    .returning({ id: schema.captureShareTokens.id });
  return rows.length > 0;
}

/**
 * The latest redeemed/completed share for this sender, ordered by redemption
 * time then row ID. Raw tokens and hashes are intentionally never returned.
 */
export async function latestCaptureShareForSender(db: CaptureShareDb, phone: string) {
  const sender = normalizeSenderPhone(phone);
  const [row] = await db
    .select({
      id: schema.captureShareTokens.id,
      senderPhone: schema.captureShareTokens.senderPhone,
      captureId: schema.captureShareTokens.captureId,
      status: schema.captureShareTokens.status,
      redeemedAt: schema.captureShareTokens.redeemedAt,
    })
    .from(schema.captureShareTokens)
    .where(and(
      eq(schema.captureShareTokens.senderPhone, sender),
      inArray(schema.captureShareTokens.status, ["redeemed", "completed"]),
    ))
    .orderBy(desc(schema.captureShareTokens.redeemedAt), desc(schema.captureShareTokens.id))
    .limit(1);
  return row ?? null;
}

/**
 * Binds the sender's newest redeemed link to one saved capture using
 * compare-and-set. Repeating the same binding is safe; a different capture
 * cannot replace an existing capture_id.
 */
export async function bindCaptureShareToCapture(
  db: CaptureShareDb,
  senderPhone: string,
  captureId: number,
): Promise<{ ok: boolean; status: "bound" | "already_bound" | "not_found" | "conflict" }> {
  const sender = normalizeSenderPhone(senderPhone);
  const current = await latestCaptureShareForSender(db, sender);
  if (!current) return { ok: false, status: "not_found" };
  if (current.captureId !== null) {
    return current.captureId === captureId
      ? { ok: true, status: "already_bound" }
      : { ok: false, status: "conflict" };
  }

  const updated = await db
    .update(schema.captureShareTokens)
    .set({ captureId })
    .where(and(
      eq(schema.captureShareTokens.id, current.id),
      eq(schema.captureShareTokens.senderPhone, sender),
      inArray(schema.captureShareTokens.status, ["redeemed", "completed"]),
      isNull(schema.captureShareTokens.captureId),
    ))
    .returning({ id: schema.captureShareTokens.id });
  if (updated.length) return { ok: true, status: "bound" };

  const [afterRace] = await db
    .select({ captureId: schema.captureShareTokens.captureId })
    .from(schema.captureShareTokens)
    .where(eq(schema.captureShareTokens.id, current.id))
    .limit(1);
  return afterRace?.captureId === captureId
    ? { ok: true, status: "already_bound" }
    : { ok: false, status: "conflict" };
}

/** Completes only the sender's current (newest) redeemed link, atomically. */
export async function completeCurrentCaptureShareForSender(
  db: CaptureShareDb,
  phone: string,
): Promise<boolean> {
  const current = await latestCaptureShareForSender(db, phone);
  if (!current || current.status !== "redeemed") return false;
  const sender = normalizeSenderPhone(phone);
  const changed = await db
    .update(schema.captureShareTokens)
    .set({ status: "completed", completedAt: new Date() })
    .where(and(
      eq(schema.captureShareTokens.id, current.id),
      eq(schema.captureShareTokens.senderPhone, sender),
      eq(schema.captureShareTokens.status, "redeemed"),
    ))
    .returning({ id: schema.captureShareTokens.id });
  return changed.length > 0;
}

/**
 * Para a integração futura do atendimento: devolve a conversa WhatsApp aberta
 * mais recente vinculada ao remetente que resgatou o link, se houver.
 */
export async function lookupCurrentCaptureSession(db: CaptureShareDb, token: string) {
  if (!/^[a-f0-9]{64}$/i.test(token)) return null;
  const tokenHash = await sha256Hex(token);
  const [link] = await db
    .select({ senderPhone: schema.captureShareTokens.senderPhone })
    .from(schema.captureShareTokens)
    .where(eq(schema.captureShareTokens.tokenHash, tokenHash))
    .limit(1);
  if (!link?.senderPhone) return null;

  const conversations = await db
    .select()
    .from(schema.conversations)
    .where(and(eq(schema.conversations.channel, "whatsapp"), eq(schema.conversations.status, "aberta")))
    .orderBy(desc(schema.conversations.lastMessageAt), desc(schema.conversations.createdAt))
    .limit(200);
  const digits = (value: string | null | undefined) => {
    const valueDigits = String(value ?? "").replace(/\D/g, "");
    return valueDigits && !valueDigits.startsWith("55") ? `55${valueDigits}` : valueDigits;
  };
  const senderDigits = digits(link.senderPhone);
  return conversations.find((conversation) => digits(conversation.contactPhone) === senderDigits) ?? null;
}
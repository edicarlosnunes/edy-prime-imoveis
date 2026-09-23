/**
 * Adaptador do LINK_CAPTACAO para o WhatsApp oficial.
 *
 * O WhatsApp não recebe um token público. Cada remetente recebe uma sessão
 * interna no mesmo motor determinístico usado pelo fluxo público; o único
 * gatilho externo continua sendo a frase pré-preenchida do link fixo.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import * as schema from "../database/schema";
import type { AdminDb } from "../lib/admin-base";
import { sha256Hex } from "../lib/auth";
import { addOwnerPhotos, serializeOwnerPhotos } from "../lib/capture-photos";
import { ownerPhoneKey } from "../lib/owner-identity";
import { publicTurn, type PublicDraft } from "../routes/owner-intake-links";

export const WHATSAPP_LINK_MESSAGE = "Vamos cadastrar seu imóvel?";
export const WHATSAPP_CAPTURE_SUCCESS =
  "Cadastro concluído com sucesso! Recebemos as informações do seu imóvel e nossa equipe entrará em contato em breve.";

const INTERNAL_PREFIX = "whatsapp-link-captacao:v1";

const fold = (value: string | null | undefined) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/** Somente o texto completo do link fixo abre uma sessão nova. */
export function isFixedWhatsappCaptureTrigger(text: string | null | undefined) {
  return fold(text) === fold(WHATSAPP_LINK_MESSAGE);
}

function phoneKey(phone: string | null | undefined) {
  const key = ownerPhoneKey(phone);
  return key.length >= 10 ? key : null;
}

function internalToken(phone: string, id: number) {
  /* O valor nunca é enviado ao cliente nem gravado; só é usado para chamar
     publicTurn, que consulta o hash persistido na sessão interna. */
  /* Put the session id first: the locator is intentionally hex-encoded and
     truncated to the public-token width, so the id must be inside that prefix
     to keep two phone sessions distinct even in test doubles. */
  const source = `${id}:${INTERNAL_PREFIX}:${phone}`;
  const bytes = new TextEncoder().encode(source);
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return (hex + "0".repeat(64)).slice(0, 64);
}

type Session = {
  link: typeof schema.ownerIntakeLinks.$inferSelect;
  token: string;
};

async function sessionFor(
  db: AdminDb,
  phone: string,
  create: boolean,
  contactName: string | null = null,
): Promise<Session | null> {
  const key = phoneKey(phone);
  if (!key) return null;

  const [active] = await db
    .select()
    .from(schema.ownerIntakeLinks)
    .where(and(
      eq(schema.ownerIntakeLinks.phone, key),
      inArray(schema.ownerIntakeLinks.status, ["aguardando", "iniciado"]),
    ))
    .orderBy(desc(schema.ownerIntakeLinks.id))
    .limit(1);

  if (active) return { link: active, token: internalToken(key, active.id) };
  if (!create) return null;

  const seed = await sha256Hex(`${INTERNAL_PREFIX}:seed:${key}`);
  const [created] = await db
    .insert(schema.ownerIntakeLinks)
    .values({
      tokenHash: seed,
      shortCode: null,
      ownerName: contactName?.trim().slice(0, 120) || "Contato WhatsApp",
      phone: key,
      status: "aguardando",
    })
    .returning();
  if (!created) return null;

  const token = internalToken(key, created.id);
  const [updated] = await db
    .update(schema.ownerIntakeLinks)
    .set({ tokenHash: await sha256Hex(token) })
    .where(and(
      eq(schema.ownerIntakeLinks.id, created.id),
      eq(schema.ownerIntakeLinks.tokenHash, seed),
    ))
    .returning();
  return { link: updated ?? { ...created, tokenHash: await sha256Hex(token) }, token };
}

export async function whatsappCaptureSession(db: AdminDb, phone: string) {
  let session: Session | null;
  try {
    session = await sessionFor(db, phone, false);
  } catch {
    /* Instalações antigas sem a tabela auxiliar continuam no WhatsApp normal.
       Uma entrada explícita, por outro lado, não usa este caminho silencioso. */
    return null;
  }
  if (!session) return null;
  let draft: PublicDraft = {};
  try {
    draft = session.link.draft ? JSON.parse(session.link.draft) as PublicDraft : {};
  } catch {
    draft = {};
  }
  return {
    ...session,
    draft,
    active: session.link.status === "aguardando" || session.link.status === "iniciado",
    waitingForPhoto: draft.step === "photo",
    captureId: session.link.captureId,
  };
}

/**
 * Processa texto no modo de captação. Retorna null quando o WhatsApp deve
 * continuar no atendimento normal.
 */
export async function whatsappCaptureText(
  db: AdminDb,
  phone: string,
  text: string,
  contactName: string | null = null,
) {
  const trigger = isFixedWhatsappCaptureTrigger(text);
  const session = trigger
    ? await sessionFor(db, phone, true, contactName)
    : await whatsappCaptureSession(db, phone);
  if (!session) return null;

  const result = await publicTurn(db as never, {
    token: session.token,
    text,
  });
  return {
    text: result.completed ? WHATSAPP_CAPTURE_SUCCESS : result.question,
    completed: result.completed,
    session,
  };
}

/**
 * A imagem chega depois que a etapa textual já mudou para `photo`. A gravação
 * da foto, conclusão da ficha e encerramento da sessão ficam juntos no mesmo
 * caminho lógico; o webhook continua responsável apenas por baixar a mídia.
 */
export async function whatsappCapturePhoto(
  db: AdminDb,
  phone: string,
  url: string,
) {
  const session = await sessionFor(db, phone, false);
  if (!session) return null;

  let draft: PublicDraft = {};
  try {
    draft = session.link.draft ? JSON.parse(session.link.draft) as PublicDraft : {};
  } catch {
    draft = {};
  }
  if (draft.step !== "photo" || !session.link.captureId || !session.link.ownerId) return null;

  const [capture] = await db
    .select()
    .from(schema.propertyCaptures)
    .where(and(
      eq(schema.propertyCaptures.id, session.link.captureId),
      eq(schema.propertyCaptures.ownerId, session.link.ownerId),
    ))
    .limit(1);
  if (!capture) return null;

  if (!capture.ownerPhotos?.includes("Fachada provisória de captação")) {
    const photos = addOwnerPhotos(
      capture.ownerPhotos,
      [{ url, caption: "Fachada provisória de captação" }],
      { source: "proprietario" },
    );
    const completedAt = new Date();
    await db.update(schema.propertyCaptures).set({
      ownerPhotos: serializeOwnerPhotos(photos),
      registrationStatus: "CONCLUIDO",
      registrationStatusAt: completedAt,
      updatedAt: completedAt,
    }).where(and(
      eq(schema.propertyCaptures.id, capture.id),
      eq(schema.propertyCaptures.registrationStatus, "EM_ANDAMENTO"),
    ));
  }

  const completedAt = new Date();
  const nextDraft: PublicDraft = {
    ...draft,
    answers: { ...(draft.answers ?? {}), fachada: "Foto provisória recebida" },
    complete: true,
    step: "completed",
  };
  await db.update(schema.ownerIntakeLinks).set({
    status: "concluido",
    draft: JSON.stringify(nextDraft),
    completedAt,
    startedAt: session.link.startedAt ?? completedAt,
  }).where(and(
    eq(schema.ownerIntakeLinks.id, session.link.id),
    inArray(schema.ownerIntakeLinks.status, ["aguardando", "iniciado"]),
  ));

  return { text: WHATSAPP_CAPTURE_SUCCESS, completed: true };
}

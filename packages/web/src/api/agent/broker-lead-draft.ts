/**
 * Durable drafts for the broker-only WhatsApp questionnaire.
 *
 * Drafts are append-only events in lead_notes. This deliberately does not
 * touch owners/property_captures and stores only accepted questionnaire values,
 * never account credentials. Generic entries must use a fresh session key for
 * each entry; token sessions retain the exact token identifier as their key.
 */
import { desc, eq, inArray } from "drizzle-orm";
import * as schema from "../database/schema";
import type { AdminDb } from "../lib/admin-base";

const NOTE_PREFIX = "[broker-lead-draft:v1] ";

export type BrokerDraftSession =
  | { kind: "token"; key: string }
  | { kind: "generic"; key: string };

export type BrokerDraftStepKey =
  | "role"
  | "creci"
  | "nome"
  | "intencao"
  | "proprietarioNome"
  | "endereco"
  | "condominioPresenca"
  | "nomeCondominio"
  | "documentacao"
  | "tipo"
  | "dormitorios"
  | "suites"
  | "banheiros"
  | "vagas"
  | "metragem"
  | "caracteristicas"
  | "valor"
  | "condominio"
  | "custos"
  | "fotoFrente"
  | "observacaoFinal";

export interface BrokerLeadDraft {
  leadId: number;
  phone: string;
  session: BrokerDraftSession;
  answers: Partial<Record<BrokerDraftStepKey, string>>;
  status: "active" | "complete";
  startedAt: string;
  updatedAt: string;
}

export interface LoadBrokerLeadDraftResult {
  leadId: number;
  phone: string;
  draft: BrokerLeadDraft | null;
  completedHistory: BrokerLeadDraft[];
}

export interface BrokerDraftInput {
  phone: string;
  session: BrokerDraftSession;
  /** Prefer the lead already attached to the current conversation. */
  leadId?: number | null;
}

type DraftEvent = {
  version: 1;
  event: "started" | "answer" | "completed";
  session: BrokerDraftSession;
  at: string;
  stepKey?: BrokerDraftStepKey;
  value?: string;
  inboundTurnDedupeKey?: string;
};

const allowedSteps = new Set<BrokerDraftStepKey>([
  "role", "creci", "nome", "intencao", "proprietarioNome", "endereco",
  "condominioPresenca", "nomeCondominio", "documentacao", "tipo",
  "dormitorios", "suites", "banheiros", "vagas", "metragem",
  "caracteristicas", "valor", "condominio", "custos", "fotoFrente",
  "observacaoFinal",
]);

/** Mirrors lead-intake's phone normalization exactly. */
export function normalizeBrokerDraftPhone(phone: string): string {
  return phone.replace(/\D/g, "").slice(0, 20);
}

/** Look up both the stored local and country-prefixed WhatsApp variants. */
export function brokerDraftPhoneVariants(phone: string): string[] {
  const digits = normalizeBrokerDraftPhone(phone);
  const variants = new Set([digits]);
  if (digits.startsWith("55") && [12, 13].includes(digits.length)) {
    variants.add(digits.slice(2));
  } else if ([10, 11].includes(digits.length)) {
    variants.add(`55${digits}`);
  }
  return [...variants].filter(Boolean);
}

function validateSession(session: BrokerDraftSession): void {
  if (
    !session ||
    (session.kind !== "token" && session.kind !== "generic") ||
    typeof session.key !== "string" ||
    !session.key.trim() ||
    session.key.length > 200
  ) {
    throw new Error("Broker draft requires a non-empty session key.");
  }
}

async function resolveLead(db: AdminDb, input: BrokerDraftInput) {
  const phone = normalizeBrokerDraftPhone(input.phone);
  if (!phone) throw new Error("Broker draft requires a valid phone number.");
  if (input.leadId != null) {
    const [lead] = await db.select().from(schema.leads)
      .where(eq(schema.leads.id, input.leadId)).limit(1);
    if (!lead) throw new Error(`Broker draft lead #${input.leadId} was not found.`);
    if (!brokerDraftPhoneVariants(phone).includes(normalizeBrokerDraftPhone(lead.phone))) {
      throw new Error(`Broker draft lead #${input.leadId} does not match the supplied phone.`);
    }
    return { leadId: lead.id, phone: normalizeBrokerDraftPhone(lead.phone) };
  }
  const [lead] = await db.select().from(schema.leads)
    .where(inArray(schema.leads.phone, brokerDraftPhoneVariants(phone)))
    .orderBy(desc(schema.leads.createdAt))
    .limit(1);
  if (!lead) throw new Error(`No lead found for phone ${phone}; broker draft was not saved.`);
  return { leadId: lead.id, phone: normalizeBrokerDraftPhone(lead.phone) };
}

function parseEvent(body: string): DraftEvent | null {
  if (!body.startsWith(NOTE_PREFIX)) return null;
  try {
    const event = JSON.parse(body.slice(NOTE_PREFIX.length)) as DraftEvent;
    if (
      event.version !== 1 ||
      !["started", "answer", "completed"].includes(event.event) ||
      !event.session ||
      (event.session.kind !== "token" && event.session.kind !== "generic") ||
      typeof event.session.key !== "string"
    ) return null;
    if (event.event === "answer" && (!allowedSteps.has(event.stepKey!) || typeof event.value !== "string")) {
      return null;
    }
    return event;
  } catch {
    return null;
  }
}

function sameSession(a: BrokerDraftSession, b: BrokerDraftSession): boolean {
  return a.kind === b.kind && a.key === b.key;
}

function reduceEvents(leadId: number, phone: string, events: DraftEvent[]): BrokerLeadDraft | null {
  if (!events.some((event) => event.event === "started")) return null;
  const answers: Partial<Record<BrokerDraftStepKey, string>> = {};
  let completed = false;
  for (const event of events) {
    if (event.event === "answer" && event.stepKey && event.value !== undefined) {
      answers[event.stepKey] = event.value;
    } else if (event.event === "completed") {
      completed = true;
    }
  }
  const startedAt = events.find((event) => event.event === "started")!.at;
  return {
    leadId,
    phone,
    session: events[0]!.session,
    answers,
    status: completed ? "complete" : "active",
    startedAt,
    updatedAt: events[events.length - 1]!.at,
  };
}

async function readDrafts(db: AdminDb, leadId: number, phone: string) {
  const notes = await db.select().from(schema.leadNotes)
    .where(eq(schema.leadNotes.leadId, leadId))
    .orderBy(schema.leadNotes.id);
  const grouped = new Map<string, DraftEvent[]>();
  for (const note of notes) {
    const event = parseEvent(note.body);
    if (!event) continue;
    const key = JSON.stringify([event.session.kind, event.session.key]);
    const group = grouped.get(key) ?? [];
    group.push(event);
    grouped.set(key, group);
  }
  return [...grouped.values()]
    .map((events) => reduceEvents(leadId, phone, events))
    .filter((draft): draft is BrokerLeadDraft => draft !== null);
}

async function appendEvent(db: AdminDb, leadId: number, event: DraftEvent): Promise<void> {
  await db.insert(schema.leadNotes).values({
    leadId,
    body: NOTE_PREFIX + JSON.stringify(event),
  });
}

/** Load one exact session and all completed sessions for this lead. */
export async function loadBrokerLeadDraft(
  db: AdminDb,
  input: BrokerDraftInput,
): Promise<LoadBrokerLeadDraftResult> {
  validateSession(input.session);
  const { leadId, phone } = await resolveLead(db, input);
  const drafts = await readDrafts(db, leadId, phone);
  const current = drafts.find((draft) => sameSession(draft.session, input.session)) ?? null;
  return {
    leadId,
    phone,
    draft: current?.status === "active" ? current : null,
    completedHistory: drafts.filter((draft) => draft.status === "complete"),
  };
}

/** Load the sender's most recently updated active draft without knowing its entry marker. */
export async function loadLatestActiveBrokerLeadDraft(
  db: AdminDb,
  phoneValue: string,
  kind?: BrokerDraftSession["kind"],
): Promise<BrokerLeadDraft | null> {
  const phone = normalizeBrokerDraftPhone(phoneValue);
  if (!phone) throw new Error("Broker draft requires a valid phone number.");
  const leads = await db.select().from(schema.leads)
    .where(inArray(schema.leads.phone, brokerDraftPhoneVariants(phone)))
    .orderBy(desc(schema.leads.createdAt));
  const drafts = (await Promise.all(
    leads.map((lead) => readDrafts(db, lead.id, phone)),
  )).flat();
  return drafts
    .filter((draft) => draft.status === "active" && (!kind || draft.session.kind === kind))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null;
}

/** Load one active exact session for a sender, including an older token session. */
export async function loadActiveBrokerLeadDraftSession(
  db: AdminDb,
  phoneValue: string,
  session: BrokerDraftSession,
): Promise<BrokerLeadDraft | null> {
  const phone = normalizeBrokerDraftPhone(phoneValue);
  if (!phone) throw new Error("Broker draft requires a valid phone number.");
  const leads = await db.select().from(schema.leads)
    .where(inArray(schema.leads.phone, brokerDraftPhoneVariants(phone)));
  const drafts = (await Promise.all(
    leads.map((lead) => readDrafts(db, lead.id, phone)),
  )).flat();
  return drafts.find((draft) =>
    draft.status === "active" &&
    draft.session.kind === session.kind &&
    draft.session.key === session.key,
  ) ?? null;
}

/** Load an exact session regardless of status, for completed-token replay guards. */
export async function loadBrokerLeadDraftSession(
  db: AdminDb,
  phoneValue: string,
  session: BrokerDraftSession,
): Promise<BrokerLeadDraft | null> {
  const phone = normalizeBrokerDraftPhone(phoneValue);
  if (!phone) throw new Error("Broker draft requires a valid phone number.");
  const leads = await db.select().from(schema.leads)
    .where(inArray(schema.leads.phone, brokerDraftPhoneVariants(phone)));
  const drafts = (await Promise.all(
    leads.map((lead) => readDrafts(db, lead.id, phone)),
  )).flat();
  return drafts
    .filter((draft) =>
      draft.session.kind === session.kind && draft.session.key === session.key,
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null;
}

/** Load the newest draft of one kind, including completed history. */
export async function loadLatestBrokerLeadDraft(
  db: AdminDb,
  phoneValue: string,
  kind: BrokerDraftSession["kind"],
): Promise<BrokerLeadDraft | null> {
  const phone = normalizeBrokerDraftPhone(phoneValue);
  if (!phone) throw new Error("Broker draft requires a valid phone number.");
  const leads = await db.select().from(schema.leads)
    .where(inArray(schema.leads.phone, brokerDraftPhoneVariants(phone)))
    .orderBy(desc(schema.leads.createdAt));
  const drafts = (await Promise.all(
    leads.map((lead) => readDrafts(db, lead.id, phone)),
  )).flat();
  return drafts
    .filter((draft) => draft.session.kind === kind)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null;
}

/**
 * Start/resume a session. Use a new generic key for every fresh generic-link
 * entry; reusing a key intentionally resumes that same session.
 */
export async function beginBrokerLeadDraft(
  db: AdminDb,
  input: BrokerDraftInput,
): Promise<BrokerLeadDraft> {
  validateSession(input.session);
  const { leadId, phone } = await resolveLead(db, input);
  const existing = (await readDrafts(db, leadId, phone))
    .find((draft) => sameSession(draft.session, input.session));
  if (existing) return existing;
  const at = new Date().toISOString();
  await appendEvent(db, leadId, { version: 1, event: "started", session: input.session, at });
  return {
    leadId, phone, session: input.session, answers: {}, status: "active",
    startedAt: at, updatedAt: at,
  };
}

/** Append one accepted questionnaire answer; repeated inbound keys are no-ops. */
export async function recordBrokerLeadDraftAnswer(
  db: AdminDb,
  input: BrokerDraftInput & {
    stepKey: BrokerDraftStepKey;
    value: string;
    inboundTurnDedupeKey: string;
  },
): Promise<{ draft: BrokerLeadDraft; duplicate: boolean }> {
  validateSession(input.session);
  if (!allowedSteps.has(input.stepKey)) throw new Error("Unsupported broker questionnaire step.");
  if (!input.inboundTurnDedupeKey.trim() || input.inboundTurnDedupeKey.length > 240) {
    throw new Error("Broker draft answer requires an inbound-turn dedupe key.");
  }
  const value = input.value.trim().slice(0, 4000);
  if (!value) throw new Error("Broker draft answer must not be empty.");
  if (/\b(?:senha|password|passcode|credencial|access[_ -]?token|api[_ -]?key)\b/i.test(value)) {
    throw new Error("Credential-like content must not be stored in a broker draft.");
  }
  const { leadId, phone } = await resolveLead(db, input);
  const drafts = await readDrafts(db, leadId, phone);
  let draft = drafts.find((item) => sameSession(item.session, input.session));
  if (!draft) draft = await beginBrokerLeadDraft(db, input);
  const notes = await db.select().from(schema.leadNotes)
    .where(eq(schema.leadNotes.leadId, leadId))
    .orderBy(schema.leadNotes.id);
  const duplicate = notes.some((note) => {
    const event = parseEvent(note.body);
    return event?.event === "answer" &&
      sameSession(event.session, input.session) &&
      event.inboundTurnDedupeKey === input.inboundTurnDedupeKey;
  });
  if (duplicate) return { draft, duplicate: true };
  if (draft.status === "complete") throw new Error("Completed broker draft cannot accept more answers.");
  const at = new Date().toISOString();
  await appendEvent(db, leadId, {
    version: 1, event: "answer", session: input.session, at,
    stepKey: input.stepKey, value, inboundTurnDedupeKey: input.inboundTurnDedupeKey,
  });
  return {
    draft: {
      ...draft,
      answers: { ...draft.answers, [input.stepKey]: value },
      updatedAt: at,
    },
    duplicate: false,
  };
}

/** Mark the session complete without changing its previously accepted answers. */
export async function markBrokerLeadDraftComplete(
  db: AdminDb,
  input: BrokerDraftInput,
): Promise<BrokerLeadDraft> {
  validateSession(input.session);
  const { leadId, phone } = await resolveLead(db, input);
  let draft = (await readDrafts(db, leadId, phone))
    .find((item) => sameSession(item.session, input.session));
  if (!draft) throw new Error("Cannot complete a broker draft that has not been started.");
  if (draft.status === "complete") return draft;
  const at = new Date().toISOString();
  await appendEvent(db, leadId, { version: 1, event: "completed", session: input.session, at });
  return { ...draft, status: "complete", updatedAt: at };
}
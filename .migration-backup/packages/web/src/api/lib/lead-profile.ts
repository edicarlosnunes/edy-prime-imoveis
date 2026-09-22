/**
 * Persistência do perfil de necessidade, timeline e score do lead (F4.1).
 *
 * Regras invioláveis:
 * 1. Nunca inventar dado: `null` continua `null`.
 * 2. Campo corrigido pelo corretor (origem `manual`) nunca é sobrescrito por
 *    automação — só por outra edição manual.
 * 3. Timeline é append-only; nada é editado ou apagado.
 * 4. Score é determinístico (lib/lead-score.ts). Nenhuma chamada de IA aqui.
 */
import { and, desc, eq, gte, sql } from "drizzle-orm";
import * as schema from "../database/schema";
import type { AdminDb } from "./admin-base";
import { scoreLead, tierOf, type ScoreResult } from "./lead-score";
import { qualifyText, type FieldOrigin, type QualificationPatch } from "./qualification";

export type ProfileRow = typeof schema.leadProfile.$inferSelect;

const JSON_FIELDS = ["districts", "preferences", "restrictions"] as const;
type JsonField = (typeof JSON_FIELDS)[number];

const parseList = (raw: string | null | undefined): string[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
};

const parseSources = (raw: string | null | undefined): Record<string, FieldOrigin> => {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, FieldOrigin>;
    }
  } catch {
    /* config corrompida não derruba a qualificação */
  }
  return {};
};

/** Campos considerados no cálculo de completude (0-100). */
const COMPLETENESS_FIELDS = [
  "purpose",
  "propertyType",
  "city",
  "districts",
  "budgetMax",
  "bedrooms",
  "parking",
  "financing",
  "timeframe",
  "contactPreference",
] as const;

export function computeCompleteness(profile: Partial<ProfileRow> | null | undefined): number {
  if (!profile) return 0;
  let filled = 0;
  for (const field of COMPLETENESS_FIELDS) {
    const value = (profile as Record<string, unknown>)[field];
    if (value === null || value === undefined || value === "") continue;
    if (typeof value === "string" && JSON_FIELDS.includes(field as JsonField)) {
      if (parseList(value).length === 0) continue;
    }
    filled += 1;
  }
  return Math.round((filled / COMPLETENESS_FIELDS.length) * 100);
}

export async function readProfile(db: AdminDb, leadId: number): Promise<ProfileRow | null> {
  const [row] = await db
    .select()
    .from(schema.leadProfile)
    .where(eq(schema.leadProfile.leadId, leadId))
    .limit(1);
  return row ?? null;
}

async function ensureProfile(db: AdminDb, leadId: number): Promise<ProfileRow> {
  const existing = await readProfile(db, leadId);
  if (existing) return existing;
  await db
    .insert(schema.leadProfile)
    .values({ leadId, source: "deterministico", updatedAt: new Date() })
    .onConflictDoNothing();
  const created = await readProfile(db, leadId);
  if (!created) throw new Error("não foi possível criar o perfil do lead");
  return created;
}

export interface ProfileSignalPatch {
  wantsVisit?: boolean;
  wantsHuman?: boolean;
  cashPayment?: boolean;
  justLooking?: boolean;
  /** incremento de mensagens do cliente */
  addMessage?: boolean;
  customerAt?: Date | null;
}

export interface ApplyPatchResult {
  profile: ProfileRow;
  /** campos realmente gravados agora */
  changed: string[];
  /** campos ignorados porque já tinham correção manual */
  keptManual: string[];
}

/**
 * Aplica um patch no perfil respeitando precedência de origem.
 * `origin = "manual"` sobrescreve qualquer coisa; automações (deterministico|ia)
 * só preenchem campo vazio e nunca tocam em campo marcado como manual.
 */
export async function applyProfilePatch(
  db: AdminDb,
  leadId: number,
  patch: QualificationPatch,
  origin: FieldOrigin,
  signals: ProfileSignalPatch = {},
): Promise<ApplyPatchResult> {
  const current = await ensureProfile(db, leadId);
  const sources = parseSources(current.fieldsSource);
  const changed: string[] = [];
  const keptManual: string[] = [];
  const values: Record<string, unknown> = {};

  for (const [key, incoming] of Object.entries(patch)) {
    if (incoming === null || incoming === undefined) continue;
    if (Array.isArray(incoming) && incoming.length === 0) continue;

    const existingSource = sources[key];
    if (origin !== "manual" && existingSource === "manual") {
      keptManual.push(key);
      continue;
    }

    if (JSON_FIELDS.includes(key as JsonField)) {
      const before = parseList(current[key as JsonField] as string | null);
      const incomingList = (Array.isArray(incoming) ? incoming : [incoming]).map(String);
      const merged =
        origin === "manual" ? incomingList : Array.from(new Set([...before, ...incomingList]));
      if (JSON.stringify(merged) === JSON.stringify(before)) continue;
      values[key] = JSON.stringify(merged.slice(0, 12));
      sources[key] = origin;
      changed.push(key);
      continue;
    }

    const before = (current as Record<string, unknown>)[key];
    /* automação nunca substitui valor já preenchido, nem grava vazio */
    if (origin !== "manual" && before !== null && before !== undefined && before !== "") continue;
    if (before === incoming) continue;
    values[key] = incoming;
    sources[key] = origin;
    changed.push(key);
  }

  /* sinais são acumulativos e não passam por fieldsSource */
  if (signals.wantsVisit) values.wantsVisit = 1;
  if (signals.wantsHuman) values.wantsHuman = 1;
  if (signals.cashPayment) values.cashPayment = 1;
  if (signals.justLooking) values.justLooking = 1;
  if (signals.addMessage) values.messagesCount = (current.messagesCount ?? 0) + 1;
  if (signals.customerAt) {
    const previous = current.lastCustomerAt ? new Date(current.lastCustomerAt) : null;
    const sameDay =
      previous !== null && previous.toISOString().slice(0, 10) === signals.customerAt.toISOString().slice(0, 10);
    values.lastCustomerAt = signals.customerAt;
    if (!sameDay) values.contactDays = (current.contactDays ?? 0) + 1;
  }

  if (Object.keys(values).length === 0) {
    return { profile: current, changed, keptManual };
  }

  values.fieldsSource = JSON.stringify(sources);
  if (origin === "manual") values.source = "manual";
  values.completeness = computeCompleteness({ ...current, ...values } as Partial<ProfileRow>);
  values.updatedAt = new Date();

  await db
    .update(schema.leadProfile)
    .set(values as Partial<typeof schema.leadProfile.$inferInsert>)
    .where(eq(schema.leadProfile.leadId, leadId));

  const profile = (await readProfile(db, leadId)) ?? current;
  return { profile, changed, keptManual };
}

/* ------------------------------------------------------------- timeline */

export interface LeadEventInput {
  kind: "criado" | "mensagem" | "qualificacao" | "score" | "etapa" | "nota" | "automacao";
  title: string;
  detail?: string | null;
  actorType?: "cliente" | "ia" | "corretor" | "sistema";
  actorName?: string | null;
  scoreBefore?: number | null;
  scoreAfter?: number | null;
  /** janela em minutos para evitar evento duplicado idêntico (0 = sem dedupe) */
  dedupeMinutes?: number;
}

/** Append-only. Devolve true quando o evento foi realmente gravado. */
export async function logLeadEvent(
  db: AdminDb,
  leadId: number,
  event: LeadEventInput,
): Promise<boolean> {
  const dedupe = event.dedupeMinutes ?? 5;
  if (dedupe > 0) {
    const since = new Date(Date.now() - dedupe * 60 * 1000);
    const [duplicate] = await db
      .select({ id: schema.leadEvents.id })
      .from(schema.leadEvents)
      .where(
        and(
          eq(schema.leadEvents.leadId, leadId),
          eq(schema.leadEvents.kind, event.kind),
          eq(schema.leadEvents.title, event.title.slice(0, 160)),
          gte(schema.leadEvents.createdAt, since),
        ),
      )
      .limit(1);
    if (duplicate) return false;
  }

  await db.insert(schema.leadEvents).values({
    leadId,
    kind: event.kind,
    title: event.title.slice(0, 160),
    detail: event.detail?.slice(0, 1000) ?? null,
    actorType: event.actorType ?? "sistema",
    actorName: event.actorName?.slice(0, 120) ?? null,
    scoreBefore: event.scoreBefore ?? null,
    scoreAfter: event.scoreAfter ?? null,
  });
  return true;
}

export async function leadTimeline(db: AdminDb, leadId: number, limit = 100) {
  return db
    .select()
    .from(schema.leadEvents)
    .where(eq(schema.leadEvents.leadId, leadId))
    .orderBy(desc(schema.leadEvents.id))
    .limit(Math.min(limit, 300));
}

/* ---------------------------------------------------------------- score */

/** Menor preço publicado e disponível do catálogo (para penalidade de orçamento). */
async function catalogFloorPrice(db: AdminDb): Promise<number | null> {
  const [row] = await db
    .select({ min: sql<number | null>`min(${schema.properties.price})` })
    .from(schema.properties)
    .where(and(eq(schema.properties.published, 1), eq(schema.properties.status, "disponivel")));
  const value = row?.min ?? null;
  return value && value > 0 ? value : null;
}

export interface RecomputeResult {
  score: number;
  tier: string;
  reasons: string[];
  changed: boolean;
}

/**
 * Recalcula e grava o score do lead. Não altera `stage` (isso é F4.2).
 * Grava evento de timeline apenas quando o score muda de valor.
 */
export async function recomputeLeadScore(
  db: AdminDb,
  leadId: number,
  options: { actorType?: "cliente" | "ia" | "corretor" | "sistema"; actorName?: string | null } = {},
): Promise<RecomputeResult | null> {
  const [lead] = await db.select().from(schema.leads).where(eq(schema.leads.id, leadId)).limit(1);
  if (!lead) return null;
  const profile = await readProfile(db, leadId);

  const floor = await catalogFloorPrice(db);
  const budgetMax = profile?.budgetMax ?? null;

  const result: ScoreResult = scoreLead(
    {
      purpose: profile?.purpose ?? null,
      propertyType: profile?.propertyType ?? null,
      city: profile?.city ?? null,
      districts: parseList(profile?.districts),
      budgetMin: profile?.budgetMin ?? null,
      budgetMax,
      bedrooms: profile?.bedrooms ?? null,
      suites: profile?.suites ?? null,
      parking: profile?.parking ?? null,
      areaMin: profile?.areaMin ?? null,
      financing: profile?.financing ?? null,
      fgts: profile?.fgts ?? null,
      tradeIn: profile?.tradeIn ?? null,
      timeframe: profile?.timeframe ?? null,
      contactPreference: profile?.contactPreference ?? null,
      contactWindow: profile?.contactWindow ?? null,
    },
    {
      hasPhone: Boolean(lead.phone && lead.phone.replace(/\D/g, "").length >= 10),
      hasEmail: Boolean(lead.email),
      hasName: Boolean(lead.name && lead.name.trim() && lead.name !== "Contato sem nome"),
      wantsVisit: (profile?.wantsVisit ?? 0) === 1,
      wantsHuman: (profile?.wantsHuman ?? 0) === 1,
      cashPayment: (profile?.cashPayment ?? 0) === 1,
      justLooking: (profile?.justLooking ?? 0) === 1,
      messagesCount: profile?.messagesCount ?? 0,
      contactDays: profile?.contactDays ?? 0,
      budgetBelowCatalog: floor !== null && budgetMax !== null && budgetMax < floor,
    },
  );

  const before = lead.score ?? 0;
  const changed = before !== result.score || lead.scoreTier !== result.tier;

  const values: Partial<typeof schema.leads.$inferInsert> = {
    score: result.score,
    scoreTier: result.tier,
    scoreReasons: JSON.stringify(result.reasons),
    scoreAt: new Date(),
    updatedAt: new Date(),
  };
  if (!lead.qualifiedAt && result.tier === "quente") values.qualifiedAt = new Date();

  await db.update(schema.leads).set(values).where(eq(schema.leads.id, leadId));

  if (changed) {
    await logLeadEvent(db, leadId, {
      kind: "score",
      title: `Score ${before} → ${result.score} (${result.tier})`,
      detail: result.reasons.join(" · "),
      actorType: options.actorType ?? "sistema",
      actorName: options.actorName ?? null,
      scoreBefore: before,
      scoreAfter: result.score,
      dedupeMinutes: 0,
    });
  }

  return { score: result.score, tier: result.tier, reasons: result.reasons, changed };
}

/* -------------------------------------------- qualificação a partir de texto */

/** Bairros e cidades reais do catálogo — evita inventar localização. */
export async function catalogPlaces(db: AdminDb) {
  const rows = await db
    .select({ district: schema.properties.district, city: schema.properties.city })
    .from(schema.properties)
    .limit(1000);
  const districts = Array.from(new Set(rows.map((r) => r.district).filter(Boolean)));
  const cities = Array.from(new Set(rows.map((r) => r.city).filter(Boolean)));
  return { districts, cities };
}

export interface QualifyFromTextOptions {
  /** quem escreveu — só "cliente" gera dados declarados */
  actorType?: "cliente" | "corretor";
  actorName?: string | null;
  /** conta uma mensagem de engajamento */
  countMessage?: boolean;
  /** origem dos campos extraídos */
  origin?: FieldOrigin;
}

/**
 * Porta única usada por intake e inbox: extrai perfil de um texto do cliente,
 * grava o que faltava, registra timeline e recalcula o score.
 * Nunca receber aqui texto gerado pela IA — só fala do cliente.
 */
export async function qualifyLeadFromText(
  db: AdminDb,
  leadId: number,
  text: string,
  options: QualifyFromTextOptions = {},
) {
  const actorType = options.actorType ?? "cliente";
  const places = await catalogPlaces(db);
  const { patch, signals, fields } = qualifyText(text ?? "", {
    knownDistricts: places.districts,
    knownCities: places.cities,
  });

  const applied = await applyProfilePatch(db, leadId, patch, options.origin ?? "deterministico", {
    wantsVisit: signals.wantsVisit,
    wantsHuman: signals.wantsHuman,
    cashPayment: signals.cashPayment,
    justLooking: signals.justLooking,
    addMessage: options.countMessage ?? false,
    customerAt: actorType === "cliente" ? new Date() : null,
  });

  if (applied.changed.length) {
    await logLeadEvent(db, leadId, {
      kind: "qualificacao",
      title: `Qualificação automática: ${applied.changed.length} campo(s)`,
      detail: applied.changed.join(", "),
      actorType,
      actorName: options.actorName ?? null,
      dedupeMinutes: 2,
    });
  }

  const score = await recomputeLeadScore(db, leadId, { actorType, actorName: options.actorName ?? null });
  return { fields, applied, signals, score };
}

export { tierOf };

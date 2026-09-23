import { and, desc, eq, isNull } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { base } from "../__core/app";
import * as schema from "../database/schema";
import { getDb } from "../lib/auth";
import { adminBase } from "../lib/admin-base";
import { randomHex, sha256Hex } from "../lib/auth";
import { intakeOwner } from "../lib/owner-intake";
import { saveCaptureAnswer } from "../agent/owner-capture";
import { addOwnerPhotos, serializeOwnerPhotos } from "../lib/capture-photos";
import { COMPLEMENT_FIELDS } from "../lib/capture-address";
import { generateText, tool } from "ai";
import { gateway, gatewayConfigured } from "../agent/gateway";
import { pickModel } from "../agent/model";
import { allocateSerial } from "../lib/serial-counter";

const tokenInput = z.string().regex(/^[a-f0-9]{64}$/i, "Link inválido");
/** Public locator deliberately accepts only the two issued formats. */
const shortCodeInput = z.string().regex(/^[a-f0-9]{15}$/i, "Link inválido");
export const publicLocatorInput = z.union([tokenInput, shortCodeInput]);
export const publicTokenPattern = /^[a-f0-9]{64}$/i;
const statusInput = z.enum(["aguardando", "iniciado", "concluido", "cancelado"]);
const complementsInput = z
  .object(
    Object.fromEntries(
      COMPLEMENT_FIELDS.map((field) => [field.key, z.string().max(60).optional()]),
    ) as Record<string, z.ZodOptional<z.ZodString>>,
  )
  .partial()
  .optional();

export const ownerIntakeLinkCreateInput = z.object({});

export const ownerIntakeSubmitInput = z.object({
  token: publicLocatorInput,
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().max(30).optional(),
  email: z.string().trim().email().max(160).optional(),
  intention: z.enum(["vender", "alugar"]),
  propertyType: z.string().trim().min(1).max(80),
  cep: z.string().trim().max(12).optional(),
  street: z.string().trim().max(200).optional(),
  number: z.string().trim().max(30).optional(),
  neighborhood: z.string().trim().max(120).optional(),
  city: z.string().trim().max(120).optional(),
  state: z.string().trim().max(2).optional(),
  complements: complementsInput,
  askingPrice: z.number().nonnegative().optional(),
  qualification: z.string().trim().max(3000).optional(),
  documentation: z.string().trim().max(3000).optional(),
  facadeImage: z.string().min(1).max(2_800_000),
});

const imageDataUrl = /^data:(image\/(?:jpeg|png|webp|avif));base64,([A-Za-z0-9+/=_-]+)$/i;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

async function findByToken(db: Awaited<ReturnType<typeof getDb>>, token: string) {
  const tokenHash = await sha256Hex(token);
  const [link] = await db
    .select()
    .from(schema.ownerIntakeLinks)
    .where(eq(schema.ownerIntakeLinks.tokenHash, tokenHash))
    .limit(1);
  return link;
}

async function findByLocator(db: Awaited<ReturnType<typeof getDb>>, locator: string) {
  if (publicTokenPattern.test(locator)) return findByToken(db, locator);
  if (!/^[a-f0-9]{15}$/i.test(locator)) return undefined;
  const [link] = await db.select().from(schema.ownerIntakeLinks)
    .where(eq(schema.ownerIntakeLinks.shortCode, locator)).limit(1);
  return link;
}

function shortCode() {
  // 15 hexadecimal characters encode 60 random bits exactly.
  return randomHex(16).slice(0, 15);
}

function invalidLink(): never {
  throw new ORPCError("NOT_FOUND", { message: "Link de captação inválido ou indisponível" });
}

function decodeFacadeImage(value: string | undefined) {
  if (!value) return null;
  const match = imageDataUrl.exec(value);
  if (!match) throw new ORPCError("BAD_REQUEST", { message: "A foto da fachada deve ser JPG, PNG, WEBP ou AVIF" });
  const mime = match[1]!.toLowerCase();
  const encoded = match[2]!;
  const binaryLength = Math.floor((encoded.replace(/=+$/, "").length * 3) / 4);
  if (binaryLength > MAX_IMAGE_BYTES) throw new ORPCError("BAD_REQUEST", { message: "A foto da fachada deve ter no máximo 2 MB" });
  return { mime, data: encoded.replace(/-/g, "+").replace(/_/g, "/"), size: binaryLength };
}

export const adminOwnerIntakeLinks = {
  create: adminBase.input(ownerIntakeLinkCreateInput).handler(async ({ context }) => {
    const token = randomHex(32);
    let link: { id: number; createdAt: Date; shortCode: string | null } | undefined;
    for (let attempt = 0; attempt < 5 && !link; attempt++) {
      try {
        const [created] = await context.db.insert(schema.ownerIntakeLinks).values({
          tokenHash: await sha256Hex(token), ownerName: "", phone: null, shortCode: shortCode(),
        }).returning({ id: schema.ownerIntakeLinks.id, createdAt: schema.ownerIntakeLinks.createdAt, shortCode: schema.ownerIntakeLinks.shortCode });
        link = created;
      } catch (error) {
        if (attempt === 4) throw error;
      }
    }
    if (!link) throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Não foi possível criar o link" });
    return {
      id: link.id,
      token,
      shortPath: `/c/${encodeURIComponent(link.shortCode!)}`,
      path: `/captacao/${encodeURIComponent(token)}`,
      status: "aguardando" as const,
      createdAt: link.createdAt,
    };
  }),

  list: adminBase.input(z.object({ status: statusInput.optional() }).optional()).handler(async ({ input, context }) => {
    // Authenticated, idempotent backfill for links created before short aliases.
    const legacy = await context.db.select({ id: schema.ownerIntakeLinks.id })
      .from(schema.ownerIntakeLinks).where(isNull(schema.ownerIntakeLinks.shortCode));
    for (const row of legacy) {
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          const changed = await context.db.update(schema.ownerIntakeLinks)
            .set({ shortCode: shortCode() })
            .where(and(eq(schema.ownerIntakeLinks.id, row.id), isNull(schema.ownerIntakeLinks.shortCode)));
          if (changed.rowsAffected) break;
        } catch (error) {
          if (attempt === 4) throw error;
        }
      }
    }
    const rows = await context.db
      .select({
        id: schema.ownerIntakeLinks.id,
        ownerName: schema.ownerIntakeLinks.ownerName,
        phone: schema.ownerIntakeLinks.phone,
        status: schema.ownerIntakeLinks.status,
        createdAt: schema.ownerIntakeLinks.createdAt,
        startedAt: schema.ownerIntakeLinks.startedAt,
        completedAt: schema.ownerIntakeLinks.completedAt,
        ownerId: schema.ownerIntakeLinks.ownerId,
        captureId: schema.ownerIntakeLinks.captureId,
        captureSerial: schema.propertyCaptures.serial,
        captureAddress: schema.propertyCaptures.address,
        captureType: schema.propertyCaptures.propertyType,
        registrationStatus: schema.propertyCaptures.registrationStatus,
        lastFieldAt: schema.propertyCaptures.lastFieldAt,
        profile: schema.ownerIntakeLinks.profile,
        draft: schema.ownerIntakeLinks.draft,
        cancellationReason: schema.ownerIntakeLinks.cancellationReason,
        shortCode: schema.ownerIntakeLinks.shortCode,
      })
      .from(schema.ownerIntakeLinks)
      .leftJoin(schema.propertyCaptures, eq(schema.propertyCaptures.id, schema.ownerIntakeLinks.captureId))
      .orderBy(desc(schema.ownerIntakeLinks.createdAt));
    return input?.status ? rows.filter((row) => row.status === input.status) : rows;
  }),

  /** Cancela pela sessão do painel, sem aceitar nem devolver o token público. */
  cancel: adminBase.input(z.object({
    id: z.number().int().positive(),
    reason: z.string().trim().max(500).optional(),
  })).handler(async ({ input, context }) => {
    const [link] = await context.db
      .select()
      .from(schema.ownerIntakeLinks)
      .where(eq(schema.ownerIntakeLinks.id, input.id))
      .limit(1);
    if (!link) throw new ORPCError("NOT_FOUND", { message: "Link de captação não encontrado" });
    if (link.status === "cancelado") return { ok: true, status: "cancelado" as const };
    if (link.status === "concluido") throw new ORPCError("CONFLICT", { message: "Uma captação concluída não pode ser cancelada" });
    const now = new Date();
    const reason = input.reason || "Cancelada pela equipe";
    const changed = await context.db.update(schema.ownerIntakeLinks).set({
      status: "cancelado",
      completedAt: now,
      cancellationReason: reason,
      draft: JSON.stringify({ ...safeDraft(link.draft), cancellationReason: reason }),
    }).where(and(eq(schema.ownerIntakeLinks.id, input.id), eq(schema.ownerIntakeLinks.status, link.status)));
    if (!changed.rowsAffected) throw new ORPCError("CONFLICT", { message: "A captação foi alterada por outra sessão" });
    if (link.captureId) {
      await context.db.update(schema.propertyCaptures).set({
        registrationStatus: "ARQUIVADO",
        registrationStatusAt: now,
        lostReason: "CANCELADO",
        lostDetail: reason,
        updatedAt: now,
      }).where(eq(schema.propertyCaptures.id, link.captureId));
    }
    return { ok: true, status: "cancelado" as const, reason };
  }),
};

export const ownerIntakeLinks = {
  metadata: base.input(z.object({ token: publicLocatorInput })).handler(async ({ input }) => {
    const db = await getDb();
    const link = await findByLocator(db, input.token);
    if (!link || link.status === "concluido" || link.status === "cancelado") invalidLink();
    return {
      ownerName: link.ownerName,
      phone: link.phone,
      status: link.status as z.infer<typeof statusInput>,
      createdAt: link.createdAt,
    };
  }),

  started: base.input(z.object({ token: publicLocatorInput })).handler(async ({ input }) => {
    const db = await getDb();
    const link = await findByLocator(db, input.token);
    if (!link || link.status === "concluido" || link.status === "cancelado") invalidLink();
    if (link.status === "aguardando") {
      await db
        .update(schema.ownerIntakeLinks)
        .set({ status: "iniciado", startedAt: new Date() })
        .where(and(eq(schema.ownerIntakeLinks.id, link.id), eq(schema.ownerIntakeLinks.status, "aguardando")));
    }
    return { ok: true, status: "iniciado" as const };
  }),

  /** Estado público mínimo. O cliente nunca recebe IDs, hashes ou outras fichas. */
  state: base.input(z.object({ token: publicLocatorInput })).handler(async ({ input }) => {
    const db = await getDb();
    const link = await findByLocator(db, input.token);
    if (!link) invalidLink();
    const draft = safeDraft(link.draft);
    const [capture] = link.captureId ? await db.select({ serial: schema.propertyCaptures.serial }).from(schema.propertyCaptures).where(eq(schema.propertyCaptures.id, link.captureId)).limit(1) : [];
    return publicState(link, draft, capture?.serial ?? null);
  }),

  /** Cancela a tentativa sem apagar histórico nem liberar o EPI. */
  cancel: base.input(z.object({ token: publicLocatorInput, reason: z.string().trim().max(500).optional() })).handler(async ({ input }) => {
    const db = await getDb();
    return publicCancel(db, input);
  }),

  /** Um turno por requisição; cada resposta válida é persistida antes da próxima. */
  turn: base.input(z.object({
    token: publicLocatorInput,
    text: z.string().max(4000),
    profile: z.enum(["PROPRIETARIO", "LOCADOR", "CORRETOR"]).optional(),
  })).handler(async ({ input }) => {
    const db = await getDb();
    return publicTurn(db, input);
  }),

  /*
   * The public route remains the production entry point, while this narrow
   * database-injected service is also used by the SQLite integration suite.
   * Keeping the database argument explicit prevents tests from ever touching
   * the workspace database.
   */
  /*
   * facade is intentionally kept below the turn handler so the route shape
   * remains unchanged for existing oRPC callers.
   */
  facade: base.input(z.object({
    token: publicLocatorInput,
    facadeImage: z.string().min(1).max(2_800_000),
  })).handler(async ({ input }) => {
    const db = await getDb();
    return publicFacade(db, input);
  }),

  submit: base.input(ownerIntakeSubmitInput).handler(async ({ input }) => {
    const db = await getDb();
    const link = await findByLocator(db, input.token);
    if (!link || link.status === "concluido" || link.status === "cancelado") invalidLink();
    const submitDraft = safeDraft(link.draft);
    if (submitDraft.step !== "photo") throw new ORPCError("CONFLICT", { message: "O cadastro só pode ser concluído após a foto da fachada" });
    const facade = decodeFacadeImage(input.facadeImage);
    const qualificationNotes = [
      "LINK_CAPTACAO — ficha pública concluída.",
      `Finalidade: ${input.intention}`,
      input.qualification ? `Qualificação: ${input.qualification}` : "",
      input.documentation ? `Documentação: ${input.documentation}` : "",
    ].filter(Boolean).join("\n");
    const result = link.captureId ? {
      captureId: link.captureId,
      id: link.ownerId,
      snapshot: { ownerId: link.ownerId },
      saved: true,
    } : await intakeOwner(db, {
      name: input.name,
      phone: input.phone ?? link.phone ?? "",
      email: input.email ?? null,
      propertyType: input.propertyType,
      neighborhood: input.neighborhood ?? null,
      message: qualificationNotes,
      source: "LINK_CAPTACAO",
      cep: input.cep ?? null,
      street: input.street ?? null,
      number: input.number ?? null,
      city: input.city ?? null,
      state: input.state ?? null,
      complements: input.complements ?? null,
      askingPrice: input.askingPrice ?? null,
      intention: input.intention,
    });
    if (link.captureId) {
      await db.update(schema.propertyCaptures).set({
        propertyType: input.propertyType,
        intention: input.intention,
        askingPrice: input.askingPrice ?? null,
        updatedAt: new Date(),
        lastFieldAt: new Date(),
        registrationStatus: "CONCLUIDO",
        registrationStatusAt: new Date(),
      }).where(eq(schema.propertyCaptures.id, link.captureId));
    }
    if (!result.captureId) throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Não foi possível registrar a captação" });
    if (facade) {
      const id = randomHex(12);
      await db.insert(schema.media).values({
        id,
        mime: facade.mime,
        size: facade.size,
        data: facade.data,
        name: "fachada-link-captacao",
        variant: "original",
      });
      const [capture] = await db
        .select({ ownerPhotos: schema.propertyCaptures.ownerPhotos })
        .from(schema.propertyCaptures)
        .where(eq(schema.propertyCaptures.id, result.captureId))
        .limit(1);
      const photos = addOwnerPhotos(capture?.ownerPhotos, [{ url: `/api/media/${id}`, caption: "Fachada do imóvel" }], { source: "proprietario" });
      await db
        .update(schema.propertyCaptures)
        .set({ ownerPhotos: serializeOwnerPhotos(photos), updatedAt: new Date() })
        .where(eq(schema.propertyCaptures.id, result.captureId));
    }
    const completedAt = new Date();
    const changed = await db
      .update(schema.ownerIntakeLinks)
      .set({
        status: "concluido",
        startedAt: link.startedAt ?? completedAt,
        completedAt,
        ownerId: result.id,
        captureId: result.captureId,
      })
      .where(and(eq(schema.ownerIntakeLinks.id, link.id), eq(schema.ownerIntakeLinks.status, link.status)));
    if (!changed.rowsAffected) throw new ORPCError("CONFLICT", { message: "Este link já foi concluído" });
    return { ok: true, status: "concluido" as const, captureId: result.captureId };
  }),
};

export type PublicDraft = {
  /** Explicit cursor: the public flow must never infer the next step from keys. */
  step?: string;
  profile?: "PROPRIETARIO" | "LOCADOR" | "CORRETOR";
  ownerName?: string;
  phone?: string;
  email?: string;
  brokerName?: string;
  brokerPhone?: string;
  brokerCreci?: string;
  intention?: "venda" | "locacao";
  propertyType?: string;
  address?: string;
  addressParts?: { cep?: string; street?: string; number?: string; district?: string; city?: string; state?: string; complement?: string };
  askingPrice?: number | null;
  priceClarification?: string;
  answers?: Record<string, string>;
  complete?: boolean;
  transcript?: { role: "user" | "assistant"; text: string }[];
};

function safeDraft(value: string | null | undefined): PublicDraft {
  if (!value) return {};
  try { return normalizeDraftStep(JSON.parse(value) as PublicDraft); } catch { return {}; }
}

/** Migrates pre-cursor drafts without guessing from arbitrary object keys. */
export function normalizeDraftStep(input: PublicDraft): PublicDraft {
  const draft = { ...input, answers: { ...(input.answers ?? {}) } };
  if (draft.complete) return draft;
  if (!draft.profile) return draft;
  if (!draft.step) {
    if (draft.profile === "CORRETOR" && !draft.brokerName) draft.step = "name";
    else if (draft.profile !== "CORRETOR" && !draft.ownerName) draft.step = "name";
    else if (draft.profile === "CORRETOR" && !draft.brokerCreci) draft.step = "creci";
    else if (draft.profile === "CORRETOR" && !draft.brokerPhone && !draft.phone) draft.step = "phone";
    else if (!draft.phone && draft.profile !== "CORRETOR") draft.step = "phone";
    else if (!draft.address) draft.step = "address";
    else if (!draft.answers.complemento) draft.step = "complement";
    else if (draft.profile === "CORRETOR" && !draft.intention) draft.step = "intention";
    else if (!draft.propertyType) draft.step = "type";
    else {
      const legacy: Record<string, string> = { dormitorios: "quartos", suites: "suites", banheiros: "banheiros", vagas: "vagas", area: "areaUtil", preco: "valorPretendido" };
      const sequence = exactSequence(draft);
      const index = sequence.findIndex((key) => draft.answers![key] === undefined && draft.answers![legacy[key] ?? ""] === undefined && (key !== "preco" || draft.askingPrice === undefined));
      draft.step = index < 0 ? "photo" : `q${index}`;
    }
  }
  return draft;
}

function cleanText(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, 500);
}

export function plausiblePublicName(value: string): boolean {
  const name = cleanText(value);
  const folded = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (name.length < 2 || !/[a-zà-ÿ]/i.test(name) || /^[\W\d_]+$/u.test(name)) return false;
  if (/^(?:a+|abc|teste|test|asdf|qwerty|xxx+)$/i.test(folded.replace(/\s+/g, ""))) return false;
  if (/^[a-z]$/i.test(name) || /^[\d\W_]+$/u.test(name)) return false;
  return name.split(/\s+/).filter(Boolean).length >= 2;
}

export function sufficientPublicAddress(value: string): boolean {
  const text = cleanText(value);
  if (text.length < 8 || !/[a-zà-ÿ]/i.test(text)) return false;
  const fold = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const cep = /\b\d{5}-?\d{3}\b/.test(text);
  const street = /\b(rua|r\.|avenida|av\.|alameda|rodovia|estrada|travessa|praça|praca|quadra|loteamento)\b/i.test(fold);
  const cityAndUf = /,\s*[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s.'-]{2,}\s*[-/]\s*[A-Z]{2}\b/.test(text)
    || /\bcidade\s*:\s*[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s.'-]{2,}.*\b(?:uf|estado)\s*:\s*[A-Z]{2}\b/i.test(text);
  const number = /(?:\bn[ºo.]?\s*|\s)\d{1,6}\b/i.test(text);
  return street && number && (cep || cityAndUf);
}

function firstNumber(value: string) {
  const match = value.replace(/\./g, "").replace(",", ".").match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

const unknown = (value: string) => /^(nao sei|não sei|n[aã]o conhe[cç]o|desconhe[cç]o)$/i.test(value.trim());
export function parsePublicMoney(value: string): number | null {
  const v = value.toLowerCase().replace(/\s+/g, " ").trim();
  if (unknown(v)) return null;
  const match = v.match(/(?:r\$\s*)?([\d.,]+)\s*(mil|k)?/i);
  if (!match) return null;
  const raw = match[1]!;
  if (match[2]) return Math.round(Number(raw.replace(",", ".")) * 1000);
  if (raw.includes(".") && raw.includes(",")) return Number(raw.replace(/\./g, "").replace(",", "."));
  if (raw.includes(".") && /^\d{1,3}(?:\.\d{3})+$/.test(raw)) return Number(raw.replace(/\./g, ""));
  return Number(raw.replace(",", "."));
}

const publicExtractSchema = z.object({
  ownerName: z.string().max(120).optional(),
  email: z.string().email().max(160).optional(),
  phone: z.string().max(30).optional(),
  propertyType: z.string().max(80).optional(),
  intention: z.enum(["venda", "locacao"]).optional(),
  cep: z.string().max(12).optional(),
  street: z.string().max(200).optional(),
  number: z.string().max(30).optional(),
  district: z.string().max(120).optional(),
  city: z.string().max(120).optional(),
  state: z.string().max(2).optional(),
  bedrooms: z.number().int().min(0).optional(),
  suites: z.number().int().min(0).optional(),
  bathrooms: z.number().int().min(0).optional(),
  parking: z.number().int().min(0).optional(),
  areaUtil: z.number().nonnegative().optional(),
  amenities: z.string().max(1000).optional(),
  documentation: z.string().max(500).optional(),
  occupancy: z.string().max(200).optional(),
  askingPrice: z.number().nonnegative().nullable().optional(),
});
type PublicExtract = z.infer<typeof publicExtractSchema>;

export function deterministicPublicExtract(text: string): PublicExtract {
  const result: PublicExtract = {};
  const fold = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/\b(apartamento|apto|casa|sobrado|terreno|lote|studio|cobertura|galpao|loja|sala comercial|sitio|chacara|fazenda)\b/i.test(text)) {
    result.propertyType = text.match(/\b(apartamento|apto|casa|sobrado|terreno|lote|studio|cobertura|galpao|loja|sala comercial|sitio|chacara|fazenda)\b/i)?.[1];
  }
  const get = (patterns: RegExp[]) => {
    for (const pattern of patterns) { const m = text.match(pattern); if (m) return Number(m[1]); }
    return undefined;
  };
  result.bedrooms = get([/(\d+)\s*(?:quartos?|dormit[oó]rios?)/i]);
  result.suites = get([/(\d+)\s*(?:su[ií]tes?)/i]);
  result.bathrooms = get([/(\d+)\s*(?:banheiros?)/i]);
  result.parking = get([/(\d+)\s*(?:vagas?|garagens?)/i]);
  result.areaUtil = get([/(\d+(?:[.,]\d+)?)\s*(?:m2|m²|metros quadrados)/i]);
  if (/\b(venda|vender)\b/i.test(fold)) result.intention = "venda";
  if (/\b(locação|locacao|aluguel|alugar)\b/i.test(fold)) result.intention = "locacao";
  const cep = text.match(/\b\d{5}-?\d{3}\b/); if (cep) result.cep = cep[0];
  const phone = text.match(/(?:\+?55\s*)?\(?\d{2}\)?\s*9?\d{4,5}[-\s]?\d{4}\b/);
  if (phone) result.phone = phone[0];
  const email = text.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
  if (email) result.email = email[0];
  const price = parsePublicMoney(text); if (price !== null || unknown(text)) result.askingPrice = price;
  if (/\b(documenta|escritura|matr[ií]cula|registro)\b/i.test(fold)) result.documentation = text;
  if (/\b(ocupad|desocupad|inquilino|alugad)/i.test(fold)) result.occupancy = text;
  if (/\b(piscina|academia|churrasqueira|elevador|portaria|sal[aã]o)\b/i.test(fold)) result.amenities = text;
  return result;
}

async function extractPublic(text: string, draft: PublicDraft): Promise<PublicExtract> {
  const fallback = deterministicPublicExtract(text);
  if (!gatewayConfigured()) return fallback;
  let extracted: PublicExtract | null = null;
  try {
    await generateText({
      model: gateway(pickModel()),
      system: "Extraia somente dados explicitamente presentes. Nunca invente. Use a ferramenta uma vez; não converse.",
      prompt: JSON.stringify({ resposta: text, estado: draft, regras: ["NÃO SEI é desconhecido e não é zero", "valores em reais: 450 mil/450k = 450000", "campos ausentes devem ser omitidos"] }),
      tools: { extract: tool({ inputSchema: publicExtractSchema, execute: async (input) => { extracted = input; return { ok: true }; } }) },
      maxOutputTokens: 1200,
    });
  } catch { return fallback; }
  return { ...fallback, ...(extracted ?? {}) };
}

function mergeExtracted(draft: PublicDraft, extracted: PublicExtract) {
  if (extracted.propertyType && !draft.propertyType) draft.propertyType = extracted.propertyType;
  if (extracted.intention && !draft.intention && draft.profile !== "LOCADOR") draft.intention = extracted.intention;
  if (extracted.phone && !draft.phone) draft.phone = extracted.phone;
  if (extracted.email && !draft.email) draft.email = extracted.email;
  if (extracted.cep || extracted.street || extracted.number || extracted.district || extracted.city || extracted.state) {
    draft.addressParts = { ...draft.addressParts, cep: extracted.cep ?? draft.addressParts?.cep, street: extracted.street ?? draft.addressParts?.street, number: extracted.number ?? draft.addressParts?.number, district: extracted.district ?? draft.addressParts?.district, city: extracted.city ?? draft.addressParts?.city, state: extracted.state ?? draft.addressParts?.state };
  }
  if (extracted.bedrooms !== undefined) draft.answers!.quartos = String(extracted.bedrooms);
  if (extracted.suites !== undefined) draft.answers!.suites = String(extracted.suites);
  if (extracted.bathrooms !== undefined) draft.answers!.banheiros = String(extracted.bathrooms);
  if (extracted.parking !== undefined) draft.answers!.vagas = String(extracted.parking);
  if (extracted.areaUtil !== undefined) draft.answers!.areaUtil = String(extracted.areaUtil);
  if (extracted.amenities) draft.answers!.comodidades = extracted.amenities;
  if (extracted.documentation) draft.answers!.documentacao = extracted.documentation;
  if (extracted.occupancy) draft.answers!.ocupacao = extracted.occupancy;
  if (extracted.askingPrice !== undefined) draft.askingPrice = extracted.askingPrice;
}

function appendAssistant(draft: PublicDraft, text: string) {
  draft.transcript = draft.transcript ?? [];
  const last = draft.transcript.at(-1);
  if (last?.role !== "assistant" || last.text !== text) draft.transcript.push({ role: "assistant", text });
}

export function nextPublicQuestion(draft: PublicDraft): string {
  draft = normalizeDraftStep(draft);
  if (draft.complete) return "Cadastro concluído com sucesso! Recebemos as informações do seu imóvel e nossa equipe entrará em contato em breve.";
  if (!draft.profile) return "Você é proprietário, locador ou corretor?";
  const step = draft.step;
  const prompts: Record<string, string> = {
    name: "Qual é o seu nome completo?",
    phone: "Qual é o seu telefone ou WhatsApp?",
    creci: "Qual é o seu CRECI?",
    address: "Qual é o endereço completo do imóvel?",
    complement: "Existe algum complemento? (apartamento, bloco, torre, casa, lote etc.)",
    intention: "Este imóvel está sendo cadastrado para VENDA ou LOCAÇÃO?",
    type: "Qual é o tipo do imóvel? (apartamento, casa, terreno, lote, gleba, sítio, chácara, fazenda, imóvel rural ou outro)",
    photo: "Envie uma foto da frente/fachada do imóvel para identificação.",
  };
  if (step && prompts[step]) return prompts[step]!;
  if (step === "photo") return prompts.photo;
  if (step?.startsWith("q")) {
    const key = exactSequence(draft)[Number(step.slice(1))];
    const labels: Record<string, string> = {
      condominio: "O imóvel fica em condomínio? Responda SIM ou NÃO.",
      documentacao: draft.profile === "CORRETOR" ? "Como está a documentação do imóvel?" : "Como está a documentação do imóvel? O imóvel está em seu nome?",
      dormitorios: "Quantos dormitórios?",
      suites: "Quantas suítes?",
      banheiros: "Quantos banheiros?",
      vagas: "Quantas vagas de garagem?",
      area: "Qual é a área útil ou construída?",
      preco: draft.intention === "locacao" ? "Qual é o valor pretendido do aluguel mensal?" : "Qual é o valor pretendido para venda?",
      condominioValor: "Qual é o valor do condomínio?",
      iptu: "Qual é o valor do IPTU?",
      ocupacao: "O imóvel está ocupado atualmente?",
      disponibilidade: "O imóvel está disponível para locação imediata?",
      mobilia: "O imóvel é mobiliado, parcialmente mobiliado ou sem mobília?",
      condicao: "Existe alguma condição/informação importante sobre a locação?",
      caracteristica: "Existe alguma característica/diferencial que gostaria de informar?",
      areaTotal: "Qual é a área total?",
      medidas: "Sabe informar frente, fundos e laterais?",
      condominioTipo: "Fica em condomínio ou loteamento? Responda SIM ou NÃO.",
      condominioNome: "Qual é o nome do condomínio ou loteamento?",
      unidade: "Qual é a unidade da área: m², hectares ou alqueires?",
      benfeitorias: "Possui casa, galpão, curral ou outras construções/benfeitorias?",
      agua: "Possui poço, nascente, rio, córrego, represa ou outra fonte de água?",
      acesso: "Como é o acesso?",
      energia: "Possui energia elétrica?",
    };
    return labels[key ?? ""] ?? "Informe a informação solicitada.";
  }
  const type = (draft.propertyType ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/apartamento|casa/.test(type)) return "O imóvel fica em condomínio? Responda SIM ou NÃO.";
  if (/terreno|lote/.test(type)) return "Como está a documentação? Está em seu nome?";
  if (/gleba|sitio|chacara|fazenda|rural/.test(type)) return "Como está a documentação? Está em seu nome?";
  return "Como está a documentação do imóvel?";
}

export function buildPublicSaveInput(draft: PublicDraft) {
    return {
    phone: draft.phone ?? null,
    nome: draft.ownerName,
    tipoImovel: draft.propertyType,
    negociacao: draft.intention,
    valorPretendido: draft.askingPrice,
    cep: draft.addressParts?.cep,
    rua: draft.addressParts?.street ?? draft.address,
    numero: draft.addressParts?.number,
    bairro: draft.addressParts?.district,
    cidade: draft.addressParts?.city,
    estado: draft.addressParts?.state,
    documentacao: draft.answers?.documentacao,
    caracteristicas: draft.answers?.caracteristicas,
    dormitorios: draft.answers?.quartos,
    suites: draft.answers?.suites,
    banheiros: draft.answers?.banheiros,
    vagas: draft.answers?.vagas,
    metragem: draft.answers?.areaUtil,
    ocupacao: draft.answers?.ocupacao,
    origem: "LINK_CAPTACAO" as const,
  };
}

export function buildBrokerPatch(draft: PublicDraft) {
  return {
    brokerName: draft.brokerName ?? null,
    brokerPhone: draft.brokerPhone ?? null,
    brokerCreci: draft.brokerCreci ?? null,
    source: "LINK_CAPTACAO" as const,
  };
}

export function publicState(link: typeof schema.ownerIntakeLinks.$inferSelect, draft: PublicDraft, captureSerial: string | null = null) {
  const question = nextPublicQuestion(draft);
  // The transcript is client-visible. Do not leak a CRM-known phone (or a
  // phone pasted in free text) through the otherwise harmless conversation
  // history.
  const publicTranscript = (draft.transcript ?? []).map((entry) => ({
    ...entry,
    text: entry.text
      .replace(/\+?\d[\d\s().-]{7,}\d/g, "[telefone]")
      .replace(link.phone ? new RegExp(link.phone.replace(/\D/g, "\\D"), "g") : /$^/, "[telefone]"),
  }));
  return {
    profile: draft.profile ?? null,
    question,
    draft: {
      profile: draft.profile ?? null,
      step: draft.step ?? null,
      intention: draft.intention ?? null,
      propertyType: draft.propertyType ?? null,
      askingPrice: draft.askingPrice ?? null,
      answers: draft.answers ?? {},
      transcript: publicTranscript,
    },
    status: link.status,
    capture: captureSerial ? { serial: captureSerial } : null,
    completed: Boolean(draft.complete || link.status === "concluido"),
    progress: draft.complete ? 100 : Math.min(95, Math.round((Object.keys(draft).length / 14) * 100)),
  };
}

export type PublicTurnInput = {
  token: string;
  text: string;
  profile?: "PROPRIETARIO" | "LOCADOR" | "CORRETOR";
};
export type PublicFacadeInput = { token: string; facadeImage: string };
const activePublicTurns = new Set<string>();
export const LINK_CAPTACAO_BROKER_UNIDENTIFIED = "LINK_CAPTACAO_BROKER_UNIDENTIFIED";

/** DB-injected terminal photo operation, shared by the HTTP route and the
 * in-memory integration suite. Every write is guarded by the same link/capture
 * identity, so a completed link can never receive a second media row. */
export async function publicFacade(
  db: Awaited<ReturnType<typeof getDb>>,
  input: PublicFacadeInput,
) {
  return db.transaction(async (tx) => runPublicFacade(tx as never, input));
}

async function runPublicFacade(
  db: Awaited<ReturnType<typeof getDb>>,
  input: PublicFacadeInput,
) {
  const link = await findByLocator(db, input.token);
  if (!link || link.status === "concluido" || link.status === "cancelado") invalidLink();
  const draft = safeDraft(link.draft);
  if (draft.step !== "photo") throw new ORPCError("CONFLICT", { message: "A foto da fachada só pode ser enviada na última etapa" });
  if (!link.captureId || !link.ownerId) throw new ORPCError("CONFLICT", { message: "A captação ainda não foi criada" });
  const facade = decodeFacadeImage(input.facadeImage);
  if (!facade) throw new ORPCError("BAD_REQUEST", { message: "Foto da fachada inválida" });
  const [capture] = await db.select({
    id: schema.propertyCaptures.id,
    serial: schema.propertyCaptures.serial,
    ownerId: schema.propertyCaptures.ownerId,
    ownerPhotos: schema.propertyCaptures.ownerPhotos,
  }).from(schema.propertyCaptures).where(and(
    eq(schema.propertyCaptures.id, link.captureId),
    eq(schema.propertyCaptures.ownerId, link.ownerId),
  )).limit(1);
  if (!capture) throw new ORPCError("NOT_FOUND", { message: "Captação indisponível" });
  if (capture.ownerPhotos?.includes("Fachada provisória de captação")) {
    throw new ORPCError("CONFLICT", { message: "A foto da fachada já foi recebida" });
  }
  const id = randomHex(12);
  await db.insert(schema.media).values({
    id, mime: facade.mime, size: facade.size, data: facade.data,
    name: "fachada-link-captacao", variant: "original",
  });
  const photos = addOwnerPhotos(capture.ownerPhotos, [{
    url: `/api/media/${id}`, caption: "Fachada provisória de captação",
  }], { source: "proprietario" });
  const completedAt = new Date();
  const captureChanged = await db.update(schema.propertyCaptures).set({
    ownerPhotos: serializeOwnerPhotos(photos),
    registrationStatus: "CONCLUIDO",
    registrationStatusAt: completedAt,
    updatedAt: completedAt,
  }).where(and(
    eq(schema.propertyCaptures.id, capture.id),
    eq(schema.propertyCaptures.ownerId, link.ownerId),
    eq(schema.propertyCaptures.registrationStatus, "EM_ANDAMENTO"),
  ));
  if (!captureChanged.rowsAffected) throw new ORPCError("CONFLICT", { message: "A captação foi alterada por outra sessão" });
  draft.answers = { ...(draft.answers ?? {}), fachada: "Foto provisória recebida" };
  draft.complete = true;
  draft.step = "completed";
  const changed = await db.update(schema.ownerIntakeLinks).set({
    draft: JSON.stringify(draft), status: "concluido", completedAt,
    startedAt: link.startedAt ?? completedAt,
  }).where(and(eq(schema.ownerIntakeLinks.id, link.id), eq(schema.ownerIntakeLinks.status, link.status)));
  if (!changed.rowsAffected) throw new ORPCError("CONFLICT", { message: "Este link já foi concluído" });
  return {
    ok: true,
    message: "Cadastro concluído com sucesso! Recebemos as informações do seu imóvel e nossa equipe entrará em contato em breve.",
    state: publicState({ ...link, draft: JSON.stringify(draft), status: "concluido" }, draft, capture.serial),
  };
}

export async function publicCancel(
  db: Awaited<ReturnType<typeof getDb>>,
  input: { token: string; reason?: string },
) {
  const link = await findByLocator(db, input.token);
  if (!link || link.status === "concluido" || link.status === "cancelado") invalidLink();
  const now = new Date();
  const reason = input.reason || "Cancelada pelo participante";
  const changed = await db.update(schema.ownerIntakeLinks).set({
    status: "cancelado",
    cancellationReason: reason,
    draft: JSON.stringify({ ...safeDraft(link.draft), cancellationReason: reason }),
  }).where(and(eq(schema.ownerIntakeLinks.id, link.id), eq(schema.ownerIntakeLinks.status, link.status)));
  if (!changed.rowsAffected) throw new ORPCError("CONFLICT", { message: "A captação foi alterada por outra sessão" });
  if (link.captureId) {
    await db.update(schema.propertyCaptures).set({
      registrationStatus: "PAUSADO",
      registrationStatusAt: now,
      lastFieldAt: now,
      stage: "perdido",
      stageChangedAt: now,
      lostReason: "CANCELADO",
      lostDetail: reason,
      updatedAt: now,
    }).where(eq(schema.propertyCaptures.id, link.captureId));
  }
  return { ok: true, status: "cancelado" as const, reason };
}

/** Finalizes the already-linked progressive capture; never creates a second one. */
export async function publicComplete(
  db: Awaited<ReturnType<typeof getDb>>,
  input: { token: string; propertyType?: string; intention?: "venda" | "alugar"; askingPrice?: number | null },
) {
  const link = await findByLocator(db, input.token);
  if (!link || link.status === "cancelado" || link.status === "concluido") invalidLink();
  if (!link.captureId) throw new ORPCError("CONFLICT", { message: "A captação ainda não foi criada" });
  if (safeDraft(link.draft).step !== "photo") throw new ORPCError("CONFLICT", { message: "A foto da fachada é obrigatória para concluir" });
  const now = new Date();
  await db.update(schema.propertyCaptures).set({
    ...(input.propertyType ? { propertyType: input.propertyType } : {}),
    ...(input.intention ? { intention: input.intention } : {}),
    ...(input.askingPrice !== undefined ? { askingPrice: input.askingPrice } : {}),
    registrationStatus: "CONCLUIDO",
    registrationStatusAt: now,
    lastFieldAt: now,
    updatedAt: now,
  }).where(eq(schema.propertyCaptures.id, link.captureId));
  const changed = await db.update(schema.ownerIntakeLinks).set({
    status: "concluido",
    completedAt: now,
  }).where(and(eq(schema.ownerIntakeLinks.id, link.id), eq(schema.ownerIntakeLinks.status, link.status)));
  if (!changed.rowsAffected) throw new ORPCError("CONFLICT", { message: "Este link já foi concluído" });
  return { ok: true, status: "concluido" as const, captureId: link.captureId };
}

/** Database-injected implementation of the public turn route. */
export async function publicTurn(
  db: Awaited<ReturnType<typeof getDb>>,
  input: PublicTurnInput,
) {
  if (activePublicTurns.has(input.token)) {
    throw new ORPCError("CONFLICT", { message: "Este link recebeu outra resposta; retome o estado atualizado" });
  }
  activePublicTurns.add(input.token);
  try {
    return await runPublicTurn(db, input);
  } finally {
    activePublicTurns.delete(input.token);
  }
}

async function runPublicTurn(
  db: Awaited<ReturnType<typeof getDb>>,
  input: PublicTurnInput,
) {
  const link = await findByLocator(db, input.token);
  if (!link || link.status === "concluido" || link.status === "cancelado") invalidLink();
  const current = safeDraft(link.draft);
  // A CRM-known phone is authoritative and is never replaced by a
  // participant/broker phone supplied in a later turn.
  if (link.phone && current.profile === "CORRETOR" && !current.brokerPhone) current.brokerPhone = link.phone;
  if (link.phone && current.profile !== "CORRETOR" && !current.phone) current.phone = link.phone;
  if (!input.text.trim()) return publicState(link, current);
  const next = await applyPublicTurn(db, link, current, input.text, input.profile);
  appendAssistant(next, nextPublicQuestion(next));
  const changed = await db.update(schema.ownerIntakeLinks).set({
    status: "iniciado",
    startedAt: link.startedAt ?? new Date(),
    profile: next.profile,
    draft: JSON.stringify(next),
    ownerName: next.ownerName ?? link.ownerName,
    phone: next.profile === "CORRETOR" ? link.phone : (next.phone ?? link.phone),
  }).where(and(eq(schema.ownerIntakeLinks.id, link.id), eq(schema.ownerIntakeLinks.status, link.status), link.draft ? eq(schema.ownerIntakeLinks.draft, link.draft) : isNull(schema.ownerIntakeLinks.draft)));
  if (!changed.rowsAffected) throw new ORPCError("CONFLICT", { message: "Este link recebeu outra resposta; retome o estado atualizado" });
  await ensureProgressiveCapture(db, { ...link, draft: JSON.stringify(next) }, next);
  const [fresh] = await db.select().from(schema.ownerIntakeLinks).where(eq(schema.ownerIntakeLinks.id, link.id)).limit(1);
  const currentLink = fresh ?? link;
  if (currentLink.captureId) await syncPublicDraftCapture(db, currentLink.captureId, next);
  const [capture] = currentLink.captureId ? await db.select({ serial: schema.propertyCaptures.serial }).from(schema.propertyCaptures).where(eq(schema.propertyCaptures.id, currentLink.captureId)).limit(1) : [];
  return publicState(currentLink, next, capture?.serial ?? null);
}

async function syncPublicDraftCapture(
  db: Awaited<ReturnType<typeof getDb>>,
  captureId: number,
  draft: PublicDraft,
) {
  const answers = draft.answers ?? {};
  await db.update(schema.propertyCaptures).set({
    ...(draft.propertyType ? { propertyType: draft.propertyType } : {}),
    ...(draft.intention ? { intention: draft.intention } : {}),
    ...(draft.askingPrice !== undefined ? { askingPrice: draft.askingPrice } : {}),
    ...(draft.profile === "CORRETOR" ? {
      brokerName: draft.brokerName ?? null,
      brokerPhone: draft.brokerPhone ?? null,
      brokerCreci: draft.brokerCreci ?? null,
    } : {}),
    ...(draft.address ? {
      address: draft.address,
      street: draft.addressParts?.street ?? draft.address,
      ...(draft.addressParts?.cep ? { cep: draft.addressParts.cep } : {}),
      ...(draft.addressParts?.number ? { number: draft.addressParts.number } : {}),
      ...(draft.addressParts?.district ? { district: draft.addressParts.district } : {}),
      ...(draft.addressParts?.city ? { city: draft.addressParts.city } : {}),
      ...(draft.addressParts?.state ? { state: draft.addressParts.state } : {}),
    } : {}),
    notes: JSON.stringify({ source: "LINK_CAPTACAO", profile: draft.profile, answers }),
    lastFieldAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(schema.propertyCaptures.id, captureId));
}

/** Ensures the first address-bearing answer creates the recoverable capture and
 * reserves its EPI exactly once. The link remains the source of truth for
 * resumption, so the same link cannot allocate a second serial. */
async function ensureProgressiveCapture(
  db: Awaited<ReturnType<typeof getDb>>,
  link: typeof schema.ownerIntakeLinks.$inferSelect,
  draft: PublicDraft,
) {
  const presenterReady = draft.profile === "CORRETOR"
    ? Boolean(draft.brokerName && draft.brokerCreci && draft.address && (draft.brokerPhone || link.phone))
    : Boolean(draft.ownerName && (draft.phone || link.phone) && draft.address);
  if (!presenterReady) return;
  let captureId = link.captureId;
  let ownerId = link.ownerId;
  if (!captureId) {
    const result = draft.profile === "CORRETOR"
      ? await ensureBrokerPlaceholderCapture(db, link, draft)
      : await intakeOwner(db, {
      name: draft.ownerName!,
      phone: draft.phone!,
      propertyType: draft.propertyType,
      intention: draft.intention === "locacao" ? "alugar" : "vender",
      cep: draft.addressParts?.cep ?? null,
      rua: draft.addressParts?.street ?? draft.address,
      numero: draft.addressParts?.number ?? null,
      bairro: draft.addressParts?.district ?? null,
      cidade: draft.addressParts?.city ?? null,
      estado: draft.addressParts?.state ?? null,
      source: "LINK_CAPTACAO",
      forceNewCapture: !link.captureId,
    });
    captureId = result.captureId;
    ownerId = result.id;
  }
  if (!captureId) return;
  const [capture] = await db.select({ serial: schema.propertyCaptures.serial })
    .from(schema.propertyCaptures).where(eq(schema.propertyCaptures.id, captureId)).limit(1);
  if (capture && !capture.serial) {
    const serial = await allocateSerial(db, draft.propertyType);
    await db.update(schema.propertyCaptures).set({
      serial,
      registrationStatus: "EM_ANDAMENTO",
      registrationStatusAt: new Date(),
      lastFieldAt: new Date(),
      updatedAt: new Date(),
      brokerName: draft.profile === "CORRETOR" ? draft.brokerName ?? null : null,
      brokerPhone: draft.profile === "CORRETOR" ? draft.brokerPhone ?? null : null,
      brokerCreci: draft.profile === "CORRETOR" ? draft.brokerCreci ?? null : null,
    }).where(and(eq(schema.propertyCaptures.id, captureId), isNull(schema.propertyCaptures.serial)));
    if (!capture || !capture.serial) {
      const [winner] = await db.select({ serial: schema.propertyCaptures.serial })
        .from(schema.propertyCaptures).where(eq(schema.propertyCaptures.id, captureId)).limit(1);
      if (!winner?.serial) throw new ORPCError("CONFLICT", { message: "Não foi possível reservar o EPI; tente novamente" });
    }
  }
  await db.update(schema.ownerIntakeLinks).set({ captureId, ownerId, ownerName: draft.ownerName, phone: link.phone ?? draft.phone })
    .where(and(
      eq(schema.ownerIntakeLinks.id, link.id),
      link.captureId === null ? isNull(schema.ownerIntakeLinks.captureId) : eq(schema.ownerIntakeLinks.captureId, link.captureId),
    ));
}

/** property_captures predates presenters and requires owner_id.  A broker
 * submission therefore uses an explicitly-labelled neutral CRM owner, never
 * the broker's identity or phone. */
async function ensureBrokerPlaceholderCapture(
  db: Awaited<ReturnType<typeof getDb>>,
  link: typeof schema.ownerIntakeLinks.$inferSelect,
  draft: PublicDraft,
) {
  const systemKey = LINK_CAPTACAO_BROKER_UNIDENTIFIED;
  const placeholder = "Não informado";
  await db.insert(schema.owners).values({
    name: "Não informado",
    systemKey,
    phone: null,
    notes: null,
  }).onConflictDoNothing({ target: schema.owners.systemKey });
  const [sentinel] = await db.select({ id: schema.owners.id }).from(schema.owners)
    .where(eq(schema.owners.systemKey, systemKey)).limit(1);
  const sentinelId = sentinel?.id;
  if (!sentinelId) throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Não foi possível reservar o proprietário-sistema" });
  const result = await intakeOwner(db, {
    name: placeholder,
    phone: "",
    propertyType: draft.propertyType,
    intention: draft.intention === "locacao" ? "alugar" : "vender",
    cep: draft.addressParts?.cep ?? null,
    street: draft.addressParts?.street ?? draft.address ?? null,
    number: draft.addressParts?.number ?? null,
    neighborhood: draft.addressParts?.district ?? null,
    city: draft.addressParts?.city ?? null,
    state: draft.addressParts?.state ?? null,
    source: "LINK_CAPTACAO",
    forceNewCapture: !link.captureId,
    ownerIdOverride: sentinelId,
  });
  return result;
}

async function ensureProgressiveOwner(
  db: Awaited<ReturnType<typeof getDb>>,
  name: string | undefined,
  phone: string | undefined,
) {
  if (!name || !phone) return null;
  const [existing] = await db.select({ id: schema.owners.id }).from(schema.owners)
    .where(eq(schema.owners.phone, phone)).limit(1);
  if (existing) {
    await db.update(schema.owners).set({ name }).where(eq(schema.owners.id, existing.id));
    return existing.id;
  }
  const [created] = await db.insert(schema.owners).values({ name, phone }).returning({ id: schema.owners.id });
  return created?.id ?? null;
}

async function applyPublicTurn(
  db: Awaited<ReturnType<typeof getDb>>,
  link: typeof schema.ownerIntakeLinks.$inferSelect,
  current: PublicDraft,
  rawText: string,
  selectedProfile?: PublicDraft["profile"],
) {
  const text = cleanText(rawText);
  if (!text) return current;
  const fold = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const draft: PublicDraft = { ...current, answers: { ...(current.answers ?? {}) } };
  return applyExactPublicTurn(draft, link, text, fold, selectedProfile);
  /* Legacy extraction path retained below for old drafts. */
  if (selectedProfile && !current.profile) {
    draft.profile = selectedProfile;
    if (selectedProfile === "LOCADOR") draft.intention = "locacao";
    if (selectedProfile === "PROPRIETARIO") draft.intention = "venda";
    if (selectedProfile === "CORRETOR" && link.phone) draft.brokerPhone = link.phone;
    if (selectedProfile !== "CORRETOR" && link.phone) draft.phone = link.phone;
    return draft;
  }
  if (selectedProfile) draft.profile = selectedProfile;
  if (!draft.profile) {
    if (/^(1|propriet)/.test(fold)) { draft.profile = "PROPRIETARIO"; if (link.phone) draft.phone = link.phone; }
    else if (/^(2|locador)/.test(fold)) { draft.profile = "LOCADOR"; draft.intention = "locacao"; if (link.phone) draft.phone = link.phone; }
    else if (/^(3|corretor)/.test(fold)) {
      draft.profile = "CORRETOR";
      if (link.phone) draft.brokerPhone = link.phone;
    }
    return draft;
  }
  return draft;
}

function addressPartsFromText(text: string) {
  const cep = text.match(/\b\d{5}-?\d{3}\b/)?.[0];
  const state = text.match(/(?:-|\/|,\s*)\s*([A-Z]{2})\b/)?.[1];
  const number = text.match(/\b(?:n[ºo.]?\s*)?(\d{1,6})\b/i)?.[1];
  const comma = text.split(",").map((part) => part.trim()).filter(Boolean);
  return { cep, street: comma[0], number, district: comma[2], city: comma[3]?.replace(/\s*[-/]\s*[A-Z]{2}\b.*/, ""), state };
}

function normalizeType(text: string) {
  const value = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/apartamento|apto/.test(value)) return "apartamento";
  if (/casa/.test(value)) return "casa";
  if (/terreno/.test(value)) return "terreno";
  if (/lote/.test(value)) return "lote";
  if (/gleba/.test(value)) return "gleba";
  if (/sitio/.test(value)) return "sitio";
  if (/chacara/.test(value)) return "chacara";
  if (/fazenda/.test(value)) return "fazenda";
  if (/imovel rural|rural/.test(value)) return "imovel rural";
  return "outro";
}

function exactSequence(draft: PublicDraft) {
  const type = draft.propertyType ?? "";
  const residential = /apartamento|casa/.test(type);
  const land = /terreno|lote/.test(type);
  const rural = /gleba|sitio|chacara|fazenda|rural/.test(type);
  const broker = draft.profile === "CORRETOR";
  const docs = broker ? "documentacao" : "documentacao";
  const common = residential
    ? ["condominio", docs, "dormitorios", "suites", "banheiros", "vagas", "area", "preco", "condominioValor", "iptu", ...(draft.intention === "locacao" ? ["disponibilidade", "mobilia", "ocupacao", "condicao"] : ["ocupacao", "caracteristica"])]
    : land
      ? [docs, "areaTotal", "medidas", "condominioTipo", "condominioNome", "preco", "iptu", "caracteristica"]
      : rural
        ? [docs, "areaTotal", "unidade", "benfeitorias", "agua", "acesso", "energia", "preco", "caracteristica"]
        : [docs, "caracteristica", "preco"];
  const answers = draft.answers ?? {};
  const negative = (value: string | undefined) => /^(nao|não|n|sem)\b/i.test(value ?? "");
  if (negative(answers.condominio)) return common.filter((key) => key !== "condominioValor");
  if (negative(answers.condominioTipo)) return common.filter((key) => key !== "condominioNome");
  return common;
}

async function applyExactPublicTurn(
  draft: PublicDraft,
  link: typeof schema.ownerIntakeLinks.$inferSelect,
  text: string,
  fold: string,
  selectedProfile?: PublicDraft["profile"],
) {
  if (selectedProfile && !draft.profile) {
    draft.profile = selectedProfile;
    draft.step = "name";
    if (selectedProfile === "LOCADOR") draft.intention = "locacao";
    if (selectedProfile === "PROPRIETARIO") draft.intention = "venda";
    if (link.phone) draft.profile === "CORRETOR" ? (draft.brokerPhone = link.phone) : (draft.phone = link.phone);
    return draft;
  }
  if (!draft.profile) {
    const profile = /corretor/.test(fold) ? "CORRETOR" : /locador/.test(fold) ? "LOCADOR" : /propriet/.test(fold) ? "PROPRIETARIO" : undefined;
    if (!profile) return draft;
    draft.profile = profile; draft.step = "name";
    draft.intention = profile === "LOCADOR" ? "locacao" : profile === "PROPRIETARIO" ? "venda" : undefined;
    if (link.phone) profile === "CORRETOR" ? (draft.brokerPhone = link.phone) : (draft.phone = link.phone);
    return draft;
  }
  if (draft.step === "name") {
    if (!plausiblePublicName(text)) return draft;
    if (draft.profile === "CORRETOR") draft.brokerName = text; else draft.ownerName = text;
    draft.step = (draft.profile === "CORRETOR" ? (draft.brokerPhone ? "creci" : "phone") : (draft.phone ? "address" : "phone"));
    return draft;
  }
  if (draft.step === "phone") {
    if (!/\d{8,}/.test(text.replace(/\D/g, ""))) return draft;
    if (draft.profile === "CORRETOR") draft.brokerPhone = text; else draft.phone = text;
    draft.step = draft.profile === "CORRETOR" ? "creci" : "address"; return draft;
  }
  if (draft.step === "creci") { if (unknown(text) || text.length < 2) return draft; draft.brokerCreci = text; draft.step = "address"; return draft; }
  if (draft.step === "address") {
    if (!sufficientPublicAddress(text)) return draft;
    draft.address = text; draft.addressParts = addressPartsFromText(text); draft.step = "complement"; return draft;
  }
  if (draft.step === "complement") {
    draft.answers!.complemento = unknown(text) || /^(nao|não|sem)$/i.test(text) ? "SEM COMPLEMENTO" : text;
    draft.step = draft.profile === "CORRETOR" ? "intention" : "type"; return draft;
  }
  if (draft.step === "intention") {
    if (/venda|vender/.test(fold)) draft.intention = "venda";
    else if (/loca|alug/.test(fold)) draft.intention = "locacao";
    else return draft;
    draft.step = "type"; return draft;
  }
  if (draft.step === "type") { draft.propertyType = normalizeType(text); draft.step = "q0"; return draft; }
  if (draft.step?.startsWith("q")) {
    const sequence = exactSequence(draft); const index = Number(draft.step.slice(1));
    const key = sequence[index]; if (key) {
      draft.answers![key] = unknown(text) ? "NÃO SEI" : text;
      if (key === "preco") draft.askingPrice = unknown(text) ? null : parsePublicMoney(text);
    }
    const updatedSequence = exactSequence(draft);
    const currentIndex = key ? updatedSequence.indexOf(key) : index;
    const next = currentIndex + 1;
    draft.step = next < updatedSequence.length ? `q${next}` : "photo";
  }
  return draft;
}
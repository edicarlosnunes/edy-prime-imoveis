import { and, desc, eq } from "drizzle-orm";
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

const tokenInput = z.string().regex(/^[a-f0-9]{64}$/i, "Link inválido");
export const publicTokenPattern = /^[a-f0-9]{64}$/i;
const statusInput = z.enum(["aguardando", "iniciado", "concluido"]);
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
  token: tokenInput,
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
    const [link] = await context.db
      .insert(schema.ownerIntakeLinks)
      .values({
        tokenHash: await sha256Hex(token),
        ownerName: "",
        phone: null,
      })
      .returning({ id: schema.ownerIntakeLinks.id, createdAt: schema.ownerIntakeLinks.createdAt });
    if (!link) throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Não foi possível criar o link" });
    return {
      id: link.id,
      token,
      path: `/captacao/${encodeURIComponent(token)}`,
      status: "aguardando" as const,
      createdAt: link.createdAt,
    };
  }),

  list: adminBase.input(z.object({ status: statusInput.optional() }).optional()).handler(async ({ input, context }) => {
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
      })
      .from(schema.ownerIntakeLinks)
      .orderBy(desc(schema.ownerIntakeLinks.createdAt));
    return input?.status ? rows.filter((row) => row.status === input.status) : rows;
  }),
};

export const ownerIntakeLinks = {
  metadata: base.input(z.object({ token: tokenInput })).handler(async ({ input }) => {
    const db = await getDb();
    const link = await findByToken(db, input.token);
    if (!link || link.status === "concluido") invalidLink();
    return {
      ownerName: link.ownerName,
      phone: link.phone,
      status: link.status as z.infer<typeof statusInput>,
      createdAt: link.createdAt,
    };
  }),

  started: base.input(z.object({ token: tokenInput })).handler(async ({ input }) => {
    const db = await getDb();
    const link = await findByToken(db, input.token);
    if (!link || link.status === "concluido") invalidLink();
    if (link.status === "aguardando") {
      await db
        .update(schema.ownerIntakeLinks)
        .set({ status: "iniciado", startedAt: new Date() })
        .where(and(eq(schema.ownerIntakeLinks.id, link.id), eq(schema.ownerIntakeLinks.status, "aguardando")));
    }
    return { ok: true, status: "iniciado" as const };
  }),

  /** Estado público mínimo. O cliente nunca recebe IDs, hashes ou outras fichas. */
  state: base.input(z.object({ token: tokenInput })).handler(async ({ input }) => {
    const db = await getDb();
    const link = await findByToken(db, input.token);
    if (!link) invalidLink();
    const draft = safeDraft(link.draft);
    return publicState(link, draft);
  }),

  /** Um turno por requisição; cada resposta válida é persistida antes da próxima. */
  turn: base.input(z.object({
    token: tokenInput,
    text: z.string().max(4000),
    profile: z.enum(["PROPRIETARIO", "LOCADOR", "CORRETOR"]).optional(),
  })).handler(async ({ input }) => {
    const db = await getDb();
    const link = await findByToken(db, input.token);
    if (!link || link.status === "concluido") invalidLink();
    const current = safeDraft(link.draft);
    if (!input.text.trim()) return publicState(link, current);
    const next = await applyPublicTurn(db, link, current, input.text, input.profile);
    appendAssistant(next, nextPublicQuestion(next));
    await db.update(schema.ownerIntakeLinks).set({
      status: "iniciado",
      startedAt: link.startedAt ?? new Date(),
      profile: next.profile,
      draft: JSON.stringify(next),
      ownerName: next.ownerName ?? link.ownerName,
      phone: next.phone ?? link.phone,
    }).where(and(eq(schema.ownerIntakeLinks.id, link.id), eq(schema.ownerIntakeLinks.status, link.status)));
    const [fresh] = await db.select().from(schema.ownerIntakeLinks).where(eq(schema.ownerIntakeLinks.id, link.id)).limit(1);
    return publicState(fresh ?? link, next);
  }),

  facade: base.input(z.object({
    token: tokenInput,
    facadeImage: z.string().min(1).max(2_800_000),
  })).handler(async ({ input }) => {
    const db = await getDb();
    const link = await findByToken(db, input.token);
    if (!link || link.status === "concluido") invalidLink();
    const draft = safeDraft(link.draft);
    const captureId = link.captureId ?? null;
    if (!captureId) throw new ORPCError("CONFLICT", { message: "Informe nome e telefone antes da foto da fachada" });
    const facade = decodeFacadeImage(input.facadeImage);
    if (!facade) throw new ORPCError("BAD_REQUEST", { message: "Foto da fachada inválida" });
    const [capture] = await db.select({ ownerPhotos: schema.propertyCaptures.ownerPhotos, ownerId: schema.propertyCaptures.ownerId }).from(schema.propertyCaptures).where(and(eq(schema.propertyCaptures.id, captureId), eq(schema.propertyCaptures.ownerId, link.ownerId ?? -1))).limit(1);
    if (!capture) throw new ORPCError("NOT_FOUND", { message: "Captação indisponível" });
    const id = randomHex(12);
    await db.insert(schema.media).values({ id, mime: facade.mime, size: facade.size, data: facade.data, name: "fachada-link-captacao", variant: "original" });
    const photos = addOwnerPhotos(capture?.ownerPhotos, [{ url: `/api/media/${id}`, caption: "Fachada provisória de captação" }], { source: "proprietario" });
    await db.update(schema.propertyCaptures).set({ ownerPhotos: serializeOwnerPhotos(photos), updatedAt: new Date() }).where(and(eq(schema.propertyCaptures.id, captureId), eq(schema.propertyCaptures.ownerId, link.ownerId ?? -1)));
    draft.answers = { ...(draft.answers ?? {}), fachada: "Foto provisória recebida" };
    appendAssistant(draft, nextPublicQuestion(draft));
    await db.update(schema.ownerIntakeLinks).set({ draft: JSON.stringify(draft) }).where(eq(schema.ownerIntakeLinks.id, link.id));
    return { ok: true, state: publicState({ ...link, draft: JSON.stringify(draft) }, draft) };
  }),

  submit: base.input(ownerIntakeSubmitInput).handler(async ({ input }) => {
    const db = await getDb();
    const link = await findByToken(db, input.token);
    if (!link || link.status === "concluido") invalidLink();
    const facade = decodeFacadeImage(input.facadeImage);
    const qualificationNotes = [
      "LINK_CAPTACAO — ficha pública concluída.",
      `Finalidade: ${input.intention}`,
      input.qualification ? `Qualificação: ${input.qualification}` : "",
      input.documentation ? `Documentação: ${input.documentation}` : "",
    ].filter(Boolean).join("\n");
    const result = await intakeOwner(db, {
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
  review?: boolean;
  correction?: string;
  correctionPrompt?: boolean;
  transcript?: { role: "user" | "assistant"; text: string }[];
};

function safeDraft(value: string | null | undefined): PublicDraft {
  if (!value) return {};
  try { return JSON.parse(value) as PublicDraft; } catch { return {}; }
}

function cleanText(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, 500);
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
  if (!draft.profile) return "Você é:\n1 — Proprietário\n2 — Locador\n3 — Corretor";
  if (draft.correctionPrompt) return "Qual informação você deseja corrigir? (ex.: quartos, valor, nome ou endereço)";
  if (draft.correction) return `Qual é o novo valor de ${draft.correction}?`;
  if (draft.review && !draft.complete) return "Revise o resumo abaixo e escolha CONFIRMAR ou CORRIGIR.";
  if (draft.profile === "CORRETOR") {
    if (!draft.brokerName) return "Qual é o seu nome completo?";
    if (!draft.brokerPhone) return "Qual é o seu telefone ou WhatsApp?";
    if (!draft.brokerCreci) return "Qual é o seu CRECI? Se não souber, digite NÃO SEI.";
  }
  if (!draft.ownerName) return "Qual é o nome completo do proprietário?";
  if (!draft.phone) return "Qual é o telefone ou WhatsApp do proprietário?";
  if (!draft.email) return "Qual é o e-mail do proprietário? (opcional — digite NÃO SEI para continuar)";
  if (!draft.intention && draft.profile !== "LOCADOR") return "O imóvel será para VENDA ou LOCAÇÃO?";
  if (!draft.propertyType) return "Qual é o tipo do imóvel?";
  if (!draft.address) return "Qual é o endereço do imóvel? Você pode informar vários dados na mesma mensagem.";
  const answers = draft.answers ?? {};
  if (!answers.caracteristicas) {
    const type = (draft.propertyType ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    if (/terreno|lote/.test(type)) return "Informe a área total e, se souber, frente x fundos.";
    if (/rural|sitio|chacara|fazenda/.test(type)) return "Informe a área, acesso/localização e benfeitorias existentes.";
    if (/comercial|sala|loja|galpao/.test(type)) return "Informe a área, banheiros, vagas e características comerciais.";
    return "Conte as principais características (quartos, suítes, banheiros, vagas, área e comodidades).";
  }
  if (draft.askingPrice === undefined) return draft.priceClarification ?? (draft.intention === "locacao" ? "Qual é o valor mensal pretendido?" : "Qual é o valor pretendido?");
  if (!answers.documentacao) return "Qual é a situação da documentação? Se não souber, digite NÃO SEI.";
  if (!answers.ocupacao && draft.intention === "locacao") return "O imóvel está ocupado ou desocupado? Se não souber, digite NÃO SEI.";
  if (!answers.fachada) return "Envie uma foto da frente/fachada na próxima etapa. Ela será provisória para identificação da equipe.";
  return "Revise os dados acima e responda CONFIRMAR para concluir ou CORRIGIR para alterar uma informação.";
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
    confirmacaoFinal: "CONFIRMADO" as const,
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

export function publicState(link: typeof schema.ownerIntakeLinks.$inferSelect, draft: PublicDraft) {
  const question = nextPublicQuestion(draft);
  return {
    profile: draft.profile ?? null,
    question,
    draft: {
      profile: draft.profile ?? null,
      ownerName: draft.ownerName ?? null,
      email: draft.email ?? null,
      intention: draft.intention ?? null,
      propertyType: draft.propertyType ?? null,
      address: draft.address ?? null,
      askingPrice: draft.askingPrice ?? null,
    answers: draft.answers ?? {},
    transcript: draft.transcript ?? [],
      broker: draft.profile === "CORRETOR" ? {
        name: draft.brokerName ?? null,
        phone: draft.brokerPhone ?? null,
        creci: draft.brokerCreci ?? null,
      } : null,
    },
    status: link.status,
    completed: Boolean(draft.complete || link.status === "concluido"),
    progress: draft.complete ? 100 : Math.min(95, Math.round((Object.keys(draft).length / 14) * 100)),
    review: {
      profile: draft.profile ?? null,
      owner: draft.ownerName ?? null,
      purpose: draft.intention ?? null,
      propertyType: draft.propertyType ?? null,
      location: draft.address ?? draft.addressParts?.district ?? null,
      characteristics: draft.answers?.caracteristicas ?? null,
      value: draft.askingPrice ?? null,
      documentation: draft.answers?.documentacao ?? null,
      occupancy: draft.answers?.ocupacao ?? null,
      broker: draft.profile === "CORRETOR" ? { name: draft.brokerName ?? null, phone: draft.brokerPhone ?? null, creci: draft.brokerCreci ?? null } : null,
    },
  };
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
  if (selectedProfile && !current.profile) {
    draft.profile = selectedProfile;
    if (selectedProfile === "LOCADOR") draft.intention = "locacao";
    return draft;
  }
  if (selectedProfile) draft.profile = selectedProfile;
  if (!draft.profile) {
    if (/^(1|propriet)/.test(fold)) draft.profile = "PROPRIETARIO";
    else if (/^(2|locador)/.test(fold)) { draft.profile = "LOCADOR"; draft.intention = "locacao"; }
    else if (/^(3|corretor)/.test(fold)) draft.profile = "CORRETOR";
    return draft;
  }
  draft.transcript = [...(draft.transcript ?? []).slice(-19), { role: "user", text }];
  if (/^(corrigir|errei|voltar)\b/i.test(fold)) {
    draft.review = false;
    draft.correction = text.replace(/^(corrigir|errei|voltar)\s*/i, "").trim() || undefined;
    draft.correctionPrompt = !draft.correction;
    return draft;
  }
  if (current.correctionPrompt) {
    draft.correction = text;
    draft.correctionPrompt = false;
    return draft;
  }
  if (current.correction) {
    const target = current.correction.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const value = unknown(text) ? "NÃO SEI" : text;
    if (/quarto|dorm/.test(target)) draft.answers!.quartos = value;
    else if (/suite/.test(target)) draft.answers!.suites = value;
    else if (/banheiro/.test(target)) draft.answers!.banheiros = value;
    else if (/vaga|garagem/.test(target)) draft.answers!.vagas = value;
    else if (/valor|pre[cç]o/.test(target)) draft.askingPrice = unknown(text) ? null : parsePublicMoney(text);
    else if (/nome/.test(target)) draft.ownerName = text;
    else if (/telefone|celular|whats/.test(target)) draft.phone = text;
    else if (/email|e-mail/.test(target)) draft.email = unknown(text) ? "NÃO SEI" : text;
    else if (/endere[cç]o|rua|cep|bairro/.test(target)) draft.address = text;
    else draft.answers!.caracteristicas = value;
    if (draft.ownerName && draft.phone) {
      await saveCaptureAnswer(db, {
        phone: draft.phone, nome: draft.ownerName,
        tipoImovel: draft.propertyType, negociacao: draft.intention, valorPretendido: draft.askingPrice,
        cep: draft.addressParts?.cep, rua: draft.addressParts?.street ?? draft.address, numero: draft.addressParts?.number,
        bairro: draft.addressParts?.district, cidade: draft.addressParts?.city, estado: draft.addressParts?.state,
        dormitorios: draft.answers!.quartos, suites: draft.answers!.suites, banheiros: draft.answers!.banheiros,
        vagas: draft.answers!.vagas, metragem: draft.answers!.areaUtil,
        caracteristicas: draft.answers!.caracteristicas, origem: "LINK_CAPTACAO",
      });
    }
    draft.correction = undefined;
    draft.correctionPrompt = false;
    draft.review = true;
    return draft;
  }
  if (draft.profile === "CORRETOR" && !draft.brokerName) { draft.brokerName = text; return draft; }
  if (draft.profile === "CORRETOR" && !draft.brokerPhone) { draft.brokerPhone = text; return draft; }
  if (draft.profile === "CORRETOR" && !draft.brokerCreci) { draft.brokerCreci = text; return draft; }
  const extracted = await extractPublic(text, draft);
  mergeExtracted(draft, extracted);
  if (!draft.ownerName) {
    const probableName = extracted.ownerName ?? (extracted.phone || extracted.propertyType ? text.split(",")[0] : text);
    draft.ownerName = probableName;
    return draft;
  }
  if (!draft.phone) {
    draft.phone = extracted.phone ?? text;
    const saved = await saveCaptureAnswer(db, {
      phone: draft.phone,
      nome: draft.ownerName,
      negociacao: draft.intention,
      origem: "LINK_CAPTACAO",
    });
    if (saved.saved && saved.captureId) {
      await db.update(schema.ownerIntakeLinks).set({
        captureId: saved.captureId,
        ownerId: saved.snapshot.ownerId,
      }).where(eq(schema.ownerIntakeLinks.id, link.id));
    }
    return draft;
  }
  if (!draft.email) {
    draft.email = extracted.email ?? (unknown(text) ? "NÃO SEI" : text);
    const emailSave = await saveCaptureAnswer(db, {
      phone: draft.phone ?? null,
      nome: draft.ownerName,
      negociacao: draft.intention,
      origem: "LINK_CAPTACAO",
    });
    if (emailSave.saved && emailSave.snapshot.ownerId && draft.email && draft.email !== "NÃO SEI") {
      await db.update(schema.owners).set({ email: draft.email }).where(eq(schema.owners.id, emailSave.snapshot.ownerId));
    }
    return draft;
  }
  if (!draft.intention && draft.profile !== "LOCADOR") {
    draft.intention = extracted.intention ?? (/loca|alug/i.test(fold) ? "locacao" : "venda"); return draft;
  }
  if (!draft.propertyType) { draft.propertyType = extracted.propertyType ?? text; return draft; }
  if (!draft.address) {
    draft.address = text;
    draft.addressParts = { cep: extracted.cep, street: extracted.street, number: extracted.number, district: extracted.district, city: extracted.city, state: extracted.state };
    return draft;
  }
  if (extracted.bedrooms !== undefined) draft.answers!.quartos = String(extracted.bedrooms);
  if (extracted.suites !== undefined) draft.answers!.suites = String(extracted.suites);
  if (extracted.bathrooms !== undefined) draft.answers!.banheiros = String(extracted.bathrooms);
  if (extracted.parking !== undefined) draft.answers!.vagas = String(extracted.parking);
  if (extracted.areaUtil !== undefined) draft.answers!.areaUtil = String(extracted.areaUtil);
  if (extracted.amenities) draft.answers!.comodidades = extracted.amenities;
  if (extracted.documentation) draft.answers!.documentacao = extracted.documentation;
  if (extracted.occupancy) draft.answers!.ocupacao = extracted.occupancy;
  if (!draft.answers!.caracteristicas) {
    draft.answers!.caracteristicas = extracted.amenities ?? text;
    return draft;
  }
  if (draft.askingPrice === undefined) {
    const parsed = extracted.askingPrice !== undefined ? extracted.askingPrice : (unknown(text) ? null : parsePublicMoney(text));
    if (parsed !== null && parsed !== undefined && parsed < 10000 && !/(mil|k|r\$|\.)/i.test(text)) {
      draft.priceClarification = "Esse valor parece ambíguo. Informe, por exemplo, 450 mil, R$ 450.000 ou 450k.";
    } else {
      draft.askingPrice = parsed;
      draft.priceClarification = undefined;
    }
    return draft;
  }
  if (!draft.answers!.documentacao) { draft.answers!.documentacao = extracted.documentation ?? (unknown(text) ? "NÃO SEI" : text); return draft; }
  if (draft.intention === "locacao" && !draft.answers!.ocupacao) { draft.answers!.ocupacao = text; return draft; }
  if (!draft.answers!.fachada) return draft;
  if (/^(confirmar|confirmo|ok)\b/i.test(fold)) {
    draft.review = true;
    if (!draft.review) return draft;
  }
  if (draft.review && /^(confirmar|confirmo|ok)\b/i.test(fold)) {
    if (!draft.phone || !draft.ownerName) return draft;
    const result = await saveCaptureAnswer(db, buildPublicSaveInput(draft));
    if (result.saved && result.captureId && draft.profile === "CORRETOR" && (draft.brokerName || draft.brokerPhone || draft.brokerCreci)) {
      await db.update(schema.propertyCaptures).set({
        ...buildBrokerPatch(draft), updatedAt: new Date(),
      }).where(eq(schema.propertyCaptures.id, result.captureId));
    }
    if (result.saved && result.captureId) {
      await db.update(schema.ownerIntakeLinks).set({
        captureId: result.captureId,
        ownerId: result.snapshot.ownerId,
        status: "concluido",
        completedAt: new Date(),
      }).where(and(eq(schema.ownerIntakeLinks.id, link.id), eq(schema.ownerIntakeLinks.status, "iniciado")));
    }
    if (result.saved && result.captureId) draft.complete = true;
  }
  return draft;
}
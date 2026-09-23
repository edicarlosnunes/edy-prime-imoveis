import { and, desc, eq } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { base } from "../__core/app";
import * as schema from "../database/schema";
import { getDb } from "../lib/auth";
import { adminBase } from "../lib/admin-base";
import { randomHex, sha256Hex } from "../lib/auth";
import { intakeOwner } from "../lib/owner-intake";
import { addOwnerPhotos, serializeOwnerPhotos } from "../lib/capture-photos";
import { COMPLEMENT_FIELDS } from "../lib/capture-address";

const tokenInput = z.string().regex(/^[a-f0-9]{64}$/i, "Link inválido");
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
import { z } from "zod";
import { and, asc, desc, eq, like, or } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { adminBase, type AdminDb } from "../lib/admin-base";
import * as schema from "../database/schema";

const statusEnum = z.enum(["disponivel", "reservado", "vendido", "alugado"]);
const purposeEnum = z.enum(["venda", "locacao", "venda_locacao"]);
const typeEnum = z.enum([
  "apartamento",
  "casa",
  "cobertura",
  "sobrado",
  "terreno",
  "sala_comercial",
  "chacara",
  "outro",
]);

const imageInput = z.object({
  url: z.string().min(1).max(2000),
  isPrimary: z.boolean().optional(),
});

const propertyInput = z.object({
  code: z.string().min(2).max(40),
  title: z.string().min(3).max(200),
  purpose: purposeEnum.default("venda"),
  type: typeEnum.default("apartamento"),
  price: z.number().min(0).max(999_999_999),
  condoFee: z.number().min(0).max(999_999).nullable().optional(),
  iptu: z.number().min(0).max(999_999).nullable().optional(),
  district: z.string().max(120).default(""),
  city: z.string().max(120).default("Praia Grande"),
  address: z.string().max(300).nullable().optional(),
  bedrooms: z.number().int().min(0).max(40).default(0),
  suites: z.number().int().min(0).max(40).default(0),
  bathrooms: z.number().int().min(0).max(40).default(0),
  parking: z.number().int().min(0).max(40).default(0),
  areaUtil: z.number().min(0).max(1_000_000).default(0),
  areaTotal: z.number().min(0).max(1_000_000).nullable().optional(),
  description: z.string().max(6000).nullable().optional(),
  highlight: z.string().max(200).nullable().optional(),
  features: z.array(z.string().max(80)).max(60).default([]),
  status: statusEnum.default("disponivel"),
  published: z.boolean().default(true),
  featured: z.boolean().default(false),
  ownerId: z.number().int().nullable().optional(),
  images: z.array(imageInput).max(40).default([]),
});

function toRow(input: z.infer<typeof propertyInput>) {
  return {
    code: input.code.trim().toUpperCase(),
    title: input.title.trim(),
    purpose: input.purpose,
    type: input.type,
    price: input.price,
    condoFee: input.condoFee ?? null,
    iptu: input.iptu ?? null,
    district: input.district.trim(),
    city: input.city.trim(),
    address: input.address?.trim() || null,
    bedrooms: input.bedrooms,
    suites: input.suites,
    bathrooms: input.bathrooms,
    parking: input.parking,
    areaUtil: input.areaUtil,
    areaTotal: input.areaTotal ?? null,
    description: input.description?.trim() || null,
    highlight: input.highlight?.trim() || null,
    features: JSON.stringify(input.features.filter((f) => f.trim().length > 0)),
    status: input.status,
    published: input.published ? 1 : 0,
    featured: input.featured ? 1 : 0,
    ownerId: input.ownerId ?? null,
    updatedAt: new Date(),
  };
}

async function syncImages(
  db: AdminDb,
  propertyId: number,
  images: z.infer<typeof imageInput>[],
) {
  await db.delete(schema.propertyImages).where(eq(schema.propertyImages.propertyId, propertyId));
  if (images.length === 0) return;
  const primaryIndex = Math.max(
    0,
    images.findIndex((image) => image.isPrimary),
  );
  await db.insert(schema.propertyImages).values(
    images.map((image, index) => ({
      propertyId,
      url: image.url.trim(),
      sortOrder: index,
      isPrimary: index === primaryIndex ? 1 : 0,
    })),
  );
}

async function loadImages(db: AdminDb, propertyId: number) {
  return db
    .select()
    .from(schema.propertyImages)
    .where(eq(schema.propertyImages.propertyId, propertyId))
    .orderBy(asc(schema.propertyImages.sortOrder), asc(schema.propertyImages.id));
}

export const adminProperties = {
  list: adminBase
    .input(
      z
        .object({
          search: z.string().max(120).optional(),
          status: statusEnum.optional(),
          published: z.boolean().optional(),
        })
        .optional(),
    )
    .handler(async ({ input, context }) => {
      const filters = [];
      if (input?.status) filters.push(eq(schema.properties.status, input.status));
      if (input?.published !== undefined) {
        filters.push(eq(schema.properties.published, input.published ? 1 : 0));
      }
      if (input?.search) {
        const term = `%${input.search.trim()}%`;
        filters.push(
          or(
            like(schema.properties.title, term),
            like(schema.properties.code, term),
            like(schema.properties.district, term),
          )!,
        );
      }

      const rows = await context.db
        .select()
        .from(schema.properties)
        .where(filters.length > 0 ? and(...filters) : undefined)
        .orderBy(desc(schema.properties.updatedAt))
        .limit(400);

      const images = await context.db
        .select()
        .from(schema.propertyImages)
        .orderBy(asc(schema.propertyImages.sortOrder), asc(schema.propertyImages.id));

      return rows.map((row) => {
        const own = images.filter((image) => image.propertyId === row.id);
        return {
          ...row,
          imageCount: own.length,
          cover: (own.find((image) => image.isPrimary === 1) ?? own[0])?.url ?? null,
        };
      });
    }),

  get: adminBase
    .input(z.object({ id: z.number().int() }))
    .handler(async ({ input, context }) => {
      const [row] = await context.db
        .select()
        .from(schema.properties)
        .where(eq(schema.properties.id, input.id))
        .limit(1);
      if (!row) throw new ORPCError("NOT_FOUND", { message: "Imóvel não encontrado" });
      return { ...row, images: await loadImages(context.db, row.id) };
    }),

  create: adminBase.input(propertyInput).handler(async ({ input, context }) => {
    const row = toRow(input);
    const [existing] = await context.db
      .select({ id: schema.properties.id })
      .from(schema.properties)
      .where(eq(schema.properties.code, row.code))
      .limit(1);
    if (existing) throw new ORPCError("CONFLICT", { message: "Já existe um imóvel com esse código" });

    const [created] = await context.db.insert(schema.properties).values(row).returning();
    if (!created) throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Falha ao criar" });
    await syncImages(context.db, created.id, input.images);
    return { id: created.id };
  }),

  update: adminBase
    .input(propertyInput.extend({ id: z.number().int() }))
    .handler(async ({ input, context }) => {
      const { id, ...rest } = input;
      const row = toRow(rest as z.infer<typeof propertyInput>);
      const [clash] = await context.db
        .select({ id: schema.properties.id })
        .from(schema.properties)
        .where(eq(schema.properties.code, row.code))
        .limit(1);
      if (clash && clash.id !== id) {
        throw new ORPCError("CONFLICT", { message: "Já existe um imóvel com esse código" });
      }
      await context.db.update(schema.properties).set(row).where(eq(schema.properties.id, id));
      await syncImages(context.db, id, input.images);
      return { id };
    }),

  remove: adminBase
    .input(z.object({ id: z.number().int() }))
    .handler(async ({ input, context }) => {
      await context.db
        .delete(schema.propertyImages)
        .where(eq(schema.propertyImages.propertyId, input.id));
      await context.db.delete(schema.properties).where(eq(schema.properties.id, input.id));
      return { ok: true };
    }),

  /** Publicar/despublicar, destacar e mudar status sem abrir o formulário. */
  patch: adminBase
    .input(
      z.object({
        id: z.number().int(),
        published: z.boolean().optional(),
        featured: z.boolean().optional(),
        status: statusEnum.optional(),
      }),
    )
    .handler(async ({ input, context }) => {
      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (input.published !== undefined) patch.published = input.published ? 1 : 0;
      if (input.featured !== undefined) patch.featured = input.featured ? 1 : 0;
      if (input.status) patch.status = input.status;
      await context.db.update(schema.properties).set(patch).where(eq(schema.properties.id, input.id));
      return { ok: true };
    }),

  /** Lista enxuta para os selects de leads, tarefas e propostas. */
  options: adminBase.handler(async ({ context }) => {
    return context.db
      .select({
        id: schema.properties.id,
        code: schema.properties.code,
        title: schema.properties.title,
        price: schema.properties.price,
        district: schema.properties.district,
      })
      .from(schema.properties)
      .orderBy(asc(schema.properties.code))
      .limit(500);
  }),
};

import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { base } from "../__core/app";
import * as schema from "../database/schema";
import { getDb } from "../lib/auth";
import { codeFromSlug, propertySlug } from "../lib/slug";

/**
 * Vitrine pública — os imóveis vêm do banco (cadastrados no /admin).
 * Aparece no site só o que está publicado.
 */
export interface Property {
  id: number;
  code: string;
  title: string;
  purpose: string;
  type: string;
  district: string;
  city: string;
  price: number;
  condoFee: number | null;
  iptu: number | null;
  bedrooms: number;
  suites: number;
  bathrooms: number;
  parking: number;
  area: number;
  areaTotal: number | null;
  status: string;
  highlight: string;
  description: string;
  features: string[];
  image: string;
  images: string[];
  featured: boolean;
  slug: string;
  address?: string | null;
}

const FALLBACK_IMAGE = "/images/imovel-1.jpg";

function parseFeatures(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export const properties = {
  /** Imóveis publicados, destaques primeiro. */
  list: base.handler(async (): Promise<Property[]> => {
    const db = await getDb();
    const rows = await db
      .select()
      .from(schema.properties)
      .where(eq(schema.properties.published, 1))
      .orderBy(desc(schema.properties.featured), desc(schema.properties.createdAt))
      .limit(48);

    if (rows.length === 0) return [];

    const images = await db
      .select()
      .from(schema.propertyImages)
      .where(
        inArray(
          schema.propertyImages.propertyId,
          rows.map((row) => row.id),
        ),
      )
      .orderBy(asc(schema.propertyImages.sortOrder), asc(schema.propertyImages.id));

    return rows.map((row) => {
      const own = images.filter((image) => image.propertyId === row.id);
      const primary = own.find((image) => image.isPrimary === 1) ?? own[0];
      return {
        id: row.id,
        code: row.code,
        title: row.title,
        purpose: row.purpose,
        type: row.type,
        district: row.district,
        city: row.city,
        price: row.price,
        condoFee: row.condoFee,
        iptu: row.iptu,
        bedrooms: row.bedrooms,
        suites: row.suites,
        bathrooms: row.bathrooms,
        parking: row.parking,
        area: row.areaUtil,
        areaTotal: row.areaTotal,
        status: row.status,
        highlight: row.highlight ?? "",
        description: row.description ?? "",
        features: parseFeatures(row.features),
        image: primary?.url ?? FALLBACK_IMAGE,
        images: own.map((image) => image.url),
        featured: row.featured === 1,
        slug: row.slug ?? propertySlug(row),
      };
    });
  }),


  /** Página individual do imóvel: /imovel/:slug (aceita slug ou código). */
  detail: base
    .input(z.object({ slug: z.string().min(1).max(160) }))
    .handler(async ({ input }): Promise<{ property: Property; related: Property[] } | null> => {
      const db = await getDb();
      const rows = await db
        .select()
        .from(schema.properties)
        .where(eq(schema.properties.published, 1))
        .limit(500);

      const wanted = input.slug.trim().toLowerCase();
      const code = codeFromSlug(wanted).toUpperCase();
      const row =
        rows.find((item) => (item.slug ?? propertySlug(item)).toLowerCase() === wanted) ??
        rows.find((item) => item.code.toLowerCase() === wanted) ??
        rows.find((item) => item.code.toUpperCase() === code);
      if (!row) return null;

      const images = await db
        .select()
        .from(schema.propertyImages)
        .where(eq(schema.propertyImages.propertyId, row.id))
        .orderBy(asc(schema.propertyImages.sortOrder), asc(schema.propertyImages.id));

      const primary = images.find((image) => image.isPrimary === 1) ?? images[0];
      const toProperty = (
        item: typeof row,
        list: { url: string; isPrimary: number }[],
      ): Property => {
        const cover = list.find((image) => image.isPrimary === 1) ?? list[0];
        return {
          id: item.id,
          code: item.code,
          title: item.title,
          purpose: item.purpose,
          type: item.type,
          district: item.district,
          city: item.city,
          price: item.price,
          condoFee: item.condoFee,
          iptu: item.iptu,
          bedrooms: item.bedrooms,
          suites: item.suites,
          bathrooms: item.bathrooms,
          parking: item.parking,
          area: item.areaUtil,
          areaTotal: item.areaTotal,
          status: item.status,
          highlight: item.highlight ?? "",
          description: item.description ?? "",
          features: parseFeatures(item.features),
          image: cover?.url ?? FALLBACK_IMAGE,
          images: list.map((image) => image.url),
          featured: item.featured === 1,
          slug: item.slug ?? propertySlug(item),
          address: item.address,
        };
      };

      const relatedRows = rows
        .filter(
          (item) =>
            item.id !== row.id &&
            (item.district === row.district || item.type === row.type) &&
            (item.status === "disponivel" || item.status === "reservado"),
        )
        .slice(0, 3);

      const relatedImages = relatedRows.length
        ? await db
            .select()
            .from(schema.propertyImages)
            .where(
              inArray(
                schema.propertyImages.propertyId,
                relatedRows.map((item) => item.id),
              ),
            )
            .orderBy(asc(schema.propertyImages.sortOrder), asc(schema.propertyImages.id))
        : [];

      void primary;
      return {
        property: toProperty(row, images),
        related: relatedRows.map((item) =>
          toProperty(
            item,
            relatedImages.filter((image) => image.propertyId === item.id),
          ),
        ),
      };
    }),

  /** Contador de interesse usado no ranking "imóveis mais procurados". */
  registerView: base
    .input(z.object({ code: z.string().min(1).max(40) }))
    .handler(async ({ input }) => {
      const db = await getDb();
      const [row] = await db
        .select({ id: schema.properties.id, views: schema.properties.views })
        .from(schema.properties)
        .where(and(eq(schema.properties.code, input.code)))
        .limit(1);
      if (!row) return { ok: false };
      await db
        .update(schema.properties)
        .set({ views: row.views + 1 })
        .where(eq(schema.properties.id, row.id));
      return { ok: true };
    }),
};

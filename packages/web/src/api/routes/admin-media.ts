import { z } from "zod";
import { desc, eq, like, or } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { adminBase } from "../lib/admin-base";
import * as schema from "../database/schema";

/**
 * Biblioteca de mídia do painel: lista, renomeia e exclui as imagens
 * enviadas pelo editor (guardadas na tabela media e servidas em /api/media/:id).
 * O upload em si é a rota HTTP POST /api/admin/upload (envio binário).
 */
export const adminMedia = {
  list: adminBase
    .input(z.object({ search: z.string().max(80).optional() }).optional())
    .handler(async ({ input, context }) => {
      const rows = await context.db
        .select({
          id: schema.media.id,
          mime: schema.media.mime,
          size: schema.media.size,
          name: schema.media.name,
          alt: schema.media.alt,
          createdAt: schema.media.createdAt,
        })
        .from(schema.media)
        .orderBy(desc(schema.media.createdAt))
        .limit(300);

      const search = input?.search?.trim().toLowerCase();
      const filtered = search
        ? rows.filter(
            (row) =>
              (row.name ?? "").toLowerCase().includes(search) ||
              (row.alt ?? "").toLowerCase().includes(search),
          )
        : rows;

      // onde cada imagem está sendo usada (imóveis + conteúdo do site)
      const images = await context.db
        .select({ url: schema.propertyImages.url })
        .from(schema.propertyImages);
      const contentRows = await context.db
        .select({ data: schema.siteContent.data, status: schema.siteContent.status })
        .from(schema.siteContent);

      const inProperties = new Set(
        images
          .map((row) => row.url.match(/\/api\/media\/([a-f0-9]+)/)?.[1])
          .filter((id): id is string => Boolean(id)),
      );
      const inContent = new Set<string>();
      for (const row of contentRows) {
        if (row.status === "archived") continue;
        for (const match of row.data.matchAll(/\/api\/media\/([a-f0-9]+)/g)) {
          inContent.add(match[1]);
        }
      }

      return filtered.map((row) => ({
        ...row,
        url: `/api/media/${row.id}`,
        usedInProperties: inProperties.has(row.id),
        usedInSite: inContent.has(row.id),
      }));
    }),

  update: adminBase
    .input(
      z.object({
        id: z.string().min(4).max(64),
        name: z.string().max(160).optional(),
        alt: z.string().max(300).optional(),
      }),
    )
    .handler(async ({ input, context }) => {
      await context.db
        .update(schema.media)
        .set({
          ...(input.name === undefined ? {} : { name: input.name.trim() }),
          ...(input.alt === undefined ? {} : { alt: input.alt.trim() }),
        })
        .where(eq(schema.media.id, input.id));
      return { ok: true };
    }),

  /** Exclui uma imagem — bloqueado se ela ainda estiver em uso. */
  remove: adminBase
    .input(z.object({ id: z.string().min(4).max(64), force: z.boolean().optional() }))
    .handler(async ({ input, context }) => {
      const url = `/api/media/${input.id}`;
      if (!input.force) {
        const [used] = await context.db
          .select({ id: schema.propertyImages.id })
          .from(schema.propertyImages)
          .where(or(eq(schema.propertyImages.url, url), like(schema.propertyImages.url, `%${input.id}%`)))
          .limit(1);
        if (used) {
          throw new ORPCError("CONFLICT", {
            message: "Imagem em uso em um imóvel. Troque a foto do imóvel antes de excluir.",
          });
        }
        const contentRows = await context.db
          .select({ data: schema.siteContent.data, status: schema.siteContent.status })
          .from(schema.siteContent);
        const inUse = contentRows.some(
          (row) => row.status !== "archived" && row.data.includes(input.id),
        );
        if (inUse) {
          throw new ORPCError("CONFLICT", {
            message: "Imagem em uso no site. Troque a imagem na seção antes de excluir.",
          });
        }
      }
      await context.db.delete(schema.media).where(eq(schema.media.id, input.id));
      return { ok: true };
    }),
};

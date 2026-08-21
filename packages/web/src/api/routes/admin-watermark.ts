/**
 * Marca d'água das fotos.
 *
 * REGRA ABSOLUTA: a foto original nunca é alterada nem apagada.
 * - `media.variant = "original"` guarda o arquivo enviado;
 * - a versão com marca entra como novo registro (`variant = "watermarked"`,
 *   `original_id` apontando para o original);
 * - `property_images.original_url` mantém o caminho da original;
 * - `properties.watermark_off` desliga a marca em um imóvel específico;
 * - nunca aplicamos marca sobre uma foto já marcada;
 * - é sempre possível voltar para a original (restore) e regerar.
 *
 * A composição da imagem é feita no navegador (canvas) pelo painel, porque o
 * runtime serverless não tem biblioteca de imagem. Aqui ficam a configuração,
 * a fila de trabalho e o registro do resultado.
 */
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { adminBase } from "../lib/admin-base";
import { audit } from "../lib/audit";
import { clientIp } from "../lib/base-url";
import * as schema from "../database/schema";

const settingsInput = z.object({
  enabled: z.boolean(),
  logoUrl: z.string().max(2000).nullable(),
  size: z.number().int().min(5).max(60),
  opacity: z.number().int().min(10).max(100),
  margin: z.number().int().min(0).max(20),
  position: z.enum([
    "top-left",
    "top-center",
    "top-right",
    "center",
    "bottom-left",
    "bottom-center",
    "bottom-right",
  ]),
  applyToNewUploads: z.boolean(),
});

async function loadSettings(db: Parameters<typeof audit>[0]) {
  const [row] = await db.select().from(schema.watermarkSettings).limit(1);
  return row ?? null;
}

export const adminWatermark = {
  get: adminBase.handler(async ({ context }) => {
    const row = await loadSettings(context.db);
    const marked = await context.db
      .select({ id: schema.propertyImages.id })
      .from(schema.propertyImages)
      .where(or(isNull(schema.propertyImages.originalUrl), eq(schema.propertyImages.originalUrl, "")));
    const total = await context.db.select({ id: schema.propertyImages.id }).from(schema.propertyImages);
    return {
      settings: row
        ? { ...row, enabled: row.enabled === 1, applyToNewUploads: row.applyToNewUploads === 1 }
        : {
            id: 0,
            enabled: false,
            logoUrl: null,
            size: 22,
            opacity: 70,
            margin: 4,
            position: "bottom-right" as const,
            applyToNewUploads: true,
            updatedAt: new Date(),
          },
      stats: {
        totalImages: total.length,
        withoutWatermark: marked.length,
        withWatermark: total.length - marked.length,
      },
    };
  }),

  save: adminBase.input(settingsInput).handler(async ({ input, context }) => {
    const payload = {
      enabled: input.enabled ? 1 : 0,
      logoUrl: input.logoUrl?.trim() || null,
      size: input.size,
      opacity: input.opacity,
      margin: input.margin,
      position: input.position,
      applyToNewUploads: input.applyToNewUploads ? 1 : 0,
      updatedAt: new Date(),
    };
    if (input.enabled && !payload.logoUrl) {
      throw new ORPCError("BAD_REQUEST", { message: "Envie o logo antes de ativar a marca d'água." });
    }
    const row = await loadSettings(context.db);
    if (row) {
      await context.db
        .update(schema.watermarkSettings)
        .set(payload)
        .where(eq(schema.watermarkSettings.id, row.id));
    } else {
      await context.db.insert(schema.watermarkSettings).values(payload);
    }
    await audit(context.db, context.user, "marca_dagua.config", {
      detail: `ativa=${input.enabled} posicao=${input.position} tamanho=${input.size}%`,
      ip: clientIp(context.headers),
    });
    return { ok: true };
  }),

  /**
   * Fila de fotos a processar. `mode = "faltantes"` pega só as que ainda não
   * têm marca; `"todas"` regera a partir da original (nunca da marcada).
   */
  queue: adminBase
    .input(
      z.object({
        mode: z.enum(["faltantes", "todas"]).default("faltantes"),
        limit: z.number().int().min(1).max(60).default(20),
      }),
    )
    .handler(async ({ input, context }) => {
      const properties = await context.db
        .select({ id: schema.properties.id, watermarkOff: schema.properties.watermarkOff })
        .from(schema.properties);
      const skip = new Set(
        properties.filter((row) => row.watermarkOff === 1).map((row) => row.id),
      );

      const images = await context.db
        .select()
        .from(schema.propertyImages)
        .orderBy(asc(schema.propertyImages.propertyId), asc(schema.propertyImages.sortOrder))
        .limit(1000);

      const pending = images
        .filter((image) => !skip.has(image.propertyId))
        .filter((image) =>
          input.mode === "todas" ? true : !image.originalUrl || image.originalUrl === "",
        )
        .slice(0, input.limit)
        .map((image) => ({
          imageId: image.id,
          propertyId: image.propertyId,
          /** origem do processamento: SEMPRE a original quando ela existe */
          sourceUrl: image.originalUrl || image.url,
          currentUrl: image.url,
          alreadyWatermarked: Boolean(image.originalUrl),
        }));

      return { pending, skipped: [...skip] };
    }),

  /** Registra a foto marcada gerada pelo painel, preservando a original. */
  applyResult: adminBase
    .input(
      z.object({
        imageId: z.number().int(),
        /** URL da nova imagem (derivada) já enviada pelo upload */
        watermarkedUrl: z.string().min(1).max(2000),
        /** URL da original usada como origem */
        originalUrl: z.string().min(1).max(2000),
      }),
    )
    .handler(async ({ input, context }) => {
      const [image] = await context.db
        .select()
        .from(schema.propertyImages)
        .where(eq(schema.propertyImages.id, input.imageId))
        .limit(1);
      if (!image) throw new ORPCError("NOT_FOUND", { message: "Foto não encontrada" });

      // a original é a que já estava guardada, ou a que veio na chamada
      const original = image.originalUrl || input.originalUrl;
      await context.db
        .update(schema.propertyImages)
        .set({ url: input.watermarkedUrl, originalUrl: original })
        .where(eq(schema.propertyImages.id, input.imageId));

      // marca a mídia derivada e liga ela à original
      const derivedId = input.watermarkedUrl.split("/").pop() ?? "";
      const originalId = original.split("/").pop() ?? "";
      if (derivedId) {
        await context.db
          .update(schema.media)
          .set({ variant: "watermarked", originalId: originalId || null })
          .where(eq(schema.media.id, derivedId));
      }
      if (originalId) {
        await context.db
          .update(schema.media)
          .set({ variant: "original" })
          .where(eq(schema.media.id, originalId));
      }

      return { ok: true };
    }),

  /** Volta a foto para a original (a marcada continua no banco). */
  restore: adminBase
    .input(z.object({ imageId: z.number().int() }))
    .handler(async ({ input, context }) => {
      const [image] = await context.db
        .select()
        .from(schema.propertyImages)
        .where(eq(schema.propertyImages.id, input.imageId))
        .limit(1);
      if (!image) throw new ORPCError("NOT_FOUND", { message: "Foto não encontrada" });
      if (!image.originalUrl) return { ok: true, message: "Esta foto já é a original." };

      await context.db
        .update(schema.propertyImages)
        .set({ url: image.originalUrl, originalUrl: null })
        .where(eq(schema.propertyImages.id, input.imageId));
      await audit(context.db, context.user, "marca_dagua.restaurar", {
        entity: "property_image",
        entityId: input.imageId,
        ip: clientIp(context.headers),
      });
      return { ok: true, message: "Foto original restaurada." };
    }),

  /** Restaura todas as fotos de um imóvel. */
  restoreProperty: adminBase
    .input(z.object({ propertyId: z.number().int() }))
    .handler(async ({ input, context }) => {
      const images = await context.db
        .select()
        .from(schema.propertyImages)
        .where(
          and(
            eq(schema.propertyImages.propertyId, input.propertyId),
            inArray(schema.propertyImages.propertyId, [input.propertyId]),
          ),
        );
      let count = 0;
      for (const image of images) {
        if (!image.originalUrl) continue;
        await context.db
          .update(schema.propertyImages)
          .set({ url: image.originalUrl, originalUrl: null })
          .where(eq(schema.propertyImages.id, image.id));
        count += 1;
      }
      await audit(context.db, context.user, "marca_dagua.restaurar_imovel", {
        entity: "property",
        entityId: input.propertyId,
        detail: `${count} foto(s)`,
        ip: clientIp(context.headers),
      });
      return { ok: true, count };
    }),

  /** Liga/desliga a marca d'água em um imóvel. */
  setPropertyOff: adminBase
    .input(z.object({ propertyId: z.number().int(), off: z.boolean() }))
    .handler(async ({ input, context }) => {
      await context.db
        .update(schema.properties)
        .set({ watermarkOff: input.off ? 1 : 0, updatedAt: new Date() })
        .where(eq(schema.properties.id, input.propertyId));
      return { ok: true };
    }),
};

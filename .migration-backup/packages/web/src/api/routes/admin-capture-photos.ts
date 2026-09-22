import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { adminBase } from "../lib/admin-base";
import * as schema from "../database/schema";
import { parseOwnerPhotos, promoteToOfficial } from "../lib/capture-photos";

/**
 * PROMOÇÃO DE FOTO PROVISÓRIA -> FOTO OFICIAL DO ANÚNCIO.
 *
 * Arquivo separado de propósito: `admin-captures.ts` já é grande e esta é a
 * ÚNICA ponte entre `property_captures.owner_photos` (JSON, provisório) e
 * `property_images` (o que o site público exibe).
 *
 * Regras que não mudam:
 *  - a promoção é sempre um ato explícito da equipe, foto a foto. Nunca
 *    acontece por efeito colateral da conversão nem em massa;
 *  - só existe promoção se a captação já virou imóvel (`converted_property_id`);
 *  - promover não apaga a foto provisória: a captação mantém o histórico do
 *    que o proprietário enviou;
 *  - a mesma URL não entra duas vezes no mesmo imóvel.
 */
export const adminCapturePhotos = {
  /** URLs provisórias que já estão no anúncio, para a ficha marcar o que falta. */
  promoted: adminBase
    .input(z.object({ id: z.number().int().positive() }))
    .handler(async ({ input, context }) => {
      const [capture] = await context.db
        .select()
        .from(schema.propertyCaptures)
        .where(eq(schema.propertyCaptures.id, input.id))
        .limit(1);
      if (!capture) throw new ORPCError("NOT_FOUND", { message: "Captação não encontrada" });
      if (!capture.convertedPropertyId) return { propertyId: null as number | null, urls: [] as string[] };
      const rows = await context.db
        .select({ url: schema.propertyImages.url })
        .from(schema.propertyImages)
        .where(eq(schema.propertyImages.propertyId, capture.convertedPropertyId));
      return { propertyId: capture.convertedPropertyId, urls: rows.map((r: { url: string }) => r.url) };
    }),

  promote: adminBase
    .input(z.object({ id: z.number().int().positive(), url: z.string().min(4).max(1000) }))
    .handler(async ({ input, context }) => {
      const [capture] = await context.db
        .select()
        .from(schema.propertyCaptures)
        .where(eq(schema.propertyCaptures.id, input.id))
        .limit(1);
      if (!capture) throw new ORPCError("NOT_FOUND", { message: "Captação não encontrada" });
      const propertyId = capture.convertedPropertyId;
      if (!propertyId) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Cadastre o imóvel antes de promover fotos: a foto oficial pertence ao anúncio, não à captação",
        });
      }
      /* A foto tem de existir entre as provisórias desta captação. */
      const chosen = promoteToOfficial(capture.ownerPhotos, [input.url]);
      if (chosen.length === 0) {
        throw new ORPCError("BAD_REQUEST", { message: "Foto não encontrada entre as provisórias desta captação" });
      }

      const existing = await context.db
        .select({ url: schema.propertyImages.url, sortOrder: schema.propertyImages.sortOrder })
        .from(schema.propertyImages)
        .where(eq(schema.propertyImages.propertyId, propertyId))
        .orderBy(desc(schema.propertyImages.sortOrder));
      if (existing.some((row: { url: string }) => row.url === chosen[0].url)) {
        return { ok: true, changed: false, propertyId };
      }
      const nextOrder = existing.length > 0 ? (existing[0].sortOrder ?? 0) + 1 : 0;
      /* Capa só quando o anúncio ainda não tem nenhuma foto. Promover a
         segunda foto nunca rouba a capa de quem já é capa. */
      const isPrimary = existing.length === 0 ? 1 : 0;

      await context.db.insert(schema.propertyImages).values({
        propertyId,
        url: chosen[0].url,
        sortOrder: nextOrder,
        isPrimary,
      });
      await context.db.insert(schema.auditLog).values({
        userId: context.user.id,
        userName: context.user.name,
        action: "capture_photo_promoted",
        entity: "capture",
        entityId: String(input.id),
        detail: `imóvel ${propertyId} · ${input.url.slice(0, 180)}`,
      });
      return { ok: true, changed: true, propertyId, isPrimary };
    }),

  /** Retira do anúncio uma foto promovida por engano. A provisória continua na captação. */
  demote: adminBase
    .input(z.object({ id: z.number().int().positive(), url: z.string().min(4).max(1000) }))
    .handler(async ({ input, context }) => {
      const [capture] = await context.db
        .select()
        .from(schema.propertyCaptures)
        .where(eq(schema.propertyCaptures.id, input.id))
        .limit(1);
      if (!capture) throw new ORPCError("NOT_FOUND", { message: "Captação não encontrada" });
      const propertyId = capture.convertedPropertyId;
      if (!propertyId) return { ok: true, changed: false };
      /* Só remove do anúncio o que veio das provisórias desta captação:
         foto cadastrada direto no imóvel não é assunto desta tela. */
      const provisional = parseOwnerPhotos(capture.ownerPhotos).some((photo) => photo.url === input.url);
      if (!provisional) {
        throw new ORPCError("BAD_REQUEST", { message: "Esta foto não veio das provisórias desta captação" });
      }
      await context.db
        .delete(schema.propertyImages)
        .where(and(eq(schema.propertyImages.propertyId, propertyId), eq(schema.propertyImages.url, input.url)));
      await context.db.insert(schema.auditLog).values({
        userId: context.user.id,
        userName: context.user.name,
        action: "capture_photo_demoted",
        entity: "capture",
        entityId: String(input.id),
        detail: `imóvel ${propertyId} · ${input.url.slice(0, 180)}`,
      });
      return { ok: true, changed: true };
    }),
};

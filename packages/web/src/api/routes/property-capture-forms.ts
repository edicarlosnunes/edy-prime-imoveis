import { z } from "zod";
import { and, eq, gt, isNull } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { base } from "../__core/app";
import { getDb, sha256Hex } from "../lib/auth";
import type { AdminDb } from "../lib/admin-base";
import * as schema from "../database/schema";
import { validateCaptureShareToken, issueCaptureShareTokenRecord } from "../lib/capture-share-tokens";
import { intakeOwner } from "../lib/owner-intake";
import { parseOwnerPhotos } from "../lib/capture-photos";
import { propertyCaptureFormSchema, captureFormNotes, captureFormPrice } from "../../shared/property-capture-form";

import { createRateLimiter } from "../lib/lead-webhook-token";
const limitPublicSessions = createRateLimiter(15, 60 * 60 * 1000);

/** A reusable public URL creates an independent, opaque session for each visitor. */
export async function startPublicCaptureSession(db: AdminDb, previousToken?: string) {
  if (previousToken && await validateCaptureShareToken(db, previousToken)) return { token: previousToken };
  // 0 identifies a public form session, not an administrator or WhatsApp sender.
  const { token } = await issueCaptureShareTokenRecord(db, 0);
  return { token };
}
export const propertyCaptureForms = {
  start: base.input(z.object({ previousToken: z.string().max(128).optional() })).handler(async ({input, context}) => {
    const db = await getDb();
    if (input.previousToken && await validateCaptureShareToken(db, input.previousToken)) return {token:input.previousToken};
    const ip = context.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    if (limitPublicSessions(ip)) throw new ORPCError("TOO_MANY_REQUESTS", {message:"Muitas tentativas. Aguarde um pouco antes de abrir um novo formulário."});
    return startPublicCaptureSession(db);
  }),
  resolve: base.input(z.object({ token: z.string().max(128) })).handler(async ({ input }) => ({
    valid: Boolean(await validateCaptureShareToken(await getDb(), input.token)),
  })),
  submit: base.input(propertyCaptureFormSchema).handler(async ({ input }) => submitPropertyCaptureForm(await getDb(), input)),
};

export async function submitPropertyCaptureForm(db: AdminDb, input: import("../../shared/property-capture-form").PropertyCaptureFormInput) {
    if (!await validateCaptureShareToken(db, input.token)) {
      throw new ORPCError("BAD_REQUEST", { message: "Este link expirou ou já foi utilizado. Peça um novo link à equipe." });
    }
    // The browser normalizes the facade to JPEG; verify the bytes and cap storage.
    let image: Buffer;
    try {
      const bytes = Buffer.from(input.photo.split(",")[1], "base64");
      if (bytes.length < 100 || bytes.length > 2 * 1024 * 1024 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) throw new Error("image");
      image = bytes;
    } catch {
      throw new ORPCError("BAD_REQUEST", { message: "Não foi possível ler a foto. Escolha uma imagem JPG, PNG ou WebP da fachada." });
    }
    const tokenHash = await sha256Hex(input.token);
    await db.transaction(async (tx) => {
      // Claim + intake + photograph commit together. Retries/concurrent submits cannot create a second record.
      const claimed = await tx.update(schema.captureShareTokens).set({ status: "completed", completedAt: new Date() })
        .where(and(eq(schema.captureShareTokens.tokenHash, tokenHash), eq(schema.captureShareTokens.status, "active"),
          isNull(schema.captureShareTokens.revokedAt), gt(schema.captureShareTokens.expiresAt, new Date())))
        .returning({ id: schema.captureShareTokens.id });
      if (!claimed.length) throw new ORPCError("BAD_REQUEST", { message: "Este formulário já foi enviado ou o link expirou." });
      const result = await intakeOwner(tx as unknown as AdminDb, {
        name: input.name, phone: input.phone, email: input.email, source: "link_captacao",
        propertyType: input.propertyType, neighborhood: input.neighborhood, cep: input.cep,
        street: input.street, number: input.number, city: input.city, state: input.state,
        complements: { unit: input.complement }, askingPrice: captureFormPrice(input.price), message: captureFormNotes(input),
      });
      if (!result.captureId) throw new Error("Não foi possível registrar a captação. Tente novamente.");
      const mediaId = crypto.randomUUID();
      await tx.insert(schema.media).values({ id: mediaId, mime: "image/jpeg", size: image.length,
        data: image.toString("base64"), name: "fachada-formulario.jpg", alt: "Fachada provisória enviada pelo proprietário" });
      const [capture] = await tx.select().from(schema.propertyCaptures).where(eq(schema.propertyCaptures.id, result.captureId));
      const photos = parseOwnerPhotos(capture.ownerPhotos);
      if (photos.length >= 30) throw new ORPCError("BAD_REQUEST", { message: "Esta captação já tem o limite de fotos. Entre em contato com a equipe." });
      photos.push({ url: `/api/media/${mediaId}`, caption: "Fachada · aguarda conferência da equipe", source: "proprietario", addedAt: new Date().toISOString(), primary: photos.length === 0 });
      await tx.update(schema.propertyCaptures).set({ ownerPhotos: JSON.stringify(photos), intention: capture.intention || input.intention })
        .where(eq(schema.propertyCaptures.id, result.captureId));
      await tx.update(schema.captureShareTokens).set({ captureId: result.captureId, senderPhone: input.phone.replace(/\D/g, "") })
        .where(eq(schema.captureShareTokens.id, claimed[0].id));
    });
    return { ok: true };
}

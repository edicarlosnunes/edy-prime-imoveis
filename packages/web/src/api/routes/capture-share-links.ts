import { z } from "zod";
import { base } from "../__core/app";
import { adminBase } from "../lib/admin-base";
import { getDb } from "../lib/auth";
import {
  issueCaptureShareTokenRecord,
  revokeCaptureShareToken,
  validateCaptureShareToken,
} from "../lib/capture-share-tokens";
import * as schema from "../database/schema";

/** Admin-only issuance: token value is returned once and never stored in DB. */
export const adminCaptureLinks = {
  issue: adminBase
    .input(z.object({}))
    .handler(async ({ context }) => {
      const { id, token } = await issueCaptureShareTokenRecord(context.db, context.user.id);
      return { id, token };
    }),
  revoke: adminBase
    .input(z.object({ id: z.number().int().positive() }))
    .handler(async ({ input, context }) => ({
      revoked: await revokeCaptureShareToken(context.db, input.id),
    })),
};

/** Public lookup used by /link-captacao/:token; never redeems the token. */
export const captureShareLinks = {
  resolve: base
    .input(z.object({ token: z.string().min(1).max(128) }))
    .handler(async ({ input }) => {
      const db = await getDb();
      const valid = await validateCaptureShareToken(db, input.token);
      if (!valid) return { valid: false as const, whatsapp: "", message: "" };

      const [settings] = await db
        .select({ whatsapp: schema.settings.whatsapp })
        .from(schema.settings)
        .limit(1);
      const whatsapp = String(settings?.whatsapp ?? "").replace(/\D/g, "");
      if (!whatsapp) return { valid: false as const, whatsapp: "", message: "" };
      const phone = whatsapp.startsWith("55") ? whatsapp : `55${whatsapp}`;
      return {
        valid: true as const,
        whatsapp: phone,
        message: `LINK_CAPTACAO:${input.token}`,
      };
    }),
};
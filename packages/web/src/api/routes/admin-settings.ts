import { z } from "zod";
import { eq } from "drizzle-orm";
import { adminBase } from "../lib/admin-base";
import * as schema from "../database/schema";

const settingsInput = z.object({
  companyName: z.string().min(2).max(160),
  brokerName: z.string().min(2).max(160),
  whatsapp: z.string().min(8).max(20),
  email: z.string().min(5).max(160),
  creci: z.string().max(60),
  address: z.string().max(300),
  instagram: z.string().max(300),
  facebook: z.string().max(300),
  commissionRate: z.number().min(0).max(100),
});

export const adminSettings = {
  get: adminBase.handler(async ({ context }) => {
    const [row] = await context.db.select().from(schema.settings).limit(1);
    return row ?? null;
  }),

  update: adminBase.input(settingsInput).handler(async ({ input, context }) => {
    const payload = {
      companyName: input.companyName.trim(),
      brokerName: input.brokerName.trim(),
      whatsapp: input.whatsapp.replace(/\D/g, ""),
      email: input.email.trim(),
      creci: input.creci.trim(),
      address: input.address.trim(),
      instagram: input.instagram.trim(),
      facebook: input.facebook.trim(),
      commissionRate: input.commissionRate,
      updatedAt: new Date(),
    };
    const [row] = await context.db.select().from(schema.settings).limit(1);
    if (row) {
      await context.db.update(schema.settings).set(payload).where(eq(schema.settings.id, row.id));
    } else {
      await context.db.insert(schema.settings).values(payload);
    }
    return { ok: true };
  }),
};

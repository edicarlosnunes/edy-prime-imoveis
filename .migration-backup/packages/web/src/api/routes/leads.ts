import { z } from "zod";
import { eq } from "drizzle-orm";
import { base } from "../__core/app";
import * as schema from "../database/schema";
import { getDb } from "../lib/auth";
import { intakeLead } from "../lib/lead-intake";

/**
 * Formulário público do site. A leitura dos leads é protegida e vive em
 * routes/admin-leads.ts — aqui só entra o que qualquer visitante pode fazer.
 * A gravação passa pela entrada única (deduplicação + origem/campanha).
 */
const createInput = z.object({
  name: z.string().min(2).max(120),
  phone: z.string().min(8).max(30),
  email: z.string().max(160).optional(),
  interest: z.string().min(1).max(160),
  message: z.string().max(1000).optional(),
  source: z.string().max(60).optional(),
  /** código do imóvel quando o contato vem da página individual */
  propertyCode: z.string().max(40).optional(),
  utmSource: z.string().max(120).optional(),
  utmMedium: z.string().max(120).optional(),
  utmCampaign: z.string().max(160).optional(),
});

export const leads = {
  /** Grava um novo contato vindo do site. */
  create: base.input(createInput).handler(async ({ input }) => {
    const db = await getDb();

    let propertyId: number | null = null;
    if (input.propertyCode) {
      const [property] = await db
        .select({ id: schema.properties.id })
        .from(schema.properties)
        .where(eq(schema.properties.code, input.propertyCode.trim().toUpperCase()))
        .limit(1);
      propertyId = property?.id ?? null;
    }

    const result = await intakeLead(db, {
      name: input.name,
      phone: input.phone,
      email: input.email ?? null,
      interest: input.interest,
      message: input.message ?? null,
      source: input.source ?? "site",
      channel: "site",
      utmSource: input.utmSource ?? null,
      utmMedium: input.utmMedium ?? null,
      utmCampaign: input.utmCampaign ?? null,
      propertyId,
    });

    return { id: result.id, ok: true };
  }),
};

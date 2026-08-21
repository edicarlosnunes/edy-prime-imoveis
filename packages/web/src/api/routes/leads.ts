import { z } from "zod";
import { base } from "../__core/app";
import * as schema from "../database/schema";
import { getDb } from "../lib/auth";

/**
 * Formulário público do site. A leitura dos leads é protegida e vive em
 * routes/admin-leads.ts — aqui só entra o que qualquer visitante pode fazer.
 */
const createInput = z.object({
  name: z.string().min(2).max(120),
  phone: z.string().min(8).max(30),
  interest: z.string().min(1).max(160),
  message: z.string().max(1000).optional(),
  source: z.string().max(60).optional(),
});

export const leads = {
  /** Grava um novo contato vindo do site. */
  create: base.input(createInput).handler(async ({ input }) => {
    const db = await getDb();
    const [lead] = await db
      .insert(schema.leads)
      .values({
        name: input.name.trim(),
        phone: input.phone.trim(),
        interest: input.interest,
        message: input.message?.trim() || null,
        source: input.source ?? "site",
        stage: "novo",
        status: "aberto",
        updatedAt: new Date(),
      })
      .returning();

    return { id: lead?.id ?? 0, ok: true };
  }),
};

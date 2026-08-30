import { z } from "zod";
import { base } from "../__core/app";
import { getDb } from "../lib/auth";
import { intakeOwner } from "../lib/owner-intake";

/**
 * Formulário público de captação de proprietários.
 *
 * Só entra o que qualquer visitante pode fazer. A leitura/edição é protegida e
 * vive em routes/admin-owners.ts. A gravação passa pela entrada única
 * (deduplicação + tarefa de retorno) em lib/owner-intake.ts.
 */
const createInput = z.object({
  name: z.string().min(2).max(120),
  phone: z.string().min(8).max(30),
  email: z.string().max(160).optional(),
  propertyType: z.string().max(60).optional(),
  neighborhood: z.string().max(120).optional(),
  message: z.string().max(1000).optional(),
  source: z.string().max(60).optional(),
});

export const owners = {
  /** Grava um proprietário interessado em vender/avaliar. */
  create: base.input(createInput).handler(async ({ input }) => {
    const db = await getDb();

    const result = await intakeOwner(db, {
      name: input.name,
      phone: input.phone,
      email: input.email ?? null,
      propertyType: input.propertyType ?? null,
      neighborhood: input.neighborhood ?? null,
      message: input.message ?? null,
      source: input.source ?? "site_vender",
    });

    /* Não devolve o id para o site: o visitante não precisa saber do CRM. */
    return { ok: true, duplicated: result.duplicated };
  }),
};

import { z } from "zod";
import { base } from "../__core/app";
import { getDb } from "../lib/auth";
import { intakeOwner } from "../lib/owner-intake";
import { COMPLEMENT_FIELDS } from "../lib/capture-address";

/**
 * Formulário público de captação de proprietários.
 *
 * Só entra o que qualquer visitante pode fazer. A leitura/edição é protegida e
 * vive em routes/admin-owners.ts. A gravação passa pela entrada única
 * (deduplicação + tarefa de retorno) em lib/owner-intake.ts.
 */
/**
 * Complementos da unidade (apartamento, bloco, torre, lote...).
 *
 * Todos opcionais e curtos: um terreno não tem apartamento, e o formulário
 * público não pode exigir nada além de nome e telefone.
 */
const complementsInput = z
  .object(
    Object.fromEntries(
      COMPLEMENT_FIELDS.map((field) => [field.key, z.string().max(60).optional()]),
    ) as Record<string, z.ZodOptional<z.ZodString>>,
  )
  .partial()
  .optional();

const createInput = z.object({
  name: z.string().min(2).max(120),
  phone: z.string().min(8).max(30),
  email: z.string().max(160).optional(),
  propertyType: z.string().max(60).optional(),
  neighborhood: z.string().max(120).optional(),
  message: z.string().max(1000).optional(),
  source: z.string().max(60).optional(),
  /* V3 — ficha única: o imóvel vem junto com o proprietário e o envio passa a
     alimentar o Radar de Captação, não só a lista de proprietários. */
  cep: z.string().max(12).optional(),
  street: z.string().max(200).optional(),
  number: z.string().max(30).optional(),
  city: z.string().max(120).optional(),
  state: z.string().max(2).optional(),
  complements: complementsInput,
  askingPrice: z.number().nonnegative().optional(),
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
      cep: input.cep ?? null,
      street: input.street ?? null,
      number: input.number ?? null,
      city: input.city ?? null,
      state: input.state ?? null,
      complements: input.complements ?? null,
      askingPrice: input.askingPrice ?? null,
    });

    /* Não devolve o id para o site: o visitante não precisa saber do CRM. */
    return { ok: true, duplicated: result.duplicated };
  }),
};

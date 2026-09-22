import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import { adminBase } from "../lib/admin-base";
import * as schema from "../database/schema";
import { ORPCError } from "@orpc/server";
import { docWarning, normalizeDoc, normalizeRg } from "../lib/person-doc";

const ownerInput = z.object({
  name: z.string().min(2).max(120),
  phone: z.string().max(30).nullable().optional(),
  email: z.string().max(160).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
  /* CPF/CNPJ e RG: alimentam os documentos impressos. Não identificam imóvel. */
  document: z.string().max(40).nullable().optional(),
  rg: z.string().max(40).nullable().optional(),
  captureStatus: z.enum(["prospeccao", "em_negociacao", "captado", "perdido"]).default("prospeccao"),
});

function toRow(input: z.infer<typeof ownerInput>) {
  return {
    name: input.name.trim(),
    phone: input.phone?.trim() || null,
    email: input.email?.trim() || null,
    notes: input.notes?.trim() || null,
    document: normalizeDoc(input.document),
    rg: normalizeRg(input.rg),
    captureStatus: input.captureStatus,
  };
}

export const adminOwners = {
  /** Proprietários com os imóveis vinculados. */
  list: adminBase.handler(async ({ context }) => {
    const owners = await context.db
      .select()
      .from(schema.owners)
      .orderBy(asc(schema.owners.name))
      .limit(500);
    const properties = await context.db
      .select({
        id: schema.properties.id,
        code: schema.properties.code,
        title: schema.properties.title,
        ownerId: schema.properties.ownerId,
      })
      .from(schema.properties)
      .limit(1000);
    return owners.map((owner) => ({
      ...owner,
      properties: properties.filter((property) => property.ownerId === owner.id),
    }));
  }),

  create: adminBase.input(ownerInput).handler(async ({ input, context }) => {
    const [created] = await context.db.insert(schema.owners).values(toRow(input)).returning();
    return { id: created?.id ?? 0 };
  }),

  update: adminBase
    .input(ownerInput.extend({ id: z.number().int() }))
    .handler(async ({ input, context }) => {
      const { id, ...rest } = input;
      await context.db
        .update(schema.owners)
        .set(toRow(rest as z.infer<typeof ownerInput>))
        .where(eq(schema.owners.id, id));
      return { ok: true };
    }),

  remove: adminBase
    .input(z.object({ id: z.number().int() }))
    .handler(async ({ input, context }) => {
      await context.db
        .update(schema.properties)
        .set({ ownerId: null })
        .where(eq(schema.properties.ownerId, input.id));
      await context.db.delete(schema.owners).where(eq(schema.owners.id, input.id));
      return { ok: true };
    }),

  /**
   * CPF/CNPJ e RG a partir da ficha da captação, sem abrir o cadastro
   * completo do proprietário. Documento com dígito verificador errado é
   * ACEITO e apenas sinalizado — a equipe registra primeiro e confere depois.
   */
  setIdentity: adminBase
    .input(
      z.object({
        id: z.number().int().positive(),
        document: z.string().max(40).nullable().optional(),
        rg: z.string().max(40).nullable().optional(),
      }),
    )
    .handler(async ({ input, context }) => {
      const document = normalizeDoc(input.document);
      const rg = normalizeRg(input.rg);
      await context.db
        .update(schema.owners)
        .set({ document, rg })
        .where(eq(schema.owners.id, input.id));
      await context.db.insert(schema.auditLog).values({
        userId: context.user.id,
        userName: context.user.name,
        action: "owner_identity_updated",
        entity: "owner",
        entityId: String(input.id),
        detail: `documento:${document ? "preenchido" : "vazio"} rg:${rg ? "preenchido" : "vazio"}`,
      });
      return { ok: true, document, rg, warning: docWarning(document) };
    }),

  /**
   * Baixa o alerta de POSSÍVEL DUPLICADO depois da conferência humana.
   *
   * NÃO faz merge: nada é apagado nem transferido. Só marca que uma pessoa
   * olhou, e a referência ao proprietário relacionado é preservada.
   */
  clearDuplicate: adminBase
    .input(z.object({ id: z.number().int().positive(), note: z.string().max(300).optional() }))
    .handler(async ({ input, context }) => {
      const [owner] = await context.db
        .select()
        .from(schema.owners)
        .where(eq(schema.owners.id, input.id))
        .limit(1);
      if (!owner) throw new ORPCError("NOT_FOUND", { message: "Proprietário não encontrado" });
      const note = input.note?.trim();
      await context.db
        .update(schema.owners)
        .set({
          possibleDuplicate: 0,
          duplicateNote: note ? `${owner.duplicateNote ?? ""} | revisado: ${note}`.trim() : owner.duplicateNote,
        })
        .where(eq(schema.owners.id, input.id));
      await context.db.insert(schema.auditLog).values({
        userId: context.user.id,
        userName: context.user.name,
        action: "owner_duplicate_reviewed",
        entity: "owner",
        entityId: String(input.id),
        detail: note ?? null,
      });
      return { ok: true };
    }),

  options: adminBase.handler(async ({ context }) => {
    return context.db
      .select({ id: schema.owners.id, name: schema.owners.name })
      .from(schema.owners)
      .orderBy(asc(schema.owners.name))
      .limit(500);
  }),
};

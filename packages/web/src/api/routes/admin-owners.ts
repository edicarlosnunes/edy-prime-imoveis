import { z } from "zod";
import { asc, eq, inArray } from "drizzle-orm";
import { adminBase } from "../lib/admin-base";
import type { AdminDb } from "../lib/admin-base";
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

/**
 * ÚNICO número autorizado para reset de sessão de teste.
 * Qualquer outro telefone, inclusive 1174, fica fora desta rotina por construção.
 */
const TEST_PHONE_KEYS = new Set([
  "5513996922804", // 2804 com DDI
  "13996922804",   // 2804 sem DDI
]);

const digits = (value: string | null | undefined) => String(value ?? "").replace(/\D/g, "");
const isTestPhone = (value: string | null | undefined) => TEST_PHONE_KEYS.has(digits(value));

/**
 * Reinicia SOMENTE o estado de conversa/link do 2804 para uma nova rodada.
 *
 * É propositalmente NÃO destrutivo: proprietários, captações, leads, tarefas,
 * documentos e imóveis permanecem no CRM como evidência das rodadas anteriores.
 * O que é descartado é apenas o contexto conversacional e tokens do link que
 * poderiam fazer uma nova rodada continuar uma sessão antiga.
 */
async function resetDedicatedTestPhoneSession(db: AdminDb) {
  const conversations = (await db.select().from(schema.conversations).limit(5000)).filter(
    (row) => isTestPhone(row.externalId) || isTestPhone(row.contactPhone),
  );
  const conversationIds = conversations.map((row) => row.id);

  const shareTokens = (await db.select().from(schema.captureShareTokens).limit(5000)).filter(
    (row) => isTestPhone(row.senderPhone),
  );
  const shareTokenIds = shareTokens.map((row) => row.id);

  if (conversationIds.length) {
    await db.delete(schema.messages).where(inArray(schema.messages.conversationId, conversationIds));
    await db.delete(schema.conversations).where(inArray(schema.conversations.id, conversationIds));
  }

  if (shareTokenIds.length) {
    await db.delete(schema.captureShareTokens).where(inArray(schema.captureShareTokens.id, shareTokenIds));
  }

  return {
    conversations: conversationIds.length,
    shareTokens: shareTokenIds.length,
    preserved: {
      owners: true,
      captures: true,
      leads: true,
      tasks: true,
      crmDocuments: true,
      properties: true,
    },
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

  create: adminBase
    .input(ownerInput.extend({ propertyId: z.number().int().positive().optional() }))
    .handler(async ({ input, context }) => {
      try {
        return await context.db.transaction(async (tx) => {
          const [created] = await tx.insert(schema.owners).values(toRow(input))
            .returning({ id: schema.owners.id });
          if (!created || !Number.isSafeInteger(created.id) || created.id <= 0) {
            throw new ORPCError("INTERNAL_SERVER_ERROR", {
              message: "Não foi possível confirmar o cadastro do proprietário.",
            });
          }
          if (input.propertyId !== undefined) {
            const [linked] = await tx.update(schema.properties)
              .set({ ownerId: created.id })
              .where(eq(schema.properties.id, input.propertyId))
              .returning({ id: schema.properties.id, ownerId: schema.properties.ownerId });
            if (!linked || linked.ownerId !== created.id) {
              throw new ORPCError("NOT_FOUND", {
                message: "Imóvel não encontrado. O proprietário não foi cadastrado; os dados foram mantidos.",
              });
            }
          }
          return { id: created.id };
        });
      } catch (error) {
        console.error("[adminOwners.create] Falha ao cadastrar/vincular proprietário:", error);
        throw error;
      }
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
   * Reinicia SOMENTE a sessão/link do número privado 2804.
   * Nada do CRM é apagado: proprietário, captações, leads, agenda, documentos
   * e imóveis permanecem para conferência das rodadas concluídas.
   * Nenhum outro telefone pode ser atingido por esta rotina.
   */
  resetTestNumbers: adminBase
    .input(z.object({ confirm: z.literal("RESET_TEST_NUMBERS") }))
    .handler(async ({ context }) => {
      const removed = await resetDedicatedTestPhoneSession(context.db);
      await context.db.insert(schema.auditLog).values({
        userId: context.user.id,
        userName: context.user.name,
        action: "test_number_2804_session_reset",
        entity: "owner",
        entityId: "2804",
        detail: JSON.stringify(removed),
      });
      return { ok: true, phones: ["2804"], removed };
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
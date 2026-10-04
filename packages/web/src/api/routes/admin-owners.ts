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

const TEST_PHONE_KEYS = new Set([
  "5513997141174", // 1174
  "13997141174",
  "5513996922804", // 2804
  "13996922804",
]);

const digits = (value: string | null | undefined) => String(value ?? "").replace(/\D/g, "");
const isTestPhone = (value: string | null | undefined) => TEST_PHONE_KEYS.has(digits(value));

async function resetDedicatedTestPhones(db: AdminDb) {
  const owners = (await db.select().from(schema.owners).limit(5000)).filter((row) => isTestPhone(row.phone));
  const ownerIds = owners.map((row) => row.id);

  const captures = ownerIds.length
    ? await db.select().from(schema.propertyCaptures).where(inArray(schema.propertyCaptures.ownerId, ownerIds)).limit(5000)
    : [];
  const captureIds = captures.map((row) => row.id);

  const conversations = (await db.select().from(schema.conversations).limit(5000)).filter(
    (row) => isTestPhone(row.externalId) || isTestPhone(row.contactPhone),
  );
  const conversationIds = conversations.map((row) => row.id);

  const leads = (await db.select().from(schema.leads).limit(5000)).filter((row) => isTestPhone(row.phone));
  const leadIds = leads.map((row) => row.id);

  const shareTokens = (await db.select().from(schema.captureShareTokens).limit(5000)).filter(
    (row) => isTestPhone(row.senderPhone),
  );
  const shareTokenIds = shareTokens.map((row) => row.id);

  const crmDocs = (await db.select().from(schema.crmDocuments).limit(5000)).filter(
    (row) => (row.captureId != null && captureIds.includes(row.captureId)) ||
      (row.ownerId != null && ownerIds.includes(row.ownerId)),
  );
  const crmDocIds = crmDocs.map((row) => row.id);

  const tasks = (await db.select().from(schema.tasks).limit(5000)).filter((row) =>
    (row.captureId != null && captureIds.includes(row.captureId)) ||
    (row.leadId != null && leadIds.includes(row.leadId)) ||
    ownerIds.some((ownerId) => (row.notes ?? "").includes(`[owner:${ownerId}]`)),
  );
  const taskIds = tasks.map((row) => row.id);

  if (conversationIds.length) {
    await db.delete(schema.messages).where(inArray(schema.messages.conversationId, conversationIds));
    await db.delete(schema.conversations).where(inArray(schema.conversations.id, conversationIds));
  }

  if (leadIds.length) {
    await db.delete(schema.leadNotes).where(inArray(schema.leadNotes.leadId, leadIds));
    await db.delete(schema.leadProfile).where(inArray(schema.leadProfile.leadId, leadIds));
    await db.delete(schema.leadEvents).where(inArray(schema.leadEvents.leadId, leadIds));
    await db.delete(schema.leads).where(inArray(schema.leads.id, leadIds));
  }

  if (shareTokenIds.length) {
    await db.delete(schema.captureShareTokens).where(inArray(schema.captureShareTokens.id, shareTokenIds));
  }

  if (taskIds.length) {
    await db.delete(schema.tasks).where(inArray(schema.tasks.id, taskIds));
  }

  if (crmDocIds.length) {
    await db.delete(schema.crmDocumentEvents).where(inArray(schema.crmDocumentEvents.documentId, crmDocIds));
    await db.delete(schema.crmDocuments).where(inArray(schema.crmDocuments.id, crmDocIds));
  }

  if (captureIds.length) {
    await db.delete(schema.propertyCaptures).where(inArray(schema.propertyCaptures.id, captureIds));
  }

  if (ownerIds.length) {
    /* Imóvel definitivo é preservado: só perde o vínculo com o contato de teste. */
    await db.update(schema.properties).set({ ownerId: null }).where(inArray(schema.properties.ownerId, ownerIds));
    await db.delete(schema.owners).where(inArray(schema.owners.id, ownerIds));
  }

  return {
    owners: ownerIds.length,
    captures: captureIds.length,
    conversations: conversationIds.length,
    leads: leadIds.length,
    shareTokens: shareTokenIds.length,
    tasks: taskIds.length,
    crmDocuments: crmDocIds.length,
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
   * Zera SOMENTE os dois números privados reservados para teste (1174/2804).
   * O fluxo real continua salvando telefone, nome, endereço, foto e conclusão
   * normalmente durante cada rodada; o reset é manual entre uma rodada e outra.
   * Qualquer outro telefone fica fora desta rotina por construção.
   */
  resetTestNumbers: adminBase
    .input(z.object({ confirm: z.literal("RESET_TEST_NUMBERS") }))
    .handler(async ({ context }) => {
      const removed = await resetDedicatedTestPhones(context.db);
      await context.db.insert(schema.auditLog).values({
        userId: context.user.id,
        userName: context.user.name,
        action: "test_numbers_reset",
        entity: "owner",
        entityId: "1174,2804",
        detail: JSON.stringify(removed),
      });
      return { ok: true, phones: ["1174", "2804"], removed };
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

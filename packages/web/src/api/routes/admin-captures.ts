import { z } from "zod";
import { and, asc, desc, eq, isNull, like, or } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { adminBase } from "../lib/admin-base";
import * as schema from "../database/schema";
import {
  CAPTURE_STAGES,
  DOC_STATUSES,
  checkConversion,
  checkStageTransition,
  normalizeDocStatus,
} from "../lib/capture-rules";

const STAGES = CAPTURE_STAGES;
const digits = (value: string | null | undefined) => String(value ?? "").replace(/\D/g, "");

async function audit(context: any, action: string, id: number, detail?: string) {
  await context.db.insert(schema.auditLog).values({
    userId: context.user.id,
    userName: context.user.name,
    action,
    entity: "capture",
    entityId: String(id),
    detail: detail ?? null,
  });
}

async function syncOwnerStatus(context: any, ownerId: number) {
  const rows = await context.db
    .select({ stage: schema.propertyCaptures.stage })
    .from(schema.propertyCaptures)
    .where(eq(schema.propertyCaptures.ownerId, ownerId));

  let next: "prospeccao" | "em_negociacao" | "captado" | "perdido" = "prospeccao";
  if (rows.some((row: any) => row.stage === "captado")) next = "captado";
  else if (rows.some((row: any) => row.stage === "avaliacao" || row.stage === "documentacao")) next = "em_negociacao";
  else if (rows.length > 0 && rows.every((row: any) => row.stage === "perdido")) next = "perdido";

  await context.db.update(schema.owners).set({ captureStatus: next }).where(eq(schema.owners.id, ownerId));
}

async function pendingTasksFor(context: any, captureId: number) {
  return context.db
    .select()
    .from(schema.tasks)
    .where(
      and(
        eq(schema.tasks.status, "pendente"),
        or(
          eq(schema.tasks.captureId, captureId),
          like(schema.tasks.notes, `%[capture:${captureId}]%`),
        ),
      ),
    )
    .orderBy(asc(schema.tasks.dueAt));
}

async function closePendingTasks(context: any, captureId: number) {
  const rows = await pendingTasksFor(context, captureId);
  for (const row of rows) {
    await context.db.update(schema.tasks).set({ status: "cancelada" }).where(eq(schema.tasks.id, row.id));
  }
}

const createInput = z.object({
  ownerName: z.string().min(2).max(120),
  ownerPhone: z.string().min(8).max(30),
  ownerEmail: z.string().max(160).nullable().optional(),
  city: z.string().min(2).max(80).default("Praia Grande"),
  district: z.string().max(120).nullable().optional(),
  address: z.string().max(240).nullable().optional(),
  propertyType: z.string().max(80).nullable().optional(),
  askingPrice: z.number().nonnegative().nullable().optional(),
  source: z.string().max(80).default("manual"),
  intention: z.string().max(80).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
});

export const adminCaptures = {
  list: adminBase
    .input(
      z.object({
        search: z.string().optional(),
        city: z.string().optional(),
        stage: z.enum(STAGES).optional(),
        source: z.string().optional(),
      }).optional(),
    )
    .handler(async ({ input, context }) => {
      const captures = await context.db.select().from(schema.propertyCaptures).orderBy(desc(schema.propertyCaptures.updatedAt)).limit(500);
      const owners = await context.db.select().from(schema.owners).limit(1000);
      const ownerById = new Map(owners.map((owner) => [owner.id, owner]));
      const q = input?.search?.trim().toLowerCase();
      return captures
        .map((capture) => ({ ...capture, owner: ownerById.get(capture.ownerId) ?? null }))
        .filter((row) => {
          if (input?.city && row.city !== input.city) return false;
          if (input?.stage && row.stage !== input.stage) return false;
          if (input?.source && row.source !== input.source) return false;
          if (q) {
            const hay = [row.owner?.name, row.owner?.phone, row.city, row.district, row.address, row.propertyType]
              .filter(Boolean)
              .join(" ")
              .toLowerCase();
            if (!hay.includes(q)) return false;
          }
          return true;
        });
    }),

  get: adminBase.input(z.object({ id: z.number().int().positive() })).handler(async ({ input, context }) => {
    const [capture] = await context.db.select().from(schema.propertyCaptures).where(eq(schema.propertyCaptures.id, input.id)).limit(1);
    if (!capture) throw new ORPCError("NOT_FOUND", { message: "Captação não encontrada" });
    const [owner] = await context.db.select().from(schema.owners).where(eq(schema.owners.id, capture.ownerId)).limit(1);
    const tasks = await context.db
      .select()
      .from(schema.tasks)
      .where(or(eq(schema.tasks.captureId, input.id), like(schema.tasks.notes, `%[capture:${input.id}]%`)))
      .orderBy(desc(schema.tasks.dueAt));
    const history = await context.db
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.entity, "capture"), eq(schema.auditLog.entityId, String(input.id))))
      .orderBy(desc(schema.auditLog.createdAt))
      .limit(100);
    return { ...capture, owner: owner ?? null, tasks, history };
  }),

  create: adminBase.input(createInput).handler(async ({ input, context }) => {
    const phoneDigits = digits(input.ownerPhone);
    const owners = await context.db.select().from(schema.owners).limit(1000);
    let owner = owners.find((row) => digits(row.phone) === phoneDigits);
    let ownerCreated = false;
    if (!owner) {
      const [created] = await context.db.insert(schema.owners).values({
        name: input.ownerName.trim(),
        phone: input.ownerPhone.trim(),
        email: input.ownerEmail?.trim() || null,
        captureStatus: "prospeccao",
      }).returning();
      owner = created;
      ownerCreated = true;
    }
    if (!owner) throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Não foi possível criar proprietário" });

    const now = new Date();
    const due = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    const [capture] = await context.db.insert(schema.propertyCaptures).values({
      ownerId: owner.id,
      city: input.city,
      district: input.district?.trim() || null,
      address: input.address?.trim() || null,
      propertyType: input.propertyType?.trim() || null,
      askingPrice: input.askingPrice ?? null,
      source: input.source,
      intention: input.intention?.trim() || null,
      notes: input.notes?.trim() || null,
      stage: "novo_contato",
      nextAction: `Retornar proprietário — ${owner.name}`,
      nextActionAt: due,
      stageChangedAt: now,
      updatedAt: now,
    }).returning();
    if (!capture) throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Não foi possível criar captação" });

    await context.db.insert(schema.tasks).values({
      title: `Retornar proprietário — ${owner.name}`,
      type: "retorno",
      dueAt: due,
      status: "pendente",
      captureId: capture.id,
      notes: `[capture:${capture.id}] Retorno automático criado pelo Radar de Captação`,
    });
    await audit(context, "capture_created", capture.id, ownerCreated ? "Proprietário novo" : "Proprietário existente reutilizado");
    return { id: capture.id, ownerId: owner.id, ownerCreated };
  }),

  setStage: adminBase.input(z.object({ id: z.number().int().positive(), stage: z.enum(STAGES) })).handler(async ({ input, context }) => {
    const [capture] = await context.db.select().from(schema.propertyCaptures).where(eq(schema.propertyCaptures.id, input.id)).limit(1);
    if (!capture) throw new ORPCError("NOT_FOUND", { message: "Captação não encontrada" });
    // Idempotente: reclique na etapa atual nao gera novo evento de historico.
    if (capture.stage === input.stage) return { ok: true, changed: false };
    const allowed = checkStageTransition({
      from: capture.stage,
      to: input.stage,
      estimatedPrice: capture.estimatedPrice,
      convertedPropertyId: capture.convertedPropertyId,
    });
    if (!allowed.ok) throw new ORPCError(allowed.code, { message: allowed.message });
    const now = new Date();
    // Compare-and-set: se dois cliques chegarem juntos, so o primeiro encontra
    // a etapa anterior e devolve linha; o segundo nao audita nada.
    const changed = await context.db
      .update(schema.propertyCaptures)
      .set({ stage: input.stage, stageChangedAt: now, updatedAt: now })
      .where(and(eq(schema.propertyCaptures.id, input.id), eq(schema.propertyCaptures.stage, capture.stage)))
      .returning({ id: schema.propertyCaptures.id });
    if (changed.length === 0) return { ok: true, changed: false };
    if (input.stage === "captado" || input.stage === "perdido") await closePendingTasks(context, input.id);
    await syncOwnerStatus(context, capture.ownerId);
    await audit(context, "capture_stage_changed", input.id, input.stage);
    return { ok: true, changed: true };
  }),

  setNextAction: adminBase.input(z.object({ id: z.number().int().positive(), title: z.string().max(200).nullable(), dueAt: z.string().max(40).nullable() })).handler(async ({ input, context }) => {
    const [capture] = await context.db.select().from(schema.propertyCaptures).where(eq(schema.propertyCaptures.id, input.id)).limit(1);
    if (!capture) throw new ORPCError("NOT_FOUND", { message: "Captação não encontrada" });
    await closePendingTasks(context, input.id);
    const now = new Date();
    if (!input.title || !input.dueAt) {
      await context.db.update(schema.propertyCaptures).set({ nextAction: null, nextActionAt: null, updatedAt: now }).where(eq(schema.propertyCaptures.id, input.id));
      await audit(context, "capture_next_action_cleared", input.id);
      return { ok: true };
    }
    const due = new Date(input.dueAt);
    await context.db.insert(schema.tasks).values({
      title: input.title.trim(), type: "retorno", dueAt: due, status: "pendente", captureId: input.id,
      notes: `[capture:${input.id}] Próxima ação do Radar`,
    });
    await context.db.update(schema.propertyCaptures).set({ nextAction: input.title.trim(), nextActionAt: due, updatedAt: now }).where(eq(schema.propertyCaptures.id, input.id));
    await audit(context, "capture_next_action_set", input.id, `${input.title} @ ${input.dueAt}`);
    return { ok: true };
  }),

  saveAppraisal: adminBase.input(z.object({ id: z.number().int().positive(), estimatedPrice: z.number().nonnegative().nullable(), note: z.string().max(4000).nullable().optional() })).handler(async ({ input, context }) => {
    const [capture] = await context.db.select().from(schema.propertyCaptures).where(eq(schema.propertyCaptures.id, input.id)).limit(1);
    if (!capture) throw new ORPCError("NOT_FOUND", { message: "Captação não encontrada" });
    const note = input.note?.trim() || null;
    // Idempotente: salvar a mesma avaliacao de novo (reclique/duplo clique) nao
    // gera segundo capture_appraisal_saved.
    if (capture.estimatedPrice === input.estimatedPrice && capture.appraisalNote === note) {
      return { ok: true, changed: false };
    }
    const now = new Date();
    // Compare-and-set no valor anterior: de dois requests simultaneos, so o
    // primeiro encontra o estado antigo e audita.
    const previousPrice = capture.estimatedPrice === null
      ? isNull(schema.propertyCaptures.estimatedPrice)
      : eq(schema.propertyCaptures.estimatedPrice, capture.estimatedPrice);
    const changed = await context.db.update(schema.propertyCaptures).set({
      estimatedPrice: input.estimatedPrice,
      appraisalStatus: input.estimatedPrice === null ? "pendente" : "concluida",
      appraisalAt: input.estimatedPrice === null ? null : now,
      appraisalNote: note,
      updatedAt: now,
    }).where(and(eq(schema.propertyCaptures.id, input.id), previousPrice)).returning({ id: schema.propertyCaptures.id });
    if (changed.length === 0) return { ok: true, changed: false };
    await audit(context, "capture_appraisal_saved", input.id, input.estimatedPrice === null ? "pendente" : String(input.estimatedPrice));
    return { ok: true, changed: true };
  }),

  setDocStatus: adminBase.input(z.object({ id: z.number().int().positive(), docStatus: z.enum(DOC_STATUSES) })).handler(async ({ input, context }) => {
    const [capture] = await context.db.select().from(schema.propertyCaptures).where(eq(schema.propertyCaptures.id, input.id)).limit(1);
    if (!capture) throw new ORPCError("NOT_FOUND", { message: "Captação não encontrada" });
    // `pendente` legado e `solicitado` sao o mesmo estado: trocar um pelo outro
    // nao e alteracao relevante e nao gera historico (nem reescreve o dado antigo).
    if (normalizeDocStatus(capture.docStatus) === normalizeDocStatus(input.docStatus)) {
      return { ok: true, changed: false };
    }
    const changed = await context.db
      .update(schema.propertyCaptures)
      .set({ docStatus: input.docStatus, updatedAt: new Date() })
      .where(and(eq(schema.propertyCaptures.id, input.id), eq(schema.propertyCaptures.docStatus, capture.docStatus)))
      .returning({ id: schema.propertyCaptures.id });
    if (changed.length === 0) return { ok: true, changed: false };
    await audit(context, "capture_doc_status", input.id, input.docStatus);
    return { ok: true, changed: true };
  }),

  markLost: adminBase.input(z.object({ id: z.number().int().positive(), reason: z.string().min(2).max(120), detail: z.string().max(1000).nullable().optional() })).handler(async ({ input, context }) => {
    const [capture] = await context.db.select().from(schema.propertyCaptures).where(eq(schema.propertyCaptures.id, input.id)).limit(1);
    if (!capture) throw new ORPCError("NOT_FOUND", { message: "Captação não encontrada" });
    const now = new Date();
    await closePendingTasks(context, input.id);
    await context.db.update(schema.propertyCaptures).set({ stage: "perdido", lostReason: input.reason, lostDetail: input.detail?.trim() || null, nextAction: null, nextActionAt: null, stageChangedAt: now, updatedAt: now }).where(eq(schema.propertyCaptures.id, input.id));
    await syncOwnerStatus(context, capture.ownerId);
    await audit(context, "capture_lost", input.id, `${input.reason}${input.detail ? ` — ${input.detail}` : ""}`);
    return { ok: true };
  }),

  reopen: adminBase.input(z.object({ id: z.number().int().positive() })).handler(async ({ input, context }) => {
    const [capture] = await context.db.select().from(schema.propertyCaptures).where(eq(schema.propertyCaptures.id, input.id)).limit(1);
    if (!capture) throw new ORPCError("NOT_FOUND", { message: "Captação não encontrada" });
    const now = new Date();
    const due = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    const title = `Retornar proprietário — ${capture.ownerId}`;
    await context.db.update(schema.propertyCaptures).set({ stage: "novo_contato", lostReason: null, lostDetail: null, nextAction: title, nextActionAt: due, stageChangedAt: now, updatedAt: now }).where(eq(schema.propertyCaptures.id, input.id));
    await context.db.insert(schema.tasks).values({ title, type: "retorno", dueAt: due, status: "pendente", captureId: input.id, notes: `[capture:${input.id}] Captação reaberta` });
    await syncOwnerStatus(context, capture.ownerId);
    await audit(context, "capture_reopened", input.id);
    return { ok: true };
  }),

  markConverted: adminBase.input(z.object({ id: z.number().int().positive(), propertyId: z.number().int().positive() })).handler(async ({ input, context }) => {
    const [capture] = await context.db.select().from(schema.propertyCaptures).where(eq(schema.propertyCaptures.id, input.id)).limit(1);
    if (!capture) throw new ORPCError("NOT_FOUND", { message: "Captação não encontrada" });
    const allowed = checkConversion({
      stage: capture.stage,
      docStatus: capture.docStatus,
      estimatedPrice: capture.estimatedPrice,
      convertedPropertyId: capture.convertedPropertyId,
      propertyId: input.propertyId,
    });
    if (!allowed.ok) throw new ORPCError(allowed.code, { message: allowed.message });
    if ("already" in allowed) return { ok: true, already: true };
    const [property] = await context.db.select({ id: schema.properties.id }).from(schema.properties).where(eq(schema.properties.id, input.propertyId)).limit(1);
    if (!property) throw new ORPCError("NOT_FOUND", { message: "Imóvel não encontrado" });
    const now = new Date();
    const updated = await context.db.update(schema.propertyCaptures).set({
      convertedPropertyId: input.propertyId,
      convertedAt: now,
      stage: "captado",
      stageChangedAt: now,
      nextAction: null,
      nextActionAt: null,
      updatedAt: now,
    }).where(and(eq(schema.propertyCaptures.id, input.id), isNull(schema.propertyCaptures.convertedPropertyId))).returning({ id: schema.propertyCaptures.id });
    if (updated.length === 0) {
      const [fresh] = await context.db.select().from(schema.propertyCaptures).where(eq(schema.propertyCaptures.id, input.id)).limit(1);
      if (fresh?.convertedPropertyId === input.propertyId) return { ok: true, already: true };
      throw new ORPCError("CONFLICT", { message: "Captação já convertida" });
    }
    await closePendingTasks(context, input.id);
    await syncOwnerStatus(context, capture.ownerId);
    await audit(context, "capture_converted", input.id, `property:${input.propertyId}`);
    return { ok: true, already: false };
  }),
};

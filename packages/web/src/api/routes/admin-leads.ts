import { z } from "zod";
import { and, desc, eq, like, or } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { adminBase } from "../lib/admin-base";
import * as schema from "../database/schema";

export const LEAD_STAGES = [
  "novo",
  "primeiro_contato",
  "qualificado",
  "imovel_apresentado",
  "visita_agendada",
  "proposta_enviada",
  "negociacao",
  "venda_fechada",
] as const;

const stageEnum = z.enum(LEAD_STAGES);
const statusEnum = z.enum(["aberto", "perdido", "ganho"]);

const optionalDate = z
  .string()
  .max(40)
  .nullable()
  .optional()
  .transform((value) => (value ? new Date(value) : null));

export const adminLeads = {
  list: adminBase
    .input(
      z
        .object({
          search: z.string().max(120).optional(),
          stage: stageEnum.optional(),
          status: statusEnum.optional(),
        })
        .optional(),
    )
    .handler(async ({ input, context }) => {
      const filters = [];
      if (input?.stage) filters.push(eq(schema.leads.stage, input.stage));
      if (input?.status) filters.push(eq(schema.leads.status, input.status));
      if (input?.search) {
        const term = `%${input.search.trim()}%`;
        filters.push(or(like(schema.leads.name, term), like(schema.leads.phone, term))!);
      }
      return context.db
        .select()
        .from(schema.leads)
        .where(filters.length > 0 ? and(...filters) : undefined)
        .orderBy(desc(schema.leads.createdAt))
        .limit(500);
    }),

  get: adminBase
    .input(z.object({ id: z.number().int() }))
    .handler(async ({ input, context }) => {
      const [lead] = await context.db
        .select()
        .from(schema.leads)
        .where(eq(schema.leads.id, input.id))
        .limit(1);
      if (!lead) throw new ORPCError("NOT_FOUND", { message: "Lead não encontrado" });
      const notes = await context.db
        .select()
        .from(schema.leadNotes)
        .where(eq(schema.leadNotes.leadId, lead.id))
        .orderBy(desc(schema.leadNotes.createdAt));
      return { lead, notes };
    }),

  /** Cadastro manual de lead pelo painel. */
  create: adminBase
    .input(
      z.object({
        name: z.string().min(2).max(120),
        phone: z.string().min(8).max(30),
        email: z.string().max(160).nullable().optional(),
        interest: z.string().min(1).max(160),
        message: z.string().max(2000).nullable().optional(),
        source: z.string().max(60).default("manual"),
        stage: stageEnum.default("novo"),
        propertyId: z.number().int().nullable().optional(),
        clientId: z.number().int().nullable().optional(),
      }),
    )
    .handler(async ({ input, context }) => {
      const [created] = await context.db
        .insert(schema.leads)
        .values({
          name: input.name.trim(),
          phone: input.phone.trim(),
          email: input.email?.trim() || null,
          interest: input.interest,
          message: input.message?.trim() || null,
          source: input.source,
          stage: input.stage,
          status: "aberto",
          propertyId: input.propertyId ?? null,
          clientId: input.clientId ?? null,
          updatedAt: new Date(),
        })
        .returning();
      return { id: created?.id ?? 0 };
    }),

  update: adminBase
    .input(
      z.object({
        id: z.number().int(),
        name: z.string().min(2).max(120),
        phone: z.string().min(8).max(30),
        email: z.string().max(160).nullable().optional(),
        interest: z.string().min(1).max(160),
        message: z.string().max(2000).nullable().optional(),
        source: z.string().max(60),
        stage: stageEnum,
        status: statusEnum,
        lostReason: z.string().max(300).nullable().optional(),
        propertyId: z.number().int().nullable().optional(),
        clientId: z.number().int().nullable().optional(),
        nextAction: z.string().max(300).nullable().optional(),
        nextActionAt: optionalDate,
      }),
    )
    .handler(async ({ input, context }) => {
      await context.db
        .update(schema.leads)
        .set({
          name: input.name.trim(),
          phone: input.phone.trim(),
          email: input.email?.trim() || null,
          interest: input.interest,
          message: input.message?.trim() || null,
          source: input.source,
          stage: input.stage,
          status: input.status,
          lostReason: input.status === "perdido" ? input.lostReason?.trim() || null : null,
          propertyId: input.propertyId ?? null,
          clientId: input.clientId ?? null,
          nextAction: input.nextAction?.trim() || null,
          nextActionAt: input.nextActionAt,
          updatedAt: new Date(),
        })
        .where(eq(schema.leads.id, input.id));
      return { ok: true };
    }),

  setStage: adminBase
    .input(z.object({ id: z.number().int(), stage: stageEnum }))
    .handler(async ({ input, context }) => {
      await context.db
        .update(schema.leads)
        .set({
          stage: input.stage,
          status: input.stage === "venda_fechada" ? "ganho" : "aberto",
          updatedAt: new Date(),
        })
        .where(eq(schema.leads.id, input.id));
      return { ok: true };
    }),

  markLost: adminBase
    .input(z.object({ id: z.number().int(), reason: z.string().min(2).max(300) }))
    .handler(async ({ input, context }) => {
      await context.db
        .update(schema.leads)
        .set({ status: "perdido", lostReason: input.reason.trim(), updatedAt: new Date() })
        .where(eq(schema.leads.id, input.id));
      return { ok: true };
    }),

  reopen: adminBase
    .input(z.object({ id: z.number().int() }))
    .handler(async ({ input, context }) => {
      await context.db
        .update(schema.leads)
        .set({ status: "aberto", lostReason: null, updatedAt: new Date() })
        .where(eq(schema.leads.id, input.id));
      return { ok: true };
    }),

  addNote: adminBase
    .input(z.object({ id: z.number().int(), body: z.string().min(1).max(2000) }))
    .handler(async ({ input, context }) => {
      await context.db
        .insert(schema.leadNotes)
        .values({ leadId: input.id, body: input.body.trim() });
      await context.db
        .update(schema.leads)
        .set({ updatedAt: new Date() })
        .where(eq(schema.leads.id, input.id));
      return { ok: true };
    }),

  remove: adminBase
    .input(z.object({ id: z.number().int() }))
    .handler(async ({ input, context }) => {
      await context.db.delete(schema.leadNotes).where(eq(schema.leadNotes.leadId, input.id));
      await context.db.delete(schema.leads).where(eq(schema.leads.id, input.id));
      return { ok: true };
    }),
};

import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import { adminBase } from "../lib/admin-base";
import * as schema from "../database/schema";

const taskInput = z.object({
  title: z.string().min(2).max(200),
  type: z.enum(["visita", "retorno", "reuniao", "proposta", "follow_up", "outro"]).default("visita"),
  dueAt: z.string().min(4).max(40),
  status: z.enum(["pendente", "concluida", "cancelada"]).default("pendente"),
  leadId: z.number().int().nullable().optional(),
  clientId: z.number().int().nullable().optional(),
  propertyId: z.number().int().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

function toRow(input: z.infer<typeof taskInput>) {
  return {
    title: input.title.trim(),
    type: input.type,
    dueAt: new Date(input.dueAt),
    status: input.status,
    leadId: input.leadId ?? null,
    clientId: input.clientId ?? null,
    propertyId: input.propertyId ?? null,
    notes: input.notes?.trim() || null,
  };
}

export const adminTasks = {
  list: adminBase
    .input(
      z
        .object({ status: z.enum(["pendente", "concluida", "cancelada"]).optional() })
        .optional(),
    )
    .handler(async ({ input, context }) => {
      return context.db
        .select()
        .from(schema.tasks)
        .where(input?.status ? eq(schema.tasks.status, input.status) : undefined)
        .orderBy(asc(schema.tasks.dueAt))
        .limit(500);
    }),

  create: adminBase.input(taskInput).handler(async ({ input, context }) => {
    const [created] = await context.db.insert(schema.tasks).values(toRow(input)).returning();
    return { id: created?.id ?? 0 };
  }),

  update: adminBase
    .input(taskInput.extend({ id: z.number().int() }))
    .handler(async ({ input, context }) => {
      const { id, ...rest } = input;
      await context.db
        .update(schema.tasks)
        .set(toRow(rest as z.infer<typeof taskInput>))
        .where(eq(schema.tasks.id, id));
      return { ok: true };
    }),

  setStatus: adminBase
    .input(
      z.object({
        id: z.number().int(),
        status: z.enum(["pendente", "concluida", "cancelada"]),
      }),
    )
    .handler(async ({ input, context }) => {
      await context.db
        .update(schema.tasks)
        .set({ status: input.status })
        .where(eq(schema.tasks.id, input.id));
      return { ok: true };
    }),

  remove: adminBase
    .input(z.object({ id: z.number().int() }))
    .handler(async ({ input, context }) => {
      await context.db.delete(schema.tasks).where(eq(schema.tasks.id, input.id));
      return { ok: true };
    }),
};

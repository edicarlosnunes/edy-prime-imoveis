/**
 * Automações: cadastro, ativação, execuções e varredura das regras de tempo.
 */
import { z } from "zod";
import { desc, eq, inArray } from "drizzle-orm";
import { adminBase } from "../lib/admin-base";
import { audit } from "../lib/audit";
import { clientIp } from "../lib/base-url";
import { ACTIONS, TRIGGERS, sweepTimeRules } from "../lib/automations";
import * as schema from "../database/schema";

const actionInput = z.object({
  type: z.enum(["criar_tarefa", "nota_lead", "mudar_etapa", "whatsapp_texto"]),
  text: z.string().max(1000).optional(),
  stage: z.string().max(60).optional(),
  hours: z.number().int().min(1).max(720).optional(),
});

const automationInput = z.object({
  name: z.string().min(2).max(120),
  trigger: z.enum([
    "lead_novo",
    "lead_sem_resposta",
    "conversa_transferida",
    "imovel_publicado",
    "proposta_enviada",
  ]),
  conditions: z
    .object({ source: z.string().max(60).optional(), hours: z.number().int().min(1).max(720).optional() })
    .default({}),
  actions: z.array(actionInput).min(1).max(6),
  active: z.boolean().default(false),
});

export const adminAutomations = {
  list: adminBase.handler(async ({ context }) => {
    const rows = await context.db
      .select()
      .from(schema.automations)
      .orderBy(desc(schema.automations.createdAt));

    const runs = rows.length
      ? await context.db
          .select()
          .from(schema.automationRuns)
          .where(
            inArray(
              schema.automationRuns.automationId,
              rows.map((row) => row.id),
            ),
          )
          .orderBy(desc(schema.automationRuns.createdAt))
          .limit(120)
      : [];

    return {
      triggers: TRIGGERS.map((item) => ({ ...item })),
      actionTypes: ACTIONS.map((item) => ({ ...item })),
      automations: rows.map((row) => ({
        ...row,
        active: row.active === 1,
        conditions: row.conditions,
        actions: row.actions,
      })),
      runs,
    };
  }),

  create: adminBase.input(automationInput).handler(async ({ input, context }) => {
    const [created] = await context.db
      .insert(schema.automations)
      .values({
        name: input.name.trim(),
        trigger: input.trigger,
        conditions: JSON.stringify(input.conditions),
        actions: JSON.stringify(input.actions),
        active: input.active ? 1 : 0,
      })
      .returning();
    await audit(context.db, context.user, "automacao.criada", {
      entity: "automation",
      entityId: created?.id,
      detail: input.name,
      ip: clientIp(context.headers),
    });
    return { id: created?.id ?? 0 };
  }),

  update: adminBase
    .input(automationInput.extend({ id: z.number().int() }))
    .handler(async ({ input, context }) => {
      await context.db
        .update(schema.automations)
        .set({
          name: input.name.trim(),
          trigger: input.trigger,
          conditions: JSON.stringify(input.conditions),
          actions: JSON.stringify(input.actions),
          active: input.active ? 1 : 0,
        })
        .where(eq(schema.automations.id, input.id));
      await audit(context.db, context.user, "automacao.atualizada", {
        entity: "automation",
        entityId: input.id,
        detail: input.name,
        ip: clientIp(context.headers),
      });
      return { id: input.id };
    }),

  setActive: adminBase
    .input(z.object({ id: z.number().int(), active: z.boolean() }))
    .handler(async ({ input, context }) => {
      await context.db
        .update(schema.automations)
        .set({ active: input.active ? 1 : 0 })
        .where(eq(schema.automations.id, input.id));
      await audit(
        context.db,
        context.user,
        input.active ? "automacao.ativada" : "automacao.pausada",
        { entity: "automation", entityId: input.id, ip: clientIp(context.headers) },
      );
      return { ok: true };
    }),

  remove: adminBase
    .input(z.object({ id: z.number().int() }))
    .handler(async ({ input, context }) => {
      await context.db
        .delete(schema.automationRuns)
        .where(eq(schema.automationRuns.automationId, input.id));
      await context.db.delete(schema.automations).where(eq(schema.automations.id, input.id));
      await audit(context.db, context.user, "automacao.removida", {
        entity: "automation",
        entityId: input.id,
        ip: clientIp(context.headers),
      });
      return { ok: true };
    }),

  /** Avalia agora as regras que dependem de tempo. */
  sweep: adminBase.handler(async ({ context }) => {
    const result = await sweepTimeRules(context.db);
    await audit(context.db, context.user, "automacao.varredura", {
      detail: `${result.fired} disparo(s) em ${result.checked} lead(s)`,
      ip: clientIp(context.headers),
    });
    return result;
  }),

  runs: adminBase
    .input(z.object({ id: z.number().int(), limit: z.number().int().min(1).max(100).optional() }))
    .handler(({ input, context }) =>
      context.db
        .select()
        .from(schema.automationRuns)
        .where(eq(schema.automationRuns.automationId, input.id))
        .orderBy(desc(schema.automationRuns.createdAt))
        .limit(input.limit ?? 30),
    ),
};

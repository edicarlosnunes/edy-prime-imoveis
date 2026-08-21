/**
 * Agentes de IA: cadastro, ativação e teste em ambiente isolado.
 * O teste NÃO cria lead e NÃO envia mensagem para ninguém.
 */
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { adminBase } from "../lib/admin-base";
import { audit } from "../lib/audit";
import { clientIp, siteBaseUrl } from "../lib/base-url";
import { agentReply, type AgentRow } from "../agent/broker";
import { gatewayConfigured } from "../agent/gateway";
import { FALLBACK_MODEL } from "../agent/model";
import * as schema from "../database/schema";

const agentInput = z.object({
  name: z.string().min(2).max(80),
  active: z.boolean().default(false),
  model: z.string().min(3).max(80).default(FALLBACK_MODEL),
  greeting: z.string().max(600).default(""),
  instructions: z.string().max(6000).default(""),
  tone: z.string().max(400).default(""),
  hoursStart: z.string().max(5).default("08:00"),
  hoursEnd: z.string().max(5).default("20:00"),
  channels: z.array(z.enum(["site", "whatsapp", "instagram", "facebook"])).default(["site"]),
  qualification: z.string().max(2000).default(""),
  transferRules: z.string().max(2000).default(""),
  transferMessage: z.string().max(600).default(""),
  idleMinutes: z.number().int().min(1).max(1440).default(30),
  humanConditions: z.string().max(2000).default(""),
});

function toRow(input: z.infer<typeof agentInput>) {
  return {
    name: input.name.trim(),
    active: input.active ? 1 : 0,
    model: input.model,
    greeting: input.greeting.trim(),
    instructions: input.instructions.trim(),
    tone: input.tone.trim(),
    hoursStart: input.hoursStart,
    hoursEnd: input.hoursEnd,
    channels: JSON.stringify(input.channels),
    qualification: input.qualification.trim(),
    transferRules: input.transferRules.trim(),
    transferMessage: input.transferMessage.trim(),
    idleMinutes: input.idleMinutes,
    humanConditions: input.humanConditions.trim(),
    updatedAt: new Date(),
  };
}

function asAgentRow(row: typeof schema.aiAgents.$inferSelect): AgentRow {
  return {
    id: row.id,
    name: row.name,
    model: row.model,
    greeting: row.greeting,
    instructions: row.instructions,
    tone: row.tone,
    qualification: row.qualification,
    transferRules: row.transferRules,
    transferMessage: row.transferMessage,
    humanConditions: row.humanConditions,
    hoursStart: row.hoursStart,
    hoursEnd: row.hoursEnd,
  };
}

export const adminAgents = {
  list: adminBase.handler(async ({ context }) => {
    const rows = await context.db
      .select()
      .from(schema.aiAgents)
      .orderBy(desc(schema.aiAgents.updatedAt));
    return {
      gatewayReady: gatewayConfigured(),
      agents: rows.map((row) => ({
        ...row,
        active: row.active === 1,
        channels: (() => {
          try {
            const parsed = JSON.parse(row.channels);
            return Array.isArray(parsed) ? parsed.map(String) : [];
          } catch {
            return [];
          }
        })(),
      })),
    };
  }),

  create: adminBase.input(agentInput).handler(async ({ input, context }) => {
    const [created] = await context.db.insert(schema.aiAgents).values(toRow(input)).returning();
    await audit(context.db, context.user, "ia.agente_criado", {
      entity: "ai_agent",
      entityId: created?.id,
      detail: input.name,
      ip: clientIp(context.headers),
    });
    return { id: created?.id ?? 0 };
  }),

  update: adminBase
    .input(agentInput.extend({ id: z.number().int() }))
    .handler(async ({ input, context }) => {
      const { id, ...rest } = input;
      await context.db
        .update(schema.aiAgents)
        .set(toRow(rest as z.infer<typeof agentInput>))
        .where(eq(schema.aiAgents.id, id));
      await audit(context.db, context.user, "ia.agente_atualizado", {
        entity: "ai_agent",
        entityId: id,
        detail: input.name,
        ip: clientIp(context.headers),
      });
      return { id };
    }),

  setActive: adminBase
    .input(z.object({ id: z.number().int(), active: z.boolean() }))
    .handler(async ({ input, context }) => {
      await context.db
        .update(schema.aiAgents)
        .set({ active: input.active ? 1 : 0, updatedAt: new Date() })
        .where(eq(schema.aiAgents.id, input.id));
      await audit(context.db, context.user, input.active ? "ia.agente_ativado" : "ia.agente_pausado", {
        entity: "ai_agent",
        entityId: input.id,
        ip: clientIp(context.headers),
      });
      return { ok: true };
    }),

  remove: adminBase
    .input(z.object({ id: z.number().int() }))
    .handler(async ({ input, context }) => {
      await context.db.delete(schema.aiAgents).where(eq(schema.aiAgents.id, input.id));
      await audit(context.db, context.user, "ia.agente_removido", {
        entity: "ai_agent",
        entityId: input.id,
        ip: clientIp(context.headers),
      });
      return { ok: true };
    }),

  /** Sandbox: conversa de teste sem gravar conversa, mensagem ou lead. */
  test: adminBase
    .input(
      z.object({
        id: z.number().int(),
        turns: z
          .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(2000) }))
          .min(1)
          .max(20),
      }),
    )
    .handler(async ({ input, context }) => {
      const [row] = await context.db
        .select()
        .from(schema.aiAgents)
        .where(eq(schema.aiAgents.id, input.id))
        .limit(1);
      if (!row) throw new ORPCError("NOT_FOUND", { message: "Agente não encontrado" });
      if (!gatewayConfigured()) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Provedor de IA não configurado no servidor.",
        });
      }

      try {
        const reply = await agentReply(
          context.db,
          asAgentRow(row),
          input.turns,
          siteBaseUrl(context.headers),
        );
        return { ok: true as const, ...reply };
      } catch (error) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: error instanceof Error ? error.message : "Falha ao consultar a IA",
        });
      }
    }),
};

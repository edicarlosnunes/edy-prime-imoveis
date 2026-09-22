/**
 * Auditoria e visão geral de IA/automações.
 * Só leitura — nada aqui altera dado do CRM.
 */
import { z } from "zod";
import { desc, gte } from "drizzle-orm";
import { adminBase } from "../lib/admin-base";
import { recentAudit } from "../lib/audit";
import * as schema from "../database/schema";

export const adminAudit = {
  list: adminBase
    .input(z.object({ limit: z.number().int().min(10).max(300).optional() }).optional())
    .handler(({ input, context }) => recentAudit(context.db, input?.limit ?? 120)),

  /** Painel de IA e automações: números reais, nada estimado. */
  aiDashboard: adminBase.handler(async ({ context }) => {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const conversations = await context.db
      .select()
      .from(schema.conversations)
      .orderBy(desc(schema.conversations.id))
      .limit(500);

    const messages = await context.db
      .select()
      .from(schema.messages)
      .where(gte(schema.messages.createdAt, since))
      .limit(4000);

    const runs = await context.db
      .select()
      .from(schema.automationRuns)
      .where(gte(schema.automationRuns.createdAt, since))
      .orderBy(desc(schema.automationRuns.createdAt))
      .limit(500);

    const automations = await context.db.select().from(schema.automations);
    const agents = await context.db.select().from(schema.aiAgents);
    const events = await context.db
      .select()
      .from(schema.integrationEvents)
      .orderBy(desc(schema.integrationEvents.createdAt))
      .limit(40);

    const transferred = conversations.filter((row) => row.transferredAt !== null);
    const byChannel = new Map<string, number>();
    for (const row of conversations) {
      byChannel.set(row.channel, (byChannel.get(row.channel) ?? 0) + 1);
    }

    return {
      conversations: {
        total: conversations.length,
        abertas: conversations.filter((row) => row.status === "aberta").length,
        emIa: conversations.filter((row) => row.mode === "ia").length,
        comHumano: conversations.filter((row) => row.mode === "humano").length,
        transferidas: transferred.length,
        taxaTransferencia:
          conversations.length > 0
            ? Math.round((transferred.length / conversations.length) * 100)
            : 0,
        porCanal: [...byChannel.entries()].map(([channel, count]) => ({ channel, count })),
      },
      messages: {
        total: messages.length,
        daIa: messages.filter((row) => row.author === "ia").length,
        deHumano: messages.filter((row) => row.author === "humano").length,
        deClientes: messages.filter((row) => row.author === "cliente").length,
      },
      agents: {
        total: agents.length,
        ativos: agents.filter((row) => row.active === 1).length,
      },
      automations: {
        total: automations.length,
        ativas: automations.filter((row) => row.active === 1).length,
        execucoes: runs.length,
        falhas: runs.filter((row) => row.ok === 0).length,
      },
      motivosTransferencia: transferred
        .filter((row) => row.transferReason)
        .slice(0, 20)
        .map((row) => ({ id: row.id, reason: row.transferReason, at: row.transferredAt })),
      integrationEvents: events,
    };
  }),
};

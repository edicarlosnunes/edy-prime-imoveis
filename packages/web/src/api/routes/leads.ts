import { z } from "zod";
import { desc } from "drizzle-orm";
import { base } from "../__core/app";
import * as schema from "../database/schema";

/**
 * O cliente do banco (libsql) é carregado sob demanda, dentro do handler.
 * Importar `db` no topo do módulo fazia o cliente ser criado no momento em que
 * a API é carregada — se as credenciais faltarem, ou se o bundle serverless
 * resolver o binário nativo do libsql, a função inteira morre na inicialização
 * e derruba até rotas que não usam banco (health, vitrine de imóveis).
 */
async function getDb() {
  const { db } = await import("../database");
  return db;
}

const createInput = z.object({
  name: z.string().min(2).max(120),
  phone: z.string().min(8).max(30),
  interest: z.string().min(1).max(160),
  message: z.string().max(1000).optional(),
  source: z.string().max(60).optional(),
});

export const leads = {
  /** Grava um novo contato vindo do site. */
  create: base.input(createInput).handler(async ({ input }) => {
    const db = await getDb();
    const [lead] = await db
      .insert(schema.leads)
      .values({
        name: input.name.trim(),
        phone: input.phone.trim(),
        interest: input.interest,
        message: input.message?.trim() || null,
        source: input.source ?? "site",
      })
      .returning();

    return { id: lead?.id ?? 0, ok: true };
  }),

  /** Últimos contatos recebidos (uso interno). */
  list: base.handler(async () => {
    const db = await getDb();
    return db.select().from(schema.leads).orderBy(desc(schema.leads.createdAt)).limit(100);
  }),
};

import { z } from "zod";
import { asc, desc, eq, like, or } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { adminBase } from "../lib/admin-base";
import * as schema from "../database/schema";

const clientInput = z.object({
  name: z.string().min(2).max(120),
  phone: z.string().min(8).max(30),
  email: z.string().max(160).nullable().optional(),
  interest: z.string().max(160).nullable().optional(),
  priceMin: z.number().min(0).max(999_999_999).nullable().optional(),
  priceMax: z.number().min(0).max(999_999_999).nullable().optional(),
  districts: z.string().max(300).nullable().optional(),
  bedrooms: z.number().int().min(0).max(20).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
});

function toRow(input: z.infer<typeof clientInput>) {
  return {
    name: input.name.trim(),
    phone: input.phone.trim(),
    email: input.email?.trim() || null,
    interest: input.interest?.trim() || null,
    priceMin: input.priceMin ?? null,
    priceMax: input.priceMax ?? null,
    districts: input.districts?.trim() || null,
    bedrooms: input.bedrooms ?? null,
    notes: input.notes?.trim() || null,
  };
}

export const adminClients = {
  list: adminBase
    .input(z.object({ search: z.string().max(120).optional() }).optional())
    .handler(async ({ input, context }) => {
      const term = input?.search?.trim();
      return context.db
        .select()
        .from(schema.clients)
        .where(
          term
            ? or(like(schema.clients.name, `%${term}%`), like(schema.clients.phone, `%${term}%`))
            : undefined,
        )
        .orderBy(asc(schema.clients.name))
        .limit(500);
    }),

  get: adminBase
    .input(z.object({ id: z.number().int() }))
    .handler(async ({ input, context }) => {
      const [client] = await context.db
        .select()
        .from(schema.clients)
        .where(eq(schema.clients.id, input.id))
        .limit(1);
      if (!client) throw new ORPCError("NOT_FOUND", { message: "Cliente não encontrado" });
      const interactions = await context.db
        .select()
        .from(schema.clientInteractions)
        .where(eq(schema.clientInteractions.clientId, client.id))
        .orderBy(desc(schema.clientInteractions.createdAt));
      return { client, interactions };
    }),

  create: adminBase.input(clientInput).handler(async ({ input, context }) => {
    const [created] = await context.db.insert(schema.clients).values(toRow(input)).returning();
    return { id: created?.id ?? 0 };
  }),

  update: adminBase
    .input(clientInput.extend({ id: z.number().int() }))
    .handler(async ({ input, context }) => {
      const { id, ...rest } = input;
      await context.db
        .update(schema.clients)
        .set(toRow(rest as z.infer<typeof clientInput>))
        .where(eq(schema.clients.id, id));
      return { ok: true };
    }),

  remove: adminBase
    .input(z.object({ id: z.number().int() }))
    .handler(async ({ input, context }) => {
      await context.db
        .delete(schema.clientInteractions)
        .where(eq(schema.clientInteractions.clientId, input.id));
      await context.db.delete(schema.clients).where(eq(schema.clients.id, input.id));
      return { ok: true };
    }),

  /** Histórico de atendimento. */
  addInteraction: adminBase
    .input(z.object({ id: z.number().int(), body: z.string().min(1).max(2000) }))
    .handler(async ({ input, context }) => {
      await context.db
        .insert(schema.clientInteractions)
        .values({ clientId: input.id, body: input.body.trim() });
      return { ok: true };
    }),

  options: adminBase.handler(async ({ context }) => {
    return context.db
      .select({ id: schema.clients.id, name: schema.clients.name, phone: schema.clients.phone })
      .from(schema.clients)
      .orderBy(asc(schema.clients.name))
      .limit(500);
  }),
};

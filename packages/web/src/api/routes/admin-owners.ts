import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import { adminBase } from "../lib/admin-base";
import * as schema from "../database/schema";

const ownerInput = z.object({
  name: z.string().min(2).max(120),
  phone: z.string().max(30).nullable().optional(),
  email: z.string().max(160).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
  captureStatus: z.enum(["prospeccao", "em_negociacao", "captado", "perdido"]).default("prospeccao"),
});

function toRow(input: z.infer<typeof ownerInput>) {
  return {
    name: input.name.trim(),
    phone: input.phone?.trim() || null,
    email: input.email?.trim() || null,
    notes: input.notes?.trim() || null,
    captureStatus: input.captureStatus,
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

  options: adminBase.handler(async ({ context }) => {
    return context.db
      .select({ id: schema.owners.id, name: schema.owners.name })
      .from(schema.owners)
      .orderBy(asc(schema.owners.name))
      .limit(500);
  }),
};

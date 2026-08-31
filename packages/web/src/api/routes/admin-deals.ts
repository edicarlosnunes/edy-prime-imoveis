import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { adminBase } from "../lib/admin-base";
import { syncLeadStageFromDeal } from "../lib/deal-stage-sync";
import { convertDealToClient } from "../lib/deal-client-conversion";
import * as schema from "../database/schema";

const dealInput = z.object({
  clientId: z.number().int().nullable().optional(),
  leadId: z.number().int().nullable().optional(),
  propertyId: z.number().int().nullable().optional(),
  clientName: z.string().max(160).nullable().optional(),
  askingPrice: z.number().min(0).max(999_999_999).nullable().optional(),
  offerPrice: z.number().min(0).max(999_999_999).nullable().optional(),
  status: z.enum(["enviada", "em_negociacao", "aceita", "recusada", "fechada"]).default("enviada"),
  commissionRate: z.number().min(0).max(100).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
  dealDate: z.string().max(40).nullable().optional(),
});

function toRow(input: z.infer<typeof dealInput>) {
  const offer = input.offerPrice ?? null;
  const rate = input.commissionRate ?? null;
  return {
    clientId: input.clientId ?? null,
    leadId: input.leadId ?? null,
    propertyId: input.propertyId ?? null,
    clientName: input.clientName?.trim() || null,
    askingPrice: input.askingPrice ?? null,
    offerPrice: offer,
    status: input.status,
    commissionRate: rate,
    commissionValue: offer !== null && rate !== null ? (offer * rate) / 100 : null,
    notes: input.notes?.trim() || null,
    dealDate: input.dealDate ? new Date(input.dealDate) : null,
  };
}

export const adminDeals = {
  list: adminBase.handler(async ({ context }) => {
    return context.db
      .select()
      .from(schema.deals)
      .orderBy(desc(schema.deals.createdAt))
      .limit(500);
  }),

  create: adminBase.input(dealInput).handler(async ({ input, context }) => {
    const row = toRow(input);
    const [created] = await context.db.insert(schema.deals).values(row).returning();
    /* Propostas alimentam o funil: o lead vinculado avança de etapa (só para frente). */
    const sync = await syncLeadStageFromDeal(context.db, row.leadId, row.status);
    /* Venda fechada vira cliente na carteira, sem duplicar quem já existe. */
    const client = created
      ? await convertDealToClient(context.db, created.id, row.status, {
          leadId: row.leadId,
          clientId: row.clientId,
          offerPrice: row.offerPrice,
          propertyId: row.propertyId,
        })
      : { action: "none" as const, clientId: null };
    return { id: created?.id ?? 0, leadStage: sync, client };
  }),

  update: adminBase
    .input(dealInput.extend({ id: z.number().int() }))
    .handler(async ({ input, context }) => {
      const { id, ...rest } = input;
      const row = toRow(rest as z.infer<typeof dealInput>);
      await context.db.update(schema.deals).set(row).where(eq(schema.deals.id, id));
      /* Mesma sincronização da criação: salvar a proposta reflete no funil do CRM. */
      const sync = await syncLeadStageFromDeal(context.db, row.leadId, row.status);
      /* Venda fechada vira cliente na carteira, sem duplicar quem já existe. */
      const client = await convertDealToClient(context.db, id, row.status, {
        leadId: row.leadId,
        clientId: row.clientId,
        offerPrice: row.offerPrice,
        propertyId: row.propertyId,
      });
      return { ok: true, leadStage: sync, client };
    }),

  remove: adminBase
    .input(z.object({ id: z.number().int() }))
    .handler(async ({ input, context }) => {
      await context.db.delete(schema.deals).where(eq(schema.deals.id, input.id));
      return { ok: true };
    }),
};

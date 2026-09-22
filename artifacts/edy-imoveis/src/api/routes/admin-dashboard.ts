import { asc, desc, eq } from "drizzle-orm";
import { adminBase } from "../lib/admin-base";
import * as schema from "../database/schema";
import { LEAD_STAGES } from "./admin-leads";

const OPEN_DEAL_STATUS = ["enviada", "em_negociacao", "aceita"];

/** Painel inicial: números do negócio calculados em uma única chamada. */
export const adminDashboard = {
  summary: adminBase.handler(async ({ context }) => {
    const [properties, leads, deals, tasks, images, settingsRow] = await Promise.all([
      context.db.select().from(schema.properties).limit(1000),
      context.db.select().from(schema.leads).orderBy(desc(schema.leads.createdAt)).limit(1000),
      context.db.select().from(schema.deals).limit(1000),
      context.db
        .select()
        .from(schema.tasks)
        .where(eq(schema.tasks.status, "pendente"))
        .orderBy(asc(schema.tasks.dueAt))
        .limit(50),
      context.db.select().from(schema.propertyImages).limit(2000),
      context.db.select().from(schema.settings).limit(1),
    ]);

    const commissionRate = settingsRow[0]?.commissionRate ?? 6;
    const available = properties.filter((p) => p.status === "disponivel");

    const funnel = LEAD_STAGES.map((stage) => ({
      stage,
      total: leads.filter((lead) => lead.stage === stage && lead.status !== "perdido").length,
    }));

    const bySource = new Map<string, number>();
    for (const lead of leads) bySource.set(lead.source, (bySource.get(lead.source) ?? 0) + 1);

    const openDeals = deals.filter((deal) => OPEN_DEAL_STATUS.includes(deal.status));
    const closedDeals = deals.filter((deal) => deal.status === "fechada");

    const cover = (propertyId: number) => {
      const own = images.filter((image) => image.propertyId === propertyId);
      return (own.find((image) => image.isPrimary === 1) ?? own[0])?.url ?? null;
    };

    return {
      properties: {
        total: properties.length,
        published: properties.filter((p) => p.published === 1).length,
        available: available.length,
        reserved: properties.filter((p) => p.status === "reservado").length,
        sold: properties.filter((p) => p.status === "vendido").length,
        rented: properties.filter((p) => p.status === "alugado").length,
        featured: properties.filter((p) => p.featured === 1).length,
      },
      leads: {
        total: leads.length,
        new: leads.filter((lead) => lead.stage === "novo" && lead.status === "aberto").length,
        open: leads.filter((lead) => lead.status === "aberto").length,
        lost: leads.filter((lead) => lead.status === "perdido").length,
        scheduledVisits: leads.filter((lead) => lead.stage === "visita_agendada").length,
        negotiating: leads.filter((lead) => lead.stage === "negociacao").length,
        closed: leads.filter((lead) => lead.stage === "venda_fechada").length,
      },
      deals: {
        total: deals.length,
        open: openDeals.length,
        negotiating: deals.filter((deal) => deal.status === "em_negociacao").length,
        closed: closedDeals.length,
      },
      money: {
        vgvPortfolio: available.reduce((sum, p) => sum + (p.price ?? 0), 0),
        vgvProposals: openDeals.reduce((sum, deal) => sum + (deal.offerPrice ?? 0), 0),
        vgvClosed: closedDeals.reduce((sum, deal) => sum + (deal.offerPrice ?? 0), 0),
        expectedCommission: openDeals.reduce(
          (sum, deal) =>
            sum +
            (deal.commissionValue ??
              ((deal.offerPrice ?? 0) * (deal.commissionRate ?? commissionRate)) / 100),
          0,
        ),
        closedCommission: closedDeals.reduce(
          (sum, deal) =>
            sum +
            (deal.commissionValue ??
              ((deal.offerPrice ?? 0) * (deal.commissionRate ?? commissionRate)) / 100),
          0,
        ),
      },
      funnel,
      leadsBySource: [...bySource.entries()]
        .map(([source, total]) => ({ source, total }))
        .sort((a, b) => b.total - a.total),
      recentLeads: leads.slice(0, 8).map((lead) => ({
        id: lead.id,
        name: lead.name,
        phone: lead.phone,
        interest: lead.interest,
        stage: lead.stage,
        status: lead.status,
        source: lead.source,
        createdAt: lead.createdAt,
      })),
      topProperties: [...properties]
        .sort((a, b) => b.views - a.views)
        .slice(0, 5)
        .map((property) => ({
          id: property.id,
          code: property.code,
          title: property.title,
          views: property.views,
          price: property.price,
          cover: cover(property.id),
        })),
      upcomingTasks: tasks.slice(0, 8),
    };
  }),
};

/**
 * Perfil de necessidade + timeline + score do lead (F4.1).
 * Rota exclusiva do painel: nada aqui é exposto no site público.
 */
import { z } from "zod";
import { eq } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { adminBase, type AdminDb } from "../lib/admin-base";
import * as schema from "../database/schema";
import { audit } from "../lib/audit";
import {
  applyProfilePatch,
  leadTimeline,
  logLeadEvent,
  readProfile,
  recomputeLeadScore,
} from "../lib/lead-profile";

const list = z.array(z.string().max(80)).max(12).nullable().optional();
const num = z.number().nonnegative().nullable().optional();
const int = z.number().int().min(0).max(50).nullable().optional();
const txt = (max: number) => z.string().max(max).nullable().optional();

const parseList = (raw: string | null) => {
  if (!raw) return [] as string[];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [] as string[];
  }
};

async function requireLead(db: AdminDb, id: number) {
  const [lead] = await db.select().from(schema.leads).where(eq(schema.leads.id, id)).limit(1);
  if (!lead) throw new ORPCError("NOT_FOUND", { message: "Lead não encontrado" });
  return lead;
}

export const adminLeadProfile = {
  get: adminBase
    .input(z.object({ leadId: z.number().int() }))
    .handler(async ({ input, context }) => {
      const lead = await requireLead(context.db, input.leadId);
      const profile = await readProfile(context.db, input.leadId);
      const events = await leadTimeline(context.db, input.leadId, 120);
      return {
        profile: profile
          ? {
              ...profile,
              districts: parseList(profile.districts),
              preferences: parseList(profile.preferences),
              restrictions: parseList(profile.restrictions),
            }
          : null,
        events,
        score: {
          score: lead.score ?? 0,
          tier: lead.scoreTier ?? "frio",
          reasons: parseList(lead.scoreReasons),
          scoreAt: lead.scoreAt,
          qualifiedAt: lead.qualifiedAt,
        },
      };
    }),

  /** Correção manual do corretor: tem precedência sobre qualquer automação. */
  update: adminBase
    .input(
      z.object({
        leadId: z.number().int(),
        purpose: txt(40),
        propertyType: txt(40),
        city: txt(80),
        districts: list,
        budgetMin: num,
        budgetMax: num,
        bedrooms: int,
        suites: int,
        parking: int,
        areaMin: num,
        financing: z.enum(["sim", "nao", "nao_sei"]).nullable().optional(),
        fgts: z.enum(["sim", "nao", "nao_sei"]).nullable().optional(),
        tradeIn: z.enum(["sim", "nao", "nao_sei"]).nullable().optional(),
        tradeInDetail: txt(300),
        timeframe: z.enum(["imediato", "30_dias", "90_dias", "sem_pressa"]).nullable().optional(),
        preferences: list,
        restrictions: list,
        contactPreference: z.enum(["whatsapp", "ligacao", "email"]).nullable().optional(),
        contactWindow: txt(60),
        summary: txt(1000),
      }),
    )
    .handler(async ({ input, context }) => {
      await requireLead(context.db, input.leadId);
      const { leadId, ...patch } = input;
      const applied = await applyProfilePatch(context.db, leadId, patch, "manual");
      if (applied.changed.length) {
        await logLeadEvent(context.db, leadId, {
          kind: "qualificacao",
          title: `Necessidade corrigida pelo corretor: ${applied.changed.length} campo(s)`,
          detail: applied.changed.join(", "),
          actorType: "corretor",
          actorName: context.user.name,
          dedupeMinutes: 0,
        });
        await audit(context.db, context.user, "lead_profile.update", {
          entity: "lead",
          entityId: leadId,
          detail: applied.changed.join(", "),
        });
      }
      const score = await recomputeLeadScore(context.db, leadId, {
        actorType: "corretor",
        actorName: context.user.name,
      });
      return { changed: applied.changed, score };
    }),

  recalc: adminBase
    .input(z.object({ leadId: z.number().int() }))
    .handler(async ({ input, context }) => {
      await requireLead(context.db, input.leadId);
      const score = await recomputeLeadScore(context.db, input.leadId, {
        actorType: "corretor",
        actorName: context.user.name,
      });
      return score;
    }),
};

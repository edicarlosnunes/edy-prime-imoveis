/**
 * Sincronização Propostas -> funil do CRM.
 *
 * Quando uma proposta é criada ou salva com um lead vinculado, a etapa do lead
 * precisa refletir onde a negociação realmente está. A regra é "somente para
 * frente": a etapa do lead nunca regride por causa de uma proposta, para não
 * apagar avanços registrados manualmente pelo corretor.
 */
import { eq } from "drizzle-orm";
import type { AdminDb } from "./admin-base";
import * as schema from "../database/schema";

/** Mesma ordem do funil exibido no Kanban de Leads / CRM. */
export const LEAD_STAGE_ORDER = [
  "novo",
  "primeiro_contato",
  "qualificado",
  "imovel_apresentado",
  "visita_agendada",
  "proposta_enviada",
  "negociacao",
  "venda_fechada",
] as const;

export type LeadStage = (typeof LEAD_STAGE_ORDER)[number];
export type DealStatus = "enviada" | "em_negociacao" | "aceita" | "recusada" | "fechada";

/**
 * Etapa mínima do lead para cada status de proposta.
 * `recusada` não move o funil: a recusa é tratada pelo corretor (seguir com
 * outro imóvel ou marcar o lead como perdido), não automaticamente.
 */
export const DEAL_STATUS_TO_STAGE: Record<DealStatus, LeadStage | null> = {
  enviada: "proposta_enviada",
  em_negociacao: "negociacao",
  aceita: "negociacao",
  recusada: null,
  fechada: "venda_fechada",
};

function stageIndex(stage: string | null | undefined): number {
  if (!stage) return -1;
  return LEAD_STAGE_ORDER.indexOf(stage as LeadStage);
}

/**
 * Decide a nova etapa do lead, ou `null` quando nada deve mudar.
 * Puro e testável: recebe a etapa atual e o status da proposta.
 */
export function nextLeadStage(
  currentStage: string | null | undefined,
  dealStatus: string,
): LeadStage | null {
  const target = DEAL_STATUS_TO_STAGE[dealStatus as DealStatus];
  if (!target) return null;
  const current = stageIndex(currentStage);
  const wanted = stageIndex(target);
  /* etapa desconhecida no banco: assume o alvo. */
  if (current < 0) return target;
  if (wanted <= current) return null;
  return target;
}

export interface StageSyncResult {
  changed: boolean;
  leadId: number | null;
  from: string | null;
  to: LeadStage | null;
}

/**
 * Aplica a sincronização no banco. Só toca a coluna `stage` (e `status`, quando
 * a venda fecha) do lead vinculado — nunca a proposta, o imóvel ou o histórico.
 */
export async function syncLeadStageFromDeal(
  db: AdminDb,
  leadId: number | null | undefined,
  dealStatus: string,
): Promise<StageSyncResult> {
  if (!leadId) return { changed: false, leadId: null, from: null, to: null };

  const [lead] = await db
    .select({ id: schema.leads.id, stage: schema.leads.stage, status: schema.leads.status })
    .from(schema.leads)
    .where(eq(schema.leads.id, leadId))
    .limit(1);

  if (!lead) return { changed: false, leadId, from: null, to: null };

  const target = nextLeadStage(lead.stage, dealStatus);
  if (!target) return { changed: false, leadId, from: lead.stage, to: null };

  await db
    .update(schema.leads)
    .set({
      stage: target,
      /* coerente com adminLeads.setStage: fechar a venda marca o lead como ganho. */
      ...(target === "venda_fechada" && lead.status !== "perdido" ? { status: "ganho" } : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.leads.id, leadId));

  return { changed: true, leadId, from: lead.stage, to: target };
}

/**
 * Automações do CRM.
 *
 * Só existem ações que este sistema realmente executa. Ação que depende de
 * credencial externa (WhatsApp) falha com mensagem clara em vez de fingir envio.
 * Não há agendador em serverless: os gatilhos disparam no evento (lead novo,
 * conversa transferida, imóvel publicado) e as regras de tempo são avaliadas
 * quando o painel abre a tela de automações (varredura sob demanda).
 */
import { and, desc, eq, isNull, lt, or } from "drizzle-orm";
import * as schema from "../database/schema";
import type { AdminDb } from "./admin-base";
import { readConfig } from "./integrations";
import { sendWhatsappText } from "./whatsapp";

export const TRIGGERS = [
  { value: "lead_novo", label: "Lead novo entrou no CRM" },
  { value: "lead_sem_resposta", label: "Lead sem contato há X horas" },
  { value: "conversa_transferida", label: "IA transferiu conversa para humano" },
  { value: "imovel_publicado", label: "Imóvel publicado no site" },
  { value: "proposta_enviada", label: "Proposta enviada" },
] as const;

export const ACTIONS = [
  { value: "criar_tarefa", label: "Criar tarefa na agenda" },
  { value: "nota_lead", label: "Registrar nota no lead" },
  { value: "mudar_etapa", label: "Mover lead de etapa" },
  { value: "whatsapp_texto", label: "Enviar WhatsApp (exige Cloud API conectada)" },
] as const;

export type TriggerKey = (typeof TRIGGERS)[number]["value"];

export interface AutomationAction {
  type: string;
  /** texto da nota/tarefa/mensagem */
  text?: string;
  /** etapa destino em mudar_etapa */
  stage?: string;
  /** horas até o vencimento da tarefa */
  hours?: number;
}

export interface AutomationConditions {
  /** filtra por origem do lead */
  source?: string;
  /** horas de silêncio em lead_sem_resposta */
  hours?: number;
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export interface RunContext {
  leadId?: number | null;
  propertyId?: number | null;
  conversationId?: number | null;
  phone?: string | null;
  name?: string | null;
  source?: string | null;
}

function fill(text: string, context: RunContext) {
  return text
    .replace(/\{nome\}/g, context.name ?? "cliente")
    .replace(/\{origem\}/g, context.source ?? "site");
}

async function runAction(
  db: AdminDb,
  action: AutomationAction,
  context: RunContext,
): Promise<{ ok: boolean; message: string }> {
  switch (action.type) {
    case "criar_tarefa": {
      const hours = action.hours && action.hours > 0 ? action.hours : 2;
      await db.insert(schema.tasks).values({
        title: fill(action.text || "Retornar contato", context).slice(0, 160),
        type: "follow_up",
        dueAt: new Date(Date.now() + hours * 60 * 60 * 1000),
        status: "pendente",
        leadId: context.leadId ?? null,
        propertyId: context.propertyId ?? null,
        notes: "Criada por automação",
      });
      return { ok: true, message: "Tarefa criada" };
    }
    case "nota_lead": {
      if (!context.leadId) return { ok: false, message: "Sem lead para anotar" };
      await db.insert(schema.leadNotes).values({
        leadId: context.leadId,
        body: fill(action.text || "Automação executada", context).slice(0, 1000),
      });
      return { ok: true, message: "Nota registrada" };
    }
    case "mudar_etapa": {
      if (!context.leadId) return { ok: false, message: "Sem lead para mover" };
      if (!action.stage) return { ok: false, message: "Etapa destino não definida" };
      await db
        .update(schema.leads)
        .set({ stage: action.stage, updatedAt: new Date() })
        .where(eq(schema.leads.id, context.leadId));
      return { ok: true, message: `Lead movido para ${action.stage}` };
    }
    case "whatsapp_texto": {
      if (!context.phone) return { ok: false, message: "Contato sem telefone" };
      const { config } = await readConfig(db, "whatsapp_cloud");
      if (!config.accessToken || !config.phoneNumberId) {
        return { ok: false, message: "WhatsApp Cloud API ainda não conectada (falta credencial)" };
      }
      try {
        await sendWhatsappText(config, context.phone, fill(action.text || "", context));
        return { ok: true, message: "WhatsApp enviado" };
      } catch (error) {
        return {
          ok: false,
          message: `Falha no WhatsApp: ${error instanceof Error ? error.message : "erro"}`,
        };
      }
    }
    default:
      return { ok: false, message: `Ação desconhecida: ${action.type}` };
  }
}

async function record(db: AdminDb, automationId: number, ok: boolean, message: string) {
  await db.insert(schema.automationRuns).values({ automationId, ok: ok ? 1 : 0, message });
  const [row] = await db
    .select()
    .from(schema.automations)
    .where(eq(schema.automations.id, automationId))
    .limit(1);
  await db
    .update(schema.automations)
    .set({
      runCount: (row?.runCount ?? 0) + 1,
      errorCount: (row?.errorCount ?? 0) + (ok ? 0 : 1),
      lastRunAt: new Date(),
      lastError: ok ? null : message.slice(0, 300),
    })
    .where(eq(schema.automations.id, automationId));
}

/** Dispara todas as automações ativas de um gatilho. */
export async function fireTrigger(db: AdminDb, trigger: TriggerKey, context: RunContext) {
  const rows = await db
    .select()
    .from(schema.automations)
    .where(and(eq(schema.automations.active, 1), eq(schema.automations.trigger, trigger)));

  const results: { automation: string; ok: boolean; message: string }[] = [];
  for (const row of rows) {
    const conditions = parseJson<AutomationConditions>(row.conditions, {});
    if (conditions.source && context.source && conditions.source !== context.source) continue;
    const actions = parseJson<AutomationAction[]>(row.actions, []);
    const messages: string[] = [];
    let ok = true;
    for (const action of actions) {
      const result = await runAction(db, action, context);
      if (!result.ok) ok = false;
      messages.push(`${action.type}: ${result.message}`);
    }
    await record(db, row.id, ok, messages.join(" | ") || "sem ações");
    results.push({ automation: row.name, ok, message: messages.join(" | ") });
  }
  return results;
}

/**
 * Varredura das regras de tempo (lead_sem_resposta). Roda quando o painel abre
 * a tela de automações — sem cron não existe execução mágica em background.
 */
export async function sweepTimeRules(db: AdminDb) {
  const rows = await db
    .select()
    .from(schema.automations)
    .where(and(eq(schema.automations.active, 1), eq(schema.automations.trigger, "lead_sem_resposta")));
  if (rows.length === 0) return { checked: 0, fired: 0 };

  let fired = 0;
  let checked = 0;
  for (const row of rows) {
    const conditions = parseJson<AutomationConditions>(row.conditions, {});
    const hours = conditions.hours && conditions.hours > 0 ? conditions.hours : 24;
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
    const leads = await db
      .select()
      .from(schema.leads)
      .where(
        and(
          eq(schema.leads.status, "aberto"),
          eq(schema.leads.stage, "novo"),
          or(lt(schema.leads.updatedAt, cutoff), isNull(schema.leads.updatedAt))!,
        ),
      )
      .orderBy(desc(schema.leads.createdAt))
      .limit(50);
    checked += leads.length;

    for (const lead of leads) {
      // evita repetir: nota de automação já existente para o mesmo lead/regra
      const notes = await db
        .select()
        .from(schema.leadNotes)
        .where(eq(schema.leadNotes.leadId, lead.id))
        .limit(50);
      const marker = `[auto:${row.id}]`;
      if (notes.some((note) => note.body.includes(marker))) continue;

      const actions = parseJson<AutomationAction[]>(row.actions, []);
      const messages: string[] = [];
      let ok = true;
      for (const action of actions) {
        const result = await runAction(db, action, {
          leadId: lead.id,
          phone: lead.phone,
          name: lead.name,
          source: lead.source,
        });
        if (!result.ok) ok = false;
        messages.push(`${action.type}: ${result.message}`);
      }
      await db.insert(schema.leadNotes).values({
        leadId: lead.id,
        body: `${marker} ${row.name}: ${messages.join(" | ")}`,
      });
      await record(db, row.id, ok, `lead #${lead.id} — ${messages.join(" | ")}`);
      fired += 1;
    }
  }
  return { checked, fired };
}

/**
 * Entrada única de leads: site, portais, Meta, WhatsApp.
 *
 * Todo lead cai no CRM que já existe (tabela `leads`). Não existe CRM paralelo.
 * Contato repetido dentro da janela de deduplicação NÃO cria lead novo: vira
 * nota no lead existente, preservando histórico, origem e campanha.
 */
import { and, desc, eq, gte, or } from "drizzle-orm";
import * as schema from "../database/schema";
import type { AdminDb } from "./admin-base";
import { fireTrigger } from "./automations";
import { parseConfig } from "./integrations";
import { logLeadEvent, qualifyLeadFromText } from "./lead-profile";

export interface LeadInput {
  name: string;
  phone: string;
  email?: string | null;
  interest: string;
  message?: string | null;
  /** site | zap | vivareal | olx | imovelweb | meta_lead_ads | whatsapp | ... */
  source: string;
  portal?: string | null;
  channel?: string | null;
  campaign?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  externalId?: string | null;
  propertyId?: number | null;
}

export interface LeadResult {
  id: number;
  duplicated: boolean;
  detail: string;
}

const digits = (value: string) => value.replace(/\D/g, "");

async function dedupeWindowHours(db: AdminDb) {
  const [row] = await db
    .select()
    .from(schema.integrations)
    .where(eq(schema.integrations.key, "site_leads"))
    .limit(1);
  const config = parseConfig(row?.config);
  const parsed = Number.parseInt(config.dedupeHours ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 8760 ? parsed : 72;
}

/** Grava (ou funde) um lead. Sempre retorna o id do lead no CRM. */
export async function intakeLead(db: AdminDb, input: LeadInput): Promise<LeadResult> {
  const phone = digits(input.phone).slice(0, 20);
  const email = input.email?.trim().toLowerCase() || null;
  const hours = await dedupeWindowHours(db);
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  // externalId é a checagem mais forte: mesmo lead reenviado pelo portal
  if (input.externalId) {
    const [same] = await db
      .select()
      .from(schema.leads)
      .where(eq(schema.leads.externalId, input.externalId))
      .limit(1);
    if (same) {
      return { id: same.id, duplicated: true, detail: "Lead já recebido antes (mesmo id externo)." };
    }
  }

  const matchers = [];
  if (phone) matchers.push(eq(schema.leads.phone, phone));
  if (email) matchers.push(eq(schema.leads.email, email));

  let existing: typeof schema.leads.$inferSelect | undefined;
  if (matchers.length) {
    const rows = await db
      .select()
      .from(schema.leads)
      .where(and(gte(schema.leads.createdAt, since), matchers.length > 1 ? or(...matchers)! : matchers[0]!))
      .orderBy(desc(schema.leads.createdAt))
      .limit(1);
    existing = rows[0];
  }

  if (existing) {
    const lines = [
      `Novo contato (${input.source}) dentro da janela de ${hours}h.`,
      input.interest ? `Interesse: ${input.interest}` : "",
      input.message ? `Mensagem: ${input.message}` : "",
      input.campaign ? `Campanha: ${input.campaign}` : "",
    ].filter(Boolean);
    await db.insert(schema.leadNotes).values({ leadId: existing.id, body: lines.join("\n") });
    await db
      .update(schema.leads)
      .set({
        updatedAt: new Date(),
        email: existing.email ?? email,
        propertyId: existing.propertyId ?? input.propertyId ?? null,
        portal: existing.portal ?? input.portal ?? null,
        channel: existing.channel ?? input.channel ?? null,
        campaign: existing.campaign ?? input.campaign ?? null,
      })
      .where(eq(schema.leads.id, existing.id));
    /* Qualificação determinística também no contato repetido: o texto novo
       pode trazer dados que faltavam. Nunca sobrescreve o que já existe. */
    await logLeadEvent(db, existing.id, {
      kind: "mensagem",
      title: `Novo contato via ${input.source}`,
      detail: [input.interest, input.message].filter(Boolean).join(" — ") || null,
      actorType: "cliente",
      actorName: existing.name,
      dedupeMinutes: 2,
    });
    await qualifyLeadFromText(db, existing.id, [input.interest, input.message].filter(Boolean).join(". "), {
      actorType: "cliente",
      actorName: existing.name,
      countMessage: true,
    });

    return {
      id: existing.id,
      duplicated: true,
      detail: `Contato adicionado ao lead #${existing.id} (deduplicação de ${hours}h).`,
    };
  }

  const [created] = await db
    .insert(schema.leads)
    .values({
      name: input.name.trim().slice(0, 120) || "Contato sem nome",
      phone,
      email,
      interest: input.interest.slice(0, 160) || "Contato",
      message: input.message?.slice(0, 1000) || null,
      source: input.source.slice(0, 60),
      portal: input.portal ?? null,
      channel: input.channel ?? null,
      campaign: input.campaign?.slice(0, 160) ?? null,
      utmSource: input.utmSource?.slice(0, 120) ?? null,
      utmMedium: input.utmMedium?.slice(0, 120) ?? null,
      utmCampaign: input.utmCampaign?.slice(0, 160) ?? null,
      externalId: input.externalId?.slice(0, 120) ?? null,
      propertyId: input.propertyId ?? null,
      stage: "novo",
      status: "aberto",
      updatedAt: new Date(),
    })
    .returning();

  if (created) {
    await logLeadEvent(db, created.id, {
      kind: "criado",
      title: `Lead criado via ${created.source}`,
      detail: [created.interest, created.message].filter(Boolean).join(" — ") || null,
      actorType: "cliente",
      actorName: created.name,
      dedupeMinutes: 0,
    });
    await qualifyLeadFromText(db, created.id, [input.interest, input.message].filter(Boolean).join(". "), {
      actorType: "cliente",
      actorName: created.name,
      countMessage: true,
    });
    await fireTrigger(db, "lead_novo", {
      leadId: created.id,
      propertyId: created.propertyId,
      phone: created.phone,
      name: created.name,
      source: created.source,
    });
  }

  return { id: created?.id ?? 0, duplicated: false, detail: "Lead criado no CRM." };
}

/** Normaliza payloads de portais (campos variam muito de um para outro). */
export function normalizeWebhookLead(payload: Record<string, unknown>, fallbackSource: string) {
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      const value = payload[key];
      if (typeof value === "string" && value.trim()) return value.trim();
      if (typeof value === "number") return String(value);
    }
    return "";
  };

  return {
    name: pick("name", "nome", "lead_name", "contactName", "cliente") || "Contato sem nome",
    phone: pick("phone", "telefone", "celular", "whatsapp", "phoneNumber", "telephone"),
    email: pick("email", "e-mail", "mail") || null,
    interest:
      pick("interest", "interesse", "propertyCode", "codigoImovel", "listing", "message", "mensagem") ||
      "Contato via integração",
    message: pick("message", "mensagem", "comment", "observacao") || null,
    source: pick("source", "origem", "portal") || fallbackSource,
    portal: pick("portal", "source", "origem") || fallbackSource,
    channel: pick("channel", "canal") || "webhook",
    campaign: pick("campaign", "campanha") || null,
    utmSource: pick("utm_source", "utmSource") || null,
    utmMedium: pick("utm_medium", "utmMedium") || null,
    utmCampaign: pick("utm_campaign", "utmCampaign") || null,
    externalId: pick("id", "lead_id", "leadId", "external_id", "externalId") || null,
    propertyCode: pick("propertyCode", "codigoImovel", "codigo", "listingId") || null,
  };
}

/**
 * Conversão Venda fechada -> Cliente.
 *
 * Quando uma proposta chega ao status "fechada" e tem lead vinculado, o lead
 * precisa aparecer também em Clientes — sem deixar de existir no CRM. O lead
 * continua em "Venda fechada" com score, origem, eventos e histórico intactos;
 * o cliente é um registro novo (ou um já existente reaproveitado), nunca uma
 * transformação do lead.
 *
 * A decisão é pura (`planClientConversion`) e testável; só `convertDealToClient`
 * toca o banco. Assim os casos de borda ficam cobertos por teste sem precisar
 * de banco de verdade.
 */
import { eq } from "drizzle-orm";
import type { AdminDb } from "./admin-base";
import { normalizePhone } from "./site-chat";
import * as schema from "../database/schema";

/** Único status que gera cliente. Enviada/negociação/aceita/recusada não geram. */
export const CLOSING_DEAL_STATUS = "fechada";

export interface LeadLike {
  id: number;
  name: string;
  phone: string;
  email: string | null;
  interest: string | null;
}

export interface ProfileLike {
  districts: string | null;
  budgetMin: number | null;
  budgetMax: number | null;
  bedrooms: number | null;
}

export interface ClientLike {
  id: number;
  name: string;
  phone: string;
  email: string | null;
  interest: string | null;
  priceMin: number | null;
  priceMax: number | null;
  districts: string | null;
  bedrooms: number | null;
  notes: string | null;
}

export interface DealLike {
  id: number;
  leadId: number | null;
  clientId: number | null;
  offerPrice: number | null;
}

export interface ClientValues {
  name: string;
  phone: string;
  email: string | null;
  interest: string | null;
  priceMin: number | null;
  priceMax: number | null;
  districts: string | null;
  bedrooms: number | null;
  notes: string | null;
}

export type ConversionPlan =
  | { action: "none"; reason: string }
  | { action: "create"; values: ClientValues; note: string }
  | { action: "update"; clientId: number; patch: Partial<ClientValues>; note: string };

/** "GUILHERMINIA" a partir de '["GUILHERMINIA"]'. Nunca explode com JSON ruim. */
export function districtsToText(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const list = parsed.filter((v): v is string => typeof v === "string" && v.trim() !== "");
      return list.length > 0 ? list.join(", ") : null;
    }
  } catch {
    /* não era JSON: usa o texto cru se tiver conteúdo. */
  }
  const text = String(raw).trim();
  return text || null;
}

function brl(value: number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  // Formatação manual: Intl insere espaço não separável depois de "R$", o que deixa
  // a nota gravada no banco instável entre ambientes. Aqui o texto é sempre o mesmo.
  const rounded = Math.round(Math.abs(value));
  const digits = String(rounded).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${value < 0 ? "-" : ""}R$ ${digits}`;
}

/** Linha legível gravada em notes/histórico. Só cita dado que realmente existe. */
export function buildConversionNote(args: {
  leadId: number;
  dealId: number;
  propertyCode: string | null;
  offerPrice: number | null;
}): string {
  const parts = [
    `Cliente convertido a partir do lead #${args.leadId} após venda fechada da proposta #${args.dealId}`,
  ];
  if (args.propertyCode) parts.push(`imóvel ${args.propertyCode}`);
  const value = brl(args.offerPrice);
  if (value) parts.push(`valor ${value}`);
  return `${parts.join(" — ")}.`;
}

function blank(value: string | null | undefined): boolean {
  return value === null || value === undefined || value.trim() === "";
}

/** Dois telefones são a mesma pessoa quando normalizam para os mesmos dígitos. */
export function samePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizePhone(a);
  const nb = normalizePhone(b);
  return na !== null && nb !== null && na === nb;
}

function sameEmail(a: string | null | undefined, b: string | null | undefined): boolean {
  if (blank(a) || blank(b)) return false;
  return a!.trim().toLowerCase() === b!.trim().toLowerCase();
}

/**
 * Acha o cliente que já representa esta pessoa.
 * Ordem: vínculo explícito (deal.clientId) > telefone normalizado > e-mail.
 */
export function findExistingClient(
  clients: ClientLike[],
  lead: LeadLike,
  linkedClientId: number | null,
): ClientLike | null {
  if (linkedClientId) {
    const linked = clients.find((c) => c.id === linkedClientId);
    if (linked) return linked;
  }
  const byPhone = clients.find((c) => samePhone(c.phone, lead.phone));
  if (byPhone) return byPhone;
  const byEmail = clients.find((c) => sameEmail(c.email, lead.email));
  return byEmail ?? null;
}

/**
 * Decide o que fazer. Nunca inventa dado: campo sem informação real fica null.
 * Em cliente existente, só preenche o que está vazio — jamais sobrescreve
 * um dado já preenchido, e jamais grava null por cima de algo que existe.
 */
export function planClientConversion(args: {
  dealStatus: string;
  deal: DealLike;
  lead: LeadLike | null;
  profile: ProfileLike | null;
  propertyCode: string | null;
  existingClients: ClientLike[];
}): ConversionPlan {
  const { dealStatus, deal, lead, profile, propertyCode, existingClients } = args;

  if (dealStatus !== CLOSING_DEAL_STATUS) {
    return { action: "none", reason: `status "${dealStatus}" não fecha venda` };
  }
  if (!deal.leadId || !lead) {
    return { action: "none", reason: "proposta sem lead vinculado" };
  }

  /* Sem telefone utilizável e sem e-mail não há como deduplicar com segurança. */
  const usablePhone = normalizePhone(lead.phone);
  if (!usablePhone && blank(lead.email)) {
    return { action: "none", reason: "lead sem telefone utilizável e sem e-mail" };
  }

  const note = buildConversionNote({
    leadId: lead.id,
    dealId: deal.id,
    propertyCode,
    offerPrice: deal.offerPrice,
  });

  const incoming: ClientValues = {
    name: lead.name.trim(),
    phone: lead.phone.trim(),
    email: blank(lead.email) ? null : lead.email!.trim(),
    interest: blank(lead.interest) ? null : lead.interest!.trim(),
    priceMin: profile?.budgetMin ?? null,
    priceMax: profile?.budgetMax ?? null,
    districts: districtsToText(profile?.districts),
    bedrooms: profile?.bedrooms ?? null,
    notes: note,
  };

  const existing = findExistingClient(existingClients, lead, deal.clientId);
  if (!existing) return { action: "create", values: incoming, note };

  /* Só completa buracos. Campo já preenchido no cliente é mantido como está. */
  const patch: Partial<ClientValues> = {};
  if (blank(existing.name) && !blank(incoming.name)) patch.name = incoming.name;
  if (blank(existing.phone) && !blank(incoming.phone)) patch.phone = incoming.phone;
  if (blank(existing.email) && incoming.email) patch.email = incoming.email;
  if (blank(existing.interest) && incoming.interest) patch.interest = incoming.interest;
  if (existing.priceMin === null && incoming.priceMin !== null) patch.priceMin = incoming.priceMin;
  if (existing.priceMax === null && incoming.priceMax !== null) patch.priceMax = incoming.priceMax;
  if (blank(existing.districts) && incoming.districts) patch.districts = incoming.districts;
  if (existing.bedrooms === null && incoming.bedrooms !== null) patch.bedrooms = incoming.bedrooms;

  /* A referência da venda é anexada uma única vez — reprocessar não repete a linha. */
  if (!(existing.notes ?? "").includes(note)) {
    patch.notes = blank(existing.notes) ? note : `${existing.notes!.trim()}\n${note}`;
  }

  return { action: "update", clientId: existing.id, patch, note };
}

export interface ConversionResult {
  action: "none" | "created" | "updated";
  clientId: number | null;
  reason?: string;
}

/**
 * Executa o plano. Idempotente: salvar a mesma venda fechada de novo reaproveita
 * o cliente e não duplica nem o registro nem a observação da venda.
 */
export async function convertDealToClient(
  db: AdminDb,
  dealId: number,
  dealStatus: string,
  deal: { leadId: number | null; clientId: number | null; offerPrice: number | null; propertyId: number | null },
): Promise<ConversionResult> {
  if (dealStatus !== CLOSING_DEAL_STATUS) {
    return { action: "none", clientId: null, reason: "status não fecha venda" };
  }
  if (!deal.leadId) {
    return { action: "none", clientId: null, reason: "proposta sem lead vinculado" };
  }

  const [lead] = await db
    .select({
      id: schema.leads.id,
      name: schema.leads.name,
      phone: schema.leads.phone,
      email: schema.leads.email,
      interest: schema.leads.interest,
    })
    .from(schema.leads)
    .where(eq(schema.leads.id, deal.leadId))
    .limit(1);

  if (!lead) return { action: "none", clientId: null, reason: "lead não encontrado" };

  const [profile] = await db
    .select({
      districts: schema.leadProfile.districts,
      budgetMin: schema.leadProfile.budgetMin,
      budgetMax: schema.leadProfile.budgetMax,
      bedrooms: schema.leadProfile.bedrooms,
    })
    .from(schema.leadProfile)
    .where(eq(schema.leadProfile.leadId, lead.id))
    .limit(1);

  let propertyCode: string | null = null;
  if (deal.propertyId) {
    const [property] = await db
      .select({ code: schema.properties.code })
      .from(schema.properties)
      .where(eq(schema.properties.id, deal.propertyId))
      .limit(1);
    propertyCode = property?.code ?? null;
  }

  /* A tabela clients guarda o telefone como foi digitado, sem coluna normalizada.
     A deduplicação precisa comparar dígito a dígito, então carregamos a carteira
     e comparamos em memória — é uma carteira de corretor, não um datalake. */
  const clients = await db.select().from(schema.clients);

  const plan = planClientConversion({
    dealStatus,
    deal: { id: dealId, leadId: deal.leadId, clientId: deal.clientId, offerPrice: deal.offerPrice },
    lead,
    profile: profile ?? null,
    propertyCode,
    existingClients: clients,
  });

  if (plan.action === "none") return { action: "none", clientId: null, reason: plan.reason };

  let clientId: number;
  let action: "created" | "updated";

  if (plan.action === "create") {
    const [created] = await db.insert(schema.clients).values(plan.values).returning();
    clientId = created!.id;
    action = "created";
  } else {
    clientId = plan.clientId;
    action = "updated";
    if (Object.keys(plan.patch).length > 0) {
      await db.update(schema.clients).set(plan.patch).where(eq(schema.clients.id, clientId));
    }
  }

  /* Histórico do cliente: uma interação por venda, sem repetir em reprocessamento. */
  const interactions = await db
    .select({ body: schema.clientInteractions.body })
    .from(schema.clientInteractions)
    .where(eq(schema.clientInteractions.clientId, clientId));
  if (!interactions.some((i) => i.body === plan.note)) {
    await db.insert(schema.clientInteractions).values({ clientId, body: plan.note });
  }

  /* Liga proposta e lead ao cliente quando ainda não há vínculo. Só preenche
     campo vazio — nunca reaponta um vínculo já existente. */
  if (!deal.clientId) {
    await db.update(schema.deals).set({ clientId }).where(eq(schema.deals.id, dealId));
  }
  const [leadRow] = await db
    .select({ clientId: schema.leads.clientId })
    .from(schema.leads)
    .where(eq(schema.leads.id, lead.id))
    .limit(1);
  if (leadRow && !leadRow.clientId) {
    await db.update(schema.leads).set({ clientId }).where(eq(schema.leads.id, lead.id));
  }

  return { action, clientId };
}

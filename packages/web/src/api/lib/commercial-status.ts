/**
 * STATUS COMERCIAL — eixo novo, separado do status do cadastro.
 *
 * Cadastro responde "a ficha está completa?"; comercial responde "o imóvel
 * está à venda agora?". São eixos independentes de propósito: ficha CONCLUIDA
 * com imóvel VENDIDO é combinação normal, e um não deve mascarar o outro.
 *
 * A coluna antiga `properties.status` (disponivel/reservado/vendido/alugado)
 * NÃO é removida nem reescrita: continua sendo a fonte de verdade de quem já
 * lê ela. Este módulo deriva o eixo novo a partir dela quando o campo novo
 * ainda está vazio — assim os 8 imóveis que já existem funcionam sem backfill.
 *
 * Módulo puro.
 */

export const COMMERCIAL_STATUSES = [
  "ATIVO_PARA_VENDA",
  "RESERVADO",
  "VENDIDO",
  "RETIRADO_PELO_PROPRIETARIO",
] as const;
export type CommercialStatus = (typeof COMMERCIAL_STATUSES)[number];

export const COMMERCIAL_STATUS_LABEL: Record<CommercialStatus, string> = {
  ATIVO_PARA_VENDA: "Ativo para venda",
  RESERVADO: "Reservado",
  VENDIDO: "Vendido",
  RETIRADO_PELO_PROPRIETARIO: "Retirado pelo proprietário",
};

export const COMMERCIAL_STATUS_TONE: Record<CommercialStatus, "ok" | "info" | "neutral" | "warn"> = {
  ATIVO_PARA_VENDA: "ok",
  RESERVADO: "info",
  VENDIDO: "neutral",
  RETIRADO_PELO_PROPRIETARIO: "warn",
};

export const DEFAULT_COMMERCIAL_STATUS: CommercialStatus = "ATIVO_PARA_VENDA";

/**
 * Tradução da coluna antiga para o eixo novo.
 *
 * `alugado` fica sem equivalente de propósito: o eixo novo é de venda, e
 * inventar "VENDIDO" para um imóvel alugado seria informação falsa. Nesse
 * caso o comportamento atual (governado por `published`) é preservado.
 */
export const LEGACY_STATUS_TO_COMMERCIAL: Record<string, CommercialStatus | null> = {
  disponivel: "ATIVO_PARA_VENDA",
  reservado: "RESERVADO",
  vendido: "VENDIDO",
  alugado: null,
};

export function normalizeCommercialStatus(
  raw: string | null | undefined,
): CommercialStatus | null {
  const value = String(raw ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (!value) return null;
  return (COMMERCIAL_STATUSES as readonly string[]).includes(value)
    ? (value as CommercialStatus)
    : null;
}

/**
 * Status comercial efetivo: o campo novo quando preenchido, senão a derivação
 * da coluna antiga, senão `null` (= "sem eixo novo definido", que NÃO deve
 * esconder nada da vitrine).
 */
export function effectiveCommercialStatus(row: {
  commercialStatus?: string | null;
  status?: string | null;
}): CommercialStatus | null {
  const explicit = normalizeCommercialStatus(row.commercialStatus);
  if (explicit) return explicit;
  const legacy = String(row.status ?? "").trim().toLowerCase();
  return LEGACY_STATUS_TO_COMMERCIAL[legacy] ?? null;
}

/** Status comerciais que somem da vitrine ativa do site. */
export const HIDDEN_FROM_SHOWCASE: CommercialStatus[] = [
  "VENDIDO",
  "RETIRADO_PELO_PROPRIETARIO",
];

/**
 * Sai da vitrine por status comercial?
 *
 * RESERVADO continua aparecendo: é o comportamento atual do site e reservado
 * ainda vende (cai a reserva e o imóvel volta). Mudar isso aqui seria alterar
 * regra que ninguém pediu.
 */
export function hiddenByCommercialStatus(row: {
  commercialStatus?: string | null;
  status?: string | null;
}): boolean {
  const status = effectiveCommercialStatus(row);
  return status != null && HIDDEN_FROM_SHOWCASE.includes(status);
}

export type ShowcaseInput = {
  /** Coluna existente — continua mandando e não é substituída. */
  published?: number | boolean | null;
  status?: string | null;
  commercialStatus?: string | null;
  /** Pausa da regra de 12 meses (`portfolio-lifecycle.ts`). */
  pausedAt?: Date | null;
  /** Status do cadastro (`capture-registration.ts`). */
  registrationStatus?: string | null;
};

export type ShowcaseDecision = {
  visible: boolean;
  /** Motivo de estar fora — `null` quando visível. */
  reason: string | null;
};

/** Status de cadastro que tiram o imóvel da vitrine ativa. */
const HIDDEN_REGISTRATION = new Set(["PAUSADO", "ARQUIVADO"]);

/**
 * Decide a exibição na VITRINE ATIVA do site.
 *
 * Nada é excluído: o registro continua no CRM com todo o histórico. Esta
 * função só responde se o imóvel entra na listagem pública.
 */
export function showcaseDecision(row: ShowcaseInput): ShowcaseDecision {
  const published = row.published === true || row.published === 1;
  if (!published) return { visible: false, reason: "Imóvel não publicado." };

  if (hiddenByCommercialStatus(row)) {
    const status = effectiveCommercialStatus(row) as CommercialStatus;
    return { visible: false, reason: `Status comercial: ${COMMERCIAL_STATUS_LABEL[status]}.` };
  }

  if (row.pausedAt) {
    return { visible: false, reason: "Imóvel pausado — histórico preservado no CRM." };
  }

  const registration = String(row.registrationStatus ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (HIDDEN_REGISTRATION.has(registration)) {
    return { visible: false, reason: `Cadastro ${registration === "PAUSADO" ? "pausado" : "arquivado"}.` };
  }

  return { visible: true, reason: null };
}

export function showcaseVisible(row: ShowcaseInput): boolean {
  return showcaseDecision(row).visible;
}

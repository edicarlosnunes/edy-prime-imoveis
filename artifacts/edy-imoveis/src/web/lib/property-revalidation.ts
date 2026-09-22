/**
 * Revalidação de carteira — ciclo de 4 meses (V2).
 *
 * Regra definitiva: o prazo nasce da ENTRADA NA CARTEIRA (cadastro do imóvel),
 * nunca do Radar nem de pré-captação. Imóvel sem `portfolioEntryAt` definido
 * simplesmente não entra na fila — não é "vencido", é "não definido".
 *
 * Funções puras: nada de Date.now() implícito, toda referência de tempo entra
 * por parâmetro para o cálculo ser testável e determinístico.
 */

export const REVALIDATION_CYCLE_MONTHS = 4;

/* ------------------------------------------------------------- desfechos */

export const REVALIDATION_OUTCOMES = [
  "disponivel",
  "vendido",
  "nao_deseja_vender",
  "alterou_condicoes",
  "retornar_depois",
  "sem_resposta",
] as const;
export type RevalidationOutcome = (typeof REVALIDATION_OUTCOMES)[number];

export const REVALIDATION_OUTCOME_LABEL: Record<RevalidationOutcome, string> = {
  disponivel: "Ainda disponível",
  vendido: "Já vendeu",
  nao_deseja_vender: "Não deseja vender",
  alterou_condicoes: "Alterou condições",
  retornar_depois: "Retornar depois",
  sem_resposta: "Sem resposta",
};

/**
 * Desfechos que ENCERRAM a participação do imóvel no ciclo. O histórico é
 * preservado; apenas não há próxima revalidação agendada.
 */
export const CLOSING_OUTCOMES: RevalidationOutcome[] = ["vendido", "nao_deseja_vender"];

/** Desfechos que reabrem um ciclo completo de 4 meses. */
export const RENEWING_OUTCOMES: RevalidationOutcome[] = ["disponivel", "alterou_condicoes"];

/**
 * Nenhum desfecho altera `properties.status` automaticamente — nem "já vendeu".
 * Mudar o status tira o imóvel do site público e mexe em dado existente, então
 * fica como sugestão para decisão humana.
 */
export function suggestedStatusChange(outcome: RevalidationOutcome): string | null {
  if (outcome === "vendido") return "vendido";
  if (outcome === "nao_deseja_vender") return "encerrar captação";
  return null;
}

/* ----------------------------------------------------------------- datas */

/**
 * Soma meses preservando o fim de mês: 31/10 + 4 meses = 28/02 (ou 29/02),
 * não 03/03 como faria o overflow nativo do Date.
 */
export function addMonths(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  const targetDay = result.getDate();
  result.setDate(1);
  result.setMonth(result.getMonth() + months);
  const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(targetDay, lastDay));
  return result;
}

/** Próxima revalidação a partir de uma data base. */
export function nextRevalidationFrom(base: Date): Date {
  return addMonths(base, REVALIDATION_CYCLE_MONTHS);
}

/* ----------------------------------------------------------------- fila */

export type RevalidationInput = {
  /** Status do imóvel em `properties.status`. */
  status: string;
  portfolioEntryAt: Date | null;
  lastRevalidationAt: Date | null;
  nextRevalidationAt: Date | null;
  /** Último desfecho registrado, se houver. */
  lastOutcome: RevalidationOutcome | null;
};

export type RevalidationState =
  | "nao_definida"
  | "fora_do_ciclo"
  | "encerrada"
  | "pendente_sem_resposta"
  | "em_dia"
  | "vence_em_breve"
  | "vencida";

export type RevalidationView = {
  state: RevalidationState;
  label: string;
  /** Dias até vencer (negativo = atrasado). null quando não há data. */
  daysUntilDue: number | null;
  dueAt: Date | null;
  /** Entra na fila de trabalho da corretora. */
  actionRequired: boolean;
};

/** Só imóveis ativos/disponíveis participam da revalidação. */
export function participatesInRevalidation(status: string): boolean {
  return status === "disponivel";
}

const DAY_MS = 86_400_000;

/** Diferença em dias inteiros entre duas datas (ignora hora). */
export function daysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b - a) / DAY_MS);
}

/** Janela de alerta antes do vencimento. */
export const DUE_SOON_DAYS = 15;

/**
 * Estado atual da revalidação de um imóvel. `now` entra por parâmetro para
 * manter a função pura.
 */
export function revalidationView(input: RevalidationInput, now: Date): RevalidationView {
  if (!participatesInRevalidation(input.status)) {
    return {
      state: "fora_do_ciclo",
      label: "Fora do ciclo (imóvel não disponível)",
      daysUntilDue: null,
      dueAt: null,
      actionRequired: false,
    };
  }

  if (input.lastOutcome && CLOSING_OUTCOMES.includes(input.lastOutcome)) {
    return {
      state: "encerrada",
      label: "Ciclo encerrado — histórico preservado",
      daysUntilDue: null,
      dueAt: null,
      actionRequired: false,
    };
  }

  if (!input.portfolioEntryAt) {
    return {
      state: "nao_definida",
      label: "Entrada na carteira não definida",
      daysUntilDue: null,
      dueAt: null,
      actionRequired: true,
    };
  }

  const dueAt = input.nextRevalidationAt ?? nextRevalidationFrom(input.portfolioEntryAt);
  const daysUntilDue = daysBetween(now, dueAt);

  if (input.lastOutcome === "sem_resposta" && daysUntilDue <= 0) {
    return {
      state: "pendente_sem_resposta",
      label: "Pendente — sem resposta do proprietário",
      daysUntilDue,
      dueAt,
      actionRequired: true,
    };
  }

  if (daysUntilDue < 0) {
    return {
      state: "vencida",
      label: `Revalidação vencida há ${Math.abs(daysUntilDue)} dia(s)`,
      daysUntilDue,
      dueAt,
      actionRequired: true,
    };
  }

  if (daysUntilDue <= DUE_SOON_DAYS) {
    return {
      state: "vence_em_breve",
      label: `Revalidar em ${daysUntilDue} dia(s)`,
      daysUntilDue,
      dueAt,
      actionRequired: true,
    };
  }

  return {
    state: "em_dia",
    label: `Em dia — próxima em ${daysUntilDue} dia(s)`,
    daysUntilDue,
    dueAt,
    actionRequired: false,
  };
}

/**
 * Efeito de registrar um desfecho: devolve as datas a gravar em `properties`.
 * Nunca devolve status do imóvel — isso é decisão humana.
 */
export function applyOutcome(
  outcome: RevalidationOutcome,
  at: Date,
): { lastRevalidationAt: Date; nextRevalidationAt: Date | null } {
  if (CLOSING_OUTCOMES.includes(outcome)) {
    return { lastRevalidationAt: at, nextRevalidationAt: null };
  }
  if (outcome === "retornar_depois") {
    // Retorno curto: metade do ciclo, sem reiniciar os 4 meses cheios.
    return { lastRevalidationAt: at, nextRevalidationAt: addMonths(at, 2) };
  }
  if (outcome === "sem_resposta") {
    // Não apaga nem encerra: reagenda curto e segue pendente.
    const next = new Date(at.getTime() + 15 * DAY_MS);
    return { lastRevalidationAt: at, nextRevalidationAt: next };
  }
  // disponivel | alterou_condicoes -> novo ciclo cheio de 4 meses
  return { lastRevalidationAt: at, nextRevalidationAt: nextRevalidationFrom(at) };
}

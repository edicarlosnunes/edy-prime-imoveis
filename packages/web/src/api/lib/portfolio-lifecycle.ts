/**
 * Ciclo de vida do imóvel na carteira — REVALIDAÇÃO 4 MESES + PAUSA 12 MESES.
 *
 * O ciclo de 4 meses já existe e continua onde está
 * (`web/lib/property-revalidation.ts`): este módulo NÃO o altera nem o
 * substitui. Aqui vive só a regra nova, dos 12 meses.
 *
 * Regra confirmada pelo usuário: 12 meses na carteira sem venda é AUTOMÁTICO —
 * o imóvel sai da vitrine sozinho e a ação de revisão é gerada sozinha, sem
 * esperar confirmação humana. E, explicitamente:
 *
 *   • NADA é excluído. O imóvel é PAUSADO, não removido;
 *   • o histórico inteiro é preservado (audit_log, revalidações, notas);
 *   • o registro continua visível no CRM — só sai da vitrine do site;
 *   • reativar é ato humano (`resumeFromPause`), nunca automático.
 *
 * Módulo puro: `now` entra por parâmetro. `addMonths` é local de propósito
 * para este módulo não depender de nada do front.
 */

/** Meses na carteira sem venda que disparam a pausa automática. */
export const PAUSE_AFTER_MONTHS = 12;

/** Rótulo exigido no pedido, gravado no motivo da pausa e exibido no CRM. */
export const PAUSE_REASON_12M = "PAUSADO — MAIS DE 12 MESES SEM VENDA";

/** Ação gerada para o corretor quando a pausa acontece. */
export const PAUSE_NEXT_ACTION = "Revisar imóvel pausado (12 meses sem venda): confirmar interesse, preço e disponibilidade com o proprietário";

/** Janela de alerta antes de completar os 12 meses. */
export const PAUSE_WARN_DAYS = 30;

const DAY_MS = 86_400_000;

/** Soma meses preservando o fim de mês (31/10 + 4 = 28/02, não 03/03). */
export function addMonths(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  const targetDay = result.getDate();
  result.setDate(1);
  result.setMonth(result.getMonth() + months);
  const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(targetDay, lastDay));
  return result;
}

/** Diferença em dias inteiros, ignorando hora. */
export function daysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b - a) / DAY_MS);
}

/** Data em que o imóvel completa 12 meses de carteira. */
export function pauseDueAt(portfolioEntryAt: Date): Date {
  return addMonths(portfolioEntryAt, PAUSE_AFTER_MONTHS);
}

export type LifecycleInput = {
  /** Entrada na carteira. Sem ela não há prazo: o imóvel fica fora da regra. */
  portfolioEntryAt?: Date | null;
  /** Coluna antiga `properties.status`. */
  status?: string | null;
  /** Eixo novo (`commercial-status.ts`). */
  commercialStatus?: string | null;
  /** Já pausado? Data da pausa anterior. */
  pausedAt?: Date | null;
  /**
   * Venda/negociação registrada depois da entrada — reinicia a contagem.
   * Normalmente `lastRevalidationAt`, quando a revalidação confirmou interesse.
   */
  lastRevalidationAt?: Date | null;
};

export type LifecycleState =
  | "sem_data_de_entrada"
  | "fora_da_regra"
  | "ja_pausado"
  | "em_carteira"
  | "pausa_proxima"
  | "pausa_devida";

export type LifecycleView = {
  state: LifecycleState;
  label: string;
  dueAt: Date | null;
  /** Dias até completar 12 meses (negativo = já passou). */
  daysUntilPause: number | null;
  monthsInPortfolio: number | null;
  /** A pausa automática deve ser aplicada agora. */
  shouldPause: boolean;
};

/** Status que encerram a participação: já vendeu ou já saiu por decisão do dono. */
const CLOSED_COMMERCIAL = new Set(["VENDIDO", "RETIRADO_PELO_PROPRIETARIO"]);
const CLOSED_LEGACY = new Set(["vendido", "alugado"]);

function isClosed(input: LifecycleInput): boolean {
  const commercial = String(input.commercialStatus ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (commercial && CLOSED_COMMERCIAL.has(commercial)) return true;
  return CLOSED_LEGACY.has(String(input.status ?? "").trim().toLowerCase());
}

/** Base da contagem: a última confirmação de interesse, senão a entrada. */
export function lifecycleBase(input: LifecycleInput): Date | null {
  const entry = input.portfolioEntryAt ?? null;
  if (!entry) return null;
  const last = input.lastRevalidationAt ?? null;
  return last && last.getTime() > entry.getTime() ? last : entry;
}

/** Meses completos entre duas datas. */
export function monthsBetween(from: Date, to: Date): number {
  let months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  if (to.getDate() < from.getDate()) months -= 1;
  return months;
}

/**
 * Estado do imóvel diante da regra dos 12 meses.
 *
 * `shouldPause` é o único gatilho de escrita: quem chamar aplica a pausa e
 * grava o histórico. Nunca devolve `true` para imóvel já pausado, vendido,
 * alugado ou retirado — e nunca para imóvel sem data de entrada, porque
 * "data não definida" não é "vencido".
 */
export function lifecycleView(input: LifecycleInput, now: Date = new Date()): LifecycleView {
  if (input.pausedAt) {
    return {
      state: "ja_pausado",
      label: PAUSE_REASON_12M,
      dueAt: null,
      daysUntilPause: null,
      monthsInPortfolio: null,
      shouldPause: false,
    };
  }

  if (isClosed(input)) {
    return {
      state: "fora_da_regra",
      label: "Fora da regra (imóvel vendido/alugado/retirado)",
      dueAt: null,
      daysUntilPause: null,
      monthsInPortfolio: null,
      shouldPause: false,
    };
  }

  const base = lifecycleBase(input);
  if (!base) {
    return {
      state: "sem_data_de_entrada",
      label: "Entrada na carteira não definida",
      dueAt: null,
      daysUntilPause: null,
      monthsInPortfolio: null,
      shouldPause: false,
    };
  }

  const dueAt = pauseDueAt(base);
  const daysUntilPause = daysBetween(now, dueAt);
  const months = monthsBetween(base, now);

  if (daysUntilPause <= 0) {
    return {
      state: "pausa_devida",
      label: `${PAUSE_REASON_12M} (${months} meses em carteira)`,
      dueAt,
      daysUntilPause,
      monthsInPortfolio: months,
      shouldPause: true,
    };
  }

  if (daysUntilPause <= PAUSE_WARN_DAYS) {
    return {
      state: "pausa_proxima",
      label: `Completa 12 meses em ${daysUntilPause} dia(s)`,
      dueAt,
      daysUntilPause,
      monthsInPortfolio: months,
      shouldPause: false,
    };
  }

  return {
    state: "em_carteira",
    label: `${months} meses em carteira`,
    dueAt,
    daysUntilPause,
    monthsInPortfolio: months,
    shouldPause: false,
  };
}

export type PauseEffect = {
  /** Data da pausa a gravar. */
  pausedAt: Date;
  pauseReason: typeof PAUSE_REASON_12M;
  /** Status do cadastro que acompanha a pausa. */
  registrationStatus: "PAUSADO";
  /** Sai da vitrine ativa — `published` NÃO é alterado. */
  showcase: false;
  /** Ação gerada para o corretor. */
  nextAction: string;
  nextActionAt: Date;
  /** Linha de histórico. */
  historyNote: string;
};

/**
 * O que gravar quando a pausa automática dispara.
 *
 * `published` de propósito fica de fora: ele é a decisão editorial do corretor
 * e sobrescrevê-lo apagaria a intenção original. Quem esconde o imóvel é
 * `pausedAt`, lido por `commercial-status.ts#showcaseDecision`.
 */
export function pauseEffect(at: Date, monthsInPortfolio: number | null = null): PauseEffect {
  const suffix = monthsInPortfolio != null ? ` (${monthsInPortfolio} meses em carteira)` : "";
  return {
    pausedAt: at,
    pauseReason: PAUSE_REASON_12M,
    registrationStatus: "PAUSADO",
    showcase: false,
    nextAction: PAUSE_NEXT_ACTION,
    nextActionAt: at,
    historyNote: `${PAUSE_REASON_12M}${suffix}. Retirado da vitrine automaticamente; registro e histórico preservados no CRM.`,
  };
}

export type ResumeEffect = {
  pausedAt: null;
  pauseReason: null;
  /** Nova entrada de contagem: reativar reinicia os 12 meses. */
  portfolioEntryAt: Date;
  historyNote: string;
};

/**
 * Reativação — SEMPRE humana. Limpa a pausa e reinicia a contagem, para o
 * imóvel não voltar e ser pausado de novo no dia seguinte.
 */
export function resumeFromPause(at: Date, by: string | null = null): ResumeEffect {
  const who = by ? ` por ${by}` : "";
  return {
    pausedAt: null,
    pauseReason: null,
    portfolioEntryAt: at,
    historyNote: `Imóvel reativado${who} após pausa de 12 meses. Contagem reiniciada.`,
  };
}

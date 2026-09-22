/**
 * Lead Score determinístico (F4.1).
 *
 * Função PURA: sem banco, sem rede, sem IA. Mesma entrada → mesma saída.
 * Todos os pesos vivem em WEIGHTS, com teto por categoria, para que o corretor
 * possa ajustar a régua num só lugar. Cada ponto atribuído gera um motivo
 * legível em `reasons` — o score nunca é uma caixa preta.
 */

export type ScoreTier = "quente" | "morno" | "frio";

export interface ScoreProfileInput {
  purpose?: string | null;
  propertyType?: string | null;
  city?: string | null;
  districts?: string[] | null;
  budgetMin?: number | null;
  budgetMax?: number | null;
  bedrooms?: number | null;
  suites?: number | null;
  parking?: number | null;
  areaMin?: number | null;
  financing?: string | null;
  fgts?: string | null;
  tradeIn?: string | null;
  timeframe?: string | null;
  contactPreference?: string | null;
  contactWindow?: string | null;
}

export interface ScoreSignalsInput {
  hasPhone?: boolean;
  hasEmail?: boolean;
  hasName?: boolean;
  wantsVisit?: boolean;
  wantsHuman?: boolean;
  cashPayment?: boolean;
  justLooking?: boolean;
  /** mensagens do cliente na conversa (não conta falas da IA) */
  messagesCount?: number;
  /** dias distintos em que o cliente interagiu */
  contactDays?: number;
  /** true quando o orçamento máximo é menor que o menor imóvel publicado */
  budgetBelowCatalog?: boolean;
  /** true quando o lead é claramente prospecção nossa / contato inválido */
  invalidContact?: boolean;
}

export interface ScoreBreakdown {
  contato: number;
  necessidade: number
  prontidao: number;
  engajamento: number;
  penalidades: number;
}

export interface ScoreResult {
  score: number;
  tier: ScoreTier;
  reasons: string[];
  breakdown: ScoreBreakdown;
}

/** Régua única do score. Alterar aqui muda a qualificação inteira. */
export const WEIGHTS = {
  caps: { contato: 30, necessidade: 30, prontidao: 25, engajamento: 15 },
  contato: {
    phone: 16,
    email: 8,
    name: 6,
  },
  necessidade: {
    purpose: 6,
    propertyType: 5,
    location: 6,
    budget: 9,
    rooms: 4,
  },
  prontidao: {
    timeframeImediato: 14,
    timeframe30: 10,
    timeframe90: 5,
    timeframeSemPressa: 0,
    wantsVisit: 12,
    wantsHuman: 6,
    cashPayment: 8,
    financingReady: 5,
    fgts: 3,
    tradeIn: 2,
  },
  engajamento: {
    perMessage: 2,
    perContactDay: 3,
    contactWindow: 2,
  },
  penalidades: {
    justLooking: -12,
    budgetBelowCatalog: -10,
    noPhone: -10,
    invalidContact: -35,
  },
  tiers: { quente: 65, morno: 35 },
  /** Piso: pediu visita e deixou telefone entra como quente, sempre. */
  visitFloor: 65,
} as const;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const filled = (value: unknown) =>
  value !== null && value !== undefined && value !== "" && !(Array.isArray(value) && value.length === 0);

export function tierOf(score: number): ScoreTier {
  if (score >= WEIGHTS.tiers.quente) return "quente";
  if (score >= WEIGHTS.tiers.morno) return "morno";
  return "frio";
}

export function scoreLead(
  profile: ScoreProfileInput | null | undefined,
  signals: ScoreSignalsInput | null | undefined,
): ScoreResult {
  const p = profile ?? {};
  const s = signals ?? {};
  const reasons: string[] = [];

  /* ------------------------------------------------------------- contato */
  let contato = 0;
  if (s.hasPhone) {
    contato += WEIGHTS.contato.phone;
    reasons.push("Telefone informado");
  }
  if (s.hasEmail) {
    contato += WEIGHTS.contato.email;
    reasons.push("E-mail informado");
  }
  if (s.hasName) {
    contato += WEIGHTS.contato.name;
    reasons.push("Nome informado");
  }
  contato = Math.min(contato, WEIGHTS.caps.contato);

  /* -------------------------------------------------------- necessidade */
  let necessidade = 0;
  if (filled(p.purpose)) {
    necessidade += WEIGHTS.necessidade.purpose;
    reasons.push(`Finalidade definida (${p.purpose})`);
  }
  if (filled(p.propertyType)) {
    necessidade += WEIGHTS.necessidade.propertyType;
    reasons.push(`Tipo de imóvel definido (${p.propertyType})`);
  }
  if (filled(p.city) || filled(p.districts)) {
    necessidade += WEIGHTS.necessidade.location;
    reasons.push("Localização desejada informada");
  }
  if (filled(p.budgetMin) || filled(p.budgetMax)) {
    necessidade += WEIGHTS.necessidade.budget;
    reasons.push("Orçamento informado");
  }
  if (filled(p.bedrooms) || filled(p.suites) || filled(p.parking) || filled(p.areaMin)) {
    necessidade += WEIGHTS.necessidade.rooms;
    reasons.push("Requisitos do imóvel informados (dormitórios/suítes/vagas/área)");
  }
  necessidade = Math.min(necessidade, WEIGHTS.caps.necessidade);

  /* ----------------------------------------------------------- prontidão */
  let prontidao = 0;
  if (p.timeframe === "imediato") {
    prontidao += WEIGHTS.prontidao.timeframeImediato;
    reasons.push("Quer resolver de imediato");
  } else if (p.timeframe === "30_dias") {
    prontidao += WEIGHTS.prontidao.timeframe30;
    reasons.push("Prazo de até 30 dias");
  } else if (p.timeframe === "90_dias") {
    prontidao += WEIGHTS.prontidao.timeframe90;
    reasons.push("Prazo de até 90 dias");
  }
  if (s.wantsVisit) {
    prontidao += WEIGHTS.prontidao.wantsVisit;
    reasons.push("Pediu visita");
  }
  if (s.wantsHuman) {
    prontidao += WEIGHTS.prontidao.wantsHuman;
    reasons.push("Pediu falar com corretor");
  }
  if (s.cashPayment) {
    prontidao += WEIGHTS.prontidao.cashPayment;
    reasons.push("Pagamento à vista");
  }
  if (p.financing === "sim") {
    prontidao += WEIGHTS.prontidao.financingReady;
    reasons.push("Vai usar financiamento");
  }
  if (p.fgts === "sim") {
    prontidao += WEIGHTS.prontidao.fgts;
    reasons.push("Tem FGTS para usar");
  }
  if (p.tradeIn === "sim") {
    prontidao += WEIGHTS.prontidao.tradeIn;
    reasons.push("Tem imóvel para permuta");
  }
  prontidao = Math.min(prontidao, WEIGHTS.caps.prontidao);

  /* --------------------------------------------------------- engajamento */
  let engajamento = 0;
  const messages = Math.max(0, s.messagesCount ?? 0);
  if (messages > 0) {
    engajamento += Math.min(messages, 4) * WEIGHTS.engajamento.perMessage;
    reasons.push(`${messages} mensagem(ns) do cliente`);
  }
  const days = Math.max(0, s.contactDays ?? 0);
  if (days > 1) {
    engajamento += Math.min(days - 1, 2) * WEIGHTS.engajamento.perContactDay;
    reasons.push(`Retornou em ${days} dias diferentes`);
  }
  if (filled(p.contactWindow) || filled(p.contactPreference)) {
    engajamento += WEIGHTS.engajamento.contactWindow;
    reasons.push("Informou como/quando prefere ser contatado");
  }
  engajamento = Math.min(engajamento, WEIGHTS.caps.engajamento);

  /* ---------------------------------------------------------- penalidades */
  let penalidades = 0;
  if (s.justLooking) {
    penalidades += WEIGHTS.penalidades.justLooking;
    reasons.push("Declarou que está só pesquisando");
  }
  if (s.budgetBelowCatalog) {
    penalidades += WEIGHTS.penalidades.budgetBelowCatalog;
    reasons.push("Orçamento abaixo do menor imóvel disponível");
  }
  if (!s.hasPhone) {
    penalidades += WEIGHTS.penalidades.noPhone;
    reasons.push("Sem telefone para contato");
  }
  if (s.invalidContact) {
    penalidades += WEIGHTS.penalidades.invalidContact;
    reasons.push("Contato inválido ou fora do perfil");
  }

  let score = clamp(contato + necessidade + prontidao + engajamento + penalidades, 0, 100);

  /* Piso determinístico: visita pedida + telefone = oportunidade real. */
  if (s.wantsVisit && s.hasPhone && !s.invalidContact && score < WEIGHTS.visitFloor) {
    score = WEIGHTS.visitFloor;
    reasons.push(`Piso aplicado: pediu visita e tem telefone (mínimo ${WEIGHTS.visitFloor})`);
  }

  return {
    score,
    tier: tierOf(score),
    reasons,
    breakdown: { contato, necessidade, prontidao, engajamento, penalidades },
  };
}

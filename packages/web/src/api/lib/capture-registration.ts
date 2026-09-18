/**
 * STATUS DO CADASTRO — eixo novo, paralelo ao funil do Radar.
 *
 * O funil de captação (`capture-rules.ts`: novo_contato → documentacao →
 * validacao → captado) continua intacto e é o trabalho comercial do corretor.
 * Este eixo responde outra pergunta: a FICHA está completa? foi abandonada?
 * pode ser retomada? é possível duplicidade?
 *
 * Por que dois eixos e não um: um cadastro pode estar CONCLUIDO e o funil
 * ainda em `novo_contato`; e um cadastro INCOMPLETO não deve ser "rebaixado"
 * no funil por causa de campo faltando. Misturar os dois perderia informação.
 *
 * Módulo puro: `now` e a lista de candidatos entram por parâmetro.
 */

/* ------------------------------------------------------------- os status */

export const REGISTRATION_STATUSES = [
  "NOVO",
  "EM_ANDAMENTO",
  "INCOMPLETO",
  "CONCLUIDO",
  "EM_ANALISE",
  "PAUSADO",
  "ARQUIVADO",
  "POSSIVEL_DUPLICIDADE",
] as const;
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];

export const REGISTRATION_STATUS_LABEL: Record<RegistrationStatus, string> = {
  NOVO: "Novo",
  EM_ANDAMENTO: "Em andamento",
  INCOMPLETO: "Incompleto",
  CONCLUIDO: "Concluído",
  EM_ANALISE: "Em análise",
  PAUSADO: "Pausado",
  ARQUIVADO: "Arquivado",
  POSSIVEL_DUPLICIDADE: "Possível duplicidade",
};

/** Cor/tom do badge no CRM. */
export const REGISTRATION_STATUS_TONE: Record<RegistrationStatus, "neutral" | "info" | "warn" | "ok" | "danger"> = {
  NOVO: "neutral",
  EM_ANDAMENTO: "info",
  INCOMPLETO: "warn",
  CONCLUIDO: "ok",
  EM_ANALISE: "info",
  PAUSADO: "warn",
  ARQUIVADO: "neutral",
  POSSIVEL_DUPLICIDADE: "danger",
};

export const DEFAULT_REGISTRATION_STATUS: RegistrationStatus = "NOVO";

export function normalizeRegistrationStatus(
  raw: string | null | undefined,
): RegistrationStatus {
  const value = String(raw ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  return (REGISTRATION_STATUSES as readonly string[]).includes(value)
    ? (value as RegistrationStatus)
    : DEFAULT_REGISTRATION_STATUS;
}

/**
 * Status decididos por pessoa. O cálculo automático NUNCA os sobrescreve:
 * se alguém pausou, arquivou, mandou para análise ou marcou duplicidade, só
 * outra ação humana muda isso.
 */
export const MANUAL_REGISTRATION_STATUSES: RegistrationStatus[] = [
  "EM_ANALISE",
  "PAUSADO",
  "ARQUIVADO",
  "POSSIVEL_DUPLICIDADE",
];

export function isManualRegistrationStatus(status: RegistrationStatus): boolean {
  return MANUAL_REGISTRATION_STATUSES.includes(status);
}

/** Status que aceitam retomada do cadastro pelo telefone. */
export const RESUMABLE_REGISTRATION_STATUSES: RegistrationStatus[] = [
  "NOVO",
  "EM_ANDAMENTO",
  "INCOMPLETO",
];

/* ------------------------------------------------------- completude */

/**
 * Campos que definem a ficha mínima de captação.
 *
 * `required: false` conta para o percentual de preenchimento mas não impede o
 * cadastro de ser CONCLUIDO — são os campos que o proprietário costuma não
 * saber de cabeça e que o corretor completa depois.
 */
export const REGISTRATION_FIELDS = [
  { key: "ownerName", label: "Nome do proprietário", required: true },
  { key: "ownerPhone", label: "Telefone", required: true },
  { key: "city", label: "Cidade", required: true },
  { key: "street", label: "Logradouro", required: true },
  { key: "number", label: "Número", required: true },
  { key: "propertyType", label: "Tipo de imóvel", required: true },
  { key: "district", label: "Bairro", required: false },
  { key: "cep", label: "CEP", required: false },
  { key: "ownerEmail", label: "E-mail", required: false },
  { key: "ownerDocument", label: "CPF/CNPJ", required: false },
  { key: "askingPrice", label: "Valor pretendido", required: false },
  { key: "intention", label: "Intenção (venda/locação)", required: false },
] as const;

export type RegistrationFieldKey = (typeof REGISTRATION_FIELDS)[number]["key"];

/** Ficha como ela chega do formulário, do WhatsApp ou do banco. */
export type RegistrationInput = Partial<Record<RegistrationFieldKey, unknown>>;

const filled = (value: unknown): boolean => {
  if (value == null) return false;
  if (typeof value === "number") return Number.isFinite(value) && value > 0;
  if (typeof value === "string") return value.trim().length > 0;
  return true;
};

export type RegistrationCompleteness = {
  /** Campos preenchidos / total considerado. */
  filled: number;
  total: number;
  percent: number;
  /** Obrigatórios que faltam, em ordem de formulário. */
  missingRequired: RegistrationFieldKey[];
  missingRequiredLabels: string[];
  /** Opcionais que faltam. */
  missingOptional: RegistrationFieldKey[];
  /** Todos os obrigatórios preenchidos. */
  complete: boolean;
  /** Ao menos um campo além do telefone foi preenchido. */
  started: boolean;
};

/**
 * Mede a ficha campo a campo. É o que permite o salvamento progressivo:
 * cada campo salvo melhora o percentual sem exigir o formulário inteiro.
 */
export function registrationCompleteness(input: RegistrationInput): RegistrationCompleteness {
  const missingRequired: RegistrationFieldKey[] = [];
  const missingRequiredLabels: string[] = [];
  const missingOptional: RegistrationFieldKey[] = [];
  let count = 0;
  let beyondPhone = 0;

  for (const field of REGISTRATION_FIELDS) {
    const ok = filled(input[field.key]);
    if (ok) {
      count += 1;
      if (field.key !== "ownerPhone") beyondPhone += 1;
    } else if (field.required) {
      missingRequired.push(field.key);
      missingRequiredLabels.push(field.label);
    } else {
      missingOptional.push(field.key);
    }
  }

  const total = REGISTRATION_FIELDS.length;
  return {
    filled: count,
    total,
    percent: Math.round((count / total) * 100),
    missingRequired,
    missingRequiredLabels,
    missingOptional,
    complete: missingRequired.length === 0,
    /* nome sozinho já conta como início: o cadastro começou a ser digitado */
    started: beyondPhone > 0,
  };
}

/* ------------------------------------------------------------ abandono */

/**
 * Tempo sem atividade para a ficha ser considerada ABANDONADA e passar de
 * EM_ANDAMENTO para INCOMPLETO. Nada é apagado: só muda o rótulo, para que o
 * corretor veja o que precisa de retomada.
 */
export const ABANDON_AFTER_HOURS = 24;

const HOUR_MS = 3_600_000;

export function hoursSince(from: Date | null | undefined, now: Date): number | null {
  if (!from) return null;
  return (now.getTime() - from.getTime()) / HOUR_MS;
}

export function isAbandoned(
  lastActivityAt: Date | null | undefined,
  now: Date,
  hours = ABANDON_AFTER_HOURS,
): boolean {
  const elapsed = hoursSince(lastActivityAt, now);
  return elapsed != null && elapsed >= hours;
}

/* ------------------------------------------------- cálculo do status */

export type RegistrationContext = {
  /** Status atual gravado (respeitado quando for decisão humana). */
  current?: string | null;
  /** Última vez que qualquer campo desta ficha foi salvo. */
  lastActivityAt?: Date | null;
  /** Alerta de duplicidade levantado pela comparação de endereço/proprietário. */
  possibleDuplicate?: boolean;
};

export type RegistrationDecision = {
  status: RegistrationStatus;
  label: string;
  reason: string;
  completeness: RegistrationCompleteness;
  /** `true` quando o status atual é humano e foi preservado. */
  locked: boolean;
};

/**
 * Deriva o status do cadastro a partir da ficha.
 *
 * Ordem das regras:
 *  1. status humano (PAUSADO/ARQUIVADO/EM_ANALISE/POSSIVEL_DUPLICIDADE) manda;
 *  2. alerta de duplicidade vira POSSIVEL_DUPLICIDADE — revisão humana,
 *     jamais exclusão automática;
 *  3. obrigatórios completos → CONCLUIDO;
 *  4. nada preenchido além do telefone → NOVO;
 *  5. atividade recente → EM_ANDAMENTO; sem atividade há
 *     `ABANDON_AFTER_HOURS` → INCOMPLETO.
 */
export function deriveRegistrationStatus(
  input: RegistrationInput,
  context: RegistrationContext = {},
  now: Date = new Date(),
): RegistrationDecision {
  const completeness = registrationCompleteness(input);
  const current = context.current ? normalizeRegistrationStatus(context.current) : null;

  if (current && isManualRegistrationStatus(current)) {
    return {
      status: current,
      label: REGISTRATION_STATUS_LABEL[current],
      reason: `Status definido manualmente (${REGISTRATION_STATUS_LABEL[current]}) — preservado.`,
      completeness,
      locked: true,
    };
  }

  if (context.possibleDuplicate) {
    return {
      status: "POSSIVEL_DUPLICIDADE",
      label: REGISTRATION_STATUS_LABEL.POSSIVEL_DUPLICIDADE,
      reason: "Endereço/unidade já consta em outro cadastro. Marcado para revisão humana — nenhum registro é excluído.",
      completeness,
      locked: false,
    };
  }

  if (completeness.complete) {
    return {
      status: "CONCLUIDO",
      label: REGISTRATION_STATUS_LABEL.CONCLUIDO,
      reason: "Todos os campos obrigatórios da ficha estão preenchidos.",
      completeness,
      locked: false,
    };
  }

  if (!completeness.started) {
    return {
      status: "NOVO",
      label: REGISTRATION_STATUS_LABEL.NOVO,
      reason: "Contato criado, ficha ainda não iniciada.",
      completeness,
      locked: false,
    };
  }

  if (isAbandoned(context.lastActivityAt ?? null, now)) {
    return {
      status: "INCOMPLETO",
      label: REGISTRATION_STATUS_LABEL.INCOMPLETO,
      reason: `Ficha parada há mais de ${ABANDON_AFTER_HOURS}h. Falta: ${completeness.missingRequiredLabels.join(", ")}.`,
      completeness,
      locked: false,
    };
  }

  return {
    status: "EM_ANDAMENTO",
    label: REGISTRATION_STATUS_LABEL.EM_ANDAMENTO,
    reason: `Preenchimento em curso (${completeness.percent}%). Falta: ${completeness.missingRequiredLabels.join(", ")}.`,
    completeness,
    locked: false,
  };
}

/* --------------------------------------------------------- retomada */

/** Cadastro candidato a retomada, como lido do banco. */
export interface ResumeCandidate {
  id: number;
  ownerId: number;
  registrationStatus?: string | null;
  /** Funil do Radar — `perdido`/`captado` não são retomados como ficha. */
  stage?: string | null;
  unitKey?: string | null;
  /** Identidade por endereço escrito (`capture-address.ts#addressKey`). */
  addressKey?: string | null;
  updatedAt?: Date | null;
  createdAt?: Date | null;
}

export type ResumeDecision =
  | {
      action: "resume";
      captureId: number;
      status: RegistrationStatus;
      reason: string;
      message: string;
    }
  | {
      action: "new";
      captureId: null;
      status: null;
      reason: string;
      message: string;
    };

const activityOf = (row: ResumeCandidate): number =>
  (row.updatedAt ?? row.createdAt ?? new Date(0)).getTime();

/**
 * Cadastro pendente do MESMO proprietário para continuar de onde parou.
 *
 * Chega aqui já filtrado por proprietário (telefone = identidade, ver
 * `owner-identity.ts`). Quando o endereço informado coincide com um cadastro
 * pendente, é ele que é retomado; sem endereço informado, retoma o pendente
 * mais recente — é o caso do proprietário que volta no WhatsApp dizendo
 * "quero continuar".
 *
 * Nunca retoma ficha CONCLUIDA: aí o certo é um imóvel novo (item 4 do
 * pedido — vários imóveis por proprietário).
 */
export function findResumableCapture(
  candidates: ResumeCandidate[],
  target: { unitKey?: string | null; addressKey?: string | null } = {},
): ResumeCandidate | null {
  const pending = candidates
    .filter((row) => {
      const status = normalizeRegistrationStatus(row.registrationStatus);
      if (!RESUMABLE_REGISTRATION_STATUSES.includes(status)) return false;
      const stage = String(row.stage ?? "").trim();
      return stage !== "perdido" && stage !== "captado";
    })
    .sort((a, b) => activityOf(b) - activityOf(a));

  if (!pending.length) return null;

  const wantedUnit = String(target.unitKey ?? "").trim();
  const wantedAddress = String(target.addressKey ?? "").trim();

  if (wantedUnit) {
    const hit = pending.find((row) => row.unitKey && row.unitKey === wantedUnit);
    if (hit) return hit;
  }
  if (wantedAddress) {
    const hit = pending.find((row) => row.addressKey && row.addressKey === wantedAddress);
    if (hit) return hit;
  }
  /* Sem endereço informado: continuar o último cadastro pendente. */
  if (!wantedUnit && !wantedAddress) return pending[0] ?? null;

  /**
   * Cadastro aberto ANTES de existir endereço.
   *
   * É o caso mais comum do primeiro contato: a pessoa manda só nome e
   * telefone, abandona, e volta depois com o endereço. A ficha pendente não
   * tem chave de imóvel nenhuma, então nenhuma comparação acima podia casar —
   * e sem isto o endereço abriria uma SEGUNDA ficha, deixando a primeira
   * vazia no Radar para sempre. Aqui ela é completada, que é o item 3 do
   * pedido: continuar de onde parou, sem duplicar.
   */
  const semEndereco = pending.find((row) => !hasAddressIdentity(row));
  if (semEndereco) return semEndereco;

  /* Endereço informado é de outro imóvel: cadastro novo, sem duplicar contato. */
  return null;
}

/**
 * `true` quando a ficha já tem alguma identidade de imóvel gravada.
 *
 * `unitKey` de uma ficha sem CEP, sem logradouro e sem número sai degenerada
 * (`st:|ct:cidade|n:`): cidade sozinha não identifica imóvel, então uma chave
 * assim conta como ausência de endereço.
 */
export function hasAddressIdentity(row: {
  unitKey?: string | null;
  addressKey?: string | null;
}): boolean {
  if (String(row.addressKey ?? "").trim()) return true;
  const unit = String(row.unitKey ?? "").trim();
  if (!unit) return false;
  return unit
    .split("|")
    .some((part) => /^(cep|st|n):.+$/.test(part));
}

/**
 * Decisão completa de retomada, com o texto que a tela/IA mostra.
 */
export function resolveResume(
  candidates: ResumeCandidate[],
  target: { unitKey?: string | null; addressKey?: string | null } = {},
): ResumeDecision {
  const hit = findResumableCapture(candidates, target);
  if (!hit) {
    return {
      action: "new",
      captureId: null,
      status: null,
      reason: "Nenhum cadastro pendente compatível para este proprietário.",
      message: "Vamos iniciar o cadastro deste imóvel.",
    };
  }
  const status = normalizeRegistrationStatus(hit.registrationStatus);
  return {
    action: "resume",
    captureId: hit.id,
    status,
    reason: `Cadastro #${hit.id} está ${REGISTRATION_STATUS_LABEL[status]} e pertence a este proprietário.`,
    message: `Retomando o cadastro #${hit.id} de onde parou — nada do que já foi informado é perdido.`,
  };
}

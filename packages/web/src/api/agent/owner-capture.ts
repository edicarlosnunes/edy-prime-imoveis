/**
 * CAPTAÇÃO PELO AGENTE DE IA — conversa e persistência progressiva.
 *
 * Este módulo é só a lógica do agente: o roteiro de perguntas, o estado do
 * cadastro e as ferramentas que gravam cada resposta. Nada de CRM novo, nada
 * de schema novo, nada de tela nova.
 *
 * Toda a gravação passa pela estrutura que já existe:
 *  - identidade do proprietário e retomada: `lib/owner-intake.ts#intakeOwner`
 *    (telefone = identidade, campo vazio recebe valor, campo preenchido nunca
 *    é apagado, unidade repetida não duplica ficha);
 *  - status/completude da ficha: `lib/capture-registration.ts`;
 *  - qualificação do imóvel (dormitórios, suítes, vagas, ocupação, fotos...):
 *    bloco estruturado no fim de `property_captures.notes`, exatamente o mesmo
 *    recurso que `lib/capture-checklist.ts` já usa para o checklist de
 *    documentos — `property_captures` não tem coluna para esses campos e criar
 *    coluna está fora do escopo.
 *
 * Limites duros:
 *  - o telefone vem do WhatsApp e NUNCA é perguntado;
 *  - uma pergunta por vez, na ordem do roteiro, sem repetir o que já foi dito;
 *  - nada é inventado: só entra na ficha o que o proprietário respondeu;
 *  - humano no controle (`conversations.mode = humano`) e a IA não fala — essa
 *    trava é de `lib/inbox.ts#aiTurn` e continua sendo a única.
 */
import { and, eq, isNull } from "drizzle-orm";
import { tool } from "ai";
import { z } from "zod";
import * as schema from "../database/schema";
import type { AdminDb } from "../lib/admin-base";
import {
  addressKey,
  buildingKey,
  formatUnitAddress,
  unitKey,
  type Complements,
} from "../lib/capture-address";
import {
  cleanComplements,
  findDuplicateUnit,
  parseComplements,
  serializeComplements,
} from "../lib/capture-intake";
import { isBlank } from "../lib/capture-merge";
import {
  deriveRegistrationStatus,
  hasAddressIdentity,
  findResumableCapture,
  normalizeRegistrationStatus,
  REGISTRATION_STATUS_LABEL,
  type RegistrationStatus,
} from "../lib/capture-registration";
import { findOwnerByPhone, ownerPhoneKey } from "../lib/owner-identity";
import { intakeOwner } from "../lib/owner-intake";

/* --------------------------------------------------------------- roteiro */

/**
 * O roteiro, na ordem exigida: nome → endereço → documentação → qualificação.
 *
 * `verbatim: true` marca as perguntas cujo texto é fixo e não pode ser
 * reescrito pelo modelo. As demais têm texto de referência: o tom pode variar,
 * o conteúdo e a ordem não.
 *
 * `store` diz onde a resposta é gravada:
 *  - `owner`   → tabela `owners` (nome);
 *  - `capture` → coluna própria em `property_captures`;
 *  - `bloco`   → bloco estruturado nas observações da ficha.
 */
export const CAPTURE_STEPS = [
  {
    key: "nome",
    label: "Nome completo",
    store: "owner",
    verbatim: true,
    question: "Olá! Seja bem-vindo à Edy Prime Imóveis. Para começarmos, qual é o seu nome completo?",
  },
  {
    key: "endereco",
    label: "Endereço completo",
    store: "capture",
    verbatim: true,
    question: "Qual é o endereço completo do imóvel que você deseja cadastrar?",
  },
  {
    key: "documentacao",
    label: "Imóvel registrado em nome do proprietário",
    store: "bloco",
    verbatim: true,
    question: "O imóvel está registrado em seu nome?",
    complement:
      "Essa informação nos ajuda a entender a situação documental e direcionar corretamente o atendimento.",
  },
  {
    key: "tipo",
    label: "Tipo de imóvel",
    store: "capture",
    question: "Que tipo de imóvel é esse? (apartamento, casa, terreno, sala comercial, outro)",
  },
  {
    key: "negociacao",
    label: "Negociação",
    store: "capture",
    question: "Você pretende vender ou alugar esse imóvel?",
  },
  { key: "dormitorios", label: "Dormitórios", store: "bloco", question: "Quantos dormitórios o imóvel tem?" },
  { key: "suites", label: "Suítes", store: "bloco", question: "Desses dormitórios, quantos são suítes?" },
  { key: "banheiros", label: "Banheiros", store: "bloco", question: "Quantos banheiros no total?" },
  { key: "vagas", label: "Vagas de garagem", store: "bloco", question: "Quantas vagas de garagem?" },
  {
    key: "metragem",
    label: "Metragem",
    store: "bloco",
    question: "Qual é a metragem do imóvel (área útil em m²)?",
  },
  {
    key: "custos",
    label: "Condomínio e IPTU",
    store: "bloco",
    question: "Quais são os valores de condomínio e de IPTU?",
  },
  {
    key: "valor",
    label: "Valor pretendido",
    store: "capture",
    question: "Qual é o valor pretendido para o imóvel?",
  },
  {
    key: "caracteristicas",
    label: "Características e diferenciais",
    store: "bloco",
    question: "Quais são as principais características e diferenciais do imóvel?",
  },
  {
    key: "ocupacao",
    label: "Ocupação",
    store: "bloco",
    question: "Hoje o imóvel está ocupado, alugado ou vago?",
  },
  {
    key: "fotos",
    label: "Fotos",
    store: "bloco",
    question: "Você tem fotos do imóvel para nos enviar?",
  },
  {
    key: "disponibilidade",
    label: "Disponibilidade para visita",
    store: "bloco",
    question: "Qual é o melhor dia e horário para nossa equipe visitar o imóvel?",
  },
] as const;

export type CaptureStepKey = (typeof CAPTURE_STEPS)[number]["key"];
export type CaptureStep = (typeof CAPTURE_STEPS)[number];

/** Passos gravados no bloco estruturado das observações. */
const BLOCK_STEPS = CAPTURE_STEPS.filter((step) => step.store === "bloco");
type BlockStepKey = (typeof BLOCK_STEPS)[number]["key"];
const BLOCK_KEYS = BLOCK_STEPS.map((step) => step.key) as readonly string[];

/**
 * Campos que moram no MESMO bloco das observações, mas não são perguntas do
 * roteiro do WhatsApp.
 *
 * Existem porque o fluxo LINK_CAPTACAO (`agent/link-captacao.ts`) pergunta
 * coisas que o roteiro do WhatsApp não pergunta — condomínio/unidade e a foto
 * da frente — e porque a origem real do cadastro precisa ficar gravada na
 * ficha. Fichas antigas podem continuar como `manual`, com a origem original
 * preservada neste bloco para o filtro legado do CRM.
 *
 * Nada aqui entra em `CAPTURE_STEPS`: o roteiro do WhatsApp continua com as
 * mesmas perguntas, na mesma ordem.
 */
const EXTRA_BLOCK_FIELDS = [
  { key: "origem", label: "Origem do cadastro" },
  { key: "condominio", label: "Condomínio e unidade" },
  { key: "fotoFrente", label: "Foto da frente" },
  { key: "valorPretendidoStatus", label: "Valor pretendido - situação" },
  { key: "observacaoFinal", label: "Informação adicional do proprietário" },
  { key: "confirmacaoFinal", label: "Confirmação final" },
] as const;

/** Vocabulário completo do bloco: roteiro do WhatsApp + campos do link. */
export const BLOCK_FIELDS = [
  ...BLOCK_STEPS.map((step) => ({ key: step.key, label: step.label })),
  ...EXTRA_BLOCK_FIELDS,
] as readonly { key: string; label: string }[];

type ExtraBlockKey = (typeof EXTRA_BLOCK_FIELDS)[number]["key"];
type BlockFieldKey = BlockStepKey | ExtraBlockKey;

const stepOf = (key: CaptureStepKey): CaptureStep =>
  CAPTURE_STEPS.find((step) => step.key === key)!;

/** Imóveis sem condomínio: a pergunta de custos vira só IPTU. */
const NO_CONDO = ["terreno", "casa", "chacara", "sitio", "galpao", "area"];

/**
 * Texto exato da pergunta de um passo.
 *
 * As três primeiras são fixas por exigência do cliente. `custos` é a única que
 * se adapta, porque condomínio só existe onde há condomínio.
 */
export function captureQuestion(key: CaptureStepKey, propertyType?: string | null): string {
  const step = stepOf(key);
  if (key === "custos") {
    const type = String(propertyType ?? "").toLowerCase();
    return NO_CONDO.some((word) => type.includes(word))
      ? "Qual é o valor do IPTU do imóvel?"
      : step.question;
  }
  const complement = "complement" in step ? step.complement : null;
  return complement ? `${step.question}\n\n${complement}` : step.question;
}

/* ------------------------------------- bloco estruturado nas observações */

const BLOCK_OPEN = "[captacao-ia]";
const BLOCK_CLOSE = "[/captacao-ia]";

const labelKey = (raw: string) =>
  raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

const LABEL_TO_KEY = new Map<string, BlockFieldKey>(
  BLOCK_FIELDS.map((field) => [labelKey(field.label), field.key as BlockFieldKey]),
);

/** Uma linha só, sem quebras e sem os delimitadores do bloco. */
const sanitize = (value: string) =>
  value
    .replace(/[\r\n]+/g, " ")
    .replace(/\[\/?captacao-ia\]/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);

export type CaptureAnswers = Partial<Record<BlockFieldKey, string>>;

/**
 * Separa o texto livre das observações do bloco da IA.
 *
 * O texto do corretor nunca é perdido: sai inteiro em `text`, na ordem
 * original. Bloco malformado (aberto e não fechado) é lido até o fim.
 */
export function parseCaptureBlock(notes: string | null | undefined): {
  text: string;
  answers: CaptureAnswers;
} {
  if (!notes) return { text: "", answers: {} };
  const kept: string[] = [];
  const answers: CaptureAnswers = {};
  let inside = false;
  for (const line of notes.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.toLowerCase() === BLOCK_OPEN) {
      inside = true;
      continue;
    }
    if (trimmed.toLowerCase() === BLOCK_CLOSE) {
      inside = false;
      continue;
    }
    if (!inside) {
      kept.push(line);
      continue;
    }
    const match = /^[-•\s]*([^:]{2,80}):\s*(.*)$/.exec(trimmed);
    if (!match) continue;
    const key = LABEL_TO_KEY.get(labelKey(match[1] ?? ""));
    const value = sanitize(match[2] ?? "");
    if (key && value) answers[key] = value;
  }
  return { text: kept.join("\n").trim(), answers };
}

/** Recompõe as observações com o bloco no fim. Sem respostas, sem bloco. */
export function serializeCaptureBlock(
  text: string | null | undefined,
  answers: CaptureAnswers,
): string | null {
  const body = (text ?? "").trim();
  const lines = BLOCK_FIELDS.filter(
    (field) => !isBlank(answers[field.key as BlockFieldKey]),
  ).map((field) => `- ${field.label}: ${sanitize(String(answers[field.key as BlockFieldKey]))}`);
  if (!lines.length) return body.length > 0 ? body : null;
  const block = [BLOCK_OPEN, ...lines, BLOCK_CLOSE].join("\n");
  return (body.length > 0 ? `${body}\n\n${block}` : block).slice(0, 4000);
}

/* ---------------------------------------------------- estado do cadastro */

export interface CaptureSnapshot {
  /** Telefone do WhatsApp — identidade do proprietário. */
  phone: string | null;
  ownerId: number | null;
  ownerName: string | null;
  /** Ficha em andamento (ou a última concluída, quando não há pendente). */
  captureId: number | null;
  /** `true` quando a ficha aberta ainda pode ser continuada. */
  pending: boolean;
  registrationStatus: RegistrationStatus | null;
  completeness: number;
  address: string | null;
  propertyType: string | null;
  intention: string | null;
  askingPrice: number | null;
  answers: CaptureAnswers;
  answered: CaptureStepKey[];
  nextStep: CaptureStepKey | null;
  nextQuestion: string | null;
  /** Roteiro inteiro respondido. */
  complete: boolean;
  duplicateNote: string | null;
  outsidePriorityArea: boolean;
}

const EMPTY_SNAPSHOT: CaptureSnapshot = {
  phone: null,
  ownerId: null,
  ownerName: null,
  captureId: null,
  pending: false,
  registrationStatus: null,
  completeness: 0,
  address: null,
  propertyType: null,
  intention: null,
  askingPrice: null,
  answers: {},
  answered: [],
  nextStep: "nome",
  nextQuestion: captureQuestion("nome"),
  complete: false,
  duplicateNote: null,
  outsidePriorityArea: false,
};

/** Passos já respondidos, lidos do que está GRAVADO — nunca da conversa. */
function answeredSteps(input: {
  ownerName: string | null;
  capture: typeof schema.propertyCaptures.$inferSelect | null;
  answers: CaptureAnswers;
}): CaptureStepKey[] {
  const done: CaptureStepKey[] = [];
  if (!isBlank(input.ownerName)) done.push("nome");
  const capture = input.capture;
  if (capture && hasAddressIdentity(capture)) done.push("endereco");
  if (capture && !isBlank(capture.propertyType)) done.push("tipo");
  if (capture && !isBlank(capture.intention)) done.push("negociacao");
  if (capture && !isBlank(capture.askingPrice)) done.push("valor");
  for (const step of BLOCK_STEPS) {
    if (!isBlank(input.answers[step.key])) done.push(step.key);
  }
  return CAPTURE_STEPS.filter((step) => done.includes(step.key)).map((step) => step.key);
}

/** Primeiro passo do roteiro ainda não respondido. */
export function nextCaptureStep(answered: readonly CaptureStepKey[]): CaptureStepKey | null {
  return CAPTURE_STEPS.find((step) => !answered.includes(step.key))?.key ?? null;
}

/**
 * Estado do cadastro deste telefone, direto do banco.
 *
 * É daqui que sai "retomar de onde parou" e "não repetir o que já foi
 * informado": o roteiro não guarda memória de conversa, ele lê a ficha.
 */
export async function captureSnapshot(
  db: AdminDb,
  phone: string | null,
  preferredCaptureId: number | null = null,
): Promise<CaptureSnapshot> {
  const key = ownerPhoneKey(phone);
  if (!key) return { ...EMPTY_SNAPSHOT };

  const owners = await db.select().from(schema.owners).limit(500);
  const owner = findOwnerByPhone(owners, key);
  if (!owner) return { ...EMPTY_SNAPSHOT, phone };

  const captures = await db
    .select()
    .from(schema.propertyCaptures)
    .where(eq(schema.propertyCaptures.ownerId, owner.id))
    .limit(200);

  const resumable = findResumableCapture(captures);
  const latest = [...captures].sort(
    (a, b) =>
      (b.updatedAt ?? b.createdAt ?? new Date(0)).getTime() -
      (a.updatedAt ?? a.createdAt ?? new Date(0)).getTime(),
  )[0];
  const target =
    (preferredCaptureId !== null ? captures.find((row) => row.id === preferredCaptureId) : null) ??
    (resumable ? captures.find((row) => row.id === resumable.id) : null) ?? latest ?? null;

  const { answers } = parseCaptureBlock(target?.notes ?? null);
  const ownerName = isBlank(owner.name) || owner.name === "Proprietário sem nome" ? null : owner.name!;
  const answered = answeredSteps({ ownerName, capture: target ?? null, answers });
  const nextStep = nextCaptureStep(answered);

  return {
    phone,
    ownerId: owner.id,
    ownerName,
    captureId: target?.id ?? null,
    pending: Boolean(resumable),
    registrationStatus: target ? normalizeRegistrationStatus(target.registrationStatus) : null,
    completeness: target?.completeness ?? 0,
    address: target?.address ?? null,
    propertyType: target?.propertyType ?? null,
    intention: target?.intention ?? null,
    askingPrice: target?.askingPrice ?? null,
    answers,
    answered,
    nextStep,
    nextQuestion: nextStep ? captureQuestion(nextStep, target?.propertyType ?? null) : null,
    complete: nextStep === null,
    duplicateNote: target?.duplicateNote ?? null,
    outsidePriorityArea: (target?.outsidePriorityArea ?? 0) === 1,
  };
}

/* A sessão do link fica nas observações do contato, sem tabela ou ficha vazia.
   O identificador da ficha ativa evita escolher outra após uma edição no CRM. */
const LINK_ADDRESS_MARKER = /(?:\r?\n){0,2}\[LINK_CAPTACAO_AGUARDANDO_ENDERECO:(\d{13})\]/g;
const LINK_ACTIVE_MARKER = /(?:\r?\n){0,2}\[LINK_CAPTACAO_FICHA_ATIVA:(\d+):(\d{13})\]/g;
const LINK_ADDRESS_SESSION_MS = 30 * 24 * 60 * 60 * 1000;

function markerIsCurrent(stamp: string): boolean {
  const age = Date.now() - Number(stamp);
  return age >= 0 && age <= LINK_ADDRESS_SESSION_MS;
}

function withoutLinkMarkers(notes: string | null): string | null {
  return notes?.replace(LINK_ADDRESS_MARKER, "").replace(LINK_ACTIVE_MARKER, "") || null;
}

/** A condição no UPDATE impede apagar observações editadas pela equipe entre leitura e gravação. */
async function updateOwnerLinkNotes(
  db: AdminDb,
  ownerId: number,
  change: (notes: string | null) => string | null,
  name?: string,
): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const [owner] = await db.select({ notes: schema.owners.notes })
      .from(schema.owners).where(eq(schema.owners.id, ownerId)).limit(1);
    if (!owner) throw new Error("Contato não encontrado para atualizar a sessão de captação.");
    const [updated] = await db.update(schema.owners)
      .set({ notes: change(owner.notes), ...(name ? { name } : {}) })
      .where(and(
        eq(schema.owners.id, ownerId),
        owner.notes === null ? isNull(schema.owners.notes) : eq(schema.owners.notes, owner.notes),
      ))
      .returning({ id: schema.owners.id });
    if (updated) return;
  }
  throw new Error("Observações alteradas simultaneamente; captação não foi atualizada.");
}

export async function linkCaptureSession(
  db: AdminDb,
  ownerId: number | null,
): Promise<{ awaitingAddress: boolean; activeCaptureId: number | null }> {
  if (ownerId === null) return { awaitingAddress: false, activeCaptureId: null };
  const [owner] = await db.select({ notes: schema.owners.notes })
    .from(schema.owners).where(eq(schema.owners.id, ownerId)).limit(1);
  const notes = owner?.notes ?? "";
  const pending = [...notes.matchAll(LINK_ADDRESS_MARKER)].at(-1);
  const active = [...notes.matchAll(LINK_ACTIVE_MARKER)].at(-1);
  if ((pending && !markerIsCurrent(pending[1]!)) || (active && !markerIsCurrent(active[2]!))) {
    await updateOwnerLinkNotes(db, ownerId, (current) =>
      current?.replace(LINK_ADDRESS_MARKER, (match, stamp: string) => markerIsCurrent(stamp) ? match : "")
        .replace(LINK_ACTIVE_MARKER, (match, _id: string, stamp: string) => markerIsCurrent(stamp) ? match : "") || null,
    );
  }
  let activeCaptureId = active && markerIsCurrent(active[2]!) ? Number(active[1]) : null;
  if (activeCaptureId !== null) {
    const [capture] = await db.select({ id: schema.propertyCaptures.id })
      .from(schema.propertyCaptures)
      .where(and(eq(schema.propertyCaptures.id, activeCaptureId), eq(schema.propertyCaptures.ownerId, ownerId)))
      .limit(1);
    if (!capture) activeCaptureId = null;
  }
  return { awaitingAddress: Boolean(pending && markerIsCurrent(pending[1]!)), activeCaptureId };
}

/* ------------------------------------------------------------ gravação */

export interface CaptureAnswerInput {
  phone: string | null;
  nome?: string | null;
  cep?: string | null;
  rua?: string | null;
  numero?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  estado?: string | null;
  unidade?: string | null;
  bloco?: string | null;
  torre?: string | null;
  andar?: string | null;
  complemento?: string | null;
  tipoImovel?: string | null;
  negociacao?: string | null;
  valorPretendido?: number | null;
  /* respostas do bloco estruturado */
  documentacao?: string | null;
  dormitorios?: string | null;
  suites?: string | null;
  banheiros?: string | null;
  vagas?: string | null;
  metragem?: string | null;
  custos?: string | null;
  caracteristicas?: string | null;
  ocupacao?: string | null;
  fotos?: string | null;
  disponibilidade?: string | null;
  /* campos do bloco que não são perguntas do roteiro do WhatsApp */
  origem?: string | null;
  condominio?: string | null;
  fotoFrente?: string | null;
  valorPretendidoStatus?: string | null;
  observacaoFinal?: string | null;
  confirmacaoFinal?: string | null;
  /** informação espontânea, fora da pergunta atual */
  observacao?: string | null;
  /** proprietário quer cadastrar OUTRO imóvel */
  novoImovel?: boolean;
  /** Entrada explícita do Link: só o endereço decide qual ficha usar. */
  novaSessaoLink?: boolean;
  /** Ficha vinculada à sessão ativa do link; nunca aceitar id de outro contato. */
  targetCaptureId?: number;
}

export type CaptureSaveResult =
  | { saved: false; reason: string; snapshot: CaptureSnapshot }
  | {
      saved: true;
      captureId: number | null;
      resumed: boolean;
      duplicateUnit: string | null;
      detail: string;
      snapshot: CaptureSnapshot;
    };

const clean = (value: unknown, max = 200): string | null => {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text.slice(0, max) : null;
};

/** Normaliza a resposta de negociação para o vocabulário da ficha. */
function normalizeIntention(raw: string | null | undefined): string | null {
  const value = labelKey(String(raw ?? ""));
  if (!value) return null;
  if (/alug|loca/.test(value)) return "locacao";
  if (/vend/.test(value)) return "venda";
  if (/amb|dois|os dois/.test(value)) return "venda_locacao";
  return clean(raw, 120);
}

const nowStamp = (now: Date) => now.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

/**
 * Grava uma resposta do proprietário na hora, campo a campo.
 *
 * Endereço, tipo, valor e nome vão pela entrada única (`intakeOwner`), que é
 * quem sabe reaproveitar contato, retomar ficha pendente e não duplicar
 * unidade. Documentação e qualificação vão para o bloco estruturado das
 * observações da ficha.
 */
export async function saveCaptureAnswer(
  db: AdminDb,
  input: CaptureAnswerInput,
): Promise<CaptureSaveResult> {
  const before = await captureSnapshot(db, input.phone, input.targetCaptureId ?? null);

  if (!ownerPhoneKey(input.phone)) {
    return {
      saved: false,
      reason:
        "Sem telefone do contato não é possível gravar a captação (o telefone é a identidade do proprietário). Peça atendimento humano.",
      snapshot: before,
    };
  }

  if (input.targetCaptureId !== undefined && before.captureId !== input.targetCaptureId) {
    return {
      saved: false,
      reason: "A ficha desta sessão não pertence ao contato ou não está disponível. Reabra o link de captação.",
      snapshot: before,
    };
  }

  const name = clean(input.nome, 120) ?? before.ownerName;
  if (!name) {
    return {
      saved: false,
      reason: "O nome completo do proprietário ainda não foi informado. Faça a pergunta do nome antes de gravar.",
      snapshot: before,
    };
  }

  /* Um imóvel por vez: enquanto a ficha atual estiver incompleta, não se abre
     outra. Continuar a pendente é o comportamento correto. */
  if (input.novoImovel && !input.novaSessaoLink && before.pending && !before.complete) {
    return {
      saved: false,
      reason: `O cadastro #${before.captureId} deste proprietário ainda está incompleto. Continue este imóvel antes de iniciar outro.`,
      snapshot: before,
    };
  }

  const complements: Complements = {};
  if (clean(input.unidade, 60)) complements.unit = clean(input.unidade, 60);
  if (clean(input.bloco, 60)) complements.block = clean(input.bloco, 60);
  if (clean(input.torre, 60)) complements.tower = clean(input.torre, 60);
  if (clean(input.andar, 60)) complements.floor = clean(input.andar, 60);
  if (clean(input.complemento, 60)) complements.complement = clean(input.complemento, 60);

  const askingPrice =
    typeof input.valorPretendido === "number" && Number.isFinite(input.valorPretendido) && input.valorPretendido > 0
      ? input.valorPretendido
      : null;

  /**
   * Só endereço (e o primeiro contato) justifica passar pela entrada única.
   *
   * É ela que resolve identidade de imóvel: retomar ficha pendente, avisar
   * unidade repetida, abrir o segundo imóvel do mesmo proprietário. Tipo e
   * valor pretendido NÃO entram nessa conta: num envio sem endereço as chaves
   * derivadas (`unitKey`/`addressKey`) nascem degeneradas, não casam com as da
   * ficha que já existe e a retomada por chave abriria uma SEGUNDA ficha para
   * o mesmo imóvel. Esses campos são gravados direto na ficha em andamento.
   *
   * Complemento SOZINHO (unidade, bloco, torre, andar) também não passa por
   * ela, pelo mesmo motivo: no roteiro do link a unidade chega num turno
   * próprio, depois do endereço. Ele vai por `attachComplements`, que anexa a
   * unidade à ficha em andamento.
   */
  const addressCore =
    clean(input.cep, 20) !== null ||
    clean(input.rua, 200) !== null ||
    clean(input.numero, 30) !== null ||
    clean(input.bairro, 120) !== null ||
    clean(input.cidade, 120) !== null ||
    clean(input.estado, 2) !== null;

  let captureId = before.captureId;
  let resumed = false;
  let duplicateUnit: string | null = null;
  let detail = "";

  /* Contato já conhecido: guardar o nome sem criar uma ficha vazia. Na resposta
     seguinte, a entrada única compara o endereço com os imóveis existentes. */
  if (input.novaSessaoLink === true && !addressCore && before.ownerId !== null && clean(input.nome, 120)) {
    const marker = `[LINK_CAPTACAO_AGUARDANDO_ENDERECO:${Date.now()}]`;
    await updateOwnerLinkNotes(db, before.ownerId, (notes) => {
      const previousNotes = withoutLinkMarkers(notes);
      return previousNotes ? `${previousNotes}\n\n${marker}` : marker;
    }, name);
    return {
      saved: true,
      captureId: null,
      resumed: false,
      duplicateUnit: null,
      detail: "Nome do proprietário atualizado; aguardando endereço do imóvel.",
      snapshot: await captureSnapshot(db, input.phone),
    };
  }

  if (addressCore || input.novoImovel || before.ownerId === null || captureId === null) {
    const result = await intakeOwner(db, {
      name,
      phone: input.phone!,
      propertyType: clean(input.tipoImovel, 60),
      neighborhood: clean(input.bairro, 120),
      cep: clean(input.cep, 20),
      street: clean(input.rua, 200),
      number: clean(input.numero, 30),
      city: clean(input.cidade, 120),
      state: clean(input.estado, 2),
      complements: Object.keys(complements).length ? complements : null,
      askingPrice,
      /* Origem mantida separada da negociação: formulário/link/WhatsApp não
         devem ser confundidos com venda ou locação. */
      source: clean(input.origem, 60) ?? "whatsapp",
    });
    captureId = result.captureId ?? captureId;
    resumed = result.resumed;
    duplicateUnit = result.duplicateUnit;
    detail = result.detail;
  } else if (Object.keys(complements).length > 0) {
    const attached = await attachComplements(db, captureId, complements);
    duplicateUnit = attached.duplicateUnit;
    detail = attached.detail;
  }

  /* Campos que a entrada única não carrega (intenção) e tudo que não tem
     coluna própria (documentação e qualificação) — sempre na ficha existente,
     sem criar campo nenhum. */
  const extras = await applyCaptureExtras(db, captureId, {
    intention: normalizeIntention(input.negociacao),
    propertyType: clean(input.tipoImovel, 60),
    askingPrice,
    ownerName: clean(input.nome, 120),
    answers: {
      documentacao: clean(input.documentacao, 300),
      dormitorios: clean(input.dormitorios, 300),
      suites: clean(input.suites, 300),
      banheiros: clean(input.banheiros, 300),
      vagas: clean(input.vagas, 300),
      metragem: clean(input.metragem, 300),
      custos: clean(input.custos, 300),
      caracteristicas: clean(input.caracteristicas, 300),
      ocupacao: clean(input.ocupacao, 300),
      fotos: clean(input.fotos, 300),
      disponibilidade: clean(input.disponibilidade, 300),
      origem: clean(input.origem, 300),
      condominio: clean(input.condominio, 300),
      fotoFrente: clean(input.fotoFrente, 300),
      valorPretendidoStatus: clean(input.valorPretendidoStatus, 300),
      observacaoFinal: clean(input.observacaoFinal, 500),
      confirmacaoFinal: clean(input.confirmacaoFinal, 40),
    },
    observation: clean(input.observacao, 500),
    firstContact: before.captureId === null,
  });

  if (input.novaSessaoLink && addressCore && clean(input.rua, 200) && clean(input.numero, 30) &&
      captureId !== null) {
    const [target] = await db.select({
      ownerId: schema.propertyCaptures.ownerId,
      street: schema.propertyCaptures.street,
      number: schema.propertyCaptures.number,
    })
      .from(schema.propertyCaptures).where(eq(schema.propertyCaptures.id, captureId)).limit(1);
    if (clean(target?.street, 200) && clean(target?.number, 30)) {
      if (before.ownerId !== null && target?.ownerId !== before.ownerId) {
        throw new Error("A ficha de captação não pertence ao contato.");
      }
      const marker = `[LINK_CAPTACAO_FICHA_ATIVA:${captureId}:${Date.now()}]`;
      await updateOwnerLinkNotes(db, target!.ownerId, (notes) => {
        const previousNotes = withoutLinkMarkers(notes);
        return previousNotes ? `${previousNotes}\n\n${marker}` : marker;
      });
    }
  }

  if (captureId !== null &&
      (clean(input.confirmacaoFinal, 40)?.toLowerCase() === "ok" || clean(input.fotoFrente, 300)) &&
      clean(input.origem, 300) === "LINK_CAPTACAO") {
    const [target] = await db.select({ ownerId: schema.propertyCaptures.ownerId })
      .from(schema.propertyCaptures).where(eq(schema.propertyCaptures.id, captureId)).limit(1);
    if (target) {
      await updateOwnerLinkNotes(db, target.ownerId, (notes) =>
        notes?.replace(LINK_ACTIVE_MARKER, (match, id: string) =>
          Number(id) === captureId ? "" : match) || null,
      );
    }
  }

  const after = await captureSnapshot(db, input.phone, captureId);
  return {
    saved: true,
    captureId,
    resumed,
    duplicateUnit,
    detail: [detail, extras].filter(Boolean).join(" "),
    snapshot: after,
  };
}

/**
 * Anexa a unidade (complementos) à ficha em andamento.
 *
 * Existe porque o roteiro do link pergunta condomínio/unidade em turno
 * próprio, DEPOIS do endereço. Nesse envio não vem rua, número nem CEP, e
 * passar por `intakeOwner` abriria uma SEGUNDA ficha: as chaves derivadas de
 * um envio sem endereço nascem degeneradas (`st:|ct:cidade|n:`), não casam com
 * a ficha que já existe e `resolveResume` concluiria "é outro imóvel".
 *
 * As chaves de identidade são recalculadas a partir do endereço que a PRÓPRIA
 * ficha já tem + a unidade que acabou de chegar. É isso que mantém a regra do
 * CRM: apto 163 e apto 205 do mesmo prédio são imóveis distintos, e a mesma
 * unidade informada de novo é reconhecida em vez de duplicada.
 *
 * Unidade que já pertence a OUTRA ficha só gera aviso — nada é bloqueado e
 * nada é movido de ficha, como no resto do CRM.
 */
async function attachComplements(
  db: AdminDb,
  captureId: number,
  complements: Complements,
): Promise<{ duplicateUnit: string | null; detail: string }> {
  const [capture] = await db
    .select()
    .from(schema.propertyCaptures)
    .where(eq(schema.propertyCaptures.id, captureId))
    .limit(1);
  if (!capture) return { duplicateUnit: null, detail: "" };

  const merged = cleanComplements({ ...parseComplements(capture.complements), ...complements });
  const written = {
    cep: capture.cep,
    number: capture.number,
    street: capture.street,
    city: capture.city,
  };

  const keys = {
    unitKey: unitKey(written, merged),
    addressKey: addressKey(written, merged) || null,
    buildingKey: buildingKey(written) || null,
  };

  const rows = await db.select().from(schema.propertyCaptures).limit(1000);
  const duplicate = findDuplicateUnit(
    rows
      .filter((row) => row.id !== captureId)
      .map((row) => ({
        id: row.id,
        ownerId: row.ownerId,
        unitKey: row.unitKey,
        stage: row.stage,
        addressKey: row.addressKey,
        buildingKey: row.buildingKey,
        address: { city: row.city, street: row.street, number: row.number, cep: row.cep },
        complements: parseComplements(row.complements),
      })),
    {
      unitKey: keys.unitKey,
      addressKey: keys.addressKey,
      address: written,
      complements: merged,
      ownerId: capture.ownerId,
    },
  );

  const now = new Date();
  await db
    .update(schema.propertyCaptures)
    .set({
      complements: serializeComplements(merged),
      ...keys,
      address:
        formatUnitAddress(
          {
            cep: capture.cep,
            street: capture.street,
            number: capture.number,
            city: capture.city,
            district: capture.district,
            state: capture.state,
          },
          merged,
        ) || capture.address,
      lastFieldAt: now,
      updatedAt: now,
    })
    .where(eq(schema.propertyCaptures.id, captureId));

  return {
    duplicateUnit: duplicate.duplicate ? duplicate.message : null,
    detail: `Unidade anexada ao cadastro #${captureId}.`,
  };
}

/**
 * Escreve na ficha o que não tem coluna própria.
 *
 * Regras herdadas do CRM, não reinventadas aqui:
 *  - campo vazio recebe valor; valor já gravado só é substituído quando o
 *    proprietário corrige, e a correção fica registrada no histórico;
 *  - status do cadastro é recalculado por `deriveRegistrationStatus`, então
 *    status decidido por pessoa (PAUSADO/ARQUIVADO/...) continua intocado.
 */
async function applyCaptureExtras(
  db: AdminDb,
  captureId: number | null,
  input: {
    intention: string | null;
    propertyType: string | null;
    askingPrice: number | null;
    ownerName: string | null;
    /* `clean()` devolve null para campo ausente, então o vocabulário aceita
       null — quem filtra é o próprio loop de gravação. */
    answers: Partial<Record<BlockFieldKey, string | null>>;
    observation: string | null;
    firstContact: boolean;
  },
): Promise<string> {
  if (!captureId) return "";
  const [capture] = await db
    .select()
    .from(schema.propertyCaptures)
    .where(eq(schema.propertyCaptures.id, captureId))
    .limit(1);
  if (!capture) return "";

  const now = new Date();
  const { text, answers } = parseCaptureBlock(capture.notes);
  const history: string[] = [];
  const saved: string[] = [];

  if (input.firstContact) {
    history.push(`— ${nowStamp(now)} · captação iniciada pelo Agente IA (WhatsApp).`);
  }

  for (const field of BLOCK_FIELDS) {
    const key = field.key as keyof CaptureAnswers;
    const value = input.answers[key];
    if (isBlank(value)) continue;
    const current = answers[key];
    /* Origem do cadastro é imutável: quem entrou pelo link continua sendo
       LINK_CAPTACAO mesmo se voltar depois por outro caminho. */
    if (field.key === "origem" && !isBlank(current)) continue;
    if (!isBlank(current) && current !== value) {
      history.push(
        `— ${nowStamp(now)} · Agente IA: ${field.label} corrigido pelo proprietário de "${current}" para "${value}".`,
      );
    }
    answers[key] = value!;
    saved.push(field.label);
  }

  if (input.observation) {
    history.push(`— ${nowStamp(now)} · Agente IA (informação espontânea): ${input.observation}`);
  }

  const intention = isBlank(capture.intention) ? input.intention : capture.intention;
  if (!isBlank(input.intention) && isBlank(capture.intention)) saved.push("Negociação");

  /* Campo vazio recebe o valor; valor já gravado só é trocado quando o
     proprietário corrige, e a correção fica no histórico da ficha. */
  let propertyType = capture.propertyType;
  if (!isBlank(input.propertyType)) {
    if (isBlank(propertyType)) {
      propertyType = input.propertyType;
      saved.push("Tipo de imóvel");
    } else if (propertyType !== input.propertyType) {
      history.push(
        `— ${nowStamp(now)} · Agente IA: tipo de imóvel corrigido pelo proprietário de "${propertyType}" para "${input.propertyType}".`,
      );
      propertyType = input.propertyType;
      saved.push("Tipo de imóvel");
    }
  }

  let askingPrice = capture.askingPrice;
  if (input.askingPrice !== null) {
    if (isBlank(askingPrice)) {
      askingPrice = input.askingPrice;
      saved.push("Valor pretendido");
    } else if (askingPrice !== input.askingPrice) {
      history.push(
        `— ${nowStamp(now)} · Agente IA: valor pretendido corrigido pelo proprietário de "${askingPrice}" para "${input.askingPrice}".`,
      );
      askingPrice = input.askingPrice;
      saved.push("Valor pretendido");
    }
  }

  const [owner] = await db
    .select()
    .from(schema.owners)
    .where(eq(schema.owners.id, capture.ownerId))
    .limit(1);

  /* Nome corrigido sem endereço no envio: a entrada única não é chamada, então
     o contato é atualizado aqui — mesma coluna, nenhum campo novo. */
  let ownerName: string | null = owner?.name ?? null;
  if (
    !isBlank(input.ownerName) &&
    owner &&
    (isBlank(ownerName) || ownerName === "Proprietário sem nome" || ownerName !== input.ownerName)
  ) {
    if (!isBlank(ownerName) && ownerName !== input.ownerName && ownerName !== "Proprietário sem nome") {
      history.push(
        `— ${nowStamp(now)} · Agente IA: nome do proprietário corrigido de "${ownerName}" para "${input.ownerName}".`,
      );
    }
    ownerName = input.ownerName ?? ownerName;
    await db
      .update(schema.owners)
      .set({ name: input.ownerName! })
      .where(eq(schema.owners.id, owner.id));
    saved.push("Nome do proprietário");
  }

  const notes = serializeCaptureBlock([text, ...history].filter(Boolean).join("\n\n"), answers);

  const decision = deriveRegistrationStatus(
    {
      ownerName,
      ownerPhone: owner?.phone ?? null,
      ownerEmail: owner?.email ?? null,
      ownerDocument: owner?.document ?? null,
      city: capture.city,
      street: capture.street,
      number: capture.number,
      district: capture.district,
      cep: capture.cep,
      propertyType,
      askingPrice,
      intention,
    },
    { current: capture.registrationStatus, lastActivityAt: now },
    now,
  );

  await db
    .update(schema.propertyCaptures)
    .set({
      intention: intention ?? null,
      propertyType: propertyType ?? null,
      askingPrice: askingPrice ?? null,
      notes,
      registrationStatus: decision.status,
      registrationStatusAt: now,
      completeness: decision.completeness.percent,
      lastFieldAt: now,
      updatedAt: now,
    })
    .where(eq(schema.propertyCaptures.id, captureId));

  return saved.length ? `Salvo na ficha #${captureId}: ${saved.join(", ")}.` : "";
}

/* -------------------------------------------------------- prompt da IA */

const answeredList = (snapshot: CaptureSnapshot): string => {
  const lines: string[] = [];
  if (snapshot.ownerName) lines.push(`- Nome: ${snapshot.ownerName}`);
  if (snapshot.address) lines.push(`- Endereço: ${snapshot.address}`);
  if (snapshot.propertyType) lines.push(`- Tipo: ${snapshot.propertyType}`);
  if (snapshot.intention) lines.push(`- Negociação: ${snapshot.intention}`);
  if (snapshot.askingPrice) lines.push(`- Valor pretendido: ${snapshot.askingPrice}`);
  for (const step of BLOCK_STEPS) {
    const value = snapshot.answers[step.key];
    if (value) lines.push(`- ${step.label}: ${value}`);
  }
  return lines.length ? lines.join("\n") : "- (nada informado ainda)";
};

/**
 * Bloco de captação do prompt: roteiro, regras e o estado real da ficha.
 *
 * O estado vem do banco a cada turno — é o que impede a IA de repetir pergunta
 * já respondida e o que faz a retomada funcionar depois de dias parada.
 */
export function captureFlowPrompt(snapshot: CaptureSnapshot): string {
  const roteiro = CAPTURE_STEPS.map((step, index) => {
    const mark = snapshot.answered.includes(step.key) ? "x" : " ";
    return `${index + 1}. [${mark}] ${step.label}`;
  }).join("\n");

  const lines = [
    "CAPTAÇÃO DE IMÓVEL (proprietário que quer vender ou alugar):",
    "Entre neste fluxo quando a pessoa quiser cadastrar, vender ou alugar um imóvel dela, ou quando já existir cadastro em andamento para este contato. Cliente que procura imóvel para comprar/alugar continua no atendimento normal.",
    "",
    "REGRAS DA CAPTAÇÃO:",
    "1. O telefone já vem do WhatsApp. NUNCA pergunte telefone.",
    "2. Uma pergunta por vez, sempre a que estiver em `proximaPergunta`. Use o texto dela como está nas três primeiras perguntas (nome, endereço, documentação).",
    "3. Depois de cada resposta, chame `salvarCadastroImovel` imediatamente, com o que a pessoa acabou de informar. Não espere o fim da conversa.",
    "4. Nunca repita pergunta já respondida no estado abaixo. Nunca invente resposta que o proprietário não deu.",
    "5. Se a pessoa informar algo fora da pergunta atual, grave em `observacao` e volte para a pergunta pendente.",
    "6. Se `salvarCadastroImovel` avisar de unidade/endereço repetido, não abra outro imóvel: siga no cadastro que já existe.",
    "7. Terminado o roteiro, confirme a conclusão e ofereça cadastrar outro imóvel (use `novoImovel: true` só quando o atual estiver concluído).",
    "8. Só chame `pedirAtendimentoHumano` se o proprietário pedir uma pessoa/corretor/atendente ou se surgir assunto de fato jurídico (advogado, inventário, ação judicial, assinatura de contrato). Querer cadastrar/vender/anunciar o imóvel e responder sobre documentação NÃO transferem: siga o roteiro.",
    "",
    "ROTEIRO (x = já respondido):",
    roteiro,
    "",
    `ESTADO DO CADASTRO${snapshot.captureId ? ` (ficha #${snapshot.captureId}` + (snapshot.registrationStatus ? `, ${REGISTRATION_STATUS_LABEL[snapshot.registrationStatus]}, ${snapshot.completeness}% preenchido)` : ")") : " (nenhuma ficha aberta)"}:`,
    answeredList(snapshot),
  ];

  if (snapshot.nextQuestion) {
    lines.push(
      "",
      `PRÓXIMA PERGUNTA (faça só esta agora):`,
      snapshot.nextQuestion,
    );
  } else if (snapshot.captureId) {
    lines.push(
      "",
      "Roteiro completo. Confirme os dados, avise que a equipe dará sequência e pergunte se há outro imóvel para cadastrar.",
    );
  }

  if (snapshot.pending && snapshot.answered.length > 0) {
    lines.push(
      "",
      `Este contato já tinha cadastro em andamento: retome de onde parou, sem pedir de novo o que está no estado acima.`,
    );
  }

  return lines.join("\n");
}

/* ------------------------------------------------------- ferramentas */

/** Ferramentas de captação do agente. Sem telefone, elas se recusam a gravar. */
export function captureTools(db: AdminDb, phone: string | null) {
  return {
    salvarCadastroImovel: tool({
      description:
        "Grava AGORA, na ficha de captação, o que o proprietário acabou de responder. Use depois de cada resposta, com apenas os campos informados. Devolve o estado atualizado do cadastro e a próxima pergunta.",
      inputSchema: z.object({
        nome: z.string().max(120).optional().describe("nome completo do proprietário"),
        cep: z.string().max(20).optional(),
        rua: z.string().max(200).optional().describe("logradouro, sem número"),
        numero: z.string().max(30).optional(),
        bairro: z.string().max(120).optional(),
        cidade: z.string().max(120).optional(),
        estado: z.string().max(2).optional().describe("UF, ex: SP"),
        unidade: z.string().max(60).optional().describe("apartamento/unidade"),
        bloco: z.string().max(60).optional(),
        torre: z.string().max(60).optional(),
        andar: z.string().max(60).optional(),
        complemento: z.string().max(60).optional(),
        tipoImovel: z.string().max(60).optional().describe("apartamento, casa, terreno, sala comercial..."),
        negociacao: z.string().max(60).optional().describe("venda, locação ou ambos"),
        valorPretendido: z.number().min(0).optional().describe("valor pretendido em reais, só números"),
        documentacao: z.string().max(300).optional().describe("resposta sobre o imóvel estar registrado no nome dele"),
        dormitorios: z.string().max(300).optional(),
        suites: z.string().max(300).optional(),
        banheiros: z.string().max(300).optional(),
        vagas: z.string().max(300).optional(),
        metragem: z.string().max(300).optional(),
        custos: z.string().max(300).optional().describe("condomínio e IPTU"),
        caracteristicas: z.string().max(300).optional(),
        ocupacao: z.string().max(300).optional().describe("ocupado, alugado ou vago"),
        fotos: z.string().max(300).optional().describe("se tem fotos e vai enviar"),
        disponibilidade: z.string().max(300).optional().describe("melhor dia/horário para visita"),
        observacao: z.string().max(500).optional().describe("informação espontânea, fora da pergunta atual"),
        novoImovel: z.boolean().optional().describe("true só quando o cadastro atual já está concluído e o proprietário quer cadastrar outro imóvel"),
      }),
      async execute(input) {
        const result = await saveCaptureAnswer(db, { ...input, phone });
        if (!result.saved) {
          return { salvo: false, motivo: result.reason, proximaPergunta: result.snapshot.nextQuestion };
        }
        return {
          salvo: true,
          cadastroId: result.captureId,
          retomado: result.resumed,
          aviso: result.duplicateUnit,
          detalhe: result.detail,
          statusCadastro: result.snapshot.registrationStatus,
          completude: result.snapshot.completeness,
          respondido: result.snapshot.answered,
          proximaPergunta: result.snapshot.nextQuestion,
          roteiroConcluido: result.snapshot.complete,
        };
      },
    }),

    consultarCadastroImovel: tool({
      description:
        "Estado atual do cadastro deste contato: o que já foi informado e qual é a próxima pergunta. Use quando precisar confirmar antes de perguntar.",
      inputSchema: z.object({}),
      async execute() {
        const snapshot = await captureSnapshot(db, phone);
        return {
          cadastroId: snapshot.captureId,
          proprietario: snapshot.ownerName,
          statusCadastro: snapshot.registrationStatus,
          completude: snapshot.completeness,
          respondido: snapshot.answered,
          dados: {
            endereco: snapshot.address,
            tipo: snapshot.propertyType,
            negociacao: snapshot.intention,
            valorPretendido: snapshot.askingPrice,
            ...snapshot.answers,
          },
          proximaPergunta: snapshot.nextQuestion,
          roteiroConcluido: snapshot.complete,
        };
      },
    }),
  };
}

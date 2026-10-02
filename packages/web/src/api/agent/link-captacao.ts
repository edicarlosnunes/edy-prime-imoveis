/**
 * LINK_CAPTACAO — roteiro unificado de cadastro de imóvel iniciado pelo link.
 *
 * O perfil informado no início separa proprietário (venda), locador (locação)
 * e corretor apresentante, sem confundir o corretor com o proprietário.
 *
 * Diferenças em relação ao roteiro do WhatsApp (`agent/owner-capture.ts`),
 * que continua intacto:
 *  - a intenção vem do perfil declarado ou da finalidade informada pelo corretor;
 *  - condomínio, fachada e observação final são passos do mesmo roteiro;
 *  - o texto que vai para o cliente é DETERMINÍSTICO: quem escolhe a frase é
 *    este módulo, não o modelo. O modelo entra só como extrator — lê a
 *    resposta do proprietário e chama a ferramenta que grava. Foi assim que a
 *    exigência "roteiro exato, sem improviso" ficou garantida por código, e
 *    não por instrução de prompt.
 *
 * Persistência: nenhuma tabela nova, nenhuma coluna nova. Tudo passa por
 * `owner-capture#saveCaptureAnswer` → `lib/owner-intake#intakeOwner`, que é
 * quem já resolve identidade por telefone, retomada de ficha pendente e
 * unidade repetida (mesmo prédio com unidade diferente = outro imóvel).
 */
import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import * as schema from "../database/schema";
import type { AdminDb } from "../lib/admin-base";
import { sha256Hex } from "../lib/auth";
import {
  completeCaptureShareLead,
  completeCaptureShareTokenForCapture,
  latestCaptureShareForSender,
} from "../lib/capture-share-tokens";
import { ownerPhoneKey } from "../lib/owner-identity";
import {
  captureSnapshot,
  linkCaptureSession,
  saveCaptureAnswer,
  type CaptureAnswerInput,
  type CaptureSaveResult,
  type CaptureSnapshot,
} from "./owner-capture";
import { gateway, gatewayConfigured } from "./gateway";
import { pickModel } from "./model";
import { handoffAllowance } from "./handoff-guard";
import type { AgentReply, AgentRow, AgentTurn } from "./broker";
import { intakeLead } from "../lib/lead-intake";
import {
  beginBrokerLeadDraft,
  brokerDraftPhoneVariants,
  loadActiveBrokerLeadDraftSession,
  loadBrokerLeadDraftSession,
  loadLatestBrokerLeadDraft,
  loadLatestActiveBrokerLeadDraft,
  recordBrokerLeadDraftAnswer,
  markBrokerLeadDraftComplete,
  type BrokerDraftSession,
  type BrokerDraftStepKey,
  type BrokerLeadDraft,
} from "./broker-lead-draft";

/* ------------------------------------------------------------- entrada */

/** Origem gravada na ficha. É ela que faz o fluxo continuar na volta. */
export const LINK_CAPTACAO_ORIGIN = "LINK_CAPTACAO";

/**
 * Marca que identifica a entrada pelo link.
 *
 * O link de captação é um link do WhatsApp com texto pré-preenchido; a marca
 * viaja nesse texto. Ler a marca da própria mensagem é o que permite
 * reconhecer a entrada sem tocar em webhook, token ou WhatsApp Cloud API.
 */
export const LINK_CAPTACAO_TOKEN = "LINK_CAPTACAO";
export const LINK_CAPTACAO_OWNER_TOKEN = "LINK_CAPTACAO_PROPRIETARIO";
export const LINK_CAPTACAO_BROKER_TOKEN = "LINK_CAPTACAO_CORRETOR";

export type LinkPresenter = "proprietario" | "corretor";

const GENERIC_ENTRY_MESSAGE = "Vamos iniciar o cadastro do seu imóvel?";
const LEGACY_GENERIC_ENTRY_MESSAGE = "Vamos cadastrar seu imóvel?";
const ROLE_QUESTION = "Você é proprietário, locador ou corretor de imóveis?";
export const OWNER_ENTRY_INTRO = "Vamos iniciar o cadastro do seu imóvel?\n\nVocê é proprietário, locador ou corretor de imóveis?";
const ROLE_REJECTED = "Nos desculpe, este cadastro precisa ser realizado pelo proprietário, locador ou corretor do imóvel, pois teremos algumas informações que somente eles poderão confirmar.";

const OWNER_ENTRY_MESSAGE = "Quero cadastrar meu imóvel para venda";
const BROKER_ENTRY_MESSAGE = "Sou corretor e quero apresentar um imóvel";

const hasBrokerToken = (text: string | null | undefined) => {
  const value = fold(text);
  return (
    Boolean(shareTokenFromMessage(text)) ||
    value.includes(fold(LINK_CAPTACAO_BROKER_TOKEN)) ||
    value === fold(BROKER_ENTRY_MESSAGE) ||
    isGenericLinkStart(text)
  );
};

const brokerUserReplies = (turns: readonly AgentTurn[]) => {
  let start = -1;
  turns.forEach((turn, index) => {
    if (turn.role === "user" && hasBrokerToken(turn.content)) start = index;
  });
  if (start < 0) return [] as string[];
  return turns
    .slice(start + 1)
    .filter((turn) => turn.role === "user")
    .map((turn) => turn.content.trim())
    .filter(Boolean);
};

function brokerPurpose(value: string | null | undefined): "venda" | "locacao" | null {
  const normalized = fold(value);
  if (/\b(?:nao|nunca|sem)\b/.test(normalized)) return null;
  const sale = /\b(?:venda|vender|vendo)\b/.test(normalized);
  const rent = /\b(?:locacao|locar|aluguel|alugar)\b/.test(normalized);
  if (sale === rent) return null;
  return rent ? "locacao" : "venda";
}

export const BROKER_LEAD_CLOSING_MESSAGE =
  "Lead recebido! Obrigado pelas informações. O cadastro do imóvel será aberto somente depois que o proprietário confirmar os dados e o interesse. Nossa equipe entrará em contato para dar continuidade.";

function brokerCondominiumPresence(value: string | null | undefined): "yes" | "no" | "unknown" | null {
  const answer = fold(value).replace(/[.!?]+$/g, "").trim();
  if (/^(?:sim|s|tem|fica em condominio)$/.test(answer)) return "yes";
  if (/^(?:nao|n|nao tem|sem condominio)$/.test(answer)) return "no";
  if (/^(?:nao sei|n sei|nao tenho certeza|desconheco)$/.test(answer)) return "unknown";
  return null;
}

function brokerOnboarding(turns: readonly AgentTurn[]) {
  const replies = brokerUserReplies(turns);
  const roleIndex = replies.findIndex((reply) => linkRole(reply) === "corretor");
  const answers = roleIndex < 0 ? [] : replies.slice(roleIndex + 1);
  const creci = answers[0]?.slice(0, 80) ?? "";
  const name = answers[1]?.slice(0, 120) ?? "";
  let cursor = 2;
  let purpose: "venda" | "locacao" | null = null;
  while (cursor < answers.length && purpose === null) {
    purpose = brokerPurpose(answers[cursor]);
    cursor++;
  }
  const ownerName = purpose === null ? null : answers[cursor++] ?? null;
  const answered: LinkStepKey[] = [];
  const acceptedAnswers: Partial<Record<BrokerDraftStepKey, string>> = {};
  if (roleIndex >= 0) acceptedAnswers.role = replies[roleIndex]!;
  if (creci) acceptedAnswers.creci = creci;
  if (name) acceptedAnswers.nome = name;
  if (purpose !== null) acceptedAnswers.intencao = purpose;
  if (ownerName !== null) acceptedAnswers.proprietarioNome = ownerName;
  let pendingQuestion: string | null = null;
  let nextStep: LinkStepKey | null = null;

  if (!creci) {
    pendingQuestion = "Qual é o seu CRECI?";
  } else if (!name) {
    pendingQuestion = "Qual é o seu nome completo?";
  } else if (!purpose) {
    pendingQuestion = "O imóvel é para venda ou locação?";
  } else if (ownerName === null) {
    pendingQuestion = "Qual é o nome do proprietário do imóvel, se souber? Responda NÃO SEI se não souber.";
  } else {
    answered.push("nome");
    const takeAnswer = (
      key: LinkStepKey,
      question: string,
      valid: (value: string) => boolean = (value) => Boolean(value.trim()),
    ) => {
      const value = answers[cursor];
      if (value === undefined || !valid(value)) {
        pendingQuestion = question;
        nextStep = key;
        return false;
      }
      cursor++;
      answered.push(key);
      if (key !== "confirmacaoFinal") {
        acceptedAnswers[key as BrokerDraftStepKey] = value;
      }
      return true;
    };

    if (takeAnswer("endereco", linkQuestion("endereco"))) {
      /* A presença do condomínio é uma escolha enumerada: descarte tentativas
         inválidas para que a resposta válida posterior ocupe este mesmo passo. */
      while (
        cursor < answers.length &&
        brokerCondominiumPresence(answers[cursor]) === null
      ) cursor++;
      if (takeAnswer(
        "condominioPresenca",
        linkQuestion("condominioPresenca"),
        (value) => brokerCondominiumPresence(value) !== null,
      )) {
        const presence = brokerCondominiumPresence(answers[cursor - 1]);
        if (presence === "yes" && takeAnswer("nomeCondominio", linkQuestion("nomeCondominio"))) {
          // The condominium name and unit are kept as one conversation answer.
        }
        if (pendingQuestion === null && takeAnswer("documentacao", linkQuestion("documentacao"))) {
          if (takeAnswer("tipo", linkQuestion("tipo"))) {
            const propertyType = answers[cursor - 1];
            const route = applicableLinkSteps(propertyType, false, {
              condominioPresenca: presence ?? undefined,
            }).filter((step) => [
              "dormitorios",
              "suites",
              "banheiros",
              "vagas",
              "metragem",
              "caracteristicas",
              "valor",
              "condominio",
              "custos",
              "fotoFrente",
              "observacaoFinal",
            ].includes(step.key));
            for (const step of route) {
              const question = linkQuestion(step.key, { propertyType, intention: purpose });
              const valid = step.key === "fotoFrente"
                ? (value: string) => /^\[imagem:/i.test(value.trim()) || missingFacadePhoto(value)
                : (value: string) => Boolean(value.trim());
              if (step.key === "fotoFrente") {
                while (cursor < answers.length && !valid(answers[cursor]!)) cursor++;
              }
              if (!takeAnswer(step.key, question, valid)) break;
            }
          }
        }
      }
    }
  }

  const photoStep = nextStep === "fotoFrente";

  return {
    replies,
    roleIndex,
    answers,
    creci,
    name,
    purpose,
    ownerName,
    pendingQuestion,
    nextStep,
    answered,
    acceptedAnswers,
    photoStep,
    complete: pendingQuestion === null && ownerName !== null,
  };
}

/** Pure media gate for the broker questionnaire's facade-photo prompt. */
export function brokerAwaitingFacadePhoto(turns: readonly AgentTurn[]): boolean {
  return brokerOnboarding(turns).photoStep;
}

const phoneFromText = (text: string | null | undefined) => {
  const digits = String(text ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? digits : null;
};

/** Texto pré-preenchido do link. */
export const LINK_CAPTACAO_MESSAGE = GENERIC_ENTRY_MESSAGE;

/** O link pronto, a partir do WhatsApp da imobiliária. Não altera nada. */
export function linkCaptacaoUrl(whatsapp: string): string {
  const digits = String(whatsapp ?? "").replace(/\D/g, "");
  const phone = digits.startsWith("55") ? digits : `55${digits}`;
  return `https://wa.me/${phone}?text=${encodeURIComponent(LINK_CAPTACAO_MESSAGE)}`;
}

const fold = (value: string | null | undefined) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

function linkRole(value: string | null | undefined): "proprietario" | "locador" | "corretor" | null {
  const normalized = fold(value)
    .replace(/^(?:eu\s+)?sou\s+(?:(?:o|a)\s+)?/, "")
    .replace(/\s+(?:(?:do|da)\s+imovel|de\s+imoveis?)$/, "")
    .trim();
  if (/^(?:proprietario|proprietaria|dono|dona)$/.test(normalized)) return "proprietario";
  if (/^(?:locador|locadora)$/.test(normalized)) return "locador";
  if (/^(?:corretor|corretora)$/.test(normalized)) return "corretor";
  return null;
}

/**
 * Porta do START público: só a frase completa pré-preenchida pelo Link de
 * Captação abre o fluxo. Palavras isoladas ou frases parecidas não abrem.
 * A normalização tolera apenas caixa, acento e espaços; não faz busca parcial.
 */
const isGenericLinkStart = (text: string | null | undefined) => {
  const value = fold(text);
  if (!value) return false;

  /* Alguns clientes do WhatsApp podem duplicar o texto pré-preenchido quando
     o link é aberto mais de uma vez antes do envio. Aceitamos apenas repetições
     exatas da frase completa, com ou sem espaços entre elas. */
  return [GENERIC_ENTRY_MESSAGE, LEGACY_GENERIC_ENTRY_MESSAGE].some((message) => {
    const start = fold(message);
    return value.includes(start) && value.split(start).join("").trim() === "";
  });
};

/**
 * Public reusable entry is exact text, never an opaque exclusive bearer token.
 * The webhook also uses this guard before sending a completed-link response;
 * an empty-caption media event must bypass that text-only response so its
 * sender-scoped media gate can ignore it without an unsolicited reply.
 */
export const isReusableGenericLinkEntry = (text: string | null | undefined) =>
  isGenericLinkStart(text) || /^(?:\[imagem\])?$/i.test(String(text ?? "").trim());

/**
 * Identifica a classe do token de entrada para proteger fichas concluídas.
 * Um futuro emissor pode introduzir um identificador distinto depois de
 * `LINK_CAPTACAO:` sem retirar o guard: compare o token novo com o usado antes
 * do fechamento e só então deixe a entrada voltar ao fluxo normal.
 */
function linkEntryToken(text: string | null | undefined): string | null {
  const value = fold(text);
  const explicitToken = /^\s*LINK_CAPTACAO:([a-f0-9]{64})\s*$/i.exec(String(text ?? ""))?.[1];
  if (explicitToken) return `${LINK_CAPTACAO_TOKEN}:${explicitToken}`;
  if (value.includes(fold(LINK_CAPTACAO_TOKEN)) || isGenericLinkStart(text)) return LINK_CAPTACAO_TOKEN;
  if (value === fold(OWNER_ENTRY_MESSAGE)) return "OWNER_ENTRY_MESSAGE";
  if (value === fold(BROKER_ENTRY_MESSAGE)) return "BROKER_ENTRY_MESSAGE";
  return null;
}

function shareTokenFromMessage(text: string | null | undefined) {
  return /^\s*LINK_CAPTACAO:([a-f0-9]{64})\s*$/i.exec(String(text ?? ""))?.[1] ?? null;
}

function senderKey(phone: string) {
  const digits = phone.replace(/\D/g, "");
  return digits.startsWith("55") ? digits : `55${digits}`;
}

async function verifiedShareToken(db: AdminDb, phone: string, token: string) {
  const tokenHash = await sha256Hex(token);
  const [row] = await db
    .select({
      id: schema.captureShareTokens.id,
      captureId: schema.captureShareTokens.captureId,
    })
    .from(schema.captureShareTokens)
    .where(and(
      eq(schema.captureShareTokens.tokenHash, tokenHash),
      eq(schema.captureShareTokens.senderPhone, senderKey(phone)),
      eq(schema.captureShareTokens.status, "redeemed"),
    ))
    .limit(1);
  return row ?? null;
}

/** A mensagem carrega a marca do link? */
export const hasLinkToken = (text: string | null | undefined) => {
  const value = fold(text);
  return (
    value.includes(fold(LINK_CAPTACAO_TOKEN)) ||
    value === fold(OWNER_ENTRY_MESSAGE) ||
    value === fold(BROKER_ENTRY_MESSAGE) ||
    isGenericLinkStart(text)
  );
};

/* ------------------------------------------------------------- roteiro */

/**
 * O roteiro, exatamente na ordem exigida.
 *
 * `verbatim` marca as frases que vão para o cliente letra por letra. As
 * demais são perguntas objetivas de qualificação, uma por vez.
 */
export const LINK_STEPS = [
  { key: "nome", label: "Nome completo", verbatim: true, question: "Qual é o seu nome completo?" },
  { key: "endereco", label: "Endereço do imóvel", verbatim: true, question: "Qual é o endereço completo do imóvel?" },
  { key: "condominioPresenca", label: "Presença de condomínio", verbatim: true, question: "O imóvel fica em condomínio? Responda SIM, NÃO ou NÃO SEI." },
  { key: "nomeCondominio", label: "Nome do condomínio e unidade", verbatim: true, question: "Qual é o nome do condomínio e, se aplicável, a unidade do imóvel?" },
  { key: "documentacao", label: "Documentação", verbatim: true, question: "Qual é a situação da documentação do imóvel? Se não souber, digite NÃO SEI." },
  { key: "tipo", label: "Tipo de imóvel", question: "Qual é o tipo do imóvel? Ex.: apartamento, casa, terreno, sítio ou outro." },
  { key: "dormitorios", label: "Dormitórios", question: "Quantos dormitórios? (0 se não tiver • NÃO SEI se não souber)" },
  { key: "suites", label: "Suítes", question: "Quantas suítes? (0 se não tiver • NÃO SEI se não souber)" },
  { key: "banheiros", label: "Banheiros", question: "Quantos banheiros? (0 se não tiver • NÃO SEI se não souber)" },
  { key: "vagas", label: "Vagas de garagem", question: "Quantas vagas de garagem? (0 se não tiver • NÃO SEI se não souber)" },
  { key: "metragem", label: "Área útil ou construída", question: "Qual é a área útil ou construída? Ex.: 75 m². Se não souber, digite NÃO SEI." },
  { key: "caracteristicas", label: "Metragem do terreno", question: "Qual é a metragem do terreno? Ex.: 10 x 40 metros. Se não souber ou não se aplicar, digite NÃO SEI." },
  { key: "valor", label: "Valor pretendido", question: "Qual é o valor pretendido do imóvel? Se ainda não souber, digite NÃO SEI." },
  { key: "condominio", label: "Valor do condomínio", question: "Qual é o valor do condomínio? (0 se não houver • NÃO SEI se não souber)" },
  { key: "custos", label: "Valor do IPTU", question: "Qual é o valor do IPTU? (0 se não houver/isento • NÃO SEI se não souber)" },
  { key: "fotoFrente", label: "Foto da fachada", verbatim: true, question: "Envie uma foto real da frente ou fachada do imóvel. Se não tiver agora, digite NÃO SEI; a foto ficará pendente para nossa equipe." },
  { key: "observacaoFinal", label: "Observações finais", verbatim: true, question: "Tem algo importante sobre o imóvel que gostaria de informar? Se não souber ou não tiver mais nada a acrescentar, digite NÃO SEI." },
] as const;

export type LinkStepKey = (typeof LINK_STEPS)[number]["key"];

/** Pergunta fora do roteiro: a resposta é esta, sem variação. */
export const OFF_SCRIPT_REPLY =
  "Certo, vamos verificar essa informação e, se necessário, nossa equipe te dá um retorno.";

/** Fechamento do cadastro. */
export const CLOSING_MESSAGE =
  "Cadastro concluído com sucesso! Em breve entraremos em contato para dar continuidade ao atendimento.";

/** Respostas naturais não exigem que o cliente escreva literalmente NÃO SEI. */
export function classifyOptionalAnswer(text: string | null | undefined): "0" | "não informado" | "não se aplica" | null {
  const value = fold(text).replace(/[.!?]+$/g, "").replace(/\s+/g, " ").trim();
  if (/^(?:nao sei|n sei|sei la|nao lembro|nao conheco|nao tenho certeza|desconheco|pular|pula|passar)$/.test(value)) return "não informado";
  if (/^(?:nao se aplica|nao aplica)$/.test(value)) return "não se aplica";
  if (/^(?:nenhum|nenhuma|nao tem|nao tenho|nao possui|nao tem condominio|nao pago condominio|nao pago|sem|sem condominio|sem cobranca|zero|0|isento|isenta)$/.test(value)) return "0";
  return null;
}

/** Um texto nunca comprova uma foto; este fallback cria pendência para a equipe. */
export function missingFacadePhoto(text: string | null | undefined): boolean {
  const value = fold(text).replace(/[.!?]+$/g, "").trim();
  return /^(?:nao sei|n sei|nao tenho|nao tenho foto|nao tenho a foto|nao tenho agora|nao tenho no momento|sem foto|estou sem foto|nao consigo enviar agora|nao posso enviar agora)$/.test(value);
}

export function finalOk(text: string | null | undefined): boolean {
  return /^ok[.! ]*$/i.test(String(text ?? "").trim());
}

/** Imóvel sem condomínio: a pergunta de custos vira só IPTU. */
const NO_CONDO = ["terreno", "casa", "chacara", "sitio", "galpao", "area", "lote"];
const NO_CONDO_ANSWER = /^(nao|nenhum|sem condominio|n)\b/;

/** Perguntas exatas; valor muda por perfil e custos pode variar por imóvel. */
export function linkQuestion(
  key: LinkStepKey,
  context: { propertyType?: string | null; condominio?: string | null; intention?: string | null; ownerExclusive?: boolean } = {},
): string {
  const step = LINK_STEPS.find((item) => item.key === key)!;
  if (key === "valor" && fold(context.intention) === "locacao") {
    return "Qual é o valor mensal do aluguel pretendido? Se ainda não souber, digite NÃO SEI.";
  }
  return step.question;
}

/* --------------------------------------------------------------- estado */

export interface LinkCaptacaoState {
  /** O fluxo do link responde este turno? */
  active: boolean;
  /** Quem apresentou o imóvel pelo link. Corretor nunca vira proprietário. */
  presenter: LinkPresenter;
  /** Telefone do proprietário usado pela ficha; no fluxo do corretor vem da resposta do proprietário. */
  ownerPhone: string | null;
  /** Identificação do corretor apresentante, quando houver. */
  broker?: { creci: string; name: string; phone: string } | null;
  /** Clique no link agora (a última mensagem do contato traz a marca). */
  freshEntry: boolean;
  /** A marca do link aparece em alguma mensagem desta conversa. */
  fromLink: boolean;
  /**
   * Outro imóvel em andamento: o cadastro anterior terminou e depois dele veio
   * um clique novo no link. Continua valendo nos turnos seguintes, até o
   * endereço do novo imóvel abrir a segunda ficha.
   */
  startNewProperty: boolean;
  snapshot: CaptureSnapshot;
  answered: LinkStepKey[];
  nextStep: LinkStepKey | null;
  nextQuestion: string | null;
  complete: boolean;
  /** Bloqueia o atendimento normal após encerrar a captação deste link. */
  completionGuard: boolean;
  /** Entry came through the reusable public phrase; the schedule is unchanged. */
  genericPublic?: boolean;
  /** Current redeemed bearer row authorizing this flow. */
  shareTokenId?: number | null;
  /** Capture id permanently bound to the redeemed link, when present. */
  shareCaptureId?: number | null;
  /** Repeated bearer text is an entry reminder, never a capture answer. */
  replayedToken?: boolean;
  replayQuestion?: string | null;
  /** Intenção definida pelo perfil: locador = locação; proprietário = venda. */
  intention: "venda" | "locacao" | null;
  /** True only for historical exclusive owner links; the schedule remains shared. */
  ownerExclusive?: boolean;
  /** Durable broker-only questionnaire state; never used by owner capture. */
  brokerDraft?: BrokerLeadDraft | null;
  brokerDraftSession?: BrokerDraftSession;
  brokerBaseTurns?: AgentTurn[];
  brokerTurns?: AgentTurn[];
  brokerInboundTurn?: string | null;
}

/** Passos já respondidos — lidos do que está GRAVADO, nunca da conversa. */
export function linkAnswered(snapshot: CaptureSnapshot, ownerExclusive = false): LinkStepKey[] {
  const answers = snapshot.answers as Record<string, string | undefined>;
  const filled = (value: unknown) => typeof value === "string" && value.trim().length > 0;
  const done = new Set<LinkStepKey>();
  if (filled(snapshot.ownerName)) done.add("nome");
  if (snapshot.answered.includes("endereco")) done.add("endereco");
  if (filled(answers.condominioPresenca)) done.add("condominioPresenca");
  if (filled(answers.nomeCondominio) || ["no", "unknown", "não", "nao"].includes(fold(answers.condominioPresenca ?? ""))) {
    done.add("nomeCondominio");
  }
  if (filled(snapshot.propertyType)) done.add("tipo");
  if (
    (typeof snapshot.askingPrice === "number" && snapshot.askingPrice > 0) ||
    filled(answers.valorPretendidoStatus)
  ) {
    done.add("valor");
  }
  for (const key of [
    "condominio",
    "documentacao",
    "dormitorios",
    "suites",
    "banheiros",
    "vagas",
    "metragem",
    "custos",
    "caracteristicas",
    "fotoFrente",
    "observacaoFinal",
  ] as const) {
    if (filled(answers[key])) done.add(key);
  }
  if (filled(answers.condominio) && !done.has("condominioPresenca")) done.add("condominioPresenca");
  return LINK_STEPS.filter((step) => done.has(step.key)).map((step) => step.key);
}

export function applicableLinkSteps(
  propertyType: string | null | undefined,
  ownerExclusive = false,
  answers: Record<string, string | undefined> = {},
) {
  const type = fold(propertyType);
  const skip = new Set<LinkStepKey>();
  const condoPresence = fold(answers.condominioPresenca);
  if (["no", "unknown", "não", "nao"].includes(condoPresence)) {
    skip.add("nomeCondominio");
    skip.add("condominio");
  }
  if (condoPresence !== "yes" && condoPresence !== "sim") skip.add("condominio");
  if (!type) return LINK_STEPS.filter((step) => !skip.has(step.key));
  if (/apartamento|apto|studio|flat|kitnet/.test(type)) skip.add("caracteristicas");
  if (/terreno|lote/.test(type)) {
    ["dormitorios", "suites", "banheiros", "vagas", "metragem", "condominio"].forEach((key) => skip.add(key as LinkStepKey));
  }
  if (/sala|loja|galpao|comercial/.test(type)) {
    ["dormitorios", "suites", "caracteristicas"].forEach((key) => skip.add(key as LinkStepKey));
  }
  if (/sitio|chacara|fazenda/.test(type)) skip.add("condominio");
  return LINK_STEPS.filter((step) => !skip.has(step.key));
}

export function buildState(input: {
  snapshot: CaptureSnapshot;
  freshEntry: boolean;
  fromLink: boolean;
  sticky: boolean;
  /** Clique no link depois do fechamento do cadastro anterior. */
  relink: boolean;
  intention?: "venda" | "locacao";
  ownerExclusive?: boolean;
}): LinkCaptacaoState {
  const { snapshot, freshEntry } = input;
  const intention = input.intention ?? (snapshot.intention === "locacao" ? "locacao" : "venda");
  const ownerExclusive = Boolean(input.ownerExclusive && intention === "venda");
  const answersAll = linkAnswered(snapshot, ownerExclusive);
  const previousRoute = applicableLinkSteps(
    snapshot.propertyType,
    ownerExclusive,
    snapshot.answers as Record<string, string | undefined>,
  );
  const completeBefore = previousRoute.every((step) => answersAll.includes(step.key));

  /* Uma entrada aceita depois do fechamento cadastra OUTRO imóvel. O nome já
     é conhecido, o resto começa do zero. O guard abaixo só deixa chegar aqui
     um token distinto do token que encerrou o cadastro anterior. */
  const startNewProperty = (freshEntry || input.relink) && completeBefore;
  const answered = startNewProperty
    ? answersAll.filter((key) => key === "nome")
    : answersAll;

  const nextStep = applicableLinkSteps(
    startNewProperty ? null : snapshot.propertyType,
    ownerExclusive,
    startNewProperty ? {} : snapshot.answers as Record<string, string | undefined>,
  )
    .find((step) => !answered.includes(step.key))?.key ?? null;
  const condominio = (snapshot.answers as Record<string, string | undefined>).condominio;

  return {
    presenter: "proprietario",
    ownerExclusive,
    ownerPhone: snapshot.phone,
    broker: null,
    /* Atende o turno quando: clicou no link agora; ou está cadastrando outro
       imóvel depois de um cadastro concluído; ou o roteiro está em andamento e
       a conversa veio do link (marca no histórico) ou a ficha já está marcada
       com a origem do link (retomada dias depois, sem o link). Roteiro
       terminado sem clique novo NÃO é atendido aqui: volta a ser atendimento
       normal, como antes. */
    active: freshEntry || startNewProperty || ((input.fromLink || input.sticky) && !completeBefore),
    freshEntry,
    fromLink: input.fromLink,
    startNewProperty,
    snapshot,
    answered,
    nextStep,
    nextQuestion: nextStep
      ? linkQuestion(nextStep, {
          propertyType: startNewProperty ? null : snapshot.propertyType,
          condominio: startNewProperty ? null : condominio,
          intention,
          ownerExclusive,
        })
      : null,
    complete: nextStep === null,
    completionGuard: false,
    intention,
  };
}

function reusableGenericState(
  state: LinkCaptacaoState,
): LinkCaptacaoState {
  const route = applicableLinkSteps(
    state.snapshot.propertyType,
    false,
    state.snapshot.answers as Record<string, string | undefined>,
  );
  const nextStep = route.find((step) => !state.answered.includes(step.key))?.key ?? null;
  return {
    ...state,
    genericPublic: true,
    startNewProperty: state.snapshot.captureId === null,
    complete: nextStep === null,
    nextStep,
    nextQuestion: nextStep
      ? linkQuestion(nextStep, {
          propertyType: state.snapshot.propertyType,
          intention: state.intention,
        })
      : null,
  };
}

/**
 * O fluxo do link atende este turno?
 *
 * As portas, e só essas:
 *  - a última mensagem do contato traz a marca do link (clique agora);
 *  - a marca aparece antes na mesma conversa — é o que segura o fluxo do
 *    segundo turno em diante, quando a ficha ainda não tem nada gravado;
 *  - a ficha deste telefone já foi aberta pelo link e o roteiro não terminou —
 *    é o que faz "abandonou e voltou" retomar no ponto exato, mesmo dias
 *    depois e mesmo que a pessoa volte digitando, sem clicar no link;
 *  - o clique veio DEPOIS do fechamento do cadastro anterior (`relink`): é o
 *    segundo imóvel do mesmo proprietário, que só deixa de ser "o anterior já
 *    concluído" quando o endereço novo abre a segunda ficha.
 */
async function brokerLinkState(
  db: AdminDb,
  phone: string,
  turns: readonly AgentTurn[],
): Promise<LinkCaptacaoState> {
  const lastCloseIndex = turns.reduce(
    (latest, turn, index) =>
      turn.role === "assistant" &&
      (turn.content.includes(CLOSING_MESSAGE) || turn.content.includes(BROKER_LEAD_CLOSING_MESSAGE))
        ? index
        : latest,
    -1,
  );
  const lastEntryIndex = turns.reduce(
    (latest, turn, index) =>
      turn.role === "user" && hasBrokerToken(turn.content) ? index : latest,
    -1,
  );
  const lastEntry = lastEntryIndex >= 0 ? turns[lastEntryIndex] : undefined;
  const tokenEntry = lastEntry?.role === "user"
    ? shareTokenFromMessage(lastEntry.content)
    : null;
  const genericEntry = lastEntry?.role === "user" && isGenericLinkStart(lastEntry.content);
  let session: BrokerDraftSession | undefined;
  let draft: BrokerLeadDraft | null = null;
  let completedExactSession: BrokerLeadDraft | null = null;
  let entryIsCurrent = false;

  if (tokenEntry) {
    session = { kind: "token", key: tokenEntry };
    entryIsCurrent = true;
    draft = await loadActiveBrokerLeadDraftSession(db, phone, session);
    if (!draft) completedExactSession = await loadBrokerLeadDraftSession(db, phone, session);
  } else if (genericEntry) {
    entryIsCurrent = true;
    if (lastCloseIndex > lastEntryIndex) {
      completedExactSession = await loadLatestBrokerLeadDraft(db, phone, "generic");
      session = completedExactSession?.session;
      draft = completedExactSession;
    } else {
      const activeGeneric = await loadLatestActiveBrokerLeadDraft(db, phone, "generic");
      draft = activeGeneric?.session.key.startsWith("generic:") ? activeGeneric : null;
      session = draft?.session ?? { kind: "generic", key: `generic:${crypto.randomUUID()}` };
    }
  } else if (lastEntry?.role === "user") {
    const legacyKey = linkEntryToken(lastEntry.content) ?? fold(lastEntry.content);
    session = { kind: "generic", key: `legacy:${legacyKey}` };
    entryIsCurrent = true;
    draft = await loadActiveBrokerLeadDraftSession(db, phone, session);
  }

  if (!session) {
    draft = await loadLatestActiveBrokerLeadDraft(db, phone);
    session = draft?.session;
    if (!draft) {
      const latestDraft = await loadLatestBrokerLeadDraft(db, phone, "generic");
      if (latestDraft?.status === "complete") {
        completedExactSession = latestDraft;
        draft = latestDraft;
        session = latestDraft.session;
      }
    }
  }
  if (completedExactSession?.status === "complete") {
    draft = completedExactSession;
  }

  const entryMarker = session?.kind === "token"
    ? `LINK_CAPTACAO:${session.key}`
    : GENERIC_ENTRY_MESSAGE;
  const baseTurns: AgentTurn[] = draft
    ? brokerDraftTurns(draft, entryMarker)
    : lastEntry?.role === "user"
      ? [lastEntry]
      : [];
  const latestUser = [...turns].reverse().find((turn) => turn.role === "user");
  const latestIsEntry = Boolean(
    lastEntryIndex >= 0 &&
    turns.length - 1 === lastEntryIndex &&
    latestUser === lastEntry,
  );
  /* A transcript ending in an assistant turn has already consumed its latest
     user message. Replaying it beside the durable answers would shift it into
     the following questionnaire step (notably a photo into final notes). */
  const inboundTurn =
    turns.at(-1)?.role === "user" && latestUser && !latestIsEntry
      ? latestUser.content
      : null;
  const brokerTurns = [...baseTurns];
  if (inboundTurn !== null) brokerTurns.push({ role: "user", content: inboundTurn });
  const onboarding = brokerOnboarding(brokerTurns);
  const currentShare = await latestCaptureShareForSender(db, phone);
  let lastLink = -1;
  let lastClosing = -1;
  for (let index = 0; index < turns.length; index++) {
    const turn = turns[index]!;
    if (turn.role === "user" && hasBrokerToken(turn.content)) lastLink = index;
    if (turn.role === "assistant" &&
      (turn.content.includes(CLOSING_MESSAGE) || turn.content.includes(BROKER_LEAD_CLOSING_MESSAGE))) {
      lastClosing = index;
    }
  }
  const currentEntry = entryIsCurrent || lastLink > lastClosing || Boolean(draft?.status === "active");
  const snapshot = await captureSnapshot(db, phone);
  let completedTokenReplay = false;
  const lastTranscriptEntry = turns[lastLink];
  const repeatedToken = lastTranscriptEntry?.role === "user"
    ? shareTokenFromMessage(lastTranscriptEntry.content)
    : null;
  if (repeatedToken) {
    const tokenHash = await sha256Hex(repeatedToken);
    const [completedToken] = await db
      .select({ id: schema.captureShareTokens.id })
      .from(schema.captureShareTokens)
      .where(and(
        eq(schema.captureShareTokens.tokenHash, tokenHash),
        eq(schema.captureShareTokens.senderPhone, senderKey(phone)),
        eq(schema.captureShareTokens.status, "completed"),
      ))
      .limit(1);
    completedTokenReplay = Boolean(completedToken);
  }
  /* Attach only the exact verified bearer entry. A generic public entry never
     inherits a nearby token's authority. */
  let shareTokenId: number | null = null;
  if (
    (currentEntry || draft?.status === "active") &&
    currentShare?.status === "redeemed" &&
    session?.kind === "token" &&
    (await verifiedShareToken(db, phone, session.key))?.id === currentShare.id
  ) {
    shareTokenId = currentShare.id;
  }
  const completionGuard =
    completedExactSession?.status === "complete" ||
    lastCloseIndex > lastLink ||
    completedTokenReplay;
  const shareCaptureId = shareTokenId === null ? null : currentShare!.captureId;

  return {
    active: completionGuard || (currentEntry && (onboarding.pendingQuestion !== null || onboarding.complete)) ||
      Boolean(draft?.status === "active"),
    presenter: "corretor",
    ownerPhone: phone,
    broker: onboarding.creci && onboarding.name
      ? { creci: onboarding.creci, name: onboarding.name, phone }
      : null,
    freshEntry: currentEntry && onboarding.replies.length === 0,
    fromLink: true,
    startNewProperty: false,
    snapshot,
    answered: onboarding.answered,
    nextStep: onboarding.nextStep,
    nextQuestion: onboarding.pendingQuestion,
    complete: completionGuard || onboarding.complete,
    completionGuard,
    intention: onboarding.purpose,
    shareTokenId,
    shareCaptureId,
    brokerDraft: draft?.status === "active" ? draft : null,
    brokerDraftSession: session,
    brokerBaseTurns: baseTurns,
    brokerTurns,
    brokerInboundTurn: inboundTurn,
  };
}

function brokerDraftTurns(draft: BrokerLeadDraft, entryMarker: string): AgentTurn[] {
  const orderedKeys: BrokerDraftStepKey[] = [
    "role", "creci", "nome", "intencao", "proprietarioNome", "endereco",
    "condominioPresenca", "nomeCondominio", "documentacao", "tipo",
    "dormitorios", "suites", "banheiros", "vagas", "metragem",
    "caracteristicas", "valor", "condominio", "custos", "fotoFrente",
    "observacaoFinal",
  ];
  return [
    { role: "user", content: entryMarker },
    ...orderedKeys
      .filter((key) => draft.answers[key] !== undefined)
      .map((key) => ({ role: "user" as const, content: draft.answers[key]! })),
  ];
}

async function ensureBrokerLead(db: AdminDb, phone: string): Promise<number> {
  const normalizedPhone = phone.replace(/\D/g, "").slice(0, 20);
  const [existing] = await db.select({ id: schema.leads.id })
    .from(schema.leads)
    .where(inArray(schema.leads.phone, brokerDraftPhoneVariants(normalizedPhone)))
    .orderBy(desc(schema.leads.createdAt))
    .limit(1);
  if (existing) return existing.id;
  const lead = await intakeLead(db, {
    name: "Contato de corretor",
    phone: normalizedPhone,
    interest: "Apresentação de imóvel por corretor",
    message: "Questionário de captação iniciado pelo link.",
    source: "whatsapp",
    channel: "whatsapp",
  });
  return lead.id;
}

export async function linkCaptacaoState(
  db: AdminDb,
  phone: string | null,
  turns: readonly AgentTurn[],
): Promise<LinkCaptacaoState | null> {
  if (!ownerPhoneKey(phone)) return null;
  const userMessages = turns.filter((turn) => turn.role === "user");
  const currentShare = await latestCaptureShareForSender(db, phone!);
  const verifiedTokens = new Map<string, { id: number; captureId: number | null }>();
  for (const turn of userMessages) {
    const token = shareTokenFromMessage(turn.content);
    if (!token) continue;
    const verified = await verifiedShareToken(db, phone!, token);
    if (
      verified &&
      currentShare?.status === "redeemed" &&
      verified.id === currentShare.id
    ) {
      verifiedTokens.set(turn.content, verified);
    }
  }
  const latestVerifiedShareId = [...verifiedTokens.values()].at(-1)?.id;
  const latestVerifiedTokenIndex = turns.reduce(
    (latest, turn, index) => turn.role === "user" && verifiedTokens.has(turn.content) ? index : latest,
    -1,
  );
  const latestGenericEntryIndex = turns.reduce(
    (latest, turn, index) => turn.role === "user" && isGenericLinkStart(turn.content) ? index : latest,
    -1,
  );
  const activeShareId =
    currentShare?.status === "redeemed" &&
    latestVerifiedTokenIndex > latestGenericEntryIndex &&
    (latestVerifiedShareId === undefined || latestVerifiedShareId === currentShare.id)
      ? currentShare.id
      : null;
  const shareCaptureId = activeShareId === null ? null : currentShare!.captureId;
  const baseSnapshot = await captureSnapshot(db, phone);
  const session = await linkCaptureSession(db, baseSnapshot.ownerId);
  const snapshot = shareCaptureId !== null
    ? await captureSnapshot(db, phone, shareCaptureId)
    : session.activeCaptureId !== null
      ? await captureSnapshot(db, phone, session.activeCaptureId)
      : baseSnapshot;
  if (
    shareCaptureId !== null &&
    snapshot.captureId !== shareCaptureId
  ) {
    return null;
  }
  if (session.activeCaptureId !== null && shareCaptureId === null && snapshot.captureId !== session.activeCaptureId) return null;
  const origin = (snapshot.answers as Record<string, string | undefined>).origem ?? null;
  const fromLinkCapture = fold(origin) === fold(LINK_CAPTACAO_ORIGIN);
  const snapshotAnswers = linkAnswered(snapshot);
  const captureWasCompleted =
    fromLinkCapture &&
    applicableLinkSteps(snapshot.propertyType, false, snapshot.answers as Record<string, string | undefined>)
      .every((step) => snapshotAnswers.includes(step.key));
  const legacyEntryIsActive =
    fromLinkCapture &&
    !captureWasCompleted &&
    turns.some((turn) => turn.role === "assistant" && turn.content.includes(ROLE_QUESTION));
  const trustedLegacyEntry = (text: string) =>
    isGenericLinkStart(text) ||
    legacyEntryIsActive && (
      fold(text) === fold(OWNER_ENTRY_MESSAGE) ||
      fold(text) === fold(BROKER_ENTRY_MESSAGE) ||
      fold(text).includes(fold(LINK_CAPTACAO_BROKER_TOKEN))
    );
  const trustedEntry = (text: string) =>
    verifiedTokens.has(text) || trustedLegacyEntry(text);
  let latestGeneric = -1;
  const seenEntryKeys = new Set<string>();
  let closingAtEntry = -1;
  turns.forEach((turn, index) => {
    if (turn.role === "assistant" && turn.content.includes(CLOSING_MESSAGE)) {
      closingAtEntry = index;
    }
    if (turn.role !== "user" || !trustedEntry(turn.content)) return;
    const share = verifiedTokens.get(turn.content);
    const key = share
      ? `SHARE:${share.id}`
      : isGenericLinkStart(turn.content)
        ? `GENERIC:${closingAtEntry}`
        : `LEGACY:${linkEntryToken(turn.content) ?? fold(turn.content)}`;
    if (seenEntryKeys.has(key)) return;
    seenEntryKeys.add(key);
    latestGeneric = index;
  });
  const afterGeneric = latestGeneric >= 0
    ? turns.slice(latestGeneric + 1).filter(
        (turn) => turn.role === "user" && !trustedEntry(turn.content),
      )
    : [];
   /* O envio da mensagem pré-preenchida já é a confirmação de entrada.
      A primeira resposta do contato é diretamente o perfil. */
  const roleAnswer = afterGeneric[0]?.content ?? "";
  const brokerEntry = afterGeneric.some(
    (turn) => turn.role === "user" && linkRole(turn.content) === "corretor",
  );
  const grandfatheredBrokerEntry = legacyEntryIsActive && afterGeneric.some((turn) =>
    turn.role === "user" &&
    (fold(turn.content) === fold(BROKER_ENTRY_MESSAGE) ||
      fold(turn.content).includes(fold(LINK_CAPTACAO_BROKER_TOKEN))),
  );
  const latestTrustedEntry = [...userMessages].reverse().find((turn) => trustedEntry(turn.content));
  const latestEntryToken = latestTrustedEntry
    ? shareTokenFromMessage(latestTrustedEntry.content)
    : null;
  const resumableBrokerDraft = latestTrustedEntry
    ? isGenericLinkStart(latestTrustedEntry.content)
      ? await loadLatestActiveBrokerLeadDraft(db, phone!, "generic")
      : latestEntryToken
        ? await loadActiveBrokerLeadDraftSession(db, phone!, {
            kind: "token",
            key: latestEntryToken,
          })
        : null
    : await loadLatestActiveBrokerLeadDraft(db, phone!);
  /* A sessão concluída continua sendo a autoridade quando a janela de
     histórico perdeu o perfil/entrada. Não transformar um retorno em outro
     roteiro; uma entrada explícita nova e uma sessão de proprietário ativa
     continuam seguindo a seleção anterior. */
  const brokerClosingAfterEntry = turns.some(
    (turn, index) => index > latestGeneric &&
      turn.role === "assistant" && turn.content.includes(BROKER_LEAD_CLOSING_MESSAGE),
  );
  const closedBrokerDraft =
    resumableBrokerDraft === null &&
    (brokerClosingAfterEntry ||
      (!latestTrustedEntry && session.activeCaptureId === null && !session.awaitingAddress))
      ? await loadLatestBrokerLeadDraft(db, phone!, "generic")
      : null;
  if (
    brokerEntry ||
    grandfatheredBrokerEntry ||
    (resumableBrokerDraft !== null && userMessages.length > 0) ||
    (closedBrokerDraft?.status === "complete" && userMessages.length > 0)
  ) return brokerLinkState(db, phone!, turns);
  const lastUser = userMessages.length ? userMessages[userMessages.length - 1]!.content : "";
  const lastUserShare = verifiedTokens.get(lastUser);
  const repeatedToken = Boolean(
    lastUserShare &&
    turns.filter(
      (turn) => turn.role === "user" && verifiedTokens.get(turn.content)?.id === lastUserShare.id,
    ).length > 1,
  );
  const replayedToken = Boolean(lastUserShare && (repeatedToken || shareCaptureId !== null));
  const freshEntry = trustedEntry(lastUser) && !replayedToken;
  const fromLink = userMessages.some((turn) => trustedEntry(turn.content));

  /* Posição do último clique e do último fechamento na conversa. */
  let lastLink = -1;
  let lastClosing = -1;
  let lastExplicitToken = -1;
  turns.forEach((turn, index) => {
    if (turn.role === "user" && trustedEntry(turn.content)) lastLink = index;
    if (turn.role === "user" && shareTokenFromMessage(turn.content)) lastExplicitToken = index;
    if (turn.role === "assistant" && turn.content.includes(CLOSING_MESSAGE)) lastClosing = index;
  });
  const firstReusableEntryAfterClose = turns.findIndex(
    (turn, index) =>
      index > lastClosing &&
      turn.role === "user" &&
      isGenericLinkStart(turn.content),
  );
  const genericPublicActive =
    firstReusableEntryAfterClose > lastClosing &&
    firstReusableEntryAfterClose > lastExplicitToken &&
    turns.slice(firstReusableEntryAfterClose + 1).every(
      (turn) => turn.role !== "user" || !shareTokenFromMessage(turn.content),
    );
  const relink = lastLink >= 0 && lastLink > lastClosing;
  const latestUserIndex = turns.reduce(
    (latest, turn, index) => turn.role === "user" ? index : latest,
    -1,
  );
  const entryTokenAt = (before: number) => turns
    .map((turn, index) => ({ turn, index }))
    .filter(({ turn, index }) => turn.role === "user" && index < before)
    .map(({ turn }) => verifiedTokens.has(turn.content)
      ? `LINK_CAPTACAO_ID:${verifiedTokens.get(turn.content)!.id}`
      : trustedLegacyEntry(turn.content) ? linkEntryToken(turn.content) : null)
    .filter((token): token is string => Boolean(token))
    .at(-1) ?? null;
  const latestEntryAfterClose = turns
    .map((turn, index) => ({ turn, index }))
    .filter(({ turn, index }) => turn.role === "user" && index > lastClosing)
    .map(({ turn }) => verifiedTokens.has(turn.content)
      ? `LINK_CAPTACAO_ID:${verifiedTokens.get(turn.content)!.id}`
      : trustedLegacyEntry(turn.content) ? linkEntryToken(turn.content) : null)
    .filter((token): token is string => Boolean(token))
    .at(-1) ?? null;
  const tokenBeforeCompletion =
    lastClosing >= 0
      ? entryTokenAt(lastClosing)
      : captureWasCompleted ? LINK_CAPTACAO_TOKEN : null;
  const distinctTokenBypass = Boolean(
    latestEntryAfterClose &&
    tokenBeforeCompletion &&
    latestEntryAfterClose !== tokenBeforeCompletion,
  );
  const currentVerifiedNewLink = Boolean(
    currentShare?.status === "redeemed" &&
    latestVerifiedShareId === currentShare.id &&
    (lastClosing >= 0 || captureWasCompleted),
  );
  const guardCompleted = (state: LinkCaptacaoState): LinkCaptacaoState => {
    const completedBeforeThisTurn =
      lastClosing >= 0
        ? latestUserIndex > lastClosing
        : captureWasCompleted && latestUserIndex >= 0;
    if (genericPublicActive) return state;
    if (
      currentShare?.status !== "completed" &&
      (!completedBeforeThisTurn || distinctTokenBypass || currentVerifiedNewLink)
    ) return state;
    return {
      ...state,
      active: true,
      completionGuard: true,
      complete: true,
      nextStep: null,
      nextQuestion: null,
    };
  };
  const sticky =
    session.activeCaptureId !== null ||
    fromLinkCapture ||
    currentShare?.status === "completed" ||
    lastClosing >= 0;
  const pendingAddress =
    !freshEntry && !fromLink && looksLikeStreetAddress(lastUser) &&
    session.awaitingAddress;
  if (!freshEntry && !fromLink && !sticky && !pendingAddress) return null;

  /* Uma ENTRADA_LINK_CAPTACAO explícita abre uma nova sessão lógica.
     Até o endereço ser informado, a ficha pendente anterior deste telefone não
     pode escolher a próxima pergunta. A ficha antiga continua preservada no
     banco; ela apenas deixa de comandar esta nova entrada. A mesma entrada
     genérica após o fechamento é retida pelo guard abaixo. */
  const validOwnerRoleIndex = afterGeneric.findIndex((turn) =>
    ["proprietario", "locador"].includes(linkRole(turn.content) ?? ""),
  );
  const ownerDataReplies =
    validOwnerRoleIndex >= 0 ? afterGeneric.slice(validOwnerRoleIndex + 1) : [];
  const selectedRole = validOwnerRoleIndex >= 0
    ? linkRole(afterGeneric[validOwnerRoleIndex]!.content) ?? ""
    : "";
  const intention: "venda" | "locacao" =
    selectedRole
      ? (selectedRole === "locador" ? "locacao" : "venda")
      : (snapshot.intention === "locacao" ? "locacao" : "venda");
  const unboundShareAwaitingAddress = Boolean(
    currentShare?.status === "redeemed" &&
    currentShare.id === latestVerifiedShareId &&
    currentShare.captureId === null &&
    session.awaitingAddress,
  );
  const cleanExplicitEntry =
    shareCaptureId === null &&
    latestGeneric >= 0 &&
    validOwnerRoleIndex >= 0 &&
    /* O endereço precisa ser associado ao imóvel certo antes de reler a ficha
       anterior deste telefone. Nome, sozinho, não abre ficha para contato antigo. */
    ownerDataReplies.length <= 2;

  if (cleanExplicitEntry || pendingAddress) {
    const nameAnswered = ownerDataReplies.length === 2 || pendingAddress || unboundShareAwaitingAddress;
    const cleanSnapshot: CaptureSnapshot = {
      ...snapshot,
      ownerName: nameAnswered ? ownerDataReplies[0]?.content ?? snapshot.ownerName ?? null : null,
      captureId: null,
      pending: false,
      registrationStatus: null,
      completeness: 0,
      address: null,
      propertyType: null,
      intention,
      askingPrice: null,
      answers: {},
      answered: [],
      nextStep: "nome",
      nextQuestion: linkQuestion("nome", { intention }),
      complete: false,
      duplicateNote: null,
      outsidePriorityArea: false,
    };
    const cleanState = buildState({
      snapshot: cleanSnapshot,
      freshEntry: false,
      fromLink: true,
      sticky: false,
      relink: false,
      intention,
      ownerExclusive: false,
    });
    const prepared = {
      ...cleanState,
      shareTokenId: activeShareId,
      shareCaptureId,
      replayedToken,
      replayQuestion: replayedToken && !selectedRole ? ROLE_QUESTION : cleanState.nextQuestion,
      ...(nameAnswered ? { startNewProperty: true, intention } : { intention }),
    };
    return guardCompleted(genericPublicActive
      ? reusableGenericState({ ...prepared, startNewProperty: true })
      : prepared);
  }

  const state = buildState({ snapshot, freshEntry, fromLink, sticky, relink, intention,
    ownerExclusive: false,
  });
  const genericState = genericPublicActive
    ? reusableGenericState(state)
    : state;
  return guardCompleted({
    ...genericState,
    shareTokenId: activeShareId,
    shareCaptureId,
    replayedToken,
    replayQuestion:
      replayedToken && shareCaptureId === null && !selectedRole
        ? ROLE_QUESTION
        : genericState.nextQuestion,
  });
}

/* ---------------------------------------------------------- gravação */

/** Texto simples não é prova de foto: só o marcador de mídia real fecha a ficha. */
/**
 * Respostas curtas e inequívocas para o passo "tipo do imóvel".
 *
 * Esse passo é simples o bastante para não depender do extrator de IA. Além
 * de ser mais rápido, evita o roteiro ficar repetindo a pergunta quando o
 * proprietário responde apenas "Apto" ou "Apartamento".
 *
 * Frases maiores/ambíguas continuam indo para o extrator normal.
 */
function shortPropertyType(text: string | null | undefined): string | null {
  const value = fold(text);
  const types: Record<string, string> = {
    apto: "apartamento",
    apartamento: "apartamento",
    casa: "casa",
    terreno: "terreno",
    lote: "terreno",
    sitio: "sitio",
    chacara: "chacara",
    sobrado: "sobrado",
    studio: "studio",
    flat: "flat",
    kitnet: "kitnet",
    galpao: "galpao",
    loja: "loja",
    "sala comercial": "sala comercial",
  };
  return types[value] ?? null;
}

/** Inteiros curtos no contexto de contagem são inequívocos e dispensam IA. */
function shortCount(text: string | null | undefined): string | null {
  const value = String(text ?? "").trim();
  const match = /^(\d{1,2})(?:\s*(?:dormit[oó]rios?|su[ií]tes?|banheiros?|vagas?))?$/i.exec(value);
  return match && Number(match[1]) > 0 ? match[1]! : null;
}

/** Valor monetário digitado isoladamente, com formato brasileiro inequívoco. */
function shortMoney(text: string | null | undefined): number | null {
  const value = String(text ?? "").trim();
  const match = /^(?:R\$\s*)?(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/i.exec(value);
  if (!match) return null;
  const amount = Number(match[1]!.replace(/\./g, "")) + Number(`0.${match[2] ?? "0"}`);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

/** Rua e número inequívocos não precisam esperar a extração da IA. */
function shortStreetAddress(text: string | null | undefined) {
  const value = String(text ?? "").trim().replace(/\s+/g, " ");
  const match = /^((?:rua|r\.|avenida|av\.?|alameda|travessa|estrada|rodovia|praça|praca)\s+[\p{L}\p{M} .'-]{2,})\s*,?\s+(?:n[º°o.]?\s*)?(\d{1,6})$/iu.exec(value);
  if (!match) return null;
  return { rua: match[1]!.trim(), numero: match[2]! };
}

/** Uma volta sem o link só pode retomar a sessão marcada se responder com rua e número. */
function looksLikeStreetAddress(text: string | null | undefined): boolean {
  return /^(?:rua|r\.|avenida|av\.?|alameda|travessa|estrada|rodovia|praça|praca)\s+[\p{L}\p{M}][^\n]{1,120}?\b\d{1,6}\b/iu.test(String(text ?? "").trim());
}

/** Tudo que o fluxo do link grava. Intenção e origem são fixas. */
function saveInput(
  state: LinkCaptacaoState,
  phone: string,
  patch: Omit<CaptureAnswerInput, "phone">,
) {
  if (state.shareCaptureId !== undefined && state.shareCaptureId !== null) {
    const stepFields: Partial<Record<LinkStepKey, string[]>> = {
      nome: ["nome"],
      endereco: ["cep", "rua", "numero", "bairro", "cidade", "estado", "unidade", "bloco", "torre", "andar", "complemento"],
      condominioPresenca: ["condominioPresenca"],
      nomeCondominio: ["nomeCondominio", "unidade", "bloco", "torre", "andar"],
      documentacao: ["documentacao"],
      tipo: ["tipoImovel"],
      dormitorios: ["dormitorios"],
      suites: ["suites"],
      banheiros: ["banheiros"],
      vagas: ["vagas"],
      metragem: ["metragem"],
      caracteristicas: ["caracteristicas"],
      valor: ["valorPretendido", "valorPretendidoStatus"],
      condominio: ["condominio"],
      custos: ["custos"],
      fotoFrente: ["fotoFrente"],
      observacaoFinal: ["observacaoFinal", "confirmacaoFinal"],
    };
    const allowed = new Set([
      ...stepFields[state.nextStep ?? "nome"] ?? [],
      ...(state.presenter === "corretor" ? ["nome"] : []),
      "corretorNome",
      "corretorCreci",
      "proprietarioNome",
      "observacao",
    ]);
    const scopedPatch = Object.fromEntries(
      Object.entries(patch).filter(([key]) => allowed.has(key)),
    ) as Omit<CaptureAnswerInput, "phone">;
    return {
      ...scopedPatch,
      phone,
      negociacao: state.intention,
      origem: LINK_CAPTACAO_ORIGIN,
      targetCaptureId: state.shareCaptureId ?? undefined,
      deferLinkCompletion: state.nextStep === "fotoFrente",
    } satisfies CaptureAnswerInput;
  }
  const addressish = Boolean(
    patch.cep || patch.rua || patch.numero || patch.bairro || patch.cidade || patch.estado ||
      patch.unidade || patch.bloco || patch.torre || patch.andar || patch.complemento,
  );
  return {
    ...patch,
    phone,
    /* O perfil determina a intenção; o extrator nunca pode alterá-la. */
    negociacao: state.intention,
    origem: LINK_CAPTACAO_ORIGIN,
    /* Só o endereço permite comparar com fichas anteriores ou abrir outro
       imóvel; o nome sozinho nunca decide a identidade do imóvel. */
    novoImovel: state.startNewProperty && addressish ? true : undefined,
    /* A sessão explícita pode atravessar uma ficha pendente antiga, mas só o
       endereço decide qual imóvel reutilizar ou abrir na entrada única. */
    novaSessaoLink: state.startNewProperty && state.snapshot.captureId === null && addressish ? true : undefined,
    targetCaptureId: !state.startNewProperty && !addressish ? state.snapshot.captureId ?? undefined : undefined,
    deferLinkCompletion: state.nextStep === "fotoFrente",
  } satisfies CaptureAnswerInput;
}

/* ------------------------------------------------------- extração (IA) */

const EXTRACTION_RULES = [
  "Você NÃO conversa com o cliente neste turno. Sua única função é EXTRAIR o que o proprietário acabou de responder e gravar com a ferramenta `salvarCadastroVenda`. O texto enviado ao cliente é escrito pelo sistema, não por você.",
  "",
  "REGRAS:",
  "1. Grave apenas o que o proprietário realmente disse. Nunca complete, deduza ou invente valor nenhum.",
  "2. Preencha só os campos que a última resposta informou. Campo sem informação fica de fora.",
  "3. A pergunta pendente está em PERGUNTA PENDENTE. A resposta do proprietário é a última mensagem dele.",
  "4. No endereço, separe rua, número, bairro, cidade, estado e CEP quando estiverem na resposta.",
  "5. Na resposta sobre condomínio, grave o texto completo em `condominio` E separe `unidade`, `bloco`, `torre` quando aparecerem — é isso que diferencia duas unidades do mesmo prédio.",
  "6. Valor pretendido vai em `valorPretendido`, só números (1.200.000 → 1200000); para locação, é o valor mensal do aluguel.",
  "7. Se o proprietário disser algo fora da pergunta pendente (dúvida, comentário, pedido), grave esse texto em `observacao`. Não responda à dúvida.",
  "8. Nunca negocie, nunca avalie o imóvel, nunca prometa nada, nunca opine sobre preço, documentação ou mercado.",
  "9. Se a resposta não tiver nada aproveitável para a pergunta pendente, não chame a ferramenta.",
].join("\n");

/**
 * Campos que o extrator pode gravar.
 *
 * É o mesmo vocabulário de `CaptureAnswerInput`, menos o que não vem do
 * modelo: telefone (vem do canal), intenção (é sempre venda neste fluxo) e
 * origem (é sempre LINK_CAPTACAO).
 */
const SAVE_SCHEMA = z.object({
  nome: z.string().max(120).optional().describe("nome completo do proprietário"),
  cep: z.string().max(20).optional(),
  rua: z.string().max(200).optional().describe("logradouro, sem número"),
  numero: z.string().max(30).optional(),
  bairro: z.string().max(120).optional(),
  cidade: z.string().max(120).optional(),
  estado: z.string().max(2).optional().describe("UF, ex: SP"),
  condominio: z.string().max(300).optional().describe("valor do condomínio"),
  condominioPresenca: z.enum(["yes", "no", "unknown"]).optional(),
  nomeCondominio: z.string().max(120).optional(),
  corretorNome: z.string().max(120).optional(),
  corretorCreci: z.string().max(60).optional(),
  proprietarioNome: z.string().max(120).optional(),
  unidade: z.string().max(60).optional().describe("apartamento, casa ou lote"),
  bloco: z.string().max(60).optional(),
  torre: z.string().max(60).optional(),
  andar: z.string().max(60).optional(),
  documentacao: z.string().max(300).optional().describe("situação da documentação"),
  tipoImovel: z.string().max(60).optional(),
  dormitorios: z.string().max(300).optional(),
  suites: z.string().max(300).optional(),
  banheiros: z.string().max(300).optional(),
  vagas: z.string().max(300).optional(),
  metragem: z.string().max(300).optional(),
  custos: z.string().max(300).optional().describe("condomínio e IPTU"),
  valorPretendido: z.number().min(0).optional().describe("valor pretendido, só números"),
  caracteristicas: z.string().max(300).optional().describe("metragem do terreno, ex.: 10 x 40 metros"),
  valorPretendidoStatus: z.string().max(300).optional(),
  observacaoFinal: z.string().max(500).optional(),
  confirmacaoFinal: z.string().max(40).optional(),
  observacao: z
    .string()
    .max(500)
    .optional()
    .describe("o que o proprietário disse fora da pergunta pendente"),
});

type SaveToolInput = z.infer<typeof SAVE_SCHEMA>;

function extractionPrompt(state: LinkCaptacaoState): string {
  const roteiro = LINK_STEPS.map((step, index) => {
    const mark = state.answered.includes(step.key) ? "x" : " ";
    return `${index + 1}. [${mark}] ${step.label}`;
  }).join("\n");

  return [
    `CADASTRO DE IMÓVEL PARA ${state.intention === "locacao" ? "LOCAÇÃO" : "VENDA"} (perfil definido no início do fluxo).`,
    "",
    EXTRACTION_RULES,
    "",
    "ROTEIRO (x = já gravado, não pergunte nem grave de novo):",
    roteiro,
    "",
    state.nextQuestion
      ? `PERGUNTA PENDENTE (foi esta que o proprietário acabou de responder):\n${state.nextQuestion}`
      : "ROTEIRO COMPLETO: nada mais a gravar, a não ser correção explícita do proprietário.",
  ].join("\n");
}

/* --------------------------------------------------------- o fluxo */

/**
 * Um turno do fluxo LINK_CAPTACAO.
 *
 * A frase que vai para o cliente é decidida aqui, sempre:
 *  - roteiro terminado agora → fechamento exato;
 *  - informação fora do roteiro neste turno → frase neutra exata + a pergunta
 *    pendente (a informação já foi para as Observações da ficha);
 *  - caso normal → a pergunta pendente, no texto do roteiro.
 *
 * O modelo não escreve nada disso. Ele só grava — e quando não há nada para
 * gravar, o modelo nem é chamado.
 */
export async function linkCaptacaoReply(
  db: AdminDb,
  agent: AgentRow,
  turns: readonly AgentTurn[],
  phone: string,
  state: LinkCaptacaoState,
  configuredModel: string | null = null,
  trustedWhatsappMedia = false,
): Promise<AgentReply> {
  const toolCalls: { tool: string; input: string }[] = [];
  const lastUser =
    [...turns].reverse().find((turn) => turn.role === "user")?.content ?? null;
  const spokeBefore = turns.some((turn) => turn.role === "assistant");

  if (state.completionGuard) {
    return {
      text: "Solicite outro link para cadastro.",
      handoff: false,
      handoffReason: null,
      usedProperties: [],
      toolCalls,
    };
  }

  if (state.shareTokenId !== undefined && state.shareTokenId !== null) {
    const currentShare = await latestCaptureShareForSender(db, phone);
    if (
      !currentShare ||
      currentShare.status !== "redeemed" ||
      currentShare.id !== state.shareTokenId ||
      currentShare.captureId !== (state.shareCaptureId ?? null)
    ) {
      return {
        text: "Solicite outro link para cadastro.",
        handoff: false,
        handoffReason: null,
        usedProperties: [],
        toolCalls,
      };
    }
  }

  let shareBindingConflict = false;
  const saveAnswer = async (
    patch: Omit<CaptureAnswerInput, "phone">,
    options: Partial<CaptureAnswerInput> = {},
    database: AdminDb = db,
  ): Promise<CaptureSaveResult> => {
    const addressCore = Boolean(
      patch.cep || patch.rua || patch.numero || patch.bairro || patch.cidade || patch.estado,
    );
    const indicatedOwner = state.presenter === "corretor"
      ? brokerOnboarding(turns).ownerName
      : null;
    const actualOwnerName = indicatedOwner && classifyOptionalAnswer(indicatedOwner) !== "não informado"
      ? indicatedOwner.slice(0, 120)
      : null;
    const brokerObservation = state.presenter === "corretor" && state.broker
      ? `Apresentado por corretor: ${state.broker.name} · CRECI ${state.broker.creci}. Contato WhatsApp da captação: ${state.broker.phone}; este é o telefone do corretor/contato, não é o telefone confirmado do proprietário.`
      : null;
    const brokerPatch = brokerObservation
      ? {
          ...patch,
          corretorNome: state.broker!.name,
          corretorCreci: state.broker!.creci,
          proprietarioNome: actualOwnerName ?? "Não informado",
      ...(addressCore
        ? { nome: state.snapshot.ownerId === null ? "Contato de corretor" : state.snapshot.ownerName ?? undefined }
        : {}),
          observacao: [patch.observacao, brokerObservation].filter(Boolean).join("\n"),
        }
      : patch;
    const input = {
      ...saveInput(
        state,
        state.ownerPhone ?? phone,
        brokerPatch,
      ),
      ...options,
    };
    const reservesFirstAddress = Boolean(
      state.shareTokenId !== undefined &&
      state.shareTokenId !== null &&
      state.shareCaptureId == null &&
      state.nextStep === "endereco" &&
      addressCore,
    );
    if (!reservesFirstAddress) return saveCaptureAnswer(database, input);

    const conflict = (): CaptureSaveResult => ({
      saved: false,
      reason: "Este link já está vinculado a outro cadastro. Solicite outro link.",
      snapshot: state.snapshot,
    });
    try {
      return await database.transaction(async (transaction) => {
        const tx = transaction as unknown as AdminDb;
        /* This no-op conditional UPDATE is the SQLite write reservation. It
           serializes first-address writes across workers, not just this process. */
        const [reservation] = await transaction
          .update(schema.captureShareTokens)
          .set({ captureId: sql`${schema.captureShareTokens.captureId}` })
          .where(and(
            eq(schema.captureShareTokens.id, state.shareTokenId!),
            eq(schema.captureShareTokens.senderPhone, senderKey(phone)),
            eq(schema.captureShareTokens.status, "redeemed"),
            isNull(schema.captureShareTokens.captureId),
          ))
          .returning({ id: schema.captureShareTokens.id });
        if (!reservation) {
          shareBindingConflict = true;
          return conflict();
        }

        const saved = await saveCaptureAnswer(tx, input);
        if (!saved.saved || saved.captureId === null) return saved;

        const [bound] = await transaction
          .update(schema.captureShareTokens)
          .set({ captureId: saved.captureId })
          .where(and(
            eq(schema.captureShareTokens.id, state.shareTokenId!),
            eq(schema.captureShareTokens.senderPhone, senderKey(phone)),
            eq(schema.captureShareTokens.status, "redeemed"),
            isNull(schema.captureShareTokens.captureId),
          ))
          .returning({ id: schema.captureShareTokens.id });
        if (!bound) throw new Error("capture-share-binding-conflict");
        return saved;
      });
    } catch (error) {
      if (error instanceof Error && error.message === "capture-share-binding-conflict") {
        shareBindingConflict = true;
        return conflict();
      }
      throw error;
    }
  };

  const rejectedShareConflict = (): AgentReply => ({
    text: "Solicite outro link para cadastro.",
    handoff: false,
    handoffReason: null,
    usedProperties: [],
    toolCalls,
  });

  if (state.replayedToken) {
    return {
      text: state.replayQuestion ?? state.nextQuestion ?? "Solicite outro link para cadastro.",
      handoff: false,
      handoffReason: null,
      usedProperties: [],
      toolCalls,
    };
  }

  /* A mensagem de entrada identifica o perfil antes das perguntas cadastrais. */
  let genericIndex = -1;
  let sawGenericEntry = false;
  let closingIndex = -1;
  turns.forEach((turn, index) => {
    if (turn.role === "assistant" && turn.content.includes(CLOSING_MESSAGE)) closingIndex = index;
  });
  const seenTokenEntries = new Set<number>();
  for (let index = 0; index < turns.length; index++) {
    const turn = turns[index]!;
    if (turn.role !== "user") continue;
    if (
      isGenericLinkStart(turn.content) &&
      state.genericPublic &&
      state.fromLink &&
      index > closingIndex &&
      !state.completionGuard &&
      !state.complete
    ) {
      if (!sawGenericEntry) genericIndex = index;
      sawGenericEntry = true;
      continue;
    }
    const token = shareTokenFromMessage(turn.content);
    if (token) {
      const verified = await verifiedShareToken(db, phone, token);
      if (
        verified &&
        verified.id === state.shareTokenId &&
        !seenTokenEntries.has(verified.id)
      ) {
        seenTokenEntries.add(verified.id);
        genericIndex = index;
      }
    }
  }
  if (genericIndex >= 0) {
    const replies = turns.slice(genericIndex + 1).filter(
      (turn) =>
        turn.role === "user" &&
        !shareTokenFromMessage(turn.content) &&
        !isGenericLinkStart(turn.content),
    );
    if (replies.length === 0) {
      const newPublicEntry = fold(turns[genericIndex]?.content)
        .startsWith(fold(GENERIC_ENTRY_MESSAGE));
      return { text: newPublicEntry ? ROLE_QUESTION : OWNER_ENTRY_INTRO,
        handoff: false, handoffReason: null, usedProperties: [], toolCalls };
    }

    /* Enquanto o contato não informar um perfil válido, cada nova resposta
       precisa ter chance de corrigir a anterior. Antes olhávamos somente
       replies[0], então um primeiro erro deixava a conversa presa para sempre. */
    const roleReply = [...replies].reverse().find((turn) => linkRole(turn.content) !== null);
    if (!roleReply) {
      return { text: `${ROLE_REJECTED}\n\n${ROLE_QUESTION}`, handoff: false, handoffReason: null, usedProperties: [], toolCalls };
    }
    const role = linkRole(roleReply.content);
    const isOwner = role === "proprietario" || role === "locador";
    /* A identificação de perfil é controle do fluxo, não dado do imóvel.
       Assim que um perfil permitido é informado corretamente, mesmo depois de
       respostas inválidas, o roteiro avança para o nome. */
    if (isOwner && state.presenter === "proprietario" && roleReply === replies[replies.length - 1]) {
      /* No turno imediatamente após o perfil, só perguntamos o nome.
         A resposta seguinte será gravada; contato antigo espera o endereço
         antes de escolher uma ficha. */
      return finish(state, { offScript: false, toolCalls });
    }
  }

  if (state.presenter === "corretor") {
    const baseBrokerTurns = state.brokerBaseTurns ?? [];
    const inboundBrokerTurn = state.brokerInboundTurn;
    const beforeInbound = brokerOnboarding(baseBrokerTurns);
    if (
      !trustedWhatsappMedia &&
      inboundBrokerTurn !== null &&
      inboundBrokerTurn !== undefined &&
      /^\[imagem:/i.test(inboundBrokerTurn.trim()) &&
      beforeInbound.photoStep
    ) {
      return {
        text: linkQuestion("fotoFrente"),
        handoff: false,
        handoffReason: null,
        usedProperties: [],
        toolCalls,
      };
    }
    let draft = state.brokerDraft ?? null;
    const session = state.brokerDraftSession;
    let onboarding = brokerOnboarding(state.brokerTurns ?? turns);
    if (session && inboundBrokerTurn !== null && inboundBrokerTurn !== undefined) {
      const answerOrder: BrokerDraftStepKey[] = [
        "role", "creci", "nome", "intencao", "proprietarioNome", "endereco",
        "condominioPresenca", "nomeCondominio", "documentacao", "tipo",
        "dormitorios", "suites", "banheiros", "vagas", "metragem",
        "caracteristicas", "valor", "condominio", "custos", "fotoFrente",
        "observacaoFinal",
      ];
      const acceptedStep = answerOrder.find((stepKey) => {
        const value = onboarding.acceptedAnswers[stepKey];
        return value !== undefined && draft?.answers[stepKey] !== value;
      });
      const value = acceptedStep ? onboarding.acceptedAnswers[acceptedStep] : undefined;
      if (acceptedStep && value !== undefined) {
        let leadId = draft?.leadId;
        if (leadId === undefined) {
          leadId = await ensureBrokerLead(db, phone);
          draft = await beginBrokerLeadDraft(db, {
            phone,
            session,
            leadId,
          });
        }
        const dedupeKey = await sha256Hex(
          `${session.kind}:${session.key}:${acceptedStep}:${fold(inboundBrokerTurn)}`,
        );
        const recorded = await recordBrokerLeadDraftAnswer(db, {
          phone,
          leadId,
          session,
          stepKey: acceptedStep,
          value,
          inboundTurnDedupeKey: dedupeKey,
        });
        draft = recorded.draft;
        const entryMarker = session.kind === "token"
          ? `LINK_CAPTACAO:${session.key}`
          : GENERIC_ENTRY_MESSAGE;
        onboarding = brokerOnboarding([
          ...brokerDraftTurns(draft, entryMarker),
        ]);
      }
      if (draft && onboarding.complete && draft.status === "active") {
        draft = await markBrokerLeadDraftComplete(db, {
          phone,
          leadId: draft.leadId,
          session,
        });
      }
    }
    const pendingBroker = onboarding.pendingQuestion;
    if (pendingBroker) {
      return {
        text: pendingBroker,
        handoff: false,
        handoffReason: null,
        usedProperties: [],
        toolCalls,
      };
    }
    if (!onboarding.complete || !state.broker) {
      return {
        text: pendingBroker ?? "Qual é o seu CRECI?",
        handoff: false,
        handoffReason: null,
        usedProperties: [],
        toolCalls,
      };
    }
    if (state.shareTokenId !== undefined && state.shareTokenId !== null) {
      const finalized = await completeCaptureShareLead(db, state.shareTokenId, phone);
      if (!finalized) return rejectedShareConflict();
    }
    return {
      text: BROKER_LEAD_CLOSING_MESSAGE,
      handoff: false,
      handoffReason: null,
      usedProperties: [],
      toolCalls,
    };
  }

  /* Clique no link, ou primeiro contato deste telefone: não há resposta para
     extrair, só a abertura do roteiro. O modelo não é chamado.
     Atenção: "conversa nova" NÃO basta para pular a extração. Quem volta dias
     depois numa thread nova costuma voltar já respondendo a pergunta pendente,
     e essa resposta tem de ser gravada na hora — por isso a condição olha o
     que está GRAVADO (`answered`), não o histórico da conversa. */
  if (state.freshEntry || (!spokeBefore && state.answered.length === 0)) {
    return finish(state, { offScript: false, toolCalls });
  }

  /* Nome da nova ENTRADA_LINK_CAPTACAO: grava de forma determinística.
     Para contato conhecido, a ficha só é escolhida quando chegar o endereço. */
  if (state.nextStep === "nome" && state.answered.length === 0 && lastUser) {
    const nome = String(lastUser).trim();
    if (nome && !isGenericLinkStart(nome) && linkRole(nome) === null) {
      const saved = await saveAnswer({
        nome,
        negociacao: state.intention,
        origem: LINK_CAPTACAO_ORIGIN,
      }, { novaSessaoLink: true });
      toolCalls.push({ tool: "salvarCadastroVenda", input: JSON.stringify({ nome }) });
      if (saved.saved) {
        const nextState: LinkCaptacaoState = {
          ...state,
          freshEntry: false,
          startNewProperty: Boolean(state.genericPublic),
          snapshot: saved.snapshot,
          answered: ["nome"],
          nextStep: "endereco",
          nextQuestion: linkQuestion("endereco"),
          complete: false,
        };
        return finish(nextState, { offScript: false, toolCalls });
      }
    }
  }

  /* Tipo do imóvel: respostas curtas e inequívocas são gravadas de forma
     determinística. Isso evita depender do extrator para "Apto"/"Apartamento"
     e impede a repetição da mesma pergunta. */
  if (state.nextStep === "tipo") {
    const tipoImovel = shortPropertyType(lastUser);
    if (tipoImovel) {
      const saved = await saveAnswer({ tipoImovel });
      toolCalls.push({
        tool: "salvarCadastroVenda",
        input: JSON.stringify({ tipoImovel }),
      });
      if (saved.saved) {
        return finish(
          await reload(db, state.ownerPhone ?? phone, state.startNewProperty, state.genericPublic),
          { offScript: false, toolCalls },
        );
      }
      return finish(state, { offScript: false, toolCalls });
    }
  }

  if (state.nextStep === "condominioPresenca") {
    const answer = fold(lastUser).replace(/[.!?]+$/g, "").trim();
    const condominioPresenca =
      /^(?:sim|s|tem|fica em condominio)$/.test(answer) ? "yes"
        : /^(?:nao|n|nao tem|sem condominio)$/.test(answer) ? "no"
          : /^(?:nao sei|n sei|nao tenho certeza|desconheco)$/.test(answer) ? "unknown"
            : null;
    if (condominioPresenca) {
      const saved = await saveAnswer({ condominioPresenca });
      toolCalls.push({ tool: "salvarCadastroVenda", input: JSON.stringify({ condominioPresenca }) });
      return finish(
        saved.saved
          ? await reload(db, state.ownerPhone ?? phone, state.startNewProperty, state.genericPublic)
          : state,
        { offScript: false, toolCalls },
      );
    }
  }

  if (state.nextStep === "nomeCondominio") {
    const answer = String(lastUser ?? "").trim();
    if (!answer) return finish(state, { offScript: false, toolCalls });
    const unknown = classifyOptionalAnswer(answer) === "não informado";
    const unit = unknown ? undefined : /(?:unidade|apto?\.?|apartamento|casa|lote)\s*#?\s*([a-z0-9-]+)/i.exec(answer)?.[1];
    const block = unknown ? undefined : /\bbloco\s+([a-z0-9-]+)/i.exec(answer)?.[1];
    const patch = {
      nomeCondominio: unknown ? "Não informado" : answer.slice(0, 120),
      ...(unit ? { unidade: unit } : {}),
      ...(block ? { bloco: block } : {}),
    };
    const saved = await saveAnswer(patch);
    toolCalls.push({ tool: "salvarCadastroVenda", input: JSON.stringify(patch) });
    return finish(
      saved.saved
        ? await reload(db, state.ownerPhone ?? phone, state.startNewProperty, state.genericPublic)
        : state,
      { offScript: false, toolCalls },
    );
  }

  const countField: Partial<Record<LinkStepKey, keyof SaveToolInput>> = {
    dormitorios: "dormitorios",
    suites: "suites",
    banheiros: "banheiros",
    vagas: "vagas",
  };
  const numericField = state.nextStep ? countField[state.nextStep] : undefined;
  const count = numericField ? shortCount(lastUser) : null;
  const price = state.nextStep === "valor" ? shortMoney(lastUser) : null;
  if ((numericField && count) || price !== null) {
    const input = (numericField && count
      ? { [numericField]: count }
      : { valorPretendido: price! }) as SaveToolInput;
    const saved = await saveAnswer(input);
    toolCalls.push({ tool: "salvarCadastroVenda", input: JSON.stringify(input) });
    return finish(
      saved.saved
        ? await reload(db, state.ownerPhone ?? phone, state.startNewProperty, state.genericPublic)
        : state,
      { offScript: false, toolCalls },
    );
  }

  const optionalValue = classifyOptionalAnswer(lastUser);
  const skipRequested = optionalValue === "não informado" || optionalValue === "não se aplica";
  const noneRequested = optionalValue === "0";

  let skipInput: SaveToolInput | null = null;
  if (state.nextStep === "documentacao" && skipRequested) {
    skipInput = { documentacao: "não informado" };
  } else if (state.nextStep === "valor" && skipRequested) {
    skipInput = { valorPretendidoStatus: "não informado" };
  } else {
    const optionalMap: Partial<Record<LinkStepKey, keyof SaveToolInput>> = {
      dormitorios: "dormitorios",
      suites: "suites",
      banheiros: "banheiros",
      vagas: "vagas",
      metragem: "metragem",
      caracteristicas: "caracteristicas",
      condominio: "condominio",
      custos: "custos",
    };
    const optionalField = state.nextStep ? optionalMap[state.nextStep] : undefined;
    if (optionalField && (skipRequested || noneRequested)) {
      skipInput = { [optionalField]: optionalValue! } as SaveToolInput;
    }
  }

  if (skipInput) {
    await saveAnswer(skipInput);
    toolCalls.push({ tool: "salvarCadastroVenda", input: JSON.stringify(skipInput) });
    return finish(
      await reload(db, state.ownerPhone ?? phone, state.startNewProperty, state.genericPublic),
      { offScript: false, toolCalls },
    );
  }

  if (state.nextStep === "fotoFrente" && missingFacadePhoto(lastUser)) {
    const saved = await saveAnswer({
      fotoFrente: "PENDENTE: foto da fachada não enviada pelo proprietário",
      observacao: "Foto da fachada não disponível; equipe deve solicitar e conferir a imagem antes da aprovação.",
    });
    toolCalls.push({ tool: "salvarCadastroVenda", input: JSON.stringify({ fotoFrente: "PENDENTE" }) });
    if (!saved?.saved) return finish(state, { offScript: false, toolCalls });
    const next = await reload(db, state.ownerPhone ?? phone, state.startNewProperty, state.genericPublic);
    const response = finish(next, { offScript: false, toolCalls });
    return { ...response, text: ["A foto da fachada ficou pendente para conferência da nossa equipe.", response.text].join("\n\n") };
  }

  if (state.nextStep === "fotoFrente" && !/^\[imagem:/i.test(String(lastUser ?? "").trim())) {
    return finish(state, { offScript: false, toolCalls });
  }

  if (state.nextStep === "observacaoFinal") {
    const answer = String(lastUser ?? "").trim();
    if (!answer || shareTokenFromMessage(answer) || /^\[imagem:/i.test(answer)) return finish(state, { offScript: false, toolCalls });
    const noNotes = classifyOptionalAnswer(answer) === "não informado" ||
      /^(?:nao|nada|nenhuma|nenhum|nao tenho|sem observacoes|pular|nao se aplica|ok)$/i.test(fold(answer));
    const patch: SaveToolInput = {
      observacaoFinal: noNotes ? "Não informado" : answer.slice(0, 500),
      /* Persisted completion marker only: the client never has an extra OK step. */
      confirmacaoFinal: "OK",
    };
    let saved: CaptureSaveResult | null = null;
    if (state.shareTokenId !== undefined && state.shareTokenId !== null && !state.genericPublic) {
      const tokenId = state.shareTokenId;
      const expectedCaptureId = state.shareCaptureId;
      if (expectedCaptureId === undefined || expectedCaptureId === null) {
        return rejectedShareConflict();
      }
      let saveFailure: CaptureSaveResult | null = null;
      try {
        saved = await db.transaction(async (transaction) => {
          const tx = transaction as unknown as AdminDb;
          /* Reserve the exact redeemed token row before touching the capture. */
          const [reservation] = await transaction
            .update(schema.captureShareTokens)
            .set({ captureId: sql`${schema.captureShareTokens.captureId}` })
            .where(and(
              eq(schema.captureShareTokens.id, tokenId),
              eq(schema.captureShareTokens.senderPhone, senderKey(state.ownerPhone ?? phone)),
              eq(schema.captureShareTokens.status, "redeemed"),
              eq(schema.captureShareTokens.captureId, expectedCaptureId),
            ))
            .returning({ id: schema.captureShareTokens.id });
          if (!reservation) throw new Error("capture-share-finalization-conflict");

          const current = await latestCaptureShareForSender(tx, state.ownerPhone ?? phone);
          if (
            current?.id !== tokenId ||
            current.status !== "redeemed" ||
            current.captureId !== expectedCaptureId
          ) {
            throw new Error("capture-share-finalization-conflict");
          }

          const result = await saveAnswer(patch, {}, tx);
          if (!result.saved || result.captureId !== expectedCaptureId) {
            saveFailure = result;
            throw new Error("capture-share-finalization-save-failed");
          }
          if (!await completeCaptureShareTokenForCapture(
            tx,
            tokenId,
            state.ownerPhone ?? phone,
            expectedCaptureId,
          )) {
            throw new Error("capture-share-finalization-conflict");
          }
          return result;
        });
      } catch (error) {
        if (error instanceof Error && error.message === "capture-share-finalization-conflict") {
          return rejectedShareConflict();
        }
        if (error instanceof Error && error.message === "capture-share-finalization-save-failed" && saveFailure) {
          return finish(state, { offScript: false, toolCalls });
        }
        throw error;
      }
    } else {
      /* A public entry finalizes only its draft, never a sender's unrelated bearer token. */
      saved = await saveAnswer(patch);
    }
    if (!saved?.saved) return finish(state, { offScript: false, toolCalls });
    return finish(await reload(db, state.ownerPhone ?? phone, false, state.genericPublic), { offScript: false, toolCalls });
  }

  if (
    state.nextStep === "fotoFrente" &&
    /^\[imagem:/i.test(String(lastUser ?? "").trim())
  ) {
    if (!trustedWhatsappMedia) {
      return finish(state, { offScript: false, toolCalls });
    }
    /* A marca só chega aqui após validação de mídia real no webhook. */
    const input = { fotoFrente: "Foto da fachada recebida" };
    const saved = await saveAnswer(input);
    toolCalls.push({ tool: "salvarCadastroVenda", input: JSON.stringify(input) });
    if (!saved.saved) return finish(state, { offScript: false, toolCalls });
    return finish(await reload(db, state.ownerPhone ?? phone, false, state.genericPublic), { offScript: false, toolCalls });
  }

  if (state.nextStep === "endereco") {
    const address = shortStreetAddress(lastUser);
    if (address) {
      const saved = await saveAnswer(address);
      toolCalls.push({ tool: "salvarCadastroVenda", input: JSON.stringify(address) });
      if (shareBindingConflict) return rejectedShareConflict();
      if (saved.saved) {
        return finish(
          await reload(db, state.ownerPhone ?? phone, false, state.genericPublic),
          { offScript: false, toolCalls },
        );
      }
    }
  }

  if (!gatewayConfigured()) {
    /* Sem provedor de IA não há extração — mas o roteiro não pode travar nem
       improvisar: a pergunta pendente é repetida. */
    return finish(state, { offScript: false, toolCalls });
  }

  const allowance = handoffAllowance(lastUser);
  let offScript = false;
  let handoffReason: string | null = null;

  let addressSaved = false;
  const saveTool = {
    salvarCadastroVenda: tool({
      description:
        "Grava AGORA na ficha de captação o que o proprietário acabou de responder. Use só com os campos que a resposta informou.",
      inputSchema: SAVE_SCHEMA,
      async execute(input: SaveToolInput) {
        const substantive = Object.keys(input).some((key) => key !== "observacao" && input[key as keyof SaveToolInput] !== undefined);
        if (input.observacao && !substantive) offScript = true;
        const result = await saveAnswer(input);
        if (result.saved && state.nextStep === "endereco" &&
            (input.cep || input.rua || input.numero || input.bairro || input.cidade || input.estado)) {
          addressSaved = true;
        }
        return result.saved
          ? { salvo: true, cadastroId: result.captureId, aviso: result.duplicateUnit }
          : { salvo: false, motivo: result.reason };
      },
    }),
  };

  /* Transferência existe só quando o proprietário pede uma pessoa ou aparece
     assunto jurídico. Sem isso, a ferramenta não é oferecida — o roteiro não
     tem como ser abandonado. */
  const handoffTool = {
    pedirAtendimentoHumano: tool({
      description:
        "Transferência para humano. Use só se o proprietário pedir uma pessoa/corretor ou houver assunto jurídico.",
      inputSchema: z.object({ motivo: z.string().min(3).max(200) }),
      async execute({ motivo }: { motivo: string }) {
        handoffReason = motivo;
        return { ok: true };
      },
    }),
  };

  const result = await generateText({
    model: gateway(pickModel(agent.model, configuredModel)),
    system: extractionPrompt(state),
    messages: turns.slice(-8).map((turn) => ({ role: turn.role, content: turn.content })),
    tools: allowance.allowed ? { ...saveTool, ...handoffTool } : saveTool,
    stopWhen: [stepCountIs(3)],
  });

  if (shareBindingConflict) return rejectedShareConflict();

  for (const step of result.steps) {
    for (const call of step.toolCalls) {
      toolCalls.push({ tool: call.toolName, input: JSON.stringify(call.input ?? {}) });
    }
  }

  if (handoffReason) {
    return {
      text: agent.transferMessage || "Vou chamar um corretor para continuar seu atendimento.",
      handoff: true,
      handoffReason,
      usedProperties: [],
      toolCalls,
    };
  }

  return finish(
    await reload(
      db,
      state.ownerPhone ?? phone,
      state.startNewProperty && !addressSaved,
      state.genericPublic,
    ),
    { offScript, toolCalls },
  );
}

/**
 * Relê o estado do banco: é o gravado que decide a próxima pergunta.
 *
 * `relink` continua valendo enquanto o endereço do novo imóvel não abrir a
 * segunda ficha — sem isso, uma extração que não gravou nada faria o fluxo
 * repetir o fechamento do cadastro ANTERIOR em vez de insistir no endereço.
 */
async function reload(
  db: AdminDb,
  phone: string,
  relink: boolean,
  genericPublic = false,
): Promise<LinkCaptacaoState> {
  const baseSnapshot = await captureSnapshot(db, phone);
  const session = await linkCaptureSession(db, baseSnapshot.ownerId);
  const snapshot = !genericPublic && session.activeCaptureId !== null
    ? await captureSnapshot(db, phone, session.activeCaptureId)
    : baseSnapshot;
  const currentShare = await latestCaptureShareForSender(db, phone);
  const state = buildState({ snapshot, freshEntry: false, fromLink: true, sticky: true, relink,
    ownerExclusive: !genericPublic && currentShare?.status === "redeemed" && snapshot.intention !== "locacao",
  });
  return genericPublic ? reusableGenericState(state) : state;
}

/** A frase que vai para o cliente. Sempre uma das três do roteiro. */
function finish(
  state: LinkCaptacaoState,
  context: { offScript: boolean; toolCalls: { tool: string; input: string }[] },
): AgentReply {
  const text = state.complete
    ? CLOSING_MESSAGE
    : context.offScript
      ? `${OFF_SCRIPT_REPLY}\n\n${state.nextQuestion}`
      : (state.nextQuestion ?? CLOSING_MESSAGE);

  return {
    text,
    handoff: false,
    handoffReason: null,
    usedProperties: [],
    toolCalls: context.toolCalls,
  };
}

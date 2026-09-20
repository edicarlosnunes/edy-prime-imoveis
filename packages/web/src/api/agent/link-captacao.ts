/**
 * LINK_CAPTACAO — cadastro de imóvel para VENDA pelo próprio proprietário.
 *
 * Fluxo exclusivo de quem entra pelo link de captação. Quem entra por aqui já
 * declarou o que quer: cadastrar um imóvel para venda. Por isso este fluxo
 * NUNCA pergunta intenção, nunca oferece imóvel, nunca fala de compra ou
 * locação e não chama a busca de imóveis.
 *
 * Diferenças em relação ao roteiro do WhatsApp (`agent/owner-capture.ts`),
 * que continua intacto:
 *  - a pergunta de negociação não existe: a intenção é gravada como `venda`;
 *  - o roteiro tem pergunta de condomínio/unidade e termina na foto da frente;
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
import type { AdminDb } from "../lib/admin-base";
import { ownerPhoneKey } from "../lib/owner-identity";
import {
  captureSnapshot,
  saveCaptureAnswer,
  type CaptureAnswerInput,
  type CaptureSnapshot,
} from "./owner-capture";
import { gateway, gatewayConfigured } from "./gateway";
import { pickModel } from "./model";
import { handoffAllowance } from "./handoff-guard";
import type { AgentReply, AgentRow, AgentTurn } from "./broker";

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

const GENERIC_ENTRY_MESSAGE = "Vamos cadastrar seu imóvel?";
const ROLE_QUESTION = "Você é o proprietário do imóvel ou corretor?";
const ROLE_REJECTED = "Nos desculpe, este cadastro precisa ser realizado pelo proprietário do imóvel ou corretor, pois teremos algumas informações que somente eles poderão confirmar.";

const OWNER_ENTRY_MESSAGE = "Quero cadastrar meu imóvel para venda";
const BROKER_ENTRY_MESSAGE = "Sou corretor e quero apresentar um imóvel";

const hasBrokerToken = (text: string | null | undefined) => {
  const value = fold(text);
  return (
    value.includes(fold(LINK_CAPTACAO_BROKER_TOKEN)) ||
    value === fold(BROKER_ENTRY_MESSAGE) ||
    value === fold(GENERIC_ENTRY_MESSAGE)
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

/** A mensagem carrega a marca do link? */
export const hasLinkToken = (text: string | null | undefined) => {
  const value = fold(text);
  return (
    value.includes(fold(LINK_CAPTACAO_TOKEN)) ||
    value === fold(OWNER_ENTRY_MESSAGE) ||
    value === fold(BROKER_ENTRY_MESSAGE) ||
    value === fold(GENERIC_ENTRY_MESSAGE)
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
  { key: "documentacao", label: "Documentação", verbatim: true, question: "Qual é a situação da documentação do imóvel?" },
  { key: "tipo", label: "Tipo de imóvel", question: "Qual é o tipo do imóvel? Ex.: apartamento, casa, terreno, sítio ou outro." },
  { key: "dormitorios", label: "Dormitórios", question: "Quantos dormitórios? Se não se aplicar, pode pular." },
  { key: "suites", label: "Suítes", question: "Quantas suítes? Se não se aplicar, pode pular." },
  { key: "banheiros", label: "Banheiros", question: "Quantos banheiros? Se não se aplicar, pode pular." },
  { key: "vagas", label: "Vagas de garagem", question: "Quantas vagas de garagem? Se não se aplicar, pode pular." },
  { key: "metragem", label: "Área útil ou construída", question: "Qual é a área útil ou construída? Ex.: 75 m²." },
  { key: "caracteristicas", label: "Metragem do terreno", question: "Qual é a metragem do terreno? Ex.: 10 x 40 metros." },
  { key: "valor", label: "Valor pretendido", question: "Qual é o valor pretendido do imóvel?" },
  { key: "condominio", label: "Valor do condomínio", question: "Qual é o valor do condomínio? Se não houver, pode pular." },
  { key: "custos", label: "Valor do IPTU", question: "Qual é o valor do IPTU? Se não souber, pode pular." },
  { key: "fotoFrente", label: "Foto da frente", verbatim: true, question: "Para finalizar, envie uma foto da frente ou fachada do imóvel." },
] as const;

export type LinkStepKey = (typeof LINK_STEPS)[number]["key"];

/** Pergunta fora do roteiro: a resposta é esta, sem variação. */
export const OFF_SCRIPT_REPLY =
  "Certo, vamos verificar essa informação e, se necessário, nossa equipe te dá um retorno.";

/** Fechamento, depois da foto. */
export const CLOSING_MESSAGE =
  "Cadastro concluído com sucesso! Em breve entraremos em contato para dar continuidade ao atendimento.";

/** Imóvel sem condomínio: a pergunta de custos vira só IPTU. */
const NO_CONDO = ["terreno", "casa", "chacara", "sitio", "galpao", "area", "lote"];
const NO_CONDO_ANSWER = /^(nao|nenhum|sem condominio|n)\b/;

/** Texto exato da pergunta. Só `custos` se adapta, porque pode não haver condomínio. */
export function linkQuestion(
  key: LinkStepKey,
  context: { propertyType?: string | null; condominio?: string | null } = {},
): string {
  const step = LINK_STEPS.find((item) => item.key === key)!;
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
}

/** Passos já respondidos — lidos do que está GRAVADO, nunca da conversa. */
function linkAnswered(snapshot: CaptureSnapshot): LinkStepKey[] {
  const answers = snapshot.answers as Record<string, string | undefined>;
  const filled = (value: unknown) => typeof value === "string" && value.trim().length > 0;
  const done = new Set<LinkStepKey>();
  if (filled(snapshot.ownerName)) done.add("nome");
  if (snapshot.answered.includes("endereco")) done.add("endereco");
  if (filled(snapshot.propertyType)) done.add("tipo");
  if (typeof snapshot.askingPrice === "number" && snapshot.askingPrice > 0) done.add("valor");
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
  ] as const) {
    if (filled(answers[key])) done.add(key);
  }
  return LINK_STEPS.filter((step) => done.has(step.key)).map((step) => step.key);
}

function buildState(input: {
  snapshot: CaptureSnapshot;
  freshEntry: boolean;
  fromLink: boolean;
  sticky: boolean;
  /** Clique no link depois do fechamento do cadastro anterior. */
  relink: boolean;
}): LinkCaptacaoState {
  const { snapshot, freshEntry } = input;
  const answersAll = linkAnswered(snapshot);
  const completeBefore = answersAll.length === LINK_STEPS.length;

  /* Clique no link com o cadastro anterior concluído: o proprietário quer
     cadastrar OUTRO imóvel. O nome já é conhecido, o resto começa do zero.
     Vale também nos turnos seguintes ao clique (`relink`), porque até o
     endereço chegar a ficha lida do banco ainda é a anterior, já concluída. */
  const startNewProperty = (freshEntry || input.relink) && completeBefore;
  const answered = startNewProperty
    ? answersAll.filter((key) => key === "nome")
    : answersAll;

  const nextStep = LINK_STEPS.find((step) => !answered.includes(step.key))?.key ?? null;
  const condominio = (snapshot.answers as Record<string, string | undefined>).condominio;

  return {
    presenter: "proprietario",
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
        })
      : null,
    complete: nextStep === null,
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
  const replies = brokerUserReplies(turns);
  const genericFlow = Boolean(
    replies[0] &&
      /^(sim|s|claro|vamos|quero|nao|não|n)\b/i.test(fold(replies[0])) &&
      replies[1] &&
      /propriet|corretor/i.test(fold(replies[1])),
  );
  const offset = genericFlow ? 2 : (replies[0] && /propriet|corretor/i.test(replies[0]) ? 1 : 0);
  const creci = replies[offset]?.slice(0, 80) ?? "";
  const brokerName = replies[offset + 1]?.slice(0, 120) ?? "";
  const ownerPhone = phone;
  const snapshot = await captureSnapshot(db, phone);

  const answered = linkAnswered(snapshot);
  const nextStep = LINK_STEPS.find((step) => !answered.includes(step.key))?.key ?? null;
  const condominio = (snapshot.answers as Record<string, string | undefined>).condominio;

  let lastLink = -1;
  let lastClosing = -1;
  turns.forEach((turn, index) => {
    if (turn.role === "user" && hasBrokerToken(turn.content)) lastLink = index;
    if (turn.role === "assistant" && turn.content.includes(CLOSING_MESSAGE)) lastClosing = index;
  });
  const currentEntry = lastLink > lastClosing;

  return {
    active: currentEntry && !snapshot.complete,
    presenter: "corretor",
    ownerPhone,
    broker: creci && brokerName ? { creci, name: brokerName, phone } : null,
    freshEntry: turns.some(
      (turn) => turn.role === "user" && hasBrokerToken(turn.content),
    ) && replies.length === 0,
    fromLink: true,
    startNewProperty: false,
    snapshot,
    answered,
    nextStep,
    nextQuestion: nextStep
      ? linkQuestion(nextStep, { propertyType: snapshot.propertyType, condominio })
      : null,
    complete: nextStep === null,
  };
}

function brokerPendingQuestion(turns: readonly AgentTurn[]): string | null {
  const replies = brokerUserReplies(turns);
  const genericFlow = Boolean(
    replies[0] &&
      /^(sim|s|claro|vamos|quero)\b/i.test(fold(replies[0])) &&
      replies[1] &&
      /corretor/i.test(fold(replies[1])),
  );
  const offset = genericFlow ? 2 : (replies[0] && /corretor/i.test(fold(replies[0])) ? 1 : 0);
  const count = replies.length - offset;
  if (count === 0) return "Qual é o seu CRECI?";
  if (count === 1) return "Qual é o seu nome completo?";
  return null;
}

export async function linkCaptacaoState(
  db: AdminDb,
  phone: string | null,
  turns: readonly AgentTurn[],
): Promise<LinkCaptacaoState | null> {
  if (!ownerPhoneKey(phone)) return null;
  const userMessages = turns.filter((turn) => turn.role === "user");
  let latestGeneric = -1;
  turns.forEach((turn, index) => {
    if (turn.role === "user" && fold(turn.content) === fold(GENERIC_ENTRY_MESSAGE)) latestGeneric = index;
  });
  const afterGeneric = latestGeneric >= 0 ? turns.slice(latestGeneric + 1).filter((turn) => turn.role === "user") : [];
  /* O envio da mensagem pré-preenchida já é a confirmação de entrada.
     A primeira resposta do contato é diretamente o perfil: proprietário ou corretor. */
  const roleAnswer = afterGeneric[0]?.content ?? "";
  const brokerEntry = /\bcorretor\b/i.test(fold(roleAnswer)) || turns.some((turn) => turn.role === "user" && fold(turn.content) === fold(BROKER_ENTRY_MESSAGE));
  if (brokerEntry) return brokerLinkState(db, phone!, turns);
  const lastUser = userMessages.length ? userMessages[userMessages.length - 1]!.content : "";
  const freshEntry = hasLinkToken(lastUser);
  const fromLink = userMessages.some((turn) => hasLinkToken(turn.content));

  /* Posição do último clique e do último fechamento na conversa: clique depois
     do fechamento = outro imóvel começando. */
  let lastLink = -1;
  let lastClosing = -1;
  turns.forEach((turn, index) => {
    if (turn.role === "user" && hasLinkToken(turn.content)) lastLink = index;
    if (turn.role === "assistant" && turn.content.includes(CLOSING_MESSAGE)) lastClosing = index;
  });
  const relink = lastLink >= 0 && lastLink > lastClosing;

  const snapshot = await captureSnapshot(db, phone);
  const origin = (snapshot.answers as Record<string, string | undefined>).origem ?? null;
  const sticky = fold(origin) === fold(LINK_CAPTACAO_ORIGIN);
  if (!freshEntry && !fromLink && !sticky) return null;

  return buildState({ snapshot, freshEntry, fromLink, sticky, relink });
}

/* ---------------------------------------------------------- gravação */

/**
 * A foto chegou?
 *
 * Duas formas, porque o canal de texto não entrega imagem:
 *  - `media`: marca de mídia colocada pelo canal (ex.: `[foto]`, `[imagem]`) —
 *    é o que o adaptador do WhatsApp produziria se passasse a entregar mídia;
 *  - `mencao`: o proprietário escrevendo que enviou ("segue a foto", "mandei",
 *    "pronto"), que é o que de fato chega hoje como texto.
 *
 * O que vai gravado na ficha diz qual dos dois foi — a ficha não afirma que
 * recebeu imagem quando só houve texto.
 */
const PHOTO_MEDIA = /\[(foto|fotos|imagem|imagens|image|photo|midia|media)[^\]]*\]/;
const PHOTO_MENTION =
  /\b(foto|fotos|imagem|imagens) (em anexo|anexad[ao]s?|enviad[ao]s?|ai|ai esta)\b|\b(enviei|mandei|segue|seguem|estou enviando|vou enviar|ta ai|esta ai|ai esta)\b|^(pronto|ok|feito|enviada|enviado|mandada|mandado)\b/;

function photoEvidence(text: string | null | undefined): "media" | "mencao" | null {
  const value = fold(text);
  if (!value) return null;
  if (PHOTO_MEDIA.test(value)) return "media";
  /* Fora do roteiro (pergunta, pedido) não conta como foto. */
  if (value.includes("?")) return null;
  return PHOTO_MENTION.test(value) ? "mencao" : null;
}

/** Tudo que o fluxo do link grava. Intenção e origem são fixas. */
function saveInput(
  state: LinkCaptacaoState,
  phone: string,
  patch: Omit<CaptureAnswerInput, "phone">,
) {
  const addressish = Boolean(
    patch.cep || patch.rua || patch.numero || patch.bairro || patch.cidade || patch.estado ||
      patch.unidade || patch.bloco || patch.torre || patch.andar || patch.complemento,
  );
  return {
    ...patch,
    phone,
    /* Entrou pelo link = captação de VENDA. A pergunta de intenção não existe
       neste fluxo e o valor nunca vem do modelo. */
    negociacao: "venda",
    origem: LINK_CAPTACAO_ORIGIN,
    /* Outro imóvel só abre quando o cadastro anterior terminou E o endereço do
       novo está vindo neste envio. */
    novoImovel: state.startNewProperty && addressish ? true : undefined,
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
  "6. Valor pretendido vai em `valorPretendido`, só números (1.200.000 → 1200000).",
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
    "CADASTRO DE IMÓVEL PARA VENDA (proprietário que entrou pelo link de captação).",
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
): Promise<AgentReply> {
  const toolCalls: { tool: string; input: string }[] = [];
  const lastUser =
    [...turns].reverse().find((turn) => turn.role === "user")?.content ?? null;
  const spokeBefore = turns.some((turn) => turn.role === "assistant");

  /* Entrada genérica: o ED primeiro identifica proprietário ou corretor. */
  let genericIndex = -1;
  turns.forEach((turn, index) => {
    if (turn.role === "user" && fold(turn.content) === fold(GENERIC_ENTRY_MESSAGE)) genericIndex = index;
  });
  if (genericIndex >= 0) {
    const replies = turns.slice(genericIndex + 1).filter((turn) => turn.role === "user");
    if (replies.length === 0) {
      return { text: ROLE_QUESTION, handoff: false, handoffReason: null, usedProperties: [], toolCalls };
    }

    const role = fold(replies[0]!.content);
    const isOwner = /propriet|dono|dona/.test(role);
    const isBroker = /corretor/.test(role);
    if (!isOwner && !isBroker) {
      return { text: ROLE_REJECTED, handoff: false, handoffReason: null, usedProperties: [], toolCalls };
    }
    /* A identificação de perfil é controle do fluxo, não dado do imóvel. */
    if (replies.length === 1 && state.presenter === "proprietario") {
      return finish(state, { offScript: false, toolCalls });
    }
  }

  if (state.presenter === "corretor") {
    const pendingBroker = brokerPendingQuestion(turns);
    if (pendingBroker) {
      return {
        text: pendingBroker,
        handoff: false,
        handoffReason: null,
        usedProperties: [],
        toolCalls,
      };
    }
    if (!state.ownerPhone || !state.broker) {
      return { text: "Qual é o seu nome completo?", handoff: false, handoffReason: null, usedProperties: [], toolCalls };
    }

    /* O cadastro do imóvel apresentado fica identificado pelo próprio corretor. */
    if (state.answered.length === 0) {
      await saveCaptureAnswer(db, {
        phone: state.ownerPhone,
        nome: state.broker.name,
        negociacao: "venda",
        origem: LINK_CAPTACAO_ORIGIN,
        observacao: `Apresentado por corretor: ${state.broker.name} · CRECI ${state.broker.creci} · WhatsApp ${state.broker.phone}`,
      });
      const refreshed = await brokerLinkState(db, phone, turns);
      return finish(refreshed, { offScript: false, toolCalls });
    }
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

  /* Foto da frente: o reconhecimento é determinístico e a gravação não passa
     pelo modelo — é o último passo do roteiro e não pode depender de extração. */
  const photo = state.nextStep === "fotoFrente" ? photoEvidence(lastUser) : null;
  if (photo) {
    const when = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
    await saveCaptureAnswer(
      db,
      saveInput(state, state.ownerPhone ?? phone, {
        fotoFrente:
          photo === "media"
            ? `imagem recebida pelo WhatsApp em ${when}`
            : `proprietário informou o envio da foto em ${when}`,
      }),
    );
    toolCalls.push({
      tool: "salvarCadastroVenda",
      input: JSON.stringify({ fotoFrente: photo }),
    });
    return finish(await reload(db, state.ownerPhone ?? phone, state.startNewProperty), { offScript: false, toolCalls });
  }

  if (!gatewayConfigured()) {
    /* Sem provedor de IA não há extração — mas o roteiro não pode travar nem
       improvisar: a pergunta pendente é repetida. */
    return finish(state, { offScript: false, toolCalls });
  }

  const allowance = handoffAllowance(lastUser);
  let offScript = false;
  let handoffReason: string | null = null;

  const saveTool = {
    salvarCadastroVenda: tool({
      description:
        "Grava AGORA na ficha de captação o que o proprietário acabou de responder. Use só com os campos que a resposta informou.",
      inputSchema: SAVE_SCHEMA,
      async execute(input: SaveToolInput) {
        if (input.observacao) offScript = true;
        const result = await saveCaptureAnswer(db, saveInput(state, state.ownerPhone ?? phone, input));
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

  return finish(await reload(db, state.ownerPhone ?? phone, state.startNewProperty), { offScript, toolCalls });
}

/**
 * Relê o estado do banco: é o gravado que decide a próxima pergunta.
 *
 * `relink` continua valendo enquanto o endereço do novo imóvel não abrir a
 * segunda ficha — sem isso, uma extração que não gravou nada faria o fluxo
 * repetir o fechamento do cadastro ANTERIOR em vez de insistir no endereço.
 */
async function reload(db: AdminDb, phone: string, relink: boolean): Promise<LinkCaptacaoState> {
  const snapshot = await captureSnapshot(db, phone);
  return buildState({ snapshot, freshEntry: false, fromLink: true, sticky: true, relink });
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

/**
 * Intenção do contato: comprador/locatário ou proprietário.
 *
 * O telefone do WhatsApp identifica o CONTATO — ele não diz o que a pessoa
 * quer. Quem decide se a captação é habilitada é este módulo, de forma
 * determinística, antes de qualquer prompt ou ferramenta de captação existir
 * no turno:
 *
 *  - quer comprar ou alugar        → `comprador`   (atendimento normal)
 *  - quer vender/anunciar/cadastrar → `proprietario` (captação)
 *  - sem sinal nenhum              → `ambiguo` (uma única pergunta de
 *                                    desambiguação, sem captação)
 *
 * Nada aqui grava, lê banco ou depende do modelo: é classificação de texto
 * sobre as mensagens da própria conversa.
 */
import { CAPTURE_STEPS } from "./owner-capture";

export type ContactIntent = "comprador" | "proprietario" | "ambiguo";

/** A única pergunta permitida quando a intenção é realmente ambígua. */
export const INTENT_QUESTION =
  "Você procura um imóvel para comprar/alugar ou deseja cadastrar um imóvel para vender?";

/** Minúsculas, sem acento, espaços normalizados. */
const fold = (value: string) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const IMOVEL = "(imovel|imoveis|apartamento|apto|casa|terreno|lote|sala|cobertura|sobrado|chacara|kitnet|studio|loja|galpao|predio)";
const POSSESSIVO = "(meu|minha|meus|minhas|nosso|nossa)";

/**
 * Proprietário. Testado ANTES do comprador, porque "alugar" e "vender"
 * aparecem nos dois lados: "quero alugar um apartamento" é comprador,
 * "quero alugar meu apartamento" é proprietário — o que decide é o possessivo.
 */
const OWNER_PATTERNS: RegExp[] = [
  /\b(sou|somos)\b[^.?!]{0,15}\b(proprietari|dono|dona)/,
  new RegExp(`\\b(vender|anunciar|cadastrar|avaliar|avaliacao|locar|alugar|colocar)\\b[^.?!]{0,30}\\b${POSSESSIVO}\\b`),
  new RegExp(`\\b${POSSESSIVO}\\b[^.?!]{0,40}\\b(vender|venda|anunciar|anuncio|cadastrar|cadastro|avaliar|avaliacao|locacao|locar|alugar)\\b`),
  new RegExp(`\\b(vender|anunciar|cadastrar|avaliar|avaliacao d[aeo])\\b[^.?!]{0,25}\\b${IMOVEL}\\b`),
  /\btenho\b[^.?!]{0,40}\b(vender|anunciar|cadastrar|locar|alugar|avaliar)\b/,
  /\b(quero|queria|gostaria|pretendo|preciso|desejo|vou|pode|posso|estou|estamos|pensando em|penso em)\b[^.?!]{0,25}\b(vender|vendendo|anunciar|anunciando|cadastrar|cadastrando)\b/,
  /\b(cadastrar|anunciar|vender)\b[^.?!]{0,20}\b(com voces|na imobiliaria|pela imobiliaria|no site de voces)\b/,
  /\b(colocar|deixar)\b[^.?!]{0,20}\b(a venda|para venda|para vender|para alugar|para locacao|no anuncio)\b/,
  /\bcadastrar\b[^.?!]{0,20}\b(outro|mais um)\b/,
  /\bcaptacao\b/,
];

/** Comprador/locatário. */
const BUYER_PATTERNS: RegExp[] = [
  /\b(procuro|procurando|busco|buscando|pesquisando)\b/,
  /\b(quero|queria|gostaria|pretendo|preciso|estou)\b[^.?!]{0,20}\b(comprar|alugar|locar|morar|investir|visitar|conhecer)\b/,
  new RegExp(`\\b(tem|teria|tem algum|voces tem|ha|existe)\\b[^.?!]{0,25}\\b${IMOVEL}\\b`),
  /\bquanto (custa|esta|fica|sai)\b/,
  /\b(agendar|marcar)\b[^.?!]{0,20}\bvisita\b/,
  /\b(financiamento|financiar|fgts|parcelar|entrada de)\b/,
  /\b(vi|achei|encontrei|gostei)\b[^.?!]{0,25}\b(anuncio|site|instagram|imovel|codigo|foto)\b/,
  /\b(comprar|alugar)\b/,
  /\b(disponivel|disponiveis)\b/,
];

/** Sinal de UMA mensagem, isolada. */
export function messageIntent(text: string): ContactIntent {
  const value = fold(text);
  if (!value) return "ambiguo";
  if (OWNER_PATTERNS.some((pattern) => pattern.test(value))) return "proprietario";
  if (BUYER_PATTERNS.some((pattern) => pattern.test(value))) return "comprador";
  return "ambiguo";
}

/* Perguntas do roteiro de captação, para reconhecer a continuidade do fluxo. */
const CAPTURE_QUESTION_TEXTS = CAPTURE_STEPS.map((step) => fold(step.question));

/**
 * A IA já estava conduzindo a captação neste contato?
 *
 * Quando a última mensagem da IA foi uma pergunta do roteiro, a resposta curta
 * que vem depois ("Maria Souza", "Rua X, 100") não traz sinal de intenção
 * nenhum — e não pode ser tratada como ambígua, senão o roteiro recomeçaria do
 * zero a cada resposta.
 */
export function isCaptureQuestion(text: string | null | undefined): boolean {
  const value = fold(text ?? "");
  if (!value) return false;
  return CAPTURE_QUESTION_TEXTS.some((question) => question && value.includes(question));
}

export interface IntentContext {
  /** Mensagens do contato, da mais antiga para a mais recente. */
  userMessages: readonly string[];
  /** Última mensagem enviada pela IA nesta conversa, se houver. */
  lastAssistant?: string | null;
  /** Existe ficha de captação deste telefone iniciada e ainda não concluída. */
  captureInProgress: boolean;
}

export interface IntentDecision {
  intent: ContactIntent;
  reason: string;
}

/**
 * Decide a intenção do contato.
 *
 * Precedência (de cima para baixo):
 *  1. o que a pessoa acabou de dizer — é o que permite um proprietário com
 *     cadastro em andamento perguntar sobre compra sem ser empurrado de volta
 *     para a pergunta pendente do roteiro, e vice-versa;
 *  2. captação já em andamento (ficha aberta ou roteiro sendo conduzido):
 *     saudação e continuação retomam de onde parou;
 *  3. sinal mais forte do histórico da conversa;
 *  4. nada disso → ambíguo.
 */
export function classifyContactIntent(context: IntentContext): IntentDecision {
  const messages = context.userMessages.filter((message) => fold(message).length > 0);
  const last = messages.length ? messages[messages.length - 1]! : "";
  const lastIntent = messageIntent(last);

  if (lastIntent === "proprietario") {
    return { intent: "proprietario", reason: "a última mensagem é de proprietário (vender/anunciar/cadastrar)" };
  }
  if (lastIntent === "comprador") {
    return { intent: "comprador", reason: "a última mensagem é de compra/locação" };
  }

  if (context.captureInProgress) {
    return { intent: "proprietario", reason: "cadastro de captação em andamento para este contato" };
  }
  if (isCaptureQuestion(context.lastAssistant)) {
    return { intent: "proprietario", reason: "a IA está no roteiro de captação e a pessoa respondeu à pergunta" };
  }

  const history = messages.map(messageIntent);
  if (history.includes("proprietario")) {
    return { intent: "proprietario", reason: "o contato já declarou intenção de proprietário nesta conversa" };
  }
  if (history.includes("comprador")) {
    return { intent: "comprador", reason: "o contato já declarou intenção de compra/locação nesta conversa" };
  }

  return { intent: "ambiguo", reason: "nenhum sinal de intenção na conversa" };
}

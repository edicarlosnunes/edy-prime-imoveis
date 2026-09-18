/**
 * Guarda do handoff durante a captação.
 *
 * O agente de captação não pode transferir a conversa só porque o assunto é
 * "cadastrar imóvel". Quem entra para vender/anunciar o imóvel próprio tem que
 * seguir o roteiro (nome, endereço, documentação, ...) até o fim.
 *
 * Durante a captação, o handoff só é liberado quando:
 * 1. a pessoa pede explicitamente humano/corretor/atendente;
 * 2. já existe humano controlando a conversa (isso é decidido antes, no inbox,
 *    e nem chega ao modelo);
 * 3. aparece uma situação de fato jurídica/contratual (advogado, inventário,
 *    ação judicial, assinatura de contrato...).
 *
 * "O imóvel está registrado em seu nome?" é pergunta normal do roteiro e NUNCA
 * é motivo de transferência.
 */

const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

/* Palavras que designam uma pessoa de verdade do outro lado. */
const HUMAN_WORDS = [
  "humano",
  "humana",
  "corretor",
  "corretora",
  "atendente",
  "consultor",
  "consultora",
  "gerente",
  "pessoa real",
  "pessoa de verdade",
  "alguem da equipe",
  "alguem de verdade",
  "responsavel pela imobiliaria",
];

/* Sinais de que a pessoa está pedindo esse contato agora. */
const REQUEST_WORDS = [
  "falar",
  "conversar",
  "atend",
  "chamar",
  "chama",
  "passar",
  "passa",
  "transferir",
  "transfere",
  "quero",
  "queria",
  "prefiro",
  "preferia",
  "pode me",
  "poderia",
  "me liga",
  "liga",
  "ligar",
  "contato de",
];

/* Reclamação de estar falando com robô também conta como pedido de humano. */
const BOT_COMPLAINTS = ["robo", "bot", "maquina", "inteligencia artificial", " ia "];

/* Situação realmente jurídica/contratual: exige pessoa. */
const LEGAL_WORDS = [
  "advogado",
  "advogada",
  "inventario",
  "espolio",
  "usucapiao",
  "judicial",
  "justica",
  "litigio",
  "penhora",
  "liminar",
  "clausula",
  "rescisao",
  "distrato",
  "procuracao",
  "assinar contrato",
  "assinar o contrato",
  "assinatura do contrato",
  "minuta",
];

export type HandoffAllowance =
  | { allowed: false }
  | { allowed: true; trigger: "pedido_explicito" | "juridico" };

/**
 * Decide se o handoff pode acontecer neste turno de captação.
 *
 * Olha apenas a última mensagem do contato: o pedido de humano tem que ser
 * do momento, não herdado de um turno antigo.
 */
export function handoffAllowance(lastUserMessage: string | null | undefined): HandoffAllowance {
  const text = ` ${normalize(lastUserMessage ?? "")} `;
  if (!text.trim()) return { allowed: false };

  const hasHuman = HUMAN_WORDS.some((word) => text.includes(word));
  const hasRequest = REQUEST_WORDS.some((word) => text.includes(word));
  const complainsBot = BOT_COMPLAINTS.some((word) => text.includes(word));

  if (hasHuman && (hasRequest || complainsBot)) return { allowed: true, trigger: "pedido_explicito" };
  if (LEGAL_WORDS.some((word) => text.includes(word))) return { allowed: true, trigger: "juridico" };
  return { allowed: false };
}

/* Texto de transferência que o modelo pode ter escrito antes de a chamada ser
   bloqueada — não pode chegar ao cliente. */
const HANDOFF_TEXT = [
  "corretor",
  "corretora",
  "atendimento humano",
  "um humano",
  "uma pessoa da equipe",
  "encaminhar seu contato",
  "encaminhando seu contato",
  "vou encaminhar",
  "vou transferir",
  "vou passar",
  "horario comercial",
];

/** O modelo respondeu como se fosse transferir? */
export function looksLikeHandoffText(text: string): boolean {
  const normalized = normalize(text);
  return HANDOFF_TEXT.some((word) => normalized.includes(word));
}

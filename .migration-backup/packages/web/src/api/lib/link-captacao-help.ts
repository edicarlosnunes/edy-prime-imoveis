import { desc, eq } from "drizzle-orm";
import * as schema from "../database/schema";
import {
  CLOSING_MESSAGE,
  linkCaptacaoState,
  type LinkStepKey,
} from "../agent/link-captacao";
import type { AdminDb } from "./admin-base";
import { addMessage, conversationTurns } from "./inbox";
import type { ConfigMap } from "./integrations";
import { sendWhatsappText } from "./whatsapp";

const DEFAULT_IDLE_MINUTES = 15;
const MAX_SCAN = 200;

function helpMessage(step: LinkStepKey) {
  if (step === "tipo") {
    return "Ficou com dúvida? Informe o tipo do imóvel: apartamento, casa, terreno, sítio ou outro.";
  }
  if (step === "fotoFrente") {
    return "Para continuar, envie uma foto da frente ou fachada do imóvel.";
  }
  if (step === "observacaoFinal" || step === "confirmacaoFinal") {
    return "Se não tiver mais nada a acrescentar, digite OK para continuar.";
  }
  return "Ficou com dúvida? Se não souber essa resposta, digite NÃO SEI que eu continuo o cadastro.";
}

/**
 * Ajuda automática para quem parou no LINK_CAPTACAO.
 *
 * Só atua quando:
 * - a conversa continua em AGENTE IA;
 * - o LINK_CAPTACAO ainda está ativo;
 * - pelo menos 3 etapas já foram respondidas;
 * - a última mensagem foi nossa pergunta e ficou sem resposta;
 * - já passou o tempo mínimo de inatividade.
 *
 * A ajuda é enviada uma única vez por pergunta: depois de enviada, ela passa a
 * ser a última mensagem de saída e a varredura ignora a conversa até o cliente
 * responder e o fluxo avançar.
 */
export async function sweepLinkCaptacaoHelp(
  db: AdminDb,
  wa: ConfigMap,
  options: { idleMinutes?: number; now?: Date } = {},
) {
  const now = options.now ?? new Date();
  const idleMinutes = Math.max(5, options.idleMinutes ?? DEFAULT_IDLE_MINUTES);
  const cutoff = new Date(now.getTime() - idleMinutes * 60 * 1000);

  const conversations = await db
    .select()
    .from(schema.conversations)
    .where(eq(schema.conversations.channel, "whatsapp"))
    .orderBy(desc(schema.conversations.lastMessageAt))
    .limit(MAX_SCAN);

  let checked = 0;
  let sent = 0;

  for (const conversation of conversations) {
    if (
      conversation.mode !== "ia" ||
      conversation.status !== "aberta" ||
      !conversation.contactPhone ||
      !conversation.lastMessageAt ||
      conversation.lastMessageAt > cutoff
    ) {
      continue;
    }

    const recent = await db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.conversationId, conversation.id))
      .orderBy(desc(schema.messages.id))
      .limit(3);
    const last = recent[0];
    if (!last || last.direction !== "out" || last.body === CLOSING_MESSAGE) continue;

    const turns = await conversationTurns(db, conversation.id);
    const state = await linkCaptacaoState(db, conversation.contactPhone, turns);
    if (!state?.active || !state.nextStep || state.answered.length < 3) continue;

    const message = helpMessage(state.nextStep);
    if (last.body === message) continue;

    checked++;
    await sendWhatsappText(wa, conversation.contactPhone, message);
    await addMessage(db, conversation.id, {
      direction: "out",
      author: "ia",
      authorName: "ED",
      body: message,
    });
    sent++;
  }

  return { checked, sent, idleMinutes };
}

import { desc, eq } from "drizzle-orm";
import * as schema from "../database/schema";
import { CLOSING_MESSAGE, linkCaptacaoState } from "../agent/link-captacao";
import type { AdminDb } from "./admin-base";
import { addMessage, conversationTurns } from "./inbox";
import type { ConfigMap } from "./integrations";
import { sendWhatsappText } from "./whatsapp";

export const LINK_CAPTACAO_HELP_MESSAGE =
  "Ficou com dúvida? Se não souber essa resposta, digite NÃO SEI que eu continuo o cadastro.";

const DEFAULT_IDLE_MINUTES = 15;
const MAX_SCAN = 200;

/**
 * Ajuda de abandono do LINK_CAPTACAO.
 *
 * Regras:
 * - somente WhatsApp + modo IA + conversa aberta;
 * - link ainda ativo e com pergunta pendente;
 * - pelo menos 3 etapas já respondidas;
 * - última mensagem precisa ser nossa (a pergunta que ficou sem resposta);
 * - ajuda nunca repete enquanto continuar sendo a última mensagem.
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
    if (!last || last.direction !== "out") continue;
    if (last.body === LINK_CAPTACAO_HELP_MESSAGE || last.body === CLOSING_MESSAGE) continue;

    const turns = await conversationTurns(db, conversation.id);
    const state = await linkCaptacaoState(db, conversation.contactPhone, turns);
    if (!state?.active || !state.nextStep || state.answered.length < 3) continue;

    checked++;
    await sendWhatsappText(wa, conversation.contactPhone, LINK_CAPTACAO_HELP_MESSAGE);
    await addMessage(db, conversation.id, {
      direction: "out",
      author: "ia",
      authorName: "ED",
      body: LINK_CAPTACAO_HELP_MESSAGE,
    });
    sent++;
  }

  return { checked, sent, idleMinutes };
}

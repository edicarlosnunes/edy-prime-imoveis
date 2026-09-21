/**
 * LINK_CAPTACAO — ponto neutro temporário.
 *
 * A implementação anterior foi removida intencionalmente do PR18.
 * Este arquivo preserva somente a interface necessária para que os pontos
 * compartilhados do projeto possam continuar referenciando o módulo enquanto
 * o novo LINK_CAPTACAO é reconstruído do zero.
 *
 * NÃO contém máquina de estados, retomada por telefone, regras de proprietário
 * ou corretor, extração por IA, perguntas, foto ou persistência de captação.
 */
import type { AdminDb } from "../lib/admin-base";
import type { AgentReply, AgentRow, AgentTurn } from "./broker";

export const LINK_CAPTACAO_ORIGIN = "LINK_CAPTACAO";
export const LINK_CAPTACAO_TOKEN = "LINK_CAPTACAO";
export const LINK_CAPTACAO_OWNER_TOKEN = "LINK_CAPTACAO_PROPRIETARIO";
export const LINK_CAPTACAO_BROKER_TOKEN = "LINK_CAPTACAO_CORRETOR";

export const LINK_CAPTACAO_MESSAGE = "Vamos cadastrar seu imóvel?";

export function linkCaptacaoUrl(whatsapp: string): string {
  const digits = String(whatsapp ?? "").replace(/\D/g, "");
  const phone = digits.startsWith("55") ? digits : `55${digits}`;
  return `https://wa.me/${phone}?text=${encodeURIComponent(LINK_CAPTACAO_MESSAGE)}`;
}

export const hasLinkToken = (_text: string | null | undefined) => false;

export interface LinkCaptacaoState {
  active: false;
}

export async function linkCaptacaoState(
  _db: AdminDb,
  _phone: string | null,
  _turns: readonly AgentTurn[],
): Promise<LinkCaptacaoState | null> {
  return null;
}

export async function linkCaptacaoReply(
  _db: AdminDb,
  _agent: AgentRow,
  _turns: readonly AgentTurn[],
  _phone: string,
  _state: LinkCaptacaoState,
  _configuredModel: string | null = null,
): Promise<AgentReply> {
  return {
    text: "",
    handoff: false,
    handoffReason: null,
    usedProperties: [],
    toolCalls: [],
  };
}

/**
 * LINK_CAPTACAO V2 — etapa 1.
 *
 * Esta etapa reaproveita do PR17 SOMENTE a porta de entrada comprovada:
 * 1) "Vamos cadastrar seu imóvel?"
 * 2) "Você é o proprietário do imóvel ou corretor?"
 * 3) para PROPRIETÁRIO: "Qual é o seu nome completo?"
 *
 * O restante do fluxo antigo do PR17 NÃO foi copiado.
 * A continuação residencial será construída no PR18 em etapas posteriores.
 */
import type { AdminDb } from "../lib/admin-base";
import { ownerPhoneKey } from "../lib/owner-identity";
import type { AgentReply, AgentRow, AgentTurn } from "./broker";

export const LINK_CAPTACAO_ORIGIN = "LINK_CAPTACAO";
export const LINK_CAPTACAO_TOKEN = "LINK_CAPTACAO";
export const LINK_CAPTACAO_OWNER_TOKEN = "LINK_CAPTACAO_PROPRIETARIO";
export const LINK_CAPTACAO_BROKER_TOKEN = "LINK_CAPTACAO_CORRETOR";

export const LINK_CAPTACAO_MESSAGE = "Vamos cadastrar seu imóvel?";
const ROLE_QUESTION = "Você é o proprietário do imóvel ou corretor?";
const NAME_QUESTION = "Qual é o seu nome completo?";
const ROLE_REJECTED =
  "Nos desculpe, este cadastro precisa ser realizado pelo proprietário do imóvel ou corretor, pois teremos algumas informações que somente eles poderão confirmar.";

const fold = (value: string | null | undefined) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/**
 * Porta pública trazida do PR17: exige a frase completa.
 * Tolera somente caixa, acento, espaços e repetição exata da própria frase.
 */
const isGenericLinkStart = (text: string | null | undefined) => {
  const value = fold(text);
  const start = fold(LINK_CAPTACAO_MESSAGE);
  if (!value || !start || !value.includes(start)) return false;
  return value.split(start).join("").trim() === "";
};

export function linkCaptacaoUrl(whatsapp: string): string {
  const digits = String(whatsapp ?? "").replace(/\D/g, "");
  const phone = digits.startsWith("55") ? digits : `55${digits}`;
  return `https://wa.me/${phone}?text=${encodeURIComponent(LINK_CAPTACAO_MESSAGE)}`;
}

/** Nesta V2, a entrada oficial é somente a frase completa aprovada. */
export const hasLinkToken = (text: string | null | undefined) =>
  isGenericLinkStart(text);

export interface LinkCaptacaoState {
  active: true;
  presenter: "pendente" | "proprietario" | "corretor";
  entryIndex: number;
  roleIndex: number | null;
  nextQuestion: string;
}

function latestEntryIndex(turns: readonly AgentTurn[]) {
  let index = -1;
  turns.forEach((turn, i) => {
    if (turn.role === "user" && isGenericLinkStart(turn.content)) index = i;
  });
  return index;
}

export async function linkCaptacaoState(
  _db: AdminDb,
  phone: string | null,
  turns: readonly AgentTurn[],
): Promise<LinkCaptacaoState | null> {
  if (!ownerPhoneKey(phone)) return null;

  const entryIndex = latestEntryIndex(turns);
  if (entryIndex < 0) return null;

  const afterEntry = turns.slice(entryIndex + 1);
  const validRole = afterEntry.findIndex((turn) => {
    if (turn.role !== "user") return false;
    return /^(proprietario|proprietaria|corretor|corretora)$/.test(fold(turn.content));
  });

  if (validRole < 0) {
    return {
      active: true,
      presenter: "pendente",
      entryIndex,
      roleIndex: null,
      nextQuestion: ROLE_QUESTION,
    };
  }

  const roleIndex = entryIndex + 1 + validRole;
  const role = fold(turns[roleIndex]?.content);
  const presenter = /^proprietari[oa]$/.test(role) ? "proprietario" : "corretor";

  /*
   * Nesta primeira etapa executamos somente a cabeça do proprietário.
   * O corretor será implementado depois, sem trazer o corpo antigo do PR17.
   */
  return {
    active: true,
    presenter,
    entryIndex,
    roleIndex,
    nextQuestion: presenter === "proprietario" ? NAME_QUESTION : ROLE_QUESTION,
  };
}

export async function linkCaptacaoReply(
  _db: AdminDb,
  _agent: AgentRow,
  turns: readonly AgentTurn[],
  _phone: string,
  state: LinkCaptacaoState,
  _configuredModel: string | null = null,
): Promise<AgentReply> {
  let text = state.nextQuestion;

  if (state.presenter === "pendente") {
    const replies = turns
      .slice(state.entryIndex + 1)
      .filter((turn) => turn.role === "user");

    if (replies.length > 0) text = ROLE_REJECTED;
  }

  return {
    text,
    handoff: false,
    handoffReason: null,
    usedProperties: [],
    toolCalls: [],
  };
}

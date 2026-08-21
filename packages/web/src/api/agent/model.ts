/**
 * Fonte única de verdade do modelo default dos agentes de IA.
 *
 * Ordem de precedência (nunca invertida):
 * 1. modelo gravado no próprio agente (`ai_agents.model`) — configuração
 *    explícita do painel /admin/ia, sempre respeitada;
 * 2. `defaultModel` da integração `ai_gateway` (painel /admin/integracoes);
 * 3. `FALLBACK_MODEL` deste arquivo — último recurso, quando não há nenhuma
 *    configuração.
 *
 * Este arquivo é o único literal de modelo no servidor: schema, rotas do
 * painel, testes de integração e broker importam daqui. Sem imports de
 * propósito (o schema importa este módulo).
 */

/** Fallback de segurança quando não há nada configurado. */
export const FALLBACK_MODEL = "openai/gpt-5.4-mini";

/**
 * Aplica a precedência acima. `agentModel` vence sempre que estiver preenchido,
 * então agentes já configurados nunca são alterados.
 */
export function pickModel(agentModel?: string | null, configuredDefault?: string | null) {
  const explicit = (agentModel ?? "").trim();
  if (explicit) return explicit;
  const configured = (configuredDefault ?? "").trim();
  if (configured) return configured;
  return FALLBACK_MODEL;
}

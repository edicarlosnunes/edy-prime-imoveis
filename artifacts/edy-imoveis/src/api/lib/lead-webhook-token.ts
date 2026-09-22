/**
 * Autenticação do webhook de leads (POST /api/webhooks/leads/:token).
 *
 * REGRA: não existe token previsível.
 *
 * Até a auditoria de 10/09/2026 o endpoint aceitava, além do token gerado pelo
 * servidor, os literais "zap", "olx" e "imovelweb". Quem descobrisse a URL
 * conseguia injetar lead falso no CRM. Esses três foram removidos e ficam
 * explicitamente revogados aqui — nome e tamanho — para que nenhuma
 * configuração legada volte a autenticar com eles.
 *
 * Hoje cada portal tem o seu próprio token aleatório de 48 caracteres, gerado
 * pelo servidor e guardado apenas no `config` da integração `lead_webhook`
 * (JSON no servidor, mascarado pela API). O token na URL continua identificando
 * a ORIGEM do lead, mas agora sem ser adivinhável.
 */

export interface WebhookTokenSlot {
  /** Chave dentro do config da integração `lead_webhook`. */
  configKey: string;
  /** Origem gravada no lead (`leads.source` / `leads.portal`). */
  portal: string;
  label: string;
}

/** Um token por origem. O primeiro é o token geral de parceiros. */
export const LEAD_WEBHOOK_SLOTS: readonly WebhookTokenSlot[] = [
  { configKey: "token", portal: "webhook", label: "Token geral (parceiros)" },
  { configKey: "tokenZap", portal: "zap", label: "Token ZAP / VivaReal" },
  { configKey: "tokenOlx", portal: "olx", label: "Token OLX" },
  { configKey: "tokenImovelweb", portal: "imovelweb", label: "Token Imovelweb" },
] as const;

/** Tokens previsíveis aceitos antes da correção. Nunca mais autenticam. */
export const REVOKED_TOKENS: readonly string[] = ["zap", "olx", "imovelweb"] as const;

/** 24 bytes em hex = 48 caracteres. Nada abaixo disso autentica. */
export const TOKEN_BYTES = 24;
export const MIN_TOKEN_LENGTH = 32;

export function randomWebhookToken(bytes = TOKEN_BYTES): string {
  const array = new Uint8Array(bytes);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Comparação sem retorno antecipado no conteúdo. Vaza apenas o tamanho, que é
 * fixo e público (48), nunca quantos caracteres do prefixo estavam certos.
 */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

/** Só os 4 últimos caracteres — o bastante para auditar sem vazar segredo. */
export function tokenHint(token: string): string {
  const clean = (token ?? "").trim();
  return clean.length <= 4 ? "••••" : `••••${clean.slice(-4)}`;
}

export function isRevokedToken(token: string): boolean {
  const clean = (token ?? "").trim().toLowerCase();
  return REVOKED_TOKENS.includes(clean);
}

/** Um token só serve se for longo o bastante e não estiver na lista revogada. */
export function isStrongToken(token: string): boolean {
  const clean = (token ?? "").trim();
  return clean.length >= MIN_TOKEN_LENGTH && !isRevokedToken(clean);
}

/**
 * Devolve a origem do lead quando o token confere, ou `null` quando não vale.
 *
 * Barra em três camadas: token curto, token revogado por nome e token que
 * simplesmente não bate com nenhum slot. Config legada com valor fraco também
 * é ignorada — não basta estar gravado, precisa ser forte.
 */
export function resolveWebhookPortal(
  config: Record<string, string>,
  candidate: string | null | undefined,
): string | null {
  const token = (candidate ?? "").trim();
  if (!isStrongToken(token)) return null;

  for (const slot of LEAD_WEBHOOK_SLOTS) {
    const stored = (config[slot.configKey] ?? "").trim();
    if (!isStrongToken(stored)) continue;
    if (safeEqual(stored, token)) return slot.portal;
  }
  return null;
}

/**
 * Preenche os tokens que faltam e substitui qualquer token fraco ou revogado
 * herdado de configuração antiga. Devolve quais slots foram gerados, para a
 * auditoria registrar a migração sem imprimir o valor.
 */
export function ensureWebhookTokens(
  config: Record<string, string>,
  generate: () => string = randomWebhookToken,
): { config: Record<string, string>; rotated: string[] } {
  const out = { ...config };
  const rotated: string[] = [];
  for (const slot of LEAD_WEBHOOK_SLOTS) {
    if (isStrongToken(out[slot.configKey] ?? "")) continue;
    out[slot.configKey] = generate();
    rotated.push(slot.configKey);
  }
  return { config: out, rotated };
}

/**
 * Limitador por IP. Extraído das rotas para poder ser testado; o comportamento
 * é o mesmo de antes — uma janela deslizante em memória do runtime, best-effort,
 * compartilhada por todos os webhooks.
 */
export function createRateLimiter(limit = 60, windowMs = 60_000) {
  const hits = new Map<string, { count: number; until: number }>();
  return function rateLimited(ip: string, now: number = Date.now()): boolean {
    const entry = hits.get(ip);
    if (!entry || now > entry.until) {
      hits.set(ip, { count: 1, until: now + windowMs });
      return false;
    }
    entry.count += 1;
    return entry.count > limit;
  };
}

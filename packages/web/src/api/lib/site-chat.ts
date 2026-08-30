/**
 * Chat público do site: identidade anônima, saneamento de entrada, limites de
 * uso e whitelist de saída.
 *
 * Regras de segurança desta camada:
 * - o visitante é identificado por um token opaco gerado no servidor
 *   (`externalId = "site-<token>"`), sem login e sem cookie novo;
 * - nada volta para o navegador fora das whitelists deste arquivo — nenhum
 *   campo administrativo (proprietário, notas internas, motivo de transferência,
 *   lead, responsável) sai daqui;
 * - o limite por IP é best-effort (memória do processo, some em serverless);
 *   a proteção real é o limite por conversa contado no banco.
 */
import { and, asc, eq, gte, inArray } from "drizzle-orm";
import * as schema from "../database/schema";
import type { AdminDb } from "./admin-base";
import { randomHex } from "./auth";
import { propertySlug } from "./slug";

export const SITE_CHAT_CHANNEL = "site" as const;

/** Tamanho máximo de uma mensagem do visitante. */
export const MAX_MESSAGE_CHARS = 800;

/** Imagem usada quando o imóvel não tem foto cadastrada (mesmo padrão da vitrine). */
const FALLBACK_IMAGE = "/images/imovel-1.jpg";

/* ------------------------------------------------------------------ *
 * Identidade do visitante                                            *
 * ------------------------------------------------------------------ */

/** Token opaco novo (guardado no localStorage do visitante). */
export function newVisitorToken() {
  return randomHex(24);
}

/** Aceita só token no formato que geramos. Devolve null quando inválido. */
export function normalizeVisitorToken(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]{32,80}$/.test(value)) return null;
  return value;
}

export function externalIdFor(token: string) {
  return `site-${token}`;
}

/* ------------------------------------------------------------------ *
 * Saneamento de entrada                                              *
 * ------------------------------------------------------------------ */

/** Remove caracteres de controle e corta no limite. */
export function sanitizeMessage(raw: string) {
  return raw
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim()
    .slice(0, MAX_MESSAGE_CHARS);
}

/**
 * Telefone informado no chat. Devolve só dígitos quando parece um número
 * brasileiro utilizável (DDD + 8 ou 9 dígitos, com ou sem o 55 na frente) e
 * null quando não dá para ligar/mandar WhatsApp. Antes o corte era
 * `length >= 8`, então "99999999" entrava como telefone válido sem DDD e o
 * visitante não recebia aviso nenhum.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  const local = digits.startsWith("55") && digits.length > 11 ? digits.slice(2) : digits;
  if (local.length < 10 || local.length > 11) return null;
  /* DDD brasileiro válido começa em 11. */
  if (Number.parseInt(local.slice(0, 2), 10) < 11) return null;
  return local;
}

/** Nome usado quando o visitante deu só o WhatsApp — o lead não pode ficar de fora do CRM. */
export const CHAT_FALLBACK_NAME = "Contato do chat do site";

export function sanitizeShort(raw: string, max = 120) {
  return raw
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/* ------------------------------------------------------------------ *
 * Limites de uso                                                     *
 * ------------------------------------------------------------------ */

/** Best-effort por IP (memória do processo). */
const ipHits = new Map<string, { count: number; until: number }>();
const IP_WINDOW_MS = 60 * 1000;
const IP_MAX = 20;

export function ipRateLimited(ip: string) {
  const entry = ipHits.get(ip);
  if (!entry) return false;
  if (Date.now() > entry.until) {
    ipHits.delete(ip);
    return false;
  }
  return entry.count >= IP_MAX;
}

export function registerIpHit(ip: string) {
  const entry = ipHits.get(ip);
  if (!entry || Date.now() > entry.until) {
    ipHits.set(ip, { count: 1, until: Date.now() + IP_WINDOW_MS });
    return;
  }
  entry.count += 1;
}

/** Limite real: mensagens do visitante nesta conversa por janela (no banco). */
export async function conversationRateLimited(db: AdminDb, conversationId: number) {
  const minuteAgo = new Date(Date.now() - 60 * 1000);
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const rows = await db
    .select({ createdAt: schema.messages.createdAt })
    .from(schema.messages)
    .where(
      and(
        eq(schema.messages.conversationId, conversationId),
        eq(schema.messages.author, "cliente"),
        gte(schema.messages.createdAt, hourAgo),
      ),
    );
  const perHour = rows.length;
  const perMinute = rows.filter((row) => row.createdAt >= minuteAgo).length;
  if (perMinute >= 10) return "Você enviou muitas mensagens seguidas. Aguarde alguns segundos.";
  if (perHour >= 80) return "Limite de mensagens atingido por agora. Fale com um corretor pelo WhatsApp.";
  return null;
}

/* ------------------------------------------------------------------ *
 * Whitelist de saída                                                 *
 * ------------------------------------------------------------------ */

/** Único formato de mensagem que sai para o navegador. */
export interface PublicChatMessage {
  id: number;
  author: "cliente" | "ia" | "humano" | "sistema";
  body: string;
  createdAt: Date;
}

export function toPublicMessage(row: {
  id: number;
  author: string;
  body: string;
  createdAt: Date;
}): PublicChatMessage {
  const author = (["cliente", "ia", "humano", "sistema"] as const).includes(
    row.author as PublicChatMessage["author"],
  )
    ? (row.author as PublicChatMessage["author"])
    : "sistema";
  return { id: row.id, author, body: row.body, createdAt: row.createdAt };
}

/** Único formato de imóvel que sai para o navegador. */
export interface PublicChatCard {
  code: string;
  title: string;
  price: number;
  district: string;
  image: string;
  slug: string;
}

/** Cards dos imóveis citados no turno — só campos públicos, só publicados. */
export async function publicCards(db: AdminDb, codes: string[]): Promise<PublicChatCard[]> {
  const wanted = [...new Set(codes.map((code) => code.trim().toUpperCase()))].filter(Boolean);
  if (wanted.length === 0) return [];

  const rows = await db
    .select()
    .from(schema.properties)
    .where(and(eq(schema.properties.published, 1), inArray(schema.properties.code, wanted)))
    .limit(6);
  if (rows.length === 0) return [];

  const images = await db
    .select()
    .from(schema.propertyImages)
    .where(
      inArray(
        schema.propertyImages.propertyId,
        rows.map((row) => row.id),
      ),
    )
    .orderBy(asc(schema.propertyImages.sortOrder), asc(schema.propertyImages.id));

  return rows.map((row) => {
    const own = images.filter((image) => image.propertyId === row.id);
    const primary = own.find((image) => image.isPrimary === 1) ?? own[0];
    return {
      code: row.code,
      title: row.title,
      price: row.price,
      district: row.district,
      image: primary?.url ?? FALLBACK_IMAGE,
      slug: row.slug ?? propertySlug(row),
    };
  });
}

/* ------------------------------------------------------------------ *
 * Nome dito por mensagem                                             *
 * ------------------------------------------------------------------ */

/** Prefixos comuns de apresentação ("meu nome é", "me chamo", "sou"...). */
const NAME_PREFIX =
  /^(?:oi|ola|olá|opa|bom dia|boa tarde|boa noite)?[\s,!.-]*(?:o\s+)?(?:meu\s+nome\s+(?:é|e)|meu\s+nome|me\s+chamo|pode\s+me\s+chamar\s+de|aqui\s+(?:é|e)\s+(?:o|a)|nome|sou\s+(?:o|a)|sou)\s*[:,-]?\s*/i;

/** Palavras que denunciam pergunta/conversa, nunca um nome. */
const NOT_A_NAME = new Set([
  "casa", "casas", "apartamento", "apartamentos", "apto", "aptos", "imovel", "imoveis",
  "terreno", "cobertura", "kitnet", "sobrado", "sala", "predio", "condominio",
  "preco", "precos", "valor", "valores", "quanto", "onde", "quando", "qual", "quais",
  "como", "porque", "quero", "queria", "gostaria", "procuro", "procurando", "busco",
  "preciso", "tem", "tenho", "temos", "voce", "voces", "corretor", "corretora",
  "whatsapp", "whats", "zap", "telefone", "contato", "visita", "visitar", "agendar",
  "aluguel", "alugar", "venda", "vender", "comprar", "compra", "financiamento",
  "financiar", "entrada", "parcela", "praia", "grande", "bairro", "guilhermina",
  "obrigado", "obrigada", "bom", "boa", "dia", "tarde", "noite", "sim", "nao",
  "ok", "certo", "beleza", "tudo", "bem", "oi", "ola", "informacao", "informacoes",
  "ajuda", "ajudar", "ainda", "so", "mais", "menos", "pra", "para", "com", "sem",
  "aqui", "ali", "hoje", "amanha", "agora", "depois", "quartos", "quarto", "suite",
  "metros", "mercado", "disponivel", "disponiveis", "foto", "fotos", "video",
]);

const stripAccents = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "");

const titleCase = (value: string) =>
  value
    .split(" ")
    .map((word) =>
      word.length <= 2 && /^(?:d[aeo]s?|e)$/i.test(word)
        ? word.toLowerCase()
        : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
    )
    .join(" ");

/**
 * Tenta ler o nome do visitante numa mensagem livre do chat.
 *
 * Existe porque o visitante costuma responder "Meu nome é Edy" na conversa em
 * vez de usar o formulário — e só o formulário gravava `contactName`. Sem o
 * nome gravado, `toPublicState` mantinha `askName` e o pedido do WhatsApp
 * nunca chegava, principalmente em atendimento humano, onde a IA não roda
 * para reconduzir o visitante ao formulário.
 *
 * É deliberadamente conservador: na dúvida devolve null e o fluxo segue como
 * antes. Nunca aceita pergunta, texto longo ou frase sobre imóvel.
 */
export function extractContactName(raw: string | null | undefined): string | null {
  const text = sanitizeShort(raw ?? "", 200);
  if (!text || text.length > 60) return null;
  /* Pergunta ou frase de conversa: não é apresentação. */
  if (/[?¿]/.test(text)) return null;
  if (/\d/.test(text)) return null;

  const hadPrefix = NAME_PREFIX.test(text);
  const candidate = (hadPrefix ? text.replace(NAME_PREFIX, "") : text)
    .replace(/[.,;:!]+$/g, "")
    .trim();
  if (!candidate) return null;

  const words = candidate.split(" ").filter(Boolean);
  /* Sem prefixo só vale resposta curta ("Edy", "Edy Nunes"). Com prefixo,
     aceita até três palavras (nome composto). */
  const maxWords = hadPrefix ? 3 : 2;
  if (words.length === 0 || words.length > maxWords) return null;

  for (const word of words) {
    if (!/^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’-]*$/.test(word)) return null;
    if (NOT_A_NAME.has(stripAccents(word).toLowerCase())) return null;
  }
  const first = words[0] ?? "";
  if (first.length < 2 || first.length > 20) return null;

  return titleCase(words.join(" ")).slice(0, 120);
}

/**
 * Nome vindo do FORMULÁRIO de contato do chat.
 *
 * O formulário aceitava qualquer texto com 2+ caracteres, então respostas como
 * "sim", "ok" ou "não" viravam o nome do contato na conversa e no lead do CRM.
 * A regra aqui é a mínima necessária: só letras, no máximo 5 palavras (nome
 * composto) e nada que esteja na lista de palavras que nunca são nome.
 */
export function sanitizeContactName(raw: string | null | undefined): string | null {
  const text = sanitizeShort(raw ?? "", 120);
  if (!text || text.length < 2 || /\d/.test(text)) return null;
  const words = text
    .replace(/[.,;:!?]+$/g, "")
    .trim()
    .split(" ")
    .filter(Boolean);
  if (words.length === 0 || words.length > 5) return null;
  for (const word of words) {
    if (!/^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\'’-]*$/.test(word)) return null;
  }
  const first = words[0] ?? "";
  if (first.length < 2 || first.length > 20) return null;
  if (NOT_A_NAME.has(stripAccents(first).toLowerCase())) return null;
  return titleCase(words.join(" ")).slice(0, 120);
}

/** Estado da conversa visível para o visitante (nada administrativo). */
export interface PublicChatState {
  token: string;
  mode: "ia" | "humano";
  status: "aberta" | "fechada";
  identified: boolean;
  askName: boolean;
  askPhone: boolean;
}

/** Mensagens do visitante necessárias antes de pedir nome/WhatsApp. */
export const CONTACT_PROMPT_AFTER = 2;

export function toPublicState(
  token: string,
  conversation: { mode: string; status: string; contactName: string | null; contactPhone: string | null },
  clientMessages: number,
): PublicChatState {
  const hasName = Boolean(conversation.contactName);
  const hasPhone = Boolean(conversation.contactPhone);
  return {
    token,
    mode: conversation.mode === "humano" ? "humano" : "ia",
    status: conversation.status === "fechada" ? "fechada" : "aberta",
    identified: hasName && hasPhone,
    /* Captação progressiva: só depois de a conversa ter andado. O nome e o
       WhatsApp usam o mesmo limiar de propósito — o pedido do telefone vem
       logo após o nome ser salvo. Com limiares diferentes (2 e 3) o fluxo
       travava: o visitante que pedia corretor parava de digitar depois de
       informar o nome, o contador nunca chegava a 3 e o formulário do
       WhatsApp não aparecia mais. */
    askName: !hasName && clientMessages >= CONTACT_PROMPT_AFTER,
    askPhone: hasName && !hasPhone && clientMessages >= CONTACT_PROMPT_AFTER,
  };
}

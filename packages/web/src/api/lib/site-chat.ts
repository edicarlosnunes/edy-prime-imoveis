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

/** Estado da conversa visível para o visitante (nada administrativo). */
export interface PublicChatState {
  token: string;
  mode: "ia" | "humano";
  status: "aberta" | "fechada";
  identified: boolean;
  askName: boolean;
  askPhone: boolean;
}

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
    /* Captação progressiva: só depois de a conversa ter andado. */
    askName: !hasName && clientMessages >= 2,
    askPhone: hasName && !hasPhone && clientMessages >= 3,
  };
}

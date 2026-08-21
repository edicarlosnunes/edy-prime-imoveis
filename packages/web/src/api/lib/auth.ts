/**
 * Autenticação do painel administrativo.
 *
 * - senha: PBKDF2-SHA256 (150k iterações) com salt aleatório por usuário
 * - sessão: token aleatório de 32 bytes; o banco guarda apenas o sha256 do token
 * - cookie: httpOnly + SameSite=Lax + Secure em produção
 *
 * Usa só WebCrypto, que existe tanto no Bun (dev) quanto no runtime Node da
 * Vercel — nada de dependência nativa e nenhuma variável de ambiente nova.
 */
import { and, eq, gt, lt } from "drizzle-orm";
import * as schema from "../database/schema";

export const SESSION_COOKIE = "epi_admin";
const SESSION_TTL_SECONDS = 60 * 60 * 12;
const PBKDF2_ITERATIONS = 150_000;

function toHex(buffer: ArrayBuffer | Uint8Array) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function randomHex(bytes = 32) {
  return toHex(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function hashPassword(password: string, salt = randomHex(16)) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: new TextEncoder().encode(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    key,
    256,
  );
  return { hash: toHex(bits), salt };
}

/** Comparação em tempo constante. */
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyPassword(password: string, hash: string, salt: string) {
  const candidate = await hashPassword(password, salt);
  return safeEqual(candidate.hash, hash);
}

export async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return toHex(digest);
}

export function readSessionToken(headers: Headers) {
  const cookie = headers.get("cookie");
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function sessionCookie(token: string, maxAge = SESSION_TTL_SECONDS) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export function clearedSessionCookie() {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

type Db = Awaited<ReturnType<typeof getDb>>;

export async function getDb() {
  const { db } = await import("../database");
  return db;
}

export async function createSession(db: Db, userId: number) {
  const token = randomHex(32);
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
  await db.insert(schema.adminSessions).values({ userId, tokenHash, expiresAt });
  // limpeza oportunista das sessões vencidas
  await db.delete(schema.adminSessions).where(lt(schema.adminSessions.expiresAt, new Date()));
  return { token, expiresAt };
}

export interface AdminUser {
  id: number;
  name: string;
  email: string;
  role: string;
}

/** Devolve o usuário da sessão ou null. Nunca lança. */
export async function resolveSession(headers: Headers): Promise<AdminUser | null> {
  const token = readSessionToken(headers);
  if (!token) return null;
  try {
    const db = await getDb();
    const tokenHash = await sha256Hex(token);
    const rows = await db
      .select({
        id: schema.adminUsers.id,
        name: schema.adminUsers.name,
        email: schema.adminUsers.email,
        role: schema.adminUsers.role,
      })
      .from(schema.adminSessions)
      .innerJoin(schema.adminUsers, eq(schema.adminUsers.id, schema.adminSessions.userId))
      .where(
        and(
          eq(schema.adminSessions.tokenHash, tokenHash),
          gt(schema.adminSessions.expiresAt, new Date()),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

export async function destroySession(headers: Headers) {
  const token = readSessionToken(headers);
  if (!token) return;
  try {
    const db = await getDb();
    await db
      .delete(schema.adminSessions)
      .where(eq(schema.adminSessions.tokenHash, await sha256Hex(token)));
  } catch {
    /* sessão já inválida */
  }
}

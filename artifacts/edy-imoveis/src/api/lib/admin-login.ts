import { asc, eq } from "drizzle-orm";
import * as schema from "../database/schema";
import type { AdminDb } from "./admin-base";
import { readConfig, saveIntegration } from "./integrations";

const ADMIN_LOGIN_KEY = "admin_login";
export const DEFAULT_ADMIN_LOGIN = "edy";
export const ADMIN_LOGIN_PATTERN = /^[a-z0-9._-]{3,32}$/;

export function normalizeAdminLogin(value: string) {
  return value.trim().toLowerCase();
}

export function validAdminLogin(value: string) {
  return ADMIN_LOGIN_PATTERN.test(normalizeAdminLogin(value));
}

/**
 * O login curto é uma configuração interna do painel. Usamos a tabela genérica
 * de configurações de integrações para não alterar o schema nem exigir migration.
 * A chave não faz parte do catálogo público da Central de Integrações, então não
 * aparece naquela tela.
 */
export async function getAdminLogin(db: AdminDb, userId: number) {
  const { config } = await readConfig(db, ADMIN_LOGIN_KEY);
  const configured = normalizeAdminLogin(config.username ?? "");
  const configuredUserId = Number(config.userId ?? 0);
  if (configured && (!configuredUserId || configuredUserId === userId)) return configured;
  return DEFAULT_ADMIN_LOGIN;
}

/** Resolve tanto o e-mail antigo quanto o login curto. */
export async function findAdminByIdentifier(db: AdminDb, identifier: string) {
  const normalized = normalizeAdminLogin(identifier);
  if (!normalized) return null;

  const [byEmail] = await db
    .select()
    .from(schema.adminUsers)
    .where(eq(schema.adminUsers.email, normalized))
    .limit(1);
  if (byEmail) return byEmail;

  const { config } = await readConfig(db, ADMIN_LOGIN_KEY);
  const configuredLogin = normalizeAdminLogin(config.username ?? "") || DEFAULT_ADMIN_LOGIN;
  if (normalized !== configuredLogin) return null;

  const configuredUserId = Number(config.userId ?? 0);
  if (configuredUserId > 0) {
    const [configuredUser] = await db
      .select()
      .from(schema.adminUsers)
      .where(eq(schema.adminUsers.id, configuredUserId))
      .limit(1);
    if (configuredUser) return configuredUser;
  }

  // Compatibilidade inicial: antes de o usuário salvar o login pela primeira vez,
  // "edy" aponta para o primeiro administrador existente.
  const [firstAdmin] = await db
    .select()
    .from(schema.adminUsers)
    .orderBy(asc(schema.adminUsers.id))
    .limit(1);
  return firstAdmin ?? null;
}

export async function setAdminLogin(db: AdminDb, userId: number, value: string) {
  const username = normalizeAdminLogin(value);
  if (!validAdminLogin(username)) throw new Error("LOGIN_INVALIDO");

  await saveIntegration(db, ADMIN_LOGIN_KEY, {
    config: { username, userId: String(userId) },
    status: "conectado",
    enabled: true,
    lastError: null,
  });
  return username;
}

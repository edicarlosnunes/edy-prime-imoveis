import { and, eq } from "drizzle-orm";
import * as schema from "../database/schema";
import type { AdminDb } from "./admin-base";
import { readConfig, saveIntegration, type ConfigMap } from "./integrations";

export const ML_KEY = "mercadolivre";
export const ML_CALLBACK_PATH = "/api/oauth/mercadolivre/callback";
const API = "https://api.mercadolibre.com";

export async function mlToken(params: Record<string, string>, fetcher: typeof fetch = fetch) {
  const response = await fetcher(`${API}/oauth/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams(params), signal: AbortSignal.timeout(15000),
  });
  const body = await response.json().catch(() => ({})) as { access_token?: string; refresh_token?: string; expires_in?: number; user_id?: number; scope?: string };
  // Never expose provider error bodies: they can contain codes or credentials.
  if (!response.ok || !body.access_token || !body.refresh_token || !Number.isFinite(body.expires_in) || Number(body.expires_in) <= 0) {
    throw new Error(`Mercado Livre recusou a autorização (HTTP ${response.status}). Conecte a conta novamente.`);
  }
  return body as Required<Pick<typeof body, "access_token" | "refresh_token" | "expires_in">> & typeof body;
}

export async function mlAccount(token: string, fetcher: typeof fetch = fetch) {
  const response = await fetcher(`${API}/users/me`, {
    headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000),
  });
  const body = await response.json().catch(() => ({})) as { id?: number; nickname?: string; site_id?: string };
  if (!response.ok || !body.id || body.site_id !== "MLB") throw new Error(`Não foi possível validar uma conta brasileira no Mercado Livre (HTTP ${response.status}).`);
  return { id: String(body.id), name: String(body.nickname || body.id).slice(0, 120) };
}

export function mlTokenConfig(config: ConfigMap, token: Awaited<ReturnType<typeof mlToken>>): ConfigMap {
  return { ...config, accessToken: token.access_token, refreshToken: token.refresh_token,
    tokenExpiresAt: String(Date.now() + Math.max(0, token.expires_in - 60) * 1000), grantedScope: token.scope || "" };
}

export async function replaceMlConfig(db: AdminDb, raw: string, next: ConfigMap) {
  const rows = await db.update(schema.integrations).set({ config: JSON.stringify(next), updatedAt: new Date() })
    .where(and(eq(schema.integrations.key, ML_KEY), eq(schema.integrations.config, raw)))
    .returning({ key: schema.integrations.key });
  return rows.length === 1;
}

export function validMlState(config: ConfigMap, state: string, session: string, now = Date.now()) {
  return Boolean(state && session && config.oauthState === state && config.oauthSession === session && Number(config.oauthExpiresAt) > now);
}

export async function testMercadoLivre(db: AdminDb) {
  const current = await readConfig(db, ML_KEY);
  let config = current.config;
  if (!config.accessToken || !config.refreshToken) return { ok: false, status: "aguardando_credencial" as const, message: "Salve as credenciais e use Conectar conta do Mercado Livre." };
  if (Number(config.refreshLeaseUntil || 0) > Date.now()) throw new Error("A conexão está sendo atualizada. Tente novamente em alguns segundos.");
  if (!(Number(config.tokenExpiresAt) > Date.now())) {
    // Refresh tokens are single-use. Claim a database lease before contacting ML.
    const locked = { ...config, refreshLeaseUntil: String(Date.now() + 60000) };
    if (!current.row?.config || !await replaceMlConfig(db, current.row.config, locked)) throw new Error("A conexão mudou. Repita o teste.");
    try {
      const tokens = await mlToken({ grant_type: "refresh_token", client_id: config.clientId || "", client_secret: config.clientSecret || "", refresh_token: config.refreshToken });
      config = mlTokenConfig(config, tokens);
      delete config.refreshLeaseUntil;
      if (!await replaceMlConfig(db, JSON.stringify(locked), config)) throw new Error("A configuração mudou durante a renovação. Conecte novamente.");
    } catch (error) {
      const cleared = { ...locked };
      delete cleared.refreshLeaseUntil;
      await replaceMlConfig(db, JSON.stringify(locked), cleared);
      throw error;
    }
  }
  const account = await mlAccount(config.accessToken!);
  if (config.sellerId && account.id !== config.sellerId) throw new Error("A conta não corresponde à autorização salva. Conecte novamente.");
  // Preserve config changes made concurrently; the test only updates status.
  await saveIntegration(db, ML_KEY, { status: "conectado", lastError: null });
  return { ok: true, status: "conectado" as const, message: `Conta ${account.name} (${account.id}) validada. Conexão autorizada; envio de imóveis ainda não habilitado e custos não verificados.` };
}

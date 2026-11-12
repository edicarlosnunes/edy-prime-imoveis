/** Publicação direta no LinkedIn, sem Metricool e sem qualquer envio automático. */
import type { Hono } from "hono";
import { and, eq, desc, asc } from "drizzle-orm";
import { getDb, resolveSession, readSessionToken, randomHex, sha256Hex } from "../lib/auth";
import { readConfig, saveIntegration, logEvent } from "../lib/integrations";
import { siteBaseUrl } from "../lib/base-url";
import { publicationDescription } from "../../shared/negotiation";
import { formatPropertyPrice } from "../../shared/property-price";
import * as schema from "../database/schema";

const KEY = "linkedin_direct";
const CALLBACK = "/api/oauth/linkedin/callback";
const VERSION = "202606"; // versão suportada e datada; revisar antes de expirar
const NO_CACHE = { "cache-control": "no-store", "referrer-policy": "no-referrer" };

function headers(token: string) {
 return { Authorization: "Bearer " + token, "Content-Type": "application/json",
   "Linkedin-Version": VERSION, "X-Restli-Protocol-Version": "2.0.0" };
}
function message(error: unknown) {
 return error instanceof Error ? error.message.slice(0, 250) : "Erro ao comunicar com o LinkedIn.";
}
async function provider<T>(url: string, init: RequestInit): Promise<T> {
 const response = await fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(25000) });
 const raw = await response.text();
 let data: any = {};
 try { data = JSON.parse(raw); } catch { /* resposta não-json */ }
 if (!response.ok) throw new Error("LinkedIn HTTP " + response.status + ": " +
   String(data.message || data.error_description || data.error || "Requisição recusada").slice(0, 130));
 return data as T;
}
function back() { return "https://www.esantoscorretor.com.br/admin/linkedin"; }
function caption(property: typeof schema.properties.$inferSelect): string {
 const link = "https://www.esantoscorretor.com.br/imovel/" + encodeURIComponent(property.code) + "?utm_source=linkedin&utm_medium=social";
 return [
  property.title, "Código: " + property.code, formatPropertyPrice(property),
  [property.district, property.city].filter(Boolean).join(" · "),
  publicationDescription(property.description, property.features, 1300),
  "Veja o imóvel: " + link,
  "WhatsApp: https://wa.me/5513997141174?text=" + encodeURIComponent("Olá, vi o imóvel " + property.code + " no LinkedIn e quero mais informações."),
  "Site: https://www.esantoscorretor.com.br",
 ].filter(Boolean).join("\n\n").slice(0, 2950);
}
function validateImage(raw: string): URL {
 const url = new URL(raw);
 if (url.protocol !== "https:" ||
    !(url.hostname.endsWith(".blob.vercel-storage.com") || url.hostname === "www.esantoscorretor.com.br" || url.hostname === "esantoscorretor.com.br"))
    throw new Error("A foto precisa estar armazenada no CRM antes da publicação.");
 return url;
}
async function imageUrn(token: string, owner: string, photo: string) {
 const resource = await fetch(validateImage(photo), { redirect: "error", signal: AbortSignal.timeout(18000) });
 if (!resource.ok) throw new Error("Não foi possível carregar a primeira foto do cadastro.");
 const mime = (resource.headers.get("content-type") || "").split(";")[0].toLowerCase();
 if (!["image/jpeg", "image/png", "image/gif"].includes(mime)) throw new Error("A foto do LinkedIn deve ser JPG ou PNG.");
 const bytes = await resource.arrayBuffer();
 if (bytes.byteLength > 12 * 1024 * 1024) throw new Error("Foto maior que 12 MB. Otimize a capa.");
 const result = await provider<{ value?: { uploadUrl?: string; image?: string } }>(
  "https://api.linkedin.com/rest/images?action=initializeUpload",
  { method: "POST", headers: headers(token), body: JSON.stringify({ initializeUploadRequest: { owner } }) });
 if (!result.value?.uploadUrl || !result.value.image) throw new Error("LinkedIn não autorizou o upload da foto.");
 const dest = new URL(result.value.uploadUrl);
 if (dest.protocol !== "https:" || !(dest.hostname.endsWith(".linkedin.com") || dest.hostname.endsWith(".licdn.com")))
    throw new Error("O destino de upload da foto não pertence ao LinkedIn.");
 const upload = await fetch(dest, { method: "PUT", headers: { Authorization: "Bearer " + token, "Content-Type": mime },
  body: bytes, redirect: "error", signal: AbortSignal.timeout(30000) });
 if (!upload.ok) throw new Error("LinkedIn recusou a imagem (HTTP " + upload.status + ").");
 return result.value.image;
}
export function registerLinkedInRoutes(app: Hono) {
 app.post("/api/oauth/linkedin/start", async c => {
  if (!await resolveSession(c.req.raw.headers)) return c.json({ error: "Faça login no CRM." }, 401, NO_CACHE);
  if (c.req.header("origin") !== new URL(c.req.url).origin) return c.json({ error: "Origem inválida." }, 403, NO_CACHE);
  const db = await getDb();
  const { config } = await readConfig(db, KEY);
  if (!config.clientId || !config.clientSecret) return c.json({ error: "Salve Client ID e Client Secret do aplicativo LinkedIn." }, 400, NO_CACHE);
  const state = randomHex(32);
  await saveIntegration(db, KEY, { config: { ...config, oauthState: state,
   oauthSession: await sha256Hex(readSessionToken(c.req.raw.headers) || ""),
   oauthExpiresAt: String(Date.now() + 600000) }, status: "configurando" });
  const url = new URL("https://www.linkedin.com/oauth/v2/authorization");
  const fields = { response_type: "code", client_id: config.clientId,
   redirect_uri: siteBaseUrl(c.req.raw.headers) + CALLBACK, state,
   scope: "openid profile w_member_social" };
  for (const [name, value] of Object.entries(fields)) url.searchParams.set(name, value);
  return c.json({ url: url.toString() }, 200, NO_CACHE);
 });
 app.get(CALLBACK, async c => {
  if (!await resolveSession(c.req.raw.headers)) return c.redirect("/admin/login");
  const db = await getDb();
  const { config, row } = await readConfig(db, KEY);
  const state = c.req.query("state");
  const session = await sha256Hex(readSessionToken(c.req.raw.headers) || "");
  if (!state || state !== config.oauthState || session !== config.oauthSession ||
     !Number(config.oauthExpiresAt) || Date.now() > Number(config.oauthExpiresAt))
     return c.text("Autorização expirada ou inválida. Volte ao CRM.", 400);
  // Consome o state antes de trocar o code; jamais publica nada na conexão.
  const cleaned = { ...config };
  for (const name of ["oauthState", "oauthSession", "oauthExpiresAt"]) delete cleaned[name];
  // Evita duas callbacks simultâneas com o mesmo state.
  if (!row?.config) return c.text("Estado de autorização inválido.", 409);
  await saveIntegration(db, KEY, { config: cleaned });
  try {
   if (c.req.query("error")) throw new Error("A autorização foi cancelada no LinkedIn.");
   const code = c.req.query("code");
   if (!code || !cleaned.clientId || !cleaned.clientSecret) throw new Error("Faltou código ou credencial de autorização.");
   const body = new URLSearchParams({ grant_type: "authorization_code", code,
    redirect_uri: siteBaseUrl(c.req.raw.headers) + CALLBACK,
    client_id: cleaned.clientId, client_secret: cleaned.clientSecret });
   const token = await provider<{ access_token: string; expires_in: number }>(
    "https://www.linkedin.com/oauth/v2/accessToken",
    { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
   if (!token.access_token) throw new Error("LinkedIn não retornou access_token.");
   const identity = await provider<{ sub: string; name?: string }>(
    "https://api.linkedin.com/v2/userinfo",
    { headers: { Authorization: "Bearer " + token.access_token } });
   if (!identity.sub || !/^[a-zA-Z0-9_-]{3,120}$/.test(identity.sub))
      throw new Error("Identificador de perfil não confirmado pelo LinkedIn.");
   await saveIntegration(db, KEY, { config: { ...cleaned,
    accessToken: token.access_token, personId: identity.sub,
    accountName: identity.name || "Perfil LinkedIn",
    tokenExpiresAt: String(Date.now() + Math.max(0, token.expires_in - 120) * 1000) },
    status: "conectado", enabled: true, lastError: null });
   await logEvent(db, KEY, "config", true, "LinkedIn autorizado; nenhum anúncio foi publicado.");
  } catch (error) {
   await saveIntegration(db, KEY, { status: "erro", enabled: false, lastError: message(error) });
   await logEvent(db, KEY, "error", false, message(error));
  }
  return c.redirect(back(), 303);
 });
 app.get("/api/admin/linkedin/status", async c => {
  if (!await resolveSession(c.req.raw.headers)) return c.json({ error: "Sessão expirada." }, 401, NO_CACHE);
  const { row, config } = await readConfig(await getDb(), KEY);
  return c.json({ connected: row?.status === "conectado" && row.enabled === 1 &&
    Boolean(config.accessToken && config.personId && Number(config.tokenExpiresAt) > Date.now()),
    accountName: config.accountName || null,
    error: row?.lastError || null, expiresAt: config.tokenExpiresAt || null }, 200, NO_CACHE);
 });
 app.post("/api/admin/linkedin/publish", async c => {
  if (!await resolveSession(c.req.raw.headers)) return c.json({ error: "Sessão expirada." }, 401, NO_CACHE);
  if (c.req.header("origin") !== new URL(c.req.url).origin) return c.json({ error: "Origem inválida." }, 403, NO_CACHE);
  let input: { code?: string; includeImage?: boolean };
  try { input = await c.req.json(); } catch { return c.json({ error: "Informe o código EPI." }, 400); }
  const code = String(input.code || "").trim().toUpperCase();
  if (!/^[A-Z0-9-]{6,35}$/.test(code)) return c.json({ error: "Código EPI inválido." }, 400);
  const db = await getDb();
  const { row, config } = await readConfig(db, KEY);
  if (row?.status !== "conectado" || row.enabled !== 1 || !config.accessToken || !config.personId ||
     Number(config.tokenExpiresAt) <= Date.now()) return c.json({ error: "Conecte novamente o LinkedIn no CRM." }, 400);
  const [property] = await db.select().from(schema.properties).where(eq(schema.properties.code, code)).limit(1);
  if (!property || property.status !== "disponivel" || property.published !== 1)
    return c.json({ error: "Imóvel não está publicado e disponível no site." }, 400);
  const previous = await db.select().from(schema.propertyChannels).where(and(
    eq(schema.propertyChannels.propertyId, property.id), eq(schema.propertyChannels.channel, "linkedin")
  )).orderBy(desc(schema.propertyChannels.id)).limit(1);
  if (previous[0] && ["publicado", "enviando", "aguardando"].includes(previous[0].status))
    return c.json({ error: "Este imóvel já foi enviado ao LinkedIn ou está em verificação. Evitamos duplicação." }, 409);
  const record = await db.insert(schema.propertyChannels).values({
    propertyId: property.id, channel: "linkedin", authorized: 1,
    status: "aguardando", message: "Envio iniciado pelo administrador", updatedAt: new Date(),
  }).returning();
  try {
   const owner = "urn:li:person:" + config.personId;
   const body: any = {
    author: owner, commentary: caption(property), visibility: "PUBLIC",
    distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
    lifecycleState: "PUBLISHED", isReshareDisabledByAuthor: false,
   };
   if (input.includeImage !== false) {
    const [photo] = await db.select().from(schema.propertyImages)
      .where(eq(schema.propertyImages.propertyId, property.id))
      .orderBy(desc(schema.propertyImages.isPrimary), asc(schema.propertyImages.sortOrder)).limit(1);
    if (!photo?.url) throw new Error("Não há foto cadastrada. Desmarque Incluir capa para enviar somente texto.");
    body.content = { media: { id: await imageUrn(config.accessToken, owner, photo.url),
      title: property.title.slice(0, 100) } };
   }
   const resp = await fetch("https://api.linkedin.com/rest/posts", {
    method: "POST", headers: headers(config.accessToken),
    body: JSON.stringify(body), redirect: "error", signal: AbortSignal.timeout(30000),
   });
   const raw = await resp.text();
   if (!resp.ok) {
    let parsed: any = {};
    try { parsed = JSON.parse(raw); } catch { /* keep status */ }
    throw new Error("LinkedIn HTTP " + resp.status + ": " +
       String(parsed.message || "A publicação foi recusada.").slice(0, 150));
   }
   const id = resp.headers.get("x-restli-id");
   if (!id) throw new Error("LinkedIn não confirmou ID da publicação. Consulte o perfil antes de repetir.");
   await db.update(schema.propertyChannels).set({
    status: "publicado", message: "LinkedIn confirmou publicação " + id, updatedAt: new Date(),
   }).where(eq(schema.propertyChannels.id, record[0].id));
   await logEvent(db, KEY, "sync", true, "Imóvel " + code + " confirmado pelo LinkedIn.");
   return c.json({ published: true, postId: id }, 200, NO_CACHE);
  } catch (error) {
   const reason = message(error);
   // Se LinkedIn não confirmou resposta, não permitir reenvio cego.
   const ambiguous = /confirmou ID|timeout|aborted|abort/i.test(reason);
   await db.update(schema.propertyChannels).set({
     status: ambiguous ? "aguardando" : "erro", message: reason, updatedAt: new Date(),
   }).where(eq(schema.propertyChannels.id, record[0].id));
   await logEvent(db, KEY, "error", false, "LinkedIn " + code + ": " + reason);
   return c.json({ error: reason }, 400, NO_CACHE);
  }
 });
}

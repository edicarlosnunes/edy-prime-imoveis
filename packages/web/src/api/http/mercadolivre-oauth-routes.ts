import { getDb, randomHex, readSessionToken, resolveSession, sha256Hex } from "../lib/auth";
import { siteBaseUrl } from "../lib/base-url";
import { logEvent, readConfig, saveIntegration } from "../lib/integrations";
import { ML_CALLBACK_PATH, ML_KEY, mlAccount, mlToken, mlTokenConfig, replaceMlConfig, validMlState } from "../lib/mercadolivre";

export async function handleMercadoLivreOAuthRequest(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  if (!["/api/oauth/mercadolivre/start", ML_CALLBACK_PATH].includes(url.pathname)) return null;
  const callback = url.pathname === ML_CALLBACK_PATH;
  if (request.method !== (callback ? "GET" : "POST")) return new Response("Method not allowed", { status: 405 });
  const headers = { "cache-control": "no-store", "referrer-policy": "no-referrer" };
  const redirect = () => new Response(null, { status: 303, headers: { ...headers, location: `${siteBaseUrl(request.headers)}/admin/integracoes` } });
  const user = await resolveSession(request.headers);
  if (!user) return Response.json({ message: "Entre no CRM para conectar a conta." }, { status: 401, headers });
  if (!callback && request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ message: "Origem inválida." }, { status: 403, headers });
  const db = await getDb();
  const current = await readConfig(db, ML_KEY);
  const session = await sha256Hex(readSessionToken(request.headers) || "");
  const redirectUri = `${siteBaseUrl(request.headers)}${ML_CALLBACK_PATH}`;
  if (!callback) {
    if (!/^\d+$/.test(current.config.clientId || "") || !current.config.clientSecret) return Response.json({ message: "Informe e salve App ID e Client Secret." }, { status: 400, headers });
    const state = randomHex(32);
    const verifier = randomHex(32);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    const challenge = btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    await saveIntegration(db, ML_KEY, { config: { ...current.config, oauthState: state, oauthSession: session, oauthExpiresAt: String(Date.now() + 600000), codeVerifier: verifier }, lastError: null });
    const auth = new URL("https://auth.mercadolivre.com.br/authorization");
    for (const [key, value] of Object.entries({ response_type: "code", client_id: current.config.clientId!, redirect_uri: redirectUri, state, code_challenge: challenge, code_challenge_method: "S256" })) auth.searchParams.set(key, value);
    return Response.json({ url: auth.toString() }, { headers });
  }
  // Validate before logging or handling provider errors. Unsolicited callbacks cannot mutate state.
  if (!validMlState(current.config, url.searchParams.get("state") || "", session) || !current.row?.config) return new Response("Autorização inválida ou expirada. Volte ao CRM e conecte novamente.", { status: 400, headers });
  const next = { ...current.config };
  for (const key of ["oauthState", "oauthSession", "oauthExpiresAt", "codeVerifier"]) delete next[key];
  // Atomic consume makes replay and concurrent callback exchange impossible.
  if (!await replaceMlConfig(db, current.row.config, next)) return new Response("Autorização já utilizada. Volte ao CRM.", { status: 409, headers });
  try {
    if (url.searchParams.has("error")) throw new Error("Autorização cancelada no Mercado Livre. Conecte novamente quando desejar.");
    const code = url.searchParams.get("code");
    if (!code) throw new Error("O Mercado Livre não devolveu o código de autorização.");
    const tokens = await mlToken({ grant_type: "authorization_code", client_id: next.clientId!, client_secret: next.clientSecret!, code, redirect_uri: redirectUri, code_verifier: current.config.codeVerifier! });
    const account = await mlAccount(tokens.access_token);
    const connected = { ...mlTokenConfig(next, tokens), sellerId: account.id, sellerName: account.name };
    if (!await replaceMlConfig(db, JSON.stringify(next), connected)) throw new Error("As credenciais mudaram durante a conexão. Conecte novamente.");
    await saveIntegration(db, ML_KEY, { status: "conectado", enabled: false, lastError: null });
    await logEvent(db, ML_KEY, "config", true, `Conta ${account.name} (${account.id}) autorizada. Nenhum anúncio publicado.`);
  } catch (error) {
    const message = error instanceof Error && /^(Mercado Livre|Não foi possível|Autorização cancelada|O Mercado Livre|As credenciais)/.test(error.message) ? error.message : "Falha de comunicação com Mercado Livre. Conecte novamente.";
    await saveIntegration(db, ML_KEY, { status: "erro", lastError: message });
    await logEvent(db, ML_KEY, "error", false, message);
  }
  return redirect();
}

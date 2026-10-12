import { getDb, randomHex, resolveSession } from "../lib/auth";
import { readConfig, saveIntegration, logEvent } from "../lib/integrations";
import { siteBaseUrl } from "../lib/base-url";

const INTEGRATION_KEY = "youtube_publicacao";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CHANNELS_URL = "https://www.googleapis.com/youtube/v3/channels";
const SCOPE = "https://www.googleapis.com/auth/youtube.upload";
const STATE_TTL_MS = 10 * 60 * 1000;

function callbackUrl(headers: Headers) {
  return `${siteBaseUrl(headers)}/api/oauth/youtube/callback`;
}

function appRedirect(request: Request, path: string) {
  return Response.redirect(new URL(path, request.url).toString(), 302);
}

async function freshAccessToken(config: Record<string, string>) {
  const clientId = (config.clientId ?? "").trim();
  const clientSecret = (config.clientSecret ?? "").trim();
  const refreshToken = (config.refreshToken ?? "").trim();
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Conecte a conta do Google antes de testar o canal.");
  }

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const payload = await response.json().catch(() => ({})) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error_description || payload.error || `Falha ao renovar acesso ao Google (HTTP ${response.status}).`);
  }
  return {
    token: payload.access_token,
    expiresAt: String(Date.now() + Math.max(0, Number(payload.expires_in ?? 3600) - 60) * 1000),
  };
}

export async function handleYouTubeOAuthRequest(request: Request): Promise<Response | null> {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/api/oauth/youtube/test") {
    const user = await resolveSession(request.headers);
    if (!user) {
      return Response.json({ ok: false, message: "Sessão expirada. Entre novamente no painel." }, { status: 401 });
    }

    const db = await getDb();
    const current = await readConfig(db, INTEGRATION_KEY);
    try {
      const access = await freshAccessToken(current.config);
      const channelUrl = new URL(CHANNELS_URL);
      channelUrl.searchParams.set("part", "id,snippet");
      channelUrl.searchParams.set("mine", "true");
      const channelResponse = await fetch(channelUrl, {
        headers: { authorization: `Bearer ${access.token}` },
      });
      const channelPayload = await channelResponse.json().catch(() => ({})) as {
        items?: Array<{ id?: string; snippet?: { title?: string; customUrl?: string } }>;
        error?: { message?: string };
      };
      if (!channelResponse.ok) {
        throw new Error(channelPayload.error?.message || `YouTube Data API respondeu HTTP ${channelResponse.status}.`);
      }
      const channel = channelPayload.items?.[0];
      if (!channel?.id) {
        throw new Error("A conta autorizada não possui um canal do YouTube disponível para publicação.");
      }

      const title = channel.snippet?.title?.trim() || "Canal do YouTube";
      const nextConfig = {
        ...current.config,
        accessToken: access.token,
        tokenExpiresAt: access.expiresAt,
        channelId: channel.id,
        channelTitle: title,
        channelHandle: channel.snippet?.customUrl ?? "",
        lastChannelTestAt: new Date().toISOString(),
      };
      await saveIntegration(db, INTEGRATION_KEY, {
        config: nextConfig,
        status: "conectado",
        enabled: true,
        lastError: null,
      });
      const message = `Conectado ao YouTube: ${title} (${channel.id}).`;
      await logEvent(db, INTEGRATION_KEY, "test", true, message);
      return Response.json({ ok: true, message, channelId: channel.id, channelTitle: title });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao testar a conexão com o YouTube.";
      await saveIntegration(db, INTEGRATION_KEY, { status: "erro", lastError: message });
      await logEvent(db, INTEGRATION_KEY, "test", false, message);
      return Response.json({ ok: false, message }, { status: 400 });
    }
  }

  if (request.method !== "GET") return null;

  if (url.pathname === "/api/oauth/youtube/start") {
    const user = await resolveSession(request.headers);
    if (!user) return appRedirect(request, "/admin/login");

    const db = await getDb();
    const current = await readConfig(db, INTEGRATION_KEY);
    const clientId = (current.config.clientId ?? "").trim();
    const clientSecret = (current.config.clientSecret ?? "").trim();
    if (!clientId || !clientSecret) {
      return appRedirect(request, "/admin/youtube?youtube=missing_credentials");
    }

    const state = randomHex(24);
    await saveIntegration(db, INTEGRATION_KEY, {
      config: {
        ...current.config,
        oauthState: state,
        oauthStateExpiresAt: String(Date.now() + STATE_TTL_MS),
      },
      status: "configurando",
      lastError: null,
    });

    const googleUrl = new URL(AUTH_URL);
    googleUrl.searchParams.set("client_id", clientId);
    googleUrl.searchParams.set("redirect_uri", callbackUrl(request.headers));
    googleUrl.searchParams.set("response_type", "code");
    googleUrl.searchParams.set("scope", SCOPE);
    googleUrl.searchParams.set("access_type", "offline");
    googleUrl.searchParams.set("include_granted_scopes", "true");
    googleUrl.searchParams.set("prompt", "consent");
    googleUrl.searchParams.set("state", state);
    return Response.redirect(googleUrl.toString(), 302);
  }

  if (url.pathname !== "/api/oauth/youtube/callback") return null;

  const code = (url.searchParams.get("code") ?? "").trim();
  const state = (url.searchParams.get("state") ?? "").trim();
  const oauthError = (url.searchParams.get("error") ?? "").trim();
  const db = await getDb();
  const current = await readConfig(db, INTEGRATION_KEY);

  if (oauthError) {
    await saveIntegration(db, INTEGRATION_KEY, {
      status: "erro",
      lastError: `Google OAuth: ${oauthError}`,
    });
    await logEvent(db, INTEGRATION_KEY, "error", false, `Google OAuth cancelado/negado: ${oauthError}`);
    return appRedirect(request, `/admin/youtube?youtube=oauth_error&reason=${encodeURIComponent(oauthError)}`);
  }

  const expectedState = current.config.oauthState ?? "";
  const expiresAt = Number(current.config.oauthStateExpiresAt ?? "0");
  if (!code || !state || !expectedState || state !== expectedState || !Number.isFinite(expiresAt) || Date.now() > expiresAt) {
    await saveIntegration(db, INTEGRATION_KEY, {
      status: "erro",
      lastError: "Resposta OAuth inválida ou expirada. Inicie a conexão novamente.",
    });
    await logEvent(db, INTEGRATION_KEY, "error", false, "Callback OAuth rejeitado por state inválido/expirado.");
    return appRedirect(request, "/admin/youtube?youtube=state_error");
  }

  const clientId = (current.config.clientId ?? "").trim();
  const clientSecret = (current.config.clientSecret ?? "").trim();
  if (!clientId || !clientSecret) {
    return appRedirect(request, "/admin/youtube?youtube=missing_credentials");
  }

  const tokenResponse = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: callbackUrl(request.headers),
      grant_type: "authorization_code",
    }),
  });
  const payload = await tokenResponse.json().catch(() => ({})) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
    error_description?: string;
  };

  if (!tokenResponse.ok || !payload.access_token) {
    const message = payload.error_description || payload.error || `Falha OAuth HTTP ${tokenResponse.status}`;
    await saveIntegration(db, INTEGRATION_KEY, { status: "erro", lastError: message });
    await logEvent(db, INTEGRATION_KEY, "error", false, `Falha ao trocar código OAuth: ${message}`);
    return appRedirect(request, "/admin/youtube?youtube=token_error");
  }

  const refreshToken = payload.refresh_token || current.config.refreshToken || "";
  if (!refreshToken) {
    await saveIntegration(db, INTEGRATION_KEY, {
      status: "erro",
      lastError: "O Google não devolveu refresh token. Conecte novamente e autorize o acesso.",
    });
    await logEvent(db, INTEGRATION_KEY, "error", false, "OAuth concluído sem refresh token.");
    return appRedirect(request, "/admin/youtube?youtube=no_refresh_token");
  }

  const nextConfig = { ...current.config };
  delete nextConfig.oauthState;
  delete nextConfig.oauthStateExpiresAt;
  nextConfig.refreshToken = refreshToken;
  nextConfig.accessToken = payload.access_token;
  nextConfig.tokenExpiresAt = String(Date.now() + Math.max(0, Number(payload.expires_in ?? 3600) - 60) * 1000);
  nextConfig.grantedScope = payload.scope ?? SCOPE;
  nextConfig.oauthConnectedAt = new Date().toISOString();

  await saveIntegration(db, INTEGRATION_KEY, {
    config: nextConfig,
    status: "configurando",
    enabled: true,
    lastError: null,
  });
  await logEvent(db, INTEGRATION_KEY, "config", true, "Google OAuth autorizado e refresh token salvo no servidor.");
  return appRedirect(request, "/admin/youtube?youtube=connected");
}

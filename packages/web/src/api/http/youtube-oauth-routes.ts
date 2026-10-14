import { formatPropertyPrice } from "../../shared/property-price";
import { and, desc, eq } from "drizzle-orm";
import { getDb, randomHex, resolveSession } from "../lib/auth";
import { readConfig, saveIntegration, logEvent } from "../lib/integrations";
import { siteBaseUrl } from "../lib/base-url";
import * as schema from "../database/schema";

const INTEGRATION_KEY = "youtube_publicacao";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CHANNELS_URL = "https://www.googleapis.com/youtube/v3/channels";
const VIDEOS_URL = "https://www.googleapis.com/youtube/v3/videos";
const UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos";
const SCOPE = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
].join(" ");
const STATE_TTL_MS = 10 * 60 * 1000;
const MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024;

function callbackUrl(headers: Headers) {
  return `${siteBaseUrl(headers)}/api/oauth/youtube/callback`;
}

function appRedirect(request: Request, path: string) {
  return Response.redirect(new URL(path, request.url).toString(), 302);
}

function safeText(value: unknown, max: number) {
  return String(value ?? "").trim().slice(0, max);
}

async function freshAccessToken(config: Record<string, string>) {
  const clientId = (config.clientId ?? "").trim();
  const clientSecret = (config.clientSecret ?? "").trim();
  const refreshToken = (config.refreshToken ?? "").trim();
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Conecte a conta do Google antes de continuar.");
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

async function youtubeProperties(db: Awaited<ReturnType<typeof getDb>>) {
  return db
    .select({
      id: schema.properties.id,
      code: schema.properties.code,
      title: schema.properties.title,
      purpose: schema.properties.purpose,
      price: schema.properties.price,
      district: schema.properties.district,
      city: schema.properties.city,
      bedrooms: schema.properties.bedrooms,
      suites: schema.properties.suites,
      parking: schema.properties.parking,
      areaUtil: schema.properties.areaUtil,
      description: schema.properties.description,
      youtubeUrl: schema.properties.youtubeUrl,
      updatedAt: schema.properties.updatedAt,
    })
    .from(schema.properties)
    .where(and(eq(schema.properties.published, 1), eq(schema.properties.status, "disponivel")))
    .orderBy(desc(schema.properties.updatedAt))
    .limit(250);
}

async function propertyById(db: Awaited<ReturnType<typeof getDb>>, propertyId: number) {
  const [property] = await db
    .select()
    .from(schema.properties)
    .where(eq(schema.properties.id, propertyId))
    .limit(1);
  return property ?? null;
}

function videoMetadata(property: NonNullable<Awaited<ReturnType<typeof propertyById>>>, baseUrl: string) {
  const title = safeText(property.title || `${property.code} · ${property.district} · ${property.city}`, 100);
  const details = [
    property.code ? `Código do imóvel: ${property.code}` : null,
    property.price > 0 ? `Valor: ${formatPropertyPrice(property)}` : null,
    property.district ? `Bairro: ${property.district}` : null,
    property.city ? `Cidade: ${property.city}` : null,
    property.bedrooms > 0 ? `Dormitórios: ${property.bedrooms}` : null,
    property.suites > 0 ? `Suítes: ${property.suites}` : null,
    property.parking > 0 ? `Vagas: ${property.parking}` : null,
    property.areaUtil > 0 ? `Área útil: ${property.areaUtil} m²` : null,
    property.description ? `\n${safeText(property.description, 2800)}` : null,
    `\nMais informações: ${baseUrl}`,
    "WhatsApp: https://wa.me/5513997141174",
    "Contato: (13) 99714-1174. Nos Shorts, acesse os links no perfil do canal.",
  ].filter(Boolean);
  return { title, description: safeText(details.join("\n"), 4900) };
}

export async function handleYouTubeOAuthRequest(request: Request): Promise<Response | null> {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/api/oauth/youtube/properties") {
    const user = await resolveSession(request.headers);
    if (!user) return Response.json({ ok: false, message: "Não autorizado" }, { status: 401 });
    const db = await getDb();
    const properties = await youtubeProperties(db);
    return Response.json({ ok: true, properties });
  }

  if (request.method === "POST" && url.pathname === "/api/oauth/youtube/upload-session") {
    const user = await resolveSession(request.headers);
    if (!user) return Response.json({ ok: false, message: "Sessão expirada. Entre novamente no painel." }, { status: 401 });

    const body = await request.json().catch(() => ({})) as {
      propertyId?: number;
      fileName?: string;
      fileSize?: number;
      mime?: string;
    };
    const propertyId = Number(body.propertyId ?? 0);
    const fileSize = Number(body.fileSize ?? 0);
    const mime = safeText(body.mime, 120) || "application/octet-stream";
    if (!Number.isInteger(propertyId) || propertyId <= 0) {
      return Response.json({ ok: false, message: "Selecione um imóvel válido." }, { status: 400 });
    }
    if (!Number.isFinite(fileSize) || fileSize <= 0 || fileSize > MAX_VIDEO_BYTES) {
      return Response.json({ ok: false, message: "O vídeo precisa ter até 2 GB para este envio pelo CRM." }, { status: 400 });
    }
    if (!(mime.startsWith("video/") || mime === "application/octet-stream")) {
      return Response.json({ ok: false, message: "Selecione um arquivo de vídeo válido." }, { status: 400 });
    }

    const db = await getDb();
    const current = await readConfig(db, INTEGRATION_KEY);
    const property = await propertyById(db, propertyId);
    if (!property) return Response.json({ ok: false, message: "Imóvel não encontrado." }, { status: 404 });
    if (property.published !== 1 || property.status !== "disponivel") {
      return Response.json({ ok: false, message: "Só imóvel aprovado/publicado e disponível pode ser enviado ao YouTube." }, { status: 400 });
    }

    const [previous] = await db
      .select()
      .from(schema.propertyChannels)
      .where(and(eq(schema.propertyChannels.propertyId, propertyId), eq(schema.propertyChannels.channel, "youtube")))
      .orderBy(desc(schema.propertyChannels.id))
      .limit(1);
    if (previous?.status === "publicado") {
      return Response.json({ ok: false, message: "Este imóvel já possui vídeo publicado no YouTube. Republicação ficará para a próxima etapa." }, { status: 409 });
    }

    try {
      const access = await freshAccessToken(current.config);
      const metadata = videoMetadata(property, siteBaseUrl(request.headers));
      const uploadStart = new URL(UPLOAD_URL);
      uploadStart.searchParams.set("uploadType", "resumable");
      uploadStart.searchParams.set("part", "snippet,status");
      const response = await fetch(uploadStart, {
        method: "POST",
        headers: {
          authorization: `Bearer ${access.token}`,
          "content-type": "application/json; charset=UTF-8",
          "x-upload-content-length": String(fileSize),
          "x-upload-content-type": mime,
        },
        body: JSON.stringify({
          snippet: {
            title: metadata.title,
            description: metadata.description,
            categoryId: "22",
          },
          status: {
            privacyStatus: "private",
            selfDeclaredMadeForKids: false,
          },
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: { message?: string } };
        throw new Error(payload.error?.message || `YouTube recusou o início do upload (HTTP ${response.status}).`);
      }
      const uploadUrl = response.headers.get("location") ?? "";
      if (!uploadUrl) throw new Error("O YouTube não devolveu a URL de upload resumível.");

      await saveIntegration(db, INTEGRATION_KEY, {
        config: { ...current.config, accessToken: access.token, tokenExpiresAt: access.expiresAt },
        status: "conectado",
        enabled: true,
        lastError: null,
      });
      await logEvent(db, INTEGRATION_KEY, "sync", true, `Upload iniciado: ${property.code} · ${safeText(body.fileName, 180)}`);
      return Response.json({
        ok: true,
        uploadUrl,
        accessToken: access.token,
        title: metadata.title,
        description: metadata.description,
        privacy: "private",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao iniciar o upload no YouTube.";
      await saveIntegration(db, INTEGRATION_KEY, { status: "erro", lastError: message });
      await logEvent(db, INTEGRATION_KEY, "error", false, message);
      return Response.json({ ok: false, message }, { status: 400 });
    }
  }

  if (request.method === "POST" && url.pathname === "/api/oauth/youtube/upload-complete") {
    const user = await resolveSession(request.headers);
    if (!user) return Response.json({ ok: false, message: "Sessão expirada. Entre novamente no painel." }, { status: 401 });
    const body = await request.json().catch(() => ({})) as { propertyId?: number; videoId?: string };
    const propertyId = Number(body.propertyId ?? 0);
    const videoId = safeText(body.videoId, 80);
    if (!Number.isInteger(propertyId) || propertyId <= 0 || !videoId) {
      return Response.json({ ok: false, message: "Retorno do upload inválido." }, { status: 400 });
    }

    const db = await getDb();
    const current = await readConfig(db, INTEGRATION_KEY);
    const property = await propertyById(db, propertyId);
    if (!property) return Response.json({ ok: false, message: "Imóvel não encontrado." }, { status: 404 });

    try {
      const access = await freshAccessToken(current.config);
      const verifyUrl = new URL(VIDEOS_URL);
      verifyUrl.searchParams.set("part", "id,snippet,status");
      verifyUrl.searchParams.set("id", videoId);
      const verify = await fetch(verifyUrl, { headers: { authorization: `Bearer ${access.token}` } });
      const payload = await verify.json().catch(() => ({})) as {
        items?: Array<{ id?: string; snippet?: { title?: string }; status?: { privacyStatus?: string; uploadStatus?: string } }>;
        error?: { message?: string };
      };
      if (!verify.ok) throw new Error(payload.error?.message || `Falha ao confirmar vídeo no YouTube (HTTP ${verify.status}).`);
      const video = payload.items?.find((item) => item.id === videoId);
      if (!video?.id) throw new Error("O vídeo enviado não pôde ser confirmado na conta conectada.");

      const link = `https://www.youtube.com/watch?v=${videoId}`;
      const message = `Publicado no YouTube como privado. ID: ${videoId}. URL: ${link}`;
      const [previous] = await db
        .select()
        .from(schema.propertyChannels)
        .where(and(eq(schema.propertyChannels.propertyId, propertyId), eq(schema.propertyChannels.channel, "youtube")))
        .orderBy(desc(schema.propertyChannels.id))
        .limit(1);

      if (previous) {
        await db
          .update(schema.propertyChannels)
          .set({ authorized: 1, status: "publicado", message, lastSyncAt: new Date(), updatedAt: new Date() })
          .where(eq(schema.propertyChannels.id, previous.id));
      } else {
        await db.insert(schema.propertyChannels).values({
          propertyId,
          channel: "youtube",
          authorized: 1,
          status: "publicado",
          message,
          lastSyncAt: new Date(),
        });
      }

      await db
        .update(schema.properties)
        .set({ youtubeUrl: link, updatedAt: new Date() })
        .where(eq(schema.properties.id, propertyId));
      await saveIntegration(db, INTEGRATION_KEY, {
        config: { ...current.config, accessToken: access.token, tokenExpiresAt: access.expiresAt },
        status: "conectado",
        enabled: true,
        lastError: null,
      });
      await logEvent(db, INTEGRATION_KEY, "sync", true, `${property.code}: ${message}`);
      return Response.json({
        ok: true,
        message,
        videoId,
        link,
        title: video.snippet?.title ?? property.title,
        privacy: video.status?.privacyStatus ?? "private",
        uploadStatus: video.status?.uploadStatus ?? "uploaded",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao registrar o vídeo publicado.";
      await saveIntegration(db, INTEGRATION_KEY, { lastError: message });
      await logEvent(db, INTEGRATION_KEY, "error", false, message);
      return Response.json({ ok: false, message }, { status: 400 });
    }
  }

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

import { formatPropertyPrice } from "../../shared/property-price";
import type { Hono } from "hono";
import { del } from "@vercel/blob";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import * as schema from "../database/schema";
import { propertyVideos } from "../database/property-videos-schema";
import { getDb, resolveSession } from "../lib/auth";
import { logEvent, readConfig, saveIntegration } from "../lib/integrations";
import { siteBaseUrl } from "../lib/base-url";

const VIDEO_KINDS = ["short_social", "youtube_long", "book_complete"] as const;
type VideoKind = (typeof VIDEO_KINDS)[number];
const MAX_VIDEO_BYTES = 1024 * 1024 * 1024; // 1 GB por arquivo
const ALLOWED_VIDEO_TYPES = [
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-m4v",
  "video/mpeg",
];
const GRAPH_VERSION = "v26.0";
const INSTAGRAM_GRAPH_BASE = `https://graph.instagram.com/${GRAPH_VERSION}`;
const YOUTUBE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const YOUTUBE_UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos";

function isVideoKind(value: unknown): value is VideoKind {
  return typeof value === "string" && VIDEO_KINDS.includes(value as VideoKind);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureTable() {
  const db = await getDb();
  await db.run(sql.raw(`CREATE TABLE IF NOT EXISTS property_videos (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    property_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    url TEXT NOT NULL,
    pathname TEXT,
    file_name TEXT,
    mime TEXT,
    size INTEGER,
    duration_seconds INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`));
  await db.run(sql.raw("CREATE INDEX IF NOT EXISTS property_videos_property_idx ON property_videos (property_id)"));
  await db.run(sql.raw("CREATE UNIQUE INDEX IF NOT EXISTS property_videos_slot_idx ON property_videos (property_id, kind)"));
  return db;
}

async function propertyExists(propertyId: number) {
  const db = await getDb();
  const [row] = await db
    .select({ id: schema.properties.id })
    .from(schema.properties)
    .where(eq(schema.properties.id, propertyId))
    .limit(1);
  return Boolean(row);
}

async function propertyForPublishing(propertyId: number) {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(schema.properties)
    .where(eq(schema.properties.id, propertyId))
    .limit(1);
  return row ?? null;
}

async function videoFor(propertyId: number, kind: VideoKind) {
  const db = await ensureTable();
  const [row] = await db
    .select()
    .from(propertyVideos)
    .where(and(eq(propertyVideos.propertyId, propertyId), eq(propertyVideos.kind, kind)))
    .limit(1);
  return row ?? null;
}

function safeBlobUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.endsWith(".blob.vercel-storage.com");
  } catch {
    return false;
  }
}

function propertyCaption(property: NonNullable<Awaited<ReturnType<typeof propertyForPublishing>>>, headers: Headers) {
  const site = siteBaseUrl(headers);
  return [
    property.title,
    property.code ? `Código: ${property.code}` : null,
    property.price > 0 ? `Valor: ${formatPropertyPrice(property)}` : null,
    property.district ? `${property.district} · ${property.city}` : property.city,
    property.bedrooms > 0 ? `${property.bedrooms} dormitório(s)` : null,
    property.suites > 0 ? `${property.suites} suíte(s)` : null,
    property.parking > 0 ? `${property.parking} vaga(s)` : null,
    `Mais informações: ${site}`,
  ].filter(Boolean).join("\n");
}

async function latestChannel(propertyId: number, channel: string) {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(schema.propertyChannels)
    .where(and(eq(schema.propertyChannels.propertyId, propertyId), eq(schema.propertyChannels.channel, channel)))
    .orderBy(desc(schema.propertyChannels.id))
    .limit(1);
  return row ?? null;
}

async function saveChannel(propertyId: number, channel: string, status: string, message: string, authorized = 1) {
  const db = await getDb();
  const previous = await latestChannel(propertyId, channel);
  if (previous) {
    await db
      .update(schema.propertyChannels)
      .set({ authorized, status, message, lastSyncAt: status === "publicado" ? new Date() : previous.lastSyncAt, updatedAt: new Date() })
      .where(eq(schema.propertyChannels.id, previous.id));
  } else {
    await db.insert(schema.propertyChannels).values({
      propertyId,
      channel,
      authorized,
      status,
      message,
      lastSyncAt: status === "publicado" ? new Date() : null,
    });
  }
}

async function publishInstagramReel(propertyId: number, videoUrl: string, caption: string, force: boolean) {
  const db = await getDb();
  const { row, config } = await readConfig(db, "instagram_publicacao");
  if (!row || row.enabled !== 1 || !config.userId || !config.accessToken) {
    throw new Error("Instagram não está conectado para publicação.");
  }
  const previous = await latestChannel(propertyId, "instagram_video");
  if (previous?.status === "publicado" && !force) {
    throw new Error("Este vídeo curto já foi publicado no Instagram. Marque republicar para enviar novamente.");
  }

  const createResponse = await fetch(`${INSTAGRAM_GRAPH_BASE}/${config.userId}/media`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      media_type: "REELS",
      video_url: videoUrl,
      caption,
      share_to_feed: "true",
      access_token: config.accessToken,
    }),
  });
  const created = await createResponse.json().catch(() => ({})) as { id?: string; error?: { message?: string } };
  if (!createResponse.ok || !created.id) {
    throw new Error(created.error?.message || `Instagram recusou o vídeo (HTTP ${createResponse.status}).`);
  }

  let ready = false;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await sleep(attempt === 0 ? 1800 : 2200);
    const statusResponse = await fetch(
      `${INSTAGRAM_GRAPH_BASE}/${created.id}?fields=status_code,status&access_token=${encodeURIComponent(config.accessToken)}`,
    );
    const status = await statusResponse.json().catch(() => ({})) as {
      status_code?: string;
      status?: string;
      error?: { message?: string };
    };
    if (!statusResponse.ok) throw new Error(status.error?.message || "Não foi possível acompanhar o processamento do Reel.");
    if (status.status_code === "FINISHED") {
      ready = true;
      break;
    }
    if (["ERROR", "EXPIRED"].includes(status.status_code ?? "")) {
      throw new Error(status.status || "O Instagram não conseguiu processar o vídeo.");
    }
  }
  if (!ready) throw new Error("O Instagram ainda está processando o vídeo. Tente publicar novamente em alguns instantes.");

  const publishResponse = await fetch(`${INSTAGRAM_GRAPH_BASE}/${config.userId}/media_publish`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ creation_id: created.id, access_token: config.accessToken }),
  });
  const published = await publishResponse.json().catch(() => ({})) as { id?: string; error?: { message?: string } };
  if (!publishResponse.ok || !published.id) {
    throw new Error(published.error?.message || `Instagram recusou a publicação (HTTP ${publishResponse.status}).`);
  }

  const permalinkResponse = await fetch(
    `${INSTAGRAM_GRAPH_BASE}/${published.id}?fields=permalink&access_token=${encodeURIComponent(config.accessToken)}`,
  );
  const permalinkPayload = await permalinkResponse.json().catch(() => ({})) as { permalink?: string };
  const message = `Vídeo curto publicado no Instagram. ID: ${published.id}.${permalinkPayload.permalink ? ` URL: ${permalinkPayload.permalink}` : ""}`;
  await saveChannel(propertyId, "instagram_video", "publicado", message, 1);
  await logEvent(db, "instagram_publicacao", "sync", true, message);
  return { id: published.id, url: permalinkPayload.permalink ?? null, message };
}

async function publishFacebookVideo(propertyId: number, videoUrl: string, caption: string, force: boolean) {
  const db = await getDb();
  const { row, config } = await readConfig(db, "facebook_publicacao");
  if (!row || row.enabled !== 1 || !config.pageId || !config.pageToken) {
    throw new Error("Facebook não está conectado para publicação.");
  }
  const previous = await latestChannel(propertyId, "facebook_video");
  if (previous?.status === "publicado" && !force) {
    throw new Error("Este vídeo curto já foi publicado no Facebook. Marque republicar para enviar novamente.");
  }

  const response = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${config.pageId}/videos`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      file_url: videoUrl,
      description: caption,
      access_token: config.pageToken,
    }),
  });
  const payload = await response.json().catch(() => ({})) as { id?: string; error?: { message?: string } };
  if (!response.ok || !payload.id) {
    throw new Error(payload.error?.message || `Facebook recusou o vídeo (HTTP ${response.status}).`);
  }
  const url = `https://www.facebook.com/${config.pageId}/videos/${payload.id}`;
  const message = `Vídeo curto enviado ao Facebook. ID: ${payload.id}. URL: ${url}`;
  await saveChannel(propertyId, "facebook_video", "publicado", message, 1);
  await logEvent(db, "facebook_publicacao", "sync", true, message);
  return { id: payload.id, url, message };
}

async function freshYouTubeAccessToken(config: Record<string, string>) {
  const clientId = (config.clientId ?? "").trim();
  const clientSecret = (config.clientSecret ?? "").trim();
  const refreshToken = (config.refreshToken ?? "").trim();
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Conecte a conta do YouTube antes de publicar.");
  }
  const response = await fetch(YOUTUBE_TOKEN_URL, {
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
    throw new Error(payload.error_description || payload.error || `Falha ao renovar acesso ao YouTube (HTTP ${response.status}).`);
  }
  return {
    token: payload.access_token,
    expiresAt: String(Date.now() + Math.max(0, Number(payload.expires_in ?? 3600) - 60) * 1000),
  };
}

export function registerPropertyVideoRoutes(app: Hono) {
  /** Lista vídeos originais e Book completo salvo do imóvel. */
  app.get("/api/admin/property-videos/:propertyId", async (c) => {
    const user = await resolveSession(c.req.raw.headers);
    if (!user) return c.json({ error: "Não autorizado" }, 401);
    const propertyId = Number(c.req.param("propertyId"));
    if (!Number.isSafeInteger(propertyId) || propertyId <= 0) {
      return c.json({ error: "Imóvel inválido" }, 400);
    }
    const db = await ensureTable();
    const rows = await db
      .select()
      .from(propertyVideos)
      .where(eq(propertyVideos.propertyId, propertyId))
      .orderBy(asc(propertyVideos.id));
    return c.json({ videos: rows }, 200);
  });

  /** Publica o vídeo curto nas integrações Meta já conectadas. */
  app.post("/api/admin/property-videos/:propertyId/publish-meta", async (c) => {
    const user = await resolveSession(c.req.raw.headers);
    if (!user) return c.json({ error: "Não autorizado" }, 401);
    const propertyId = Number(c.req.param("propertyId"));
    if (!Number.isSafeInteger(propertyId) || propertyId <= 0) return c.json({ error: "Imóvel inválido" }, 400);
    const body = await c.req.json().catch(() => ({})) as { targets?: unknown; force?: unknown };
    const targets = Array.isArray(body.targets)
      ? body.targets.filter((value): value is string => value === "instagram" || value === "facebook")
      : [];
    if (targets.length === 0) return c.json({ error: "Selecione Instagram e/ou Facebook." }, 400);
    const property = await propertyForPublishing(propertyId);
    if (!property) return c.json({ error: "Imóvel não encontrado" }, 404);
    if (property.published !== 1 || property.status !== "disponivel") {
      return c.json({ error: "O imóvel precisa estar publicado no site e disponível antes de enviar às redes sociais." }, 400);
    }
    const video = await videoFor(propertyId, "short_social");
    if (!video?.url) return c.json({ error: "Cadastre o vídeo curto antes de publicar." }, 400);
    const caption = propertyCaption(property, c.req.raw.headers);
    const force = body.force === true;
    const results: Record<string, { ok: boolean; message: string; url?: string | null }> = {};

    for (const target of targets) {
      try {
        if (target === "instagram") {
          const result = await publishInstagramReel(propertyId, video.url, caption, force);
          results.instagram = { ok: true, message: result.message, url: result.url };
        } else {
          const result = await publishFacebookVideo(propertyId, video.url, caption, force);
          results.facebook = { ok: true, message: result.message, url: result.url };
        }
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : `Falha ao publicar no ${target}.`;
        results[target] = { ok: false, message };
        await saveChannel(propertyId, `${target}_video`, "erro", message, 0);
      }
    }

    const ok = Object.values(results).some((result) => result.ok);
    return c.json({ ok, results }, ok ? 200 : 400);
  });

  /** Abre upload resumível para o mesmo vídeo curto virar YouTube Short. */
  app.post("/api/admin/property-videos/:propertyId/youtube-short-session", async (c) => {
    const user = await resolveSession(c.req.raw.headers);
    if (!user) return c.json({ error: "Não autorizado" }, 401);
    const propertyId = Number(c.req.param("propertyId"));
    if (!Number.isSafeInteger(propertyId) || propertyId <= 0) return c.json({ error: "Imóvel inválido" }, 400);
    const property = await propertyForPublishing(propertyId);
    if (!property) return c.json({ error: "Imóvel não encontrado" }, 404);
    if (property.published !== 1 || property.status !== "disponivel") {
      return c.json({ error: "O imóvel precisa estar publicado no site e disponível antes do envio." }, 400);
    }
    const video = await videoFor(propertyId, "short_social");
    if (!video?.url || !video.size) return c.json({ error: "Cadastre o vídeo curto antes de publicar." }, 400);
    const previous = await latestChannel(propertyId, "youtube_short");
    const body = await c.req.json().catch(() => ({})) as { force?: unknown };
    if (previous?.status === "publicado" && body.force !== true) {
      return c.json({ error: "Este vídeo curto já foi enviado ao YouTube Shorts." }, 409);
    }

    const db = await getDb();
    const current = await readConfig(db, "youtube_publicacao");
    try {
      const access = await freshYouTubeAccessToken(current.config);
      const title = `${String(property.title || property.code).slice(0, 85)} #Shorts`;
      const description = `${propertyCaption(property, c.req.raw.headers)}\n\n#Shorts`.slice(0, 4900);
      const start = new URL(YOUTUBE_UPLOAD_URL);
      start.searchParams.set("uploadType", "resumable");
      start.searchParams.set("part", "snippet,status");
      const response = await fetch(start, {
        method: "POST",
        headers: {
          authorization: `Bearer ${access.token}`,
          "content-type": "application/json; charset=UTF-8",
          "x-upload-content-length": String(video.size),
          "x-upload-content-type": video.mime || "video/mp4",
        },
        body: JSON.stringify({
          snippet: { title, description, categoryId: "22" },
          status: { privacyStatus: "private", selfDeclaredMadeForKids: false },
        }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message || `YouTube recusou o início do Short (HTTP ${response.status}).`);
      const uploadUrl = response.headers.get("location") ?? "";
      if (!uploadUrl) throw new Error("O YouTube não devolveu a URL de upload do Short.");
      await saveIntegration(db, "youtube_publicacao", {
        config: { ...current.config, accessToken: access.token, tokenExpiresAt: access.expiresAt },
        status: "conectado",
        enabled: true,
        lastError: null,
      });
      return c.json({ ok: true, uploadUrl, accessToken: access.token, videoUrl: video.url, mime: video.mime || "video/mp4" }, 200);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Falha ao preparar o YouTube Short.";
      return c.json({ error: message }, 400);
    }
  });

  app.post("/api/admin/property-videos/:propertyId/youtube-short-complete", async (c) => {
    const user = await resolveSession(c.req.raw.headers);
    if (!user) return c.json({ error: "Não autorizado" }, 401);
    const propertyId = Number(c.req.param("propertyId"));
    const body = await c.req.json().catch(() => ({})) as { videoId?: unknown; book?: unknown };
    const videoId = String(body.videoId ?? "").trim();
    if (!Number.isSafeInteger(propertyId) || propertyId <= 0 || !videoId) return c.json({ error: "Retorno do YouTube inválido" }, 400);
    const link = `https://www.youtube.com/watch?v=${videoId}`;
    const message = `${body.book === true ? "Book completo" : "Vídeo curto"} enviado ao YouTube Shorts como privado. ID: ${videoId}. URL: ${link}`;
    await saveChannel(propertyId, "youtube_short", "publicado", message, 1);
    const db = await getDb();
    await logEvent(db, "youtube_publicacao", "sync", true, message);
    return c.json({ ok: true, videoId, link, message }, 200);
  });

  /**
   * Endpoint usado pelo upload direto navegador -> Vercel Blob. O arquivo
   * grande não atravessa a Function do CRM; aqui só é emitido o token curto.
   */
  app.post("/api/admin/property-videos/upload", async (c) => {
    const user = await resolveSession(c.req.raw.headers);
    if (!user) return c.json({ error: "Não autorizado" }, 401);

    let body: HandleUploadBody;
    try {
      body = (await c.req.json()) as HandleUploadBody;
    } catch {
      return c.json({ error: "Requisição inválida" }, 400);
    }

    try {
      const response = await handleUpload({
        body,
        request: c.req.raw,
        onBeforeGenerateToken: async (_pathname, clientPayload) => {
          let payload: { propertyId?: unknown; kind?: unknown } = {};
          try {
            payload = JSON.parse(clientPayload ?? "{}") as typeof payload;
          } catch {
            throw new Error("Dados do vídeo inválidos");
          }
          const propertyId = Number(payload.propertyId);
          if (!Number.isSafeInteger(propertyId) || propertyId <= 0 || !(await propertyExists(propertyId))) {
            throw new Error("Imóvel não encontrado");
          }
          if (!isVideoKind(payload.kind)) throw new Error("Tipo de vídeo inválido");
          if (payload.kind === "book_complete" && !_pathname.startsWith(`properties/${propertyId}/book-youtube/`)) throw new Error("Destino do Book inválido");
          return {
            allowedContentTypes: ALLOWED_VIDEO_TYPES,
            maximumSizeInBytes: MAX_VIDEO_BYTES,
            addRandomSuffix: true,
            tokenPayload: JSON.stringify({ propertyId, kind: payload.kind, userId: user.id }),
          };
        },
        onUploadCompleted: async () => {
          // O vínculo é confirmado pelo navegador em /attach logo após o Blob responder.
        },
      });
      return c.json(response, 200);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Falha ao preparar upload";
      return c.json({ error: message }, 400);
    }
  });

  /** Confirma o arquivo que acabou de chegar ao Blob e ocupa o slot do imóvel. */
  app.post("/api/admin/property-videos/attach", async (c) => {
    const user = await resolveSession(c.req.raw.headers);
    if (!user) return c.json({ error: "Não autorizado" }, 401);

    let body: {
      propertyId?: unknown;
      kind?: unknown;
      url?: unknown;
      pathname?: unknown;
      fileName?: unknown;
      mime?: unknown;
      size?: unknown;
      durationSeconds?: unknown;
    };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Requisição inválida" }, 400);
    }

    const propertyId = Number(body.propertyId);
    if (!Number.isSafeInteger(propertyId) || propertyId <= 0 || !(await propertyExists(propertyId))) {
      return c.json({ error: "Imóvel não encontrado" }, 404);
    }
    if (!isVideoKind(body.kind)) return c.json({ error: "Tipo de vídeo inválido" }, 400);
    const url = String(body.url ?? "").trim();
    if (!safeBlobUrl(url)) return c.json({ error: "Arquivo de vídeo inválido" }, 400);
    if (body.kind === "book_complete" && !new URL(url).pathname.startsWith(`/properties/${propertyId}/book-youtube/`)) return c.json({ error: "O Book precisa pertencer a este imóvel." }, 400);
    const size = Number(body.size ?? 0);
    if (!Number.isFinite(size) || size <= 0 || size > MAX_VIDEO_BYTES) {
      return c.json({ error: "Tamanho de vídeo inválido" }, 400);
    }
    const mime = String(body.mime ?? "").trim();
    if (mime && !ALLOWED_VIDEO_TYPES.includes(mime)) {
      return c.json({ error: "Formato de vídeo não suportado" }, 400);
    }
    const duration = Math.max(0, Math.round(Number(body.durationSeconds ?? 0)) || 0);
    if (body.kind === "short_social" && duration > 60) {
      return c.json({ error: "O vídeo curto deve ter no máximo 60 segundos." }, 400);
    }

    const db = await ensureTable();
    const [previous] = await db
      .select()
      .from(propertyVideos)
      .where(and(eq(propertyVideos.propertyId, propertyId), eq(propertyVideos.kind, body.kind)))
      .limit(1);

    const now = new Date();
    await db
      .insert(propertyVideos)
      .values({
        propertyId,
        kind: body.kind,
        url,
        pathname: String(body.pathname ?? "").trim() || null,
        fileName: String(body.fileName ?? "").trim() || null,
        mime: mime || null,
        size: Math.round(size),
        durationSeconds: duration || null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [propertyVideos.propertyId, propertyVideos.kind],
        set: {
          url,
          pathname: String(body.pathname ?? "").trim() || null,
          fileName: String(body.fileName ?? "").trim() || null,
          mime: mime || null,
          size: Math.round(size),
          durationSeconds: duration || null,
          updatedAt: now,
        },
      });

    if (previous?.url && previous.url !== url) {
      try {
        await del(previous.url);
      } catch (caught) {
        console.warn("[property-video] Não foi possível remover o Blob substituído:", caught);
      }
    }

    const [saved] = await db
      .select()
      .from(propertyVideos)
      .where(and(eq(propertyVideos.propertyId, propertyId), eq(propertyVideos.kind, body.kind)))
      .limit(1);
    return c.json({ ok: true, video: saved }, 200);
  });

  /** Remove apenas o vídeo do slot; nunca altera o cadastro/publicação do imóvel. */
  app.delete("/api/admin/property-videos/:propertyId/:kind", async (c) => {
    const user = await resolveSession(c.req.raw.headers);
    if (!user) return c.json({ error: "Não autorizado" }, 401);
    const propertyId = Number(c.req.param("propertyId"));
    const kind = c.req.param("kind");
    if (!Number.isSafeInteger(propertyId) || propertyId <= 0 || !isVideoKind(kind)) {
      return c.json({ error: "Dados inválidos" }, 400);
    }
    const db = await ensureTable();
    const [current] = await db
      .select()
      .from(propertyVideos)
      .where(and(eq(propertyVideos.propertyId, propertyId), eq(propertyVideos.kind, kind)))
      .limit(1);
    await db
      .delete(propertyVideos)
      .where(and(eq(propertyVideos.propertyId, propertyId), eq(propertyVideos.kind, kind)));
    if (current?.url) {
      try {
        await del(current.url);
      } catch (caught) {
        console.warn("[property-video] Não foi possível remover o Blob:", caught);
      }
    }
    return c.json({ ok: true }, 200);
  });

  /** Resumo operacional para o card do Dashboard. */
  app.get("/api/admin/property-videos-pending", async (c) => {
    const user = await resolveSession(c.req.raw.headers);
    if (!user) return c.json({ error: "Não autorizado" }, 401);
    const db = await ensureTable();
    const properties = await db
      .select({
        id: schema.properties.id,
        code: schema.properties.code,
        title: schema.properties.title,
        status: schema.properties.status,
      })
      .from(schema.properties)
      .where(inArray(schema.properties.status, ["disponivel", "reservado"]));
    const videos = await db.select().from(propertyVideos);
    const items = properties.map((property) => {
      const own = videos.filter((video) => video.propertyId === property.id);
      const shortReady = own.some((video) => video.kind === "short_social");
      const youtubeReady = own.some((video) => video.kind === "youtube_long");
      return { ...property, shortReady, youtubeReady, missing: Number(!shortReady) + Number(!youtubeReady) };
    });
    const pending = items.filter((item) => item.missing > 0);
    return c.json({
      totalProperties: items.length,
      pendingProperties: pending.length,
      shortMissing: items.filter((item) => !item.shortReady).length,
      youtubeMissing: items.filter((item) => !item.youtubeReady).length,
      bothMissing: items.filter((item) => !item.shortReady && !item.youtubeReady).length,
      complete: items.filter((item) => item.shortReady && item.youtubeReady).length,
      items: pending,
    }, 200);
  });
}

import { formatPropertyPrice } from "../../shared/property-price";
import type { Hono } from "hono";
import { del } from "@vercel/blob";
import { and, desc, eq } from "drizzle-orm";
import * as schema from "../database/schema";
import { propertyVideos } from "../database/property-videos-schema";
import { getDb, resolveSession } from "../lib/auth";
import { readConfig } from "../lib/integrations";
import { siteBaseUrl } from "../lib/base-url";

const YOUTUBE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const YOUTUBE_UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos";

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
    error?: string;
    error_description?: string;
  };
  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error_description || payload.error || `Falha ao renovar acesso ao YouTube (HTTP ${response.status}).`);
  }
  return payload.access_token;
}

function captionFor(property: any, headers: Headers) {
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
    "WhatsApp: https://wa.me/5513997141174",
    "Contato: (13) 99714-1174. Nos Shorts, acesse os links no perfil do canal.",
    "#Shorts",
  ].filter(Boolean).join("\n").slice(0, 4900);
}

export function registerYoutubeShortProxyRoutes(app: Hono) {
  // Esta rota fica registrada antes da implementação antiga. Ela mantém o
  // contrato esperado pela tela, mas troca o upload navegador -> Google por
  // um proxy servidor -> Google, evitando o "Failed to fetch" por CORS/rede.
  app.post("/api/admin/property-videos/:propertyId/youtube-short-session", async (c) => {
    const user = await resolveSession(c.req.raw.headers);
    if (!user) return c.json({ error: "Não autorizado" }, 401);

    const propertyId = Number(c.req.param("propertyId"));
    if (!Number.isSafeInteger(propertyId) || propertyId <= 0) {
      return c.json({ error: "Imóvel inválido" }, 400);
    }

    const db = await getDb();
    const [property] = await db.select().from(schema.properties).where(eq(schema.properties.id, propertyId)).limit(1);
    if (!property) return c.json({ error: "Imóvel não encontrado" }, 404);
    if (property.published !== 1 || property.status !== "disponivel") {
      return c.json({ error: "O imóvel precisa estar publicado no site e disponível antes do envio." }, 400);
    }

    const [video] = await db
      .select()
      .from(propertyVideos)
      .where(and(eq(propertyVideos.propertyId, propertyId), eq(propertyVideos.kind, "short_social")))
      .limit(1);
    if (!video?.url || !video.size) return c.json({ error: "Cadastre o vídeo curto antes de publicar." }, 400);

    const body = await c.req.json().catch(() => ({})) as { force?: unknown; book?: unknown };
    const [previous] = await db
      .select()
      .from(schema.propertyChannels)
      .where(and(eq(schema.propertyChannels.propertyId, propertyId), eq(schema.propertyChannels.channel, "youtube_short")))
      .orderBy(desc(schema.propertyChannels.id))
      .limit(1);
    if (previous?.status === "publicado" && body.force !== true && !(body.book === true && !previous.message?.includes("Book completo"))) {
      return c.json({ error: "Este vídeo curto já foi enviado ao YouTube Shorts." }, 409);
    }

    const current = await readConfig(db, "youtube_publicacao");
    if (!current.row || current.row.enabled !== 1) {
      return c.json({ error: "YouTube não está conectado para publicação." }, 400);
    }
    const clientId = (current.config.clientId ?? "").trim();
    const clientSecret = (current.config.clientSecret ?? "").trim();
    const refreshToken = (current.config.refreshToken ?? "").trim();
    if (!clientId || !clientSecret || !refreshToken) {
      return c.json({ error: "Conecte a conta do YouTube antes de publicar." }, 400);
    }

    return c.json({
      ok: true,
      uploadUrl: `/api/admin/property-videos/${propertyId}/youtube-short-proxy-upload`,
      accessToken: "crm-proxy",
      // A tela atual espera buscar um Blob antes do PUT. Mandamos apenas 1 byte;
      // o vídeo verdadeiro é buscado pelo servidor diretamente do Vercel Blob.
      videoUrl: "data:application/octet-stream;base64,AA==",
      mime: video.mime || "video/mp4",
    }, 200);
  });

  app.put("/api/admin/property-videos/:propertyId/youtube-short-proxy-upload", async (c) => {
    const user = await resolveSession(c.req.raw.headers);
    if (!user) return c.json({ error: { message: "Não autorizado" } }, 401);

    const propertyId = Number(c.req.param("propertyId"));
    if (!Number.isSafeInteger(propertyId) || propertyId <= 0) {
      return c.json({ error: { message: "Imóvel inválido" } }, 400);
    }

    const db = await getDb();
    const [property] = await db.select().from(schema.properties).where(eq(schema.properties.id, propertyId)).limit(1);
    const [video] = await db
      .select()
      .from(propertyVideos)
      .where(and(eq(propertyVideos.propertyId, propertyId), eq(propertyVideos.kind, "short_social")))
      .limit(1);
    if (!property || !video?.url) {
      return c.json({ error: { message: "Vídeo curto não encontrado no CRM." } }, 404);
    }

    let bookVideoUrl: string | null = null;
    if (c.req.header("content-type")?.includes("application/json")) {
      const body = await c.req.json().catch(() => ({})) as { bookVideoUrl?: unknown };
      try {
        const url = new URL(String(body.bookVideoUrl ?? ""));
        const stored = new URL(video.url);
        if (url.protocol !== "https:" || url.origin !== stored.origin || !url.hostname.endsWith(".blob.vercel-storage.com") || !url.pathname.startsWith(`/properties/${propertyId}/book-youtube/`) || url.search || url.hash) throw new Error();
        bookVideoUrl = url.toString();
      } catch {
        return c.json({ error: { message: "Arquivo do Book completo inválido." } }, 400);
      }
    }
    const [previous] = await db.select().from(schema.propertyChannels)
      .where(and(eq(schema.propertyChannels.propertyId, propertyId), eq(schema.propertyChannels.channel, "youtube_short")))
      .orderBy(desc(schema.propertyChannels.id)).limit(1);
    if (previous?.status === "publicado" && (!bookVideoUrl || previous.message?.includes("Book completo"))) {
      return c.json({ error: { message: "Este conteúdo já foi enviado ao YouTube Shorts." } }, 409);
    }
    if (property.published !== 1 || property.status !== "disponivel") return c.json({ error: { message: "O imóvel precisa estar publicado e disponível." } }, 400);
    try {
      const current = await readConfig(db, "youtube_publicacao");
      if (current.row?.enabled !== 1) throw new Error("YouTube não está conectado para publicação.");
      const accessToken = await freshYouTubeAccessToken(current.config);

      const sourceResponse = await fetch(bookVideoUrl || video.url, { redirect: "error" });
      if (!sourceResponse.ok) {
        throw new Error(`O CRM não conseguiu abrir o vídeo armazenado (HTTP ${sourceResponse.status}).`);
      }
      const videoBytes = await sourceResponse.arrayBuffer();
      if (videoBytes.byteLength === 0) throw new Error("O arquivo do vídeo curto está vazio.");
      const mime = bookVideoUrl ? sourceResponse.headers.get("content-type") : video.mime || sourceResponse.headers.get("content-type") || "video/mp4";
      if (!mime || (bookVideoUrl && !["video/mp4", "video/webm"].includes(mime.split(";")[0]))) throw new Error("Formato do vídeo não suportado.");

      const start = new URL(YOUTUBE_UPLOAD_URL);
      start.searchParams.set("uploadType", "resumable");
      start.searchParams.set("part", "snippet,status");
      const startResponse = await fetch(start, {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json; charset=UTF-8",
          "x-upload-content-length": String(videoBytes.byteLength),
          "x-upload-content-type": mime,
        },
        body: JSON.stringify({
          snippet: {
            title: `${String(property.title || property.code).slice(0, 85)} #Shorts`,
            description: captionFor(property, c.req.raw.headers),
            categoryId: "22",
          },
          status: { privacyStatus: "private", selfDeclaredMadeForKids: false },
        }),
      });
      const startPayload = await startResponse.json().catch(() => ({})) as { error?: { message?: string } };
      if (!startResponse.ok) {
        throw new Error(startPayload.error?.message || `YouTube recusou o início do Short (HTTP ${startResponse.status}).`);
      }
      const googleUploadUrl = startResponse.headers.get("location");
      if (!googleUploadUrl) throw new Error("O YouTube não devolveu a URL de upload do Short.");

      const uploadResponse = await fetch(googleUploadUrl, {
        method: "PUT",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": mime,
          "content-length": String(videoBytes.byteLength),
        },
        body: videoBytes,
      });
      const uploaded = await uploadResponse.json().catch(() => ({})) as { id?: string; error?: { message?: string } };
      if (!uploadResponse.ok || !uploaded.id) {
        throw new Error(uploaded.error?.message || `YouTube recusou o arquivo do Short (HTTP ${uploadResponse.status}).`);
      }

      return c.json({ id: uploaded.id }, 200);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Falha no upload do YouTube Short.";
      return c.json({ error: { message } }, 400);
    } finally {
      if (bookVideoUrl) await del(bookVideoUrl).catch(() => {});
    }
  });
}

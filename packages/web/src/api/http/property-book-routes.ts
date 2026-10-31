import { put } from "@vercel/blob";
import { prepareInstagramImage } from "../lib/instagram-image-delivery";
import { publicationDescription } from "../../shared/negotiation";
import { formatPropertyPrice } from "../../shared/property-price";
import type { Hono } from "hono";
import { and, desc, eq } from "drizzle-orm";
import * as schema from "../database/schema";
import { propertyVideos } from "../database/property-videos-schema";
import { getDb, resolveSession } from "../lib/auth";
import { logEvent, readConfig } from "../lib/integrations";
import { siteBaseUrl } from "../lib/base-url";

const GRAPH_VERSION = "v26.0";
const INSTAGRAM_GRAPH_BASE = `https://graph.instagram.com/${GRAPH_VERSION}`;

type MetaError = {
  message?: string;
  code?: number;
  error_subcode?: number;
  error_user_title?: string;
  error_user_msg?: string;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function captionFor(property: any, headers: Headers) {
  const site = siteBaseUrl(headers);
  return [
    property.title,
    publicationDescription(property.description,property.features) || null,
    property.code ? `Código: ${property.code}` : null,
    property.price > 0 ? `Valor: ${formatPropertyPrice(property)}` : null,
    property.district ? `${property.district} · ${property.city}` : property.city,
    property.bedrooms > 0 ? `${property.bedrooms} dormitório(s)` : null,
    property.suites > 0 ? `${property.suites} suíte(s)` : null,
    property.parking > 0 ? `${property.parking} vaga(s)` : null,
    `Mais informações: ${site}`,
  ].filter(Boolean).join("\n\n").slice(0, 2100);
}

function safePublicUrl(value: unknown) {
  try {
    const url = new URL(String(value ?? ""));
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function metaErrorMessage(label: string, error: MetaError | undefined, fallback: string) {
  if (!error) return `${label}: ${fallback}`;
  const detail = error.error_user_msg || error.message || fallback;
  const code = [error.code, error.error_subcode].filter((value) => value !== undefined).join("/");
  return `${label}: ${detail}${code ? ` (Meta ${code})` : ""}`;
}

function publishedInstagramId(message: string | null | undefined) {
  const match = String(message ?? "").match(/ID:\s*([0-9]+)/i);
  return match?.[1] ?? null;
}

async function instagramMediaStillExists(mediaId: string, accessToken: string) {
  const response = await fetch(
    `${INSTAGRAM_GRAPH_BASE}/${mediaId}?fields=id,permalink&access_token=${encodeURIComponent(accessToken)}`,
  );
  if (response.ok) return true;
  const payload = await response.json().catch(() => ({})) as { error?: MetaError };
  const code = payload.error?.code;
  const subcode = payload.error?.error_subcode;
  if (code === 100 || code === 190 || subcode === 33) return false;
  return true;
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
      .set({
        authorized,
        status,
        message,
        lastSyncAt: status === "publicado" ? new Date() : previous.lastSyncAt,
        updatedAt: new Date(),
      })
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

async function waitForContainer(containerId: string, accessToken: string, label: string, maxAttempts = 40) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    await sleep(attempt === 0 ? 1800 : 2500);
    const statusResponse = await fetch(
      `${INSTAGRAM_GRAPH_BASE}/${containerId}?fields=status_code,status&access_token=${encodeURIComponent(accessToken)}`,
    );
    const status = await statusResponse.json().catch(() => ({})) as {
      status_code?: string;
      status?: string;
      error?: MetaError;
    };
    if (!statusResponse.ok) {
      throw new Error(metaErrorMessage(label, status.error, "Não foi possível acompanhar o processamento."));
    }
    if (["FINISHED", "PUBLISHED"].includes(status.status_code ?? "")) return;
    if (["ERROR", "EXPIRED"].includes(status.status_code ?? "")) {
      throw new Error(`${label}: ${status.status || "O Instagram não conseguiu processar esta mídia."}`);
    }
  }
  throw new Error(`${label}: o Instagram ainda está processando esta mídia. Tente publicar novamente em alguns instantes.`);
}

async function createImageChild(userId: string, accessToken: string, imageUrl: string, label: string) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) await sleep(2500);
    const response = await fetch(`${INSTAGRAM_GRAPH_BASE}/${userId}/media`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        image_url: imageUrl,
        is_carousel_item: "true",
        access_token: accessToken,
      }),
    });
    const payload = await response.json().catch(() => ({})) as { id?: string; error?: MetaError };
    if (response.ok && payload.id) return payload.id;

    const fetchFailure = payload.error?.code === 9004 || payload.error?.error_subcode === 2207052;
    if (attempt === 0 && fetchFailure) continue;
    throw new Error(metaErrorMessage(label, payload.error, `Instagram recusou esta imagem (HTTP ${response.status}).`));
  }
  throw new Error(`${label}: o Instagram não conseguiu baixar a imagem.`);
}

async function createVideoChild(userId: string, accessToken: string, videoUrl: string) {
  const response = await fetch(`${INSTAGRAM_GRAPH_BASE}/${userId}/media`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      media_type: "VIDEO",
      video_url: videoUrl,
      is_carousel_item: "true",
      access_token: accessToken,
    }),
  });
  const payload = await response.json().catch(() => ({})) as { id?: string; error?: MetaError };
  if (!response.ok || !payload.id) {
    throw new Error(metaErrorMessage("Vídeo curto", payload.error, `Instagram recusou o vídeo do Book (HTTP ${response.status}).`));
  }
  await waitForContainer(payload.id, accessToken, "Vídeo curto");
  return payload.id;
}

export function registerPropertyBookRoutes(app: Hono) {
  app.post("/api/admin/property-book/:propertyId/publish-instagram", async (c) => {
    const user = await resolveSession(c.req.raw.headers);
    if (!user) return c.json({ error: "Não autorizado" }, 401);

    const propertyId = Number(c.req.param("propertyId"));
    if (!Number.isSafeInteger(propertyId) || propertyId <= 0) return c.json({ error: "Imóvel inválido" }, 400);

    const body = await c.req.json().catch(() => ({})) as {
      coverUrl?: unknown;
      ctaUrl?: unknown;
      photoUrls?: unknown;
      force?: unknown;
    };
    const coverUrl = safePublicUrl(body.coverUrl);
    const ctaUrl = safePublicUrl(body.ctaUrl);
    const photoUrls = Array.isArray(body.photoUrls)
      ? body.photoUrls.map(safePublicUrl).filter((value): value is string => Boolean(value)).slice(0, 8)
      : [];
    if (!coverUrl || !ctaUrl) return c.json({ error: "A capa e o encerramento do Book são obrigatórios." }, 400);

    const db = await getDb();
    const [property] = await db.select().from(schema.properties).where(eq(schema.properties.id, propertyId)).limit(1);
    if (!property) return c.json({ error: "Imóvel não encontrado" }, 404);
    if (property.published !== 1 || property.status !== "disponivel") {
      return c.json({ error: "O imóvel precisa estar publicado no site e disponível antes de enviar ao Instagram." }, 400);
    }

    const [video] = await db
      .select()
      .from(propertyVideos)
      .where(and(eq(propertyVideos.propertyId, propertyId), eq(propertyVideos.kind, "short_social")))
      .limit(1);

    const { row, config } = await readConfig(db, "instagram_publicacao");
    if (!row || row.enabled !== 1 || !config.userId || !config.accessToken) {
      return c.json({ error: "Instagram não está conectado para publicação." }, 400);
    }

    const previous = await latestChannel(propertyId, "instagram_book");
    if (previous?.status === "publicado" && body.force !== true) {
      const mediaId = publishedInstagramId(previous.message);
      const stillExists = mediaId ? await instagramMediaStillExists(mediaId, config.accessToken) : true;
      if (stillExists) {
        return c.json({ error: "Este Book já foi publicado no Instagram." }, 409);
      }
      await saveChannel(propertyId, "instagram_book", "removido_externamente", "A publicação anterior foi removida do Instagram. O Book foi liberado para republicação.", 1);
    }

    try {
      const publicImage = (url: string) => prepareInstagramImage(
        url,
        siteBaseUrl(c.req.raw.headers),
        async (id) => {
          const [image] = await db.select({ mime: schema.media.mime, data: schema.media.data })
            .from(schema.media).where(eq(schema.media.id, id)).limit(1);
          return image ?? null;
        },
        async (id, bytes) => {
          const saved = await put(`social/instagram/${propertyId}/${id}.jpg`, bytes, {
            access: "public", addRandomSuffix: true, contentType: "image/jpeg",
          });
          return saved.url;
        },
      );
      const children: string[] = [];
      children.push(await createImageChild(config.userId, config.accessToken, await publicImage(coverUrl), "Capa"));
      if (video?.url) {
        children.push(await createVideoChild(config.userId, config.accessToken, video.url));
      }
      const selectedPhotoUrls = photoUrls.slice(0, video?.url ? 7 : 8);
      for (let index = 0; index < selectedPhotoUrls.length; index += 1) {
        const photoUrl = selectedPhotoUrls[index];
        children.push(await createImageChild(config.userId, config.accessToken, await publicImage(photoUrl), `Foto ${index + 1}`));
      }
      children.push(await createImageChild(config.userId, config.accessToken, await publicImage(ctaUrl), "Encerramento/CTA"));

      const parentResponse = await fetch(`${INSTAGRAM_GRAPH_BASE}/${config.userId}/media`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          media_type: "CAROUSEL",
          children: children.join(","),
          caption: captionFor(property, c.req.raw.headers),
          access_token: config.accessToken,
        }),
      });
      const parent = await parentResponse.json().catch(() => ({})) as { id?: string; error?: MetaError };
      if (!parentResponse.ok || !parent.id) {
        throw new Error(metaErrorMessage("Carrossel", parent.error, `Instagram recusou o carrossel (HTTP ${parentResponse.status}).`));
      }

      await waitForContainer(parent.id, config.accessToken, "Carrossel", 20);

      const publishResponse = await fetch(`${INSTAGRAM_GRAPH_BASE}/${config.userId}/media_publish`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ creation_id: parent.id, access_token: config.accessToken }),
      });
      const published = await publishResponse.json().catch(() => ({})) as { id?: string; error?: MetaError };
      if (!publishResponse.ok || !published.id) {
        throw new Error(metaErrorMessage("Publicação", published.error, `Instagram recusou a publicação do Book (HTTP ${publishResponse.status}).`));
      }

      const permalinkResponse = await fetch(
        `${INSTAGRAM_GRAPH_BASE}/${published.id}?fields=permalink&access_token=${encodeURIComponent(config.accessToken)}`,
      );
      const permalink = await permalinkResponse.json().catch(() => ({})) as { permalink?: string };
      const message = `Book Premium publicado no Instagram${video?.url ? " com vídeo curto" : " sem vídeo curto"}. ID: ${published.id}.${permalink.permalink ? ` URL: ${permalink.permalink}` : ""}`;
      await saveChannel(propertyId, "instagram_book", "publicado", message, 1);
      await logEvent(db, "instagram_publicacao", "sync", true, message);
      return c.json({ ok: true, id: published.id, url: permalink.permalink ?? null, message }, 200);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Falha ao publicar o Book Premium no Instagram.";
      await saveChannel(propertyId, "instagram_book", "erro", message, 0);
      await logEvent(db, "instagram_publicacao", "sync", false, message);
      return c.json({ error: message }, 400);
    }
  });
}

import type { Hono } from "hono";
import { and, desc, eq } from "drizzle-orm";
import * as schema from "../database/schema";
import { propertyVideos } from "../database/property-videos-schema";
import { getDb, resolveSession } from "../lib/auth";
import { logEvent, readConfig } from "../lib/integrations";
import { siteBaseUrl } from "../lib/base-url";

const GRAPH_VERSION = "v26.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

function money(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function propertyCaption(property: any, headers: Headers) {
  const site = siteBaseUrl(headers);
  return [
    property.title,
    property.code ? `Código: ${property.code}` : null,
    property.price > 0 ? `Valor: ${money(property.price)}` : null,
    property.district ? `${property.district} · ${property.city}` : property.city,
    property.bedrooms > 0 ? `${property.bedrooms} dormitório(s)` : null,
    property.suites > 0 ? `${property.suites} suíte(s)` : null,
    property.parking > 0 ? `${property.parking} vaga(s)` : null,
    `Mais informações: ${site}`,
  ].filter(Boolean).join("\n");
}

async function latestChannel(propertyId: number) {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(schema.propertyChannels)
    .where(and(eq(schema.propertyChannels.propertyId, propertyId), eq(schema.propertyChannels.channel, "facebook_video")))
    .orderBy(desc(schema.propertyChannels.id))
    .limit(1);
  return row ?? null;
}

async function saveChannel(propertyId: number, status: string, message: string, authorized = 1) {
  const db = await getDb();
  const previous = await latestChannel(propertyId);
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
      channel: "facebook_video",
      authorized,
      status,
      message,
      lastSyncAt: status === "publicado" ? new Date() : null,
    });
  }
}

async function graphGet(url: string) {
  const response = await fetch(url);
  const payload = await response.json().catch(() => ({})) as {
    id?: string;
    name?: string;
    access_token?: string;
    data?: Array<{ id?: string; name?: string; access_token?: string }>;
    error?: { message?: string; code?: number; error_subcode?: number };
  };
  return { response, payload };
}

async function resolveFacebookPageAccessToken(pageId: string, credential: string) {
  const direct = new URL(`${GRAPH_BASE}/${encodeURIComponent(pageId)}`);
  direct.searchParams.set("fields", "id,name,access_token");
  direct.searchParams.set("access_token", credential);
  const directResult = await graphGet(direct.toString());
  if (directResult.response.ok && directResult.payload.id === pageId && directResult.payload.access_token) {
    return directResult.payload.access_token;
  }

  const accounts = new URL(`${GRAPH_BASE}/me/accounts`);
  accounts.searchParams.set("fields", "id,name,access_token");
  accounts.searchParams.set("limit", "100");
  accounts.searchParams.set("access_token", credential);
  const accountsResult = await graphGet(accounts.toString());
  if (accountsResult.response.ok) {
    const page = accountsResult.payload.data?.find((item) => item.id === pageId);
    if (page?.access_token) return page.access_token;
  }

  const directError = directResult.payload.error?.message;
  const accountsError = accountsResult.payload.error?.message;
  throw new Error(
    `O CRM não conseguiu obter o Page Access Token da Página ${pageId}. ${directError || accountsError || "Confirme pages_show_list e pages_manage_posts no token do usuário do sistema."}`,
  );
}

export function registerFacebookVideoRoute(app: Hono) {
  app.post("/api/admin/property-videos/:propertyId/publish-meta", async (c, next) => {
    const body = await c.req.json().catch(() => ({})) as { targets?: unknown; force?: unknown };
    const targets = Array.isArray(body.targets) ? body.targets.map(String) : [];
    if (targets.length !== 1 || targets[0] !== "facebook") return next();

    const user = await resolveSession(c.req.raw.headers);
    if (!user) return c.json({ error: "Não autorizado" }, 401);

    const propertyId = Number(c.req.param("propertyId"));
    if (!Number.isSafeInteger(propertyId) || propertyId <= 0) return c.json({ error: "Imóvel inválido" }, 400);

    const db = await getDb();
    const [property] = await db.select().from(schema.properties).where(eq(schema.properties.id, propertyId)).limit(1);
    if (!property) return c.json({ error: "Imóvel não encontrado" }, 404);
    if (property.published !== 1 || property.status !== "disponivel") {
      return c.json({ error: "O imóvel precisa estar publicado no site e disponível antes de enviar às redes sociais." }, 400);
    }

    const [video] = await db
      .select()
      .from(propertyVideos)
      .where(and(eq(propertyVideos.propertyId, propertyId), eq(propertyVideos.kind, "short_social")))
      .limit(1);
    if (!video?.url) return c.json({ error: "Cadastre o vídeo curto antes de publicar." }, 400);

    const previous = await latestChannel(propertyId);
    if (previous?.status === "publicado" && body.force !== true) {
      return c.json({
        ok: false,
        results: {
          facebook: {
            ok: false,
            message: "Este vídeo curto já foi publicado no Facebook. Marque republicar para enviar novamente.",
          },
        },
      }, 409);
    }

    const { row, config } = await readConfig(db, "facebook_publicacao");
    if (!row || row.enabled !== 1 || !config.pageId || !config.pageToken) {
      return c.json({ error: "Facebook não está conectado para publicação." }, 400);
    }

    try {
      const pageAccessToken = await resolveFacebookPageAccessToken(config.pageId, config.pageToken);
      const response = await fetch(`${GRAPH_BASE}/${encodeURIComponent(config.pageId)}/videos`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          file_url: video.url,
          description: propertyCaption(property, c.req.raw.headers),
          access_token: pageAccessToken,
        }),
      });
      const payload = await response.json().catch(() => ({})) as {
        id?: string;
        error?: { message?: string; code?: number; error_subcode?: number };
      };
      if (!response.ok || !payload.id) {
        const suffix = payload.error?.code ? ` (Meta ${payload.error.code}${payload.error.error_subcode ? `/${payload.error.error_subcode}` : ""})` : "";
        throw new Error(`${payload.error?.message || `Facebook recusou o vídeo (HTTP ${response.status}).`}${suffix}`);
      }

      const url = `https://www.facebook.com/${config.pageId}/videos/${payload.id}`;
      const message = `Vídeo curto enviado ao Facebook. ID: ${payload.id}. URL: ${url}`;
      await saveChannel(propertyId, "publicado", message, 1);
      await logEvent(db, "facebook_publicacao", "sync", true, message);
      return c.json({
        ok: true,
        results: { facebook: { ok: true, message, url } },
      }, 200);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Falha ao publicar no Facebook.";
      await saveChannel(propertyId, "erro", message, 0);
      await logEvent(db, "facebook_publicacao", "sync", false, message);
      return c.json({
        ok: false,
        results: { facebook: { ok: false, message } },
      }, 400);
    }
  });
}

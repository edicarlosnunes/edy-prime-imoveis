import type { Hono } from "hono";
import { del } from "@vercel/blob";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import * as schema from "../database/schema";
import { propertyVideos } from "../database/property-videos-schema";
import { getDb, resolveSession } from "../lib/auth";

const VIDEO_KINDS = ["short_social", "youtube_long"] as const;
type VideoKind = (typeof VIDEO_KINDS)[number];
const MAX_VIDEO_BYTES = 1024 * 1024 * 1024; // 1 GB por arquivo
const ALLOWED_VIDEO_TYPES = [
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-m4v",
  "video/mpeg",
];

function isVideoKind(value: unknown): value is VideoKind {
  return typeof value === "string" && VIDEO_KINDS.includes(value as VideoKind);
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

function safeBlobUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.endsWith(".blob.vercel-storage.com");
  } catch {
    return false;
  }
}

export function registerPropertyVideoRoutes(app: Hono) {
  /** Lista os dois slots do imóvel. */
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

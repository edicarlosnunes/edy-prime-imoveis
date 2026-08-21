import type { RouterClient } from "@orpc/server";
import { eq } from "drizzle-orm";
import { createApp } from "./__core/app";
import { ping } from "./routes/ping";
import { leads } from "./routes/leads";
import { properties } from "./routes/properties";
import { siteConfig } from "./routes/site-config";
import { siteContent } from "./routes/site-content";
import { adminAuth } from "./routes/admin-auth";
import { adminProperties } from "./routes/admin-properties";
import { adminLeads } from "./routes/admin-leads";
import { adminClients } from "./routes/admin-clients";
import { adminOwners } from "./routes/admin-owners";
import { adminTasks } from "./routes/admin-tasks";
import { adminDeals } from "./routes/admin-deals";
import { adminDashboard } from "./routes/admin-dashboard";
import { adminSettings } from "./routes/admin-settings";
import { adminSite } from "./routes/admin-site";
import { adminMedia } from "./routes/admin-media";
import { adminIntegrations } from "./routes/admin-integrations";
import { adminChannels } from "./routes/admin-channels";
import { adminInbox } from "./routes/admin-inbox";
import { adminAgents } from "./routes/admin-agents";
import { adminAutomations } from "./routes/admin-automations";
import { adminWatermark } from "./routes/admin-watermark";
import { adminAudit } from "./routes/admin-audit";
import { registerFeedRoutes } from "./http/feed-routes";
import { registerWebhookRoutes } from "./http/webhook-routes";
import * as schema from "./database/schema";
import {
  clearedSessionCookie,
  createSession,
  destroySession,
  getDb,
  randomHex,
  resolveSession,
  sessionCookie,
  verifyPassword,
} from "./lib/auth";

// API features are oRPC procedures, one file per feature in ./routes/,
// composed into this router — typed end-to-end via the clients
// (web: src/web/lib/api.ts, mobile: lib/api.ts).
// Keep each routes/ file under 500 lines (`bun run lint` enforces this);
// split into more feature files as they grow.
// Patterns and examples: skills/app/references/api.md
export const router = {
  ping,
  leads,
  properties,
  siteConfig,
  siteContent,
  adminAuth,
  adminProperties,
  adminLeads,
  adminClients,
  adminOwners,
  adminTasks,
  adminDeals,
  adminDashboard,
  adminSettings,
  adminSite,
  adminMedia,
  adminIntegrations,
  adminChannels,
  adminInbox,
  adminAgents,
  adminAutomations,
  adminWatermark,
  adminAudit,
};

export type AppRouter = typeof router;
/** Typed client for the router — used by the web and mobile api clients. */
export type AppRouterClient = RouterClient<AppRouter>;

const app = createApp(router);

/* Arquivos públicos (feed/sitemap/robots/prerender) e webhooks de entrada. */
registerFeedRoutes(app);
registerWebhookRoutes(app);

/* ------------------------------------------------------------------ *
 * Rotas HTTP simples: só o que precisa mexer em cookie/binário.      *
 * ------------------------------------------------------------------ */

/** Limitador simples de tentativas por IP (best-effort em serverless). */
const attempts = new Map<string, { count: number; until: number }>();
const MAX_ATTEMPTS = 8;
const WINDOW_MS = 10 * 60 * 1000;

function tooManyAttempts(ip: string) {
  const entry = attempts.get(ip);
  if (!entry) return false;
  if (Date.now() > entry.until) {
    attempts.delete(ip);
    return false;
  }
  return entry.count >= MAX_ATTEMPTS;
}

function registerAttempt(ip: string) {
  const entry = attempts.get(ip);
  if (!entry || Date.now() > entry.until) {
    attempts.set(ip, { count: 1, until: Date.now() + WINDOW_MS });
    return;
  }
  entry.count += 1;
}

app.post("/api/admin/login", async (c) => {
  const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (tooManyAttempts(ip)) {
    return c.json({ error: "Muitas tentativas. Tente novamente mais tarde." }, 429);
  }

  let email = "";
  let password = "";
  try {
    const body = (await c.req.json()) as { email?: unknown; password?: unknown };
    email = String(body.email ?? "").trim().toLowerCase();
    password = String(body.password ?? "");
  } catch {
    return c.json({ error: "Requisição inválida" }, 400);
  }
  if (!email || !password) return c.json({ error: "Informe e-mail e senha" }, 400);

  const db = await getDb();
  const [user] = await db
    .select()
    .from(schema.adminUsers)
    .where(eq(schema.adminUsers.email, email))
    .limit(1);

  const ok = user ? await verifyPassword(password, user.passwordHash, user.passwordSalt) : false;
  if (!user || !ok) {
    registerAttempt(ip);
    return c.json({ error: "E-mail ou senha inválidos" }, 401);
  }

  const { token } = await createSession(db, user.id);
  await db
    .update(schema.adminUsers)
    .set({ lastLoginAt: new Date() })
    .where(eq(schema.adminUsers.id, user.id));
  attempts.delete(ip);

  c.header("set-cookie", sessionCookie(token));
  return c.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } }, 200);
});

app.post("/api/admin/logout", async (c) => {
  await destroySession(c.req.raw.headers);
  c.header("set-cookie", clearedSessionCookie());
  return c.json({ ok: true }, 200);
});

const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp", "image/avif"];

/** Upload de foto: guarda no banco e devolve a URL pública /api/media/:id */
app.post("/api/admin/upload", async (c) => {
  const user = await resolveSession(c.req.raw.headers);
  if (!user) return c.json({ error: "Não autorizado" }, 401);

  const form = await c.req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return c.json({ error: "Arquivo ausente" }, 400);
  if (!ALLOWED_MIME.includes(file.type)) {
    return c.json({ error: "Formato não suportado (use JPG, PNG, WEBP ou AVIF)" }, 400);
  }
  const buffer = new Uint8Array(await file.arrayBuffer());
  if (buffer.byteLength > MAX_UPLOAD_BYTES) {
    return c.json({ error: "Imagem acima de 3 MB" }, 400);
  }

  let binary = "";
  for (let i = 0; i < buffer.length; i += 8192) {
    binary += String.fromCharCode(...buffer.subarray(i, i + 8192));
  }

  const id = randomHex(12);
  const db = await getDb();
  const safeName = (file.name || "imagem").replace(/[^\w.\-() ]+/g, "").slice(0, 120);
  // variant/originalId permitem guardar a versão com marca d'água SEM apagar a original
  const rawVariant = String(form.get("variant") ?? "original");
  const variant = rawVariant === "watermarked" ? "watermarked" : "original";
  const originalId = String(form.get("originalId") ?? "").trim() || null;
  await db.insert(schema.media).values({
    id,
    mime: file.type,
    size: buffer.byteLength,
    data: btoa(binary),
    name: safeName,
    variant,
    originalId: variant === "watermarked" ? originalId : null,
  });

  return c.json({ url: `/api/media/${id}`, id }, 200);
});

/** Entrega das fotos enviadas pelo painel. */
app.get("/api/media/:id", async (c) => {
  const id = c.req.param("id");
  if (!/^[a-f0-9]{8,64}$/.test(id)) return c.json({ error: "not found" }, 404);
  const db = await getDb();
  const [row] = await db.select().from(schema.media).where(eq(schema.media.id, id)).limit(1);
  if (!row) return c.json({ error: "not found" }, 404);

  const binary = atob(row.data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  return new Response(bytes, {
    status: 200,
    headers: {
      "content-type": row.mime,
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
});

export default app;

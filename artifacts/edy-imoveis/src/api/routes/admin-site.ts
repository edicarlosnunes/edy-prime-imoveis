import { z } from "zod";
import { and, desc, eq, ne } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { adminBase, type AdminDb } from "../lib/admin-base";
import * as schema from "../database/schema";

/* ------------------------------------------------------------------ *
 * Validação: o formato do conteúdo é definido no front                *
 * (src/web/lib/site-content.ts). Aqui garantimos apenas que é um      *
 * objeto JSON seguro e limitado — nada de HTML executável, tamanho    *
 * controlado e profundidade limitada.                                 *
 * ------------------------------------------------------------------ */

const MAX_JSON_BYTES = 400 * 1024;
const MAX_STRING = 20000;
const MAX_ARRAY = 200;
const MAX_DEPTH = 8;
const MAX_KEYS = 200;

function sanitize(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return null;
  if (value === null) return null;
  if (typeof value === "string") return value.slice(0, MAX_STRING);
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY).map((item) => sanitize(item, depth + 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    let count = 0;
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (count >= MAX_KEYS) break;
      if (!/^[A-Za-z0-9_-]{1,60}$/.test(key)) continue;
      out[key] = sanitize(item, depth + 1);
      count += 1;
    }
    return out;
  }
  return null;
}

function serialize(data: unknown) {
  const clean = sanitize(data);
  const json = JSON.stringify(clean);
  if (json.length > MAX_JSON_BYTES) {
    throw new ORPCError("BAD_REQUEST", { message: "Conteúdo muito grande para salvar" });
  }
  return json;
}

const contentInput = z.object({
  data: z.record(z.string(), z.unknown()),
});

type Db = AdminDb;

function rowOut(row: schema.SiteContentRow) {
  return {
    id: row.id,
    status: row.status,
    label: row.label,
    author: row.author,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    publishedAt: row.publishedAt,
    data: JSON.parse(row.data) as unknown,
  };
}

async function findDraft(db: Db) {
  const [row] = await db
    .select()
    .from(schema.siteContent)
    .where(eq(schema.siteContent.status, "draft"))
    .orderBy(desc(schema.siteContent.updatedAt))
    .limit(1);
  return row ?? null;
}

async function findPublished(db: Db) {
  const [row] = await db
    .select()
    .from(schema.siteContent)
    .where(eq(schema.siteContent.status, "published"))
    .orderBy(desc(schema.siteContent.publishedAt))
    .limit(1);
  return row ?? null;
}

export const adminSite = {
  /** Rascunho em edição + versão publicada, para o editor abrir no estado certo. */
  state: adminBase.handler(async ({ context }) => {
    const db: Db = context.db;
    const draft = await findDraft(db);
    const published = await findPublished(db);
    return {
      draft: draft ? rowOut(draft) : null,
      published: published ? rowOut(published) : null,
      hasChanges: Boolean(draft && (!published || draft.data !== published.data)),
    };
  }),

  /** Salva o rascunho (não publica nada). */
  saveDraft: adminBase.input(contentInput).handler(async ({ input, context }) => {
    const db: Db = context.db;
    const json = serialize(input.data);
    const existing = await findDraft(db);
    const now = new Date();
    if (existing) {
      await db
        .update(schema.siteContent)
        .set({ data: json, updatedAt: now, author: context.user.name })
        .where(eq(schema.siteContent.id, existing.id));
      return { ok: true, id: existing.id, updatedAt: now };
    }
    await db.insert(schema.siteContent).values({
      status: "draft",
      data: json,
      author: context.user.name,
      label: "Rascunho",
      createdAt: now,
      updatedAt: now,
    });
    const created = await findDraft(db);
    return { ok: true, id: created?.id ?? 0, updatedAt: now };
  }),

  /**
   * Publica: arquiva a versão no ar (vira histórico) e coloca o rascunho no lugar.
   * O rascunho continua existindo para novas edições.
   */
  publish: adminBase
    .input(z.object({ data: z.record(z.string(), z.unknown()).optional(), label: z.string().max(120).optional() }))
    .handler(async ({ input, context }) => {
      const db: Db = context.db;
      const now = new Date();

      let json: string;
      if (input.data) {
        json = serialize(input.data);
        const draft = await findDraft(db);
        if (draft) {
          await db
            .update(schema.siteContent)
            .set({ data: json, updatedAt: now, author: context.user.name })
            .where(eq(schema.siteContent.id, draft.id));
        } else {
          await db.insert(schema.siteContent).values({
            status: "draft",
            data: json,
            author: context.user.name,
            label: "Rascunho",
            createdAt: now,
            updatedAt: now,
          });
        }
      } else {
        const draft = await findDraft(db);
        if (!draft) throw new ORPCError("BAD_REQUEST", { message: "Nada para publicar" });
        json = draft.data;
      }

      const current = await findPublished(db);
      if (current) {
        await db
          .update(schema.siteContent)
          .set({ status: "archived" })
          .where(eq(schema.siteContent.id, current.id));
      }

      await db.insert(schema.siteContent).values({
        status: "published",
        data: json,
        author: context.user.name,
        label: input.label?.trim() || `Publicado em ${now.toLocaleString("pt-BR")}`,
        createdAt: now,
        updatedAt: now,
        publishedAt: now,
      });

      // mantém as configurações do CRM alinhadas com os dados publicados
      try {
        const company = (JSON.parse(json) as { company?: Record<string, string> }).company;
        if (company) {
          const [row] = await db.select().from(schema.settings).limit(1);
          const payload = {
            companyName: `${company.name ?? ""} ${company.brandSuffix ?? ""}`.trim(),
            brokerName: company.broker ?? "",
            whatsapp: (company.whatsapp ?? "").replace(/\D/g, ""),
            email: company.email ?? "",
            creci: company.creci ?? "",
            address: company.address ?? "",
            instagram: company.instagram ?? "",
            facebook: company.facebook ?? "",
            updatedAt: now,
          };
          if (row) {
            await db
              .update(schema.settings)
              .set(payload)
              .where(eq(schema.settings.id, row.id));
          }
        }
      } catch {
        /* publicação não depende da sincronia com as configurações */
      }

      // guarda no máximo 20 versões no histórico
      const archived = await db
        .select({ id: schema.siteContent.id })
        .from(schema.siteContent)
        .where(eq(schema.siteContent.status, "archived"))
        .orderBy(desc(schema.siteContent.createdAt));
      for (const old of archived.slice(20)) {
        await db.delete(schema.siteContent).where(eq(schema.siteContent.id, old.id));
      }

      return { ok: true, publishedAt: now };
    }),

  /** Histórico de versões (publicada + arquivadas). */
  history: adminBase.handler(async ({ context }) => {
    const db: Db = context.db;
    const rows = await db
      .select({
        id: schema.siteContent.id,
        status: schema.siteContent.status,
        label: schema.siteContent.label,
        author: schema.siteContent.author,
        createdAt: schema.siteContent.createdAt,
        publishedAt: schema.siteContent.publishedAt,
      })
      .from(schema.siteContent)
      .where(ne(schema.siteContent.status, "draft"))
      .orderBy(desc(schema.siteContent.createdAt))
      .limit(30);
    return rows;
  }),

  /** Restaura uma versão do histórico para o rascunho (sem publicar). */
  restore: adminBase
    .input(z.object({ id: z.number().int().positive() }))
    .handler(async ({ input, context }) => {
      const db: Db = context.db;
      const [version] = await db
        .select()
        .from(schema.siteContent)
        .where(
          and(eq(schema.siteContent.id, input.id), ne(schema.siteContent.status, "draft")),
        )
        .limit(1);
      if (!version) throw new ORPCError("NOT_FOUND", { message: "Versão não encontrada" });

      const now = new Date();
      const draft = await findDraft(db);
      if (draft) {
        await db
          .update(schema.siteContent)
          .set({ data: version.data, updatedAt: now, author: context.user.name })
          .where(eq(schema.siteContent.id, draft.id));
      } else {
        await db.insert(schema.siteContent).values({
          status: "draft",
          data: version.data,
          author: context.user.name,
          label: "Rascunho",
          createdAt: now,
          updatedAt: now,
        });
      }
      return { ok: true, data: JSON.parse(version.data) as unknown };
    }),

  /** Descarta o rascunho e volta para o conteúdo que está no ar. */
  discardDraft: adminBase.handler(async ({ context }) => {
    const db: Db = context.db;
    const published = await findPublished(db);
    const draft = await findDraft(db);
    if (!draft) return { ok: true, data: published ? (JSON.parse(published.data) as unknown) : null };
    if (!published) {
      await db.delete(schema.siteContent).where(eq(schema.siteContent.id, draft.id));
      return { ok: true, data: null };
    }
    await db
      .update(schema.siteContent)
      .set({ data: published.data, updatedAt: new Date() })
      .where(eq(schema.siteContent.id, draft.id));
    return { ok: true, data: JSON.parse(published.data) as unknown };
  }),
};

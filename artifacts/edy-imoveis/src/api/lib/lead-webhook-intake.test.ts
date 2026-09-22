/**
 * Correção de segurança do webhook de leads (10/09/2026) — parte 2.
 *
 * O teste puro (lead-webhook-token.test.ts) cobre a autenticação. Aqui o que
 * está em jogo é o que o usuário exigiu preservar: normalização de payload de
 * portal e deduplicação de leads continuam funcionando exatamente como antes.
 *
 * Roda contra um SQLite local em memória — nunca contra o banco de produção.
 */
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "bun:test";
import * as schema from "../database/schema";
import type { AdminDb } from "./admin-base";
import { intakeLead, normalizeWebhookLead } from "./lead-intake";
import { resolveWebhookPortal } from "./lead-webhook-token";

let db: AdminDb;

/* DDL copiada da produção (sqlite_master), não inventada. */
const DDL = [
  `CREATE TABLE leads (
    id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    name text NOT NULL, phone text NOT NULL, interest text NOT NULL,
    message text, source text DEFAULT 'site' NOT NULL, created_at integer NOT NULL,
    email TEXT, stage TEXT NOT NULL DEFAULT 'novo', status TEXT NOT NULL DEFAULT 'aberto',
    lost_reason TEXT, client_id INTEGER, property_id INTEGER, next_action TEXT,
    next_action_at INTEGER, updated_at INTEGER, portal TEXT, channel TEXT, campaign TEXT,
    utm_source TEXT, utm_medium TEXT, utm_campaign TEXT, external_id TEXT,
    score integer NOT NULL DEFAULT 0, score_tier text NOT NULL DEFAULT 'frio',
    score_reasons text, score_at integer, qualified_at integer)`,
  `CREATE TABLE lead_notes (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    lead_id INTEGER NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE TABLE lead_events (id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    lead_id integer NOT NULL, kind text NOT NULL, title text NOT NULL, detail text,
    actor_type text NOT NULL DEFAULT 'sistema', actor_name text,
    score_before integer, score_after integer, created_at integer NOT NULL)`,
  `CREATE TABLE lead_profile (id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    lead_id integer NOT NULL UNIQUE, purpose text, property_type text, city text, districts text,
    budget_min real, budget_max real, bedrooms integer, suites integer,
    parking integer, area_min real, financing text, fgts text,
    trade_in text, trade_in_detail text, timeframe text, preferences text,
    restrictions text, contact_preference text, contact_window text, summary text,
    wants_visit integer NOT NULL DEFAULT 0, wants_human integer NOT NULL DEFAULT 0,
    cash_payment integer NOT NULL DEFAULT 0, just_looking integer NOT NULL DEFAULT 0,
    messages_count integer NOT NULL DEFAULT 0, contact_days integer NOT NULL DEFAULT 0,
    last_customer_at integer, source text NOT NULL DEFAULT 'deterministico',
    fields_source text, completeness integer NOT NULL DEFAULT 0,
    created_at integer NOT NULL, updated_at integer)`,
  `CREATE TABLE integrations (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    key TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'nao_configurado',
    enabled INTEGER NOT NULL DEFAULT 0, config TEXT, last_sync_at INTEGER,
    last_test_at INTEGER, last_error TEXT, updated_at INTEGER NOT NULL)`,
  `CREATE TABLE automations (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    name TEXT NOT NULL, trigger TEXT NOT NULL, conditions TEXT NOT NULL DEFAULT '{}',
    actions TEXT NOT NULL DEFAULT '[]', active INTEGER NOT NULL DEFAULT 0,
    run_count INTEGER NOT NULL DEFAULT 0, error_count INTEGER NOT NULL DEFAULT 0,
    last_run_at INTEGER, last_error TEXT, created_at INTEGER NOT NULL)`,
  `CREATE TABLE automation_runs (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    automation_id INTEGER NOT NULL, ok INTEGER NOT NULL DEFAULT 1,
    message TEXT, created_at INTEGER NOT NULL)`,
  `CREATE TABLE tasks (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    title TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'visita', due_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pendente', lead_id INTEGER, client_id INTEGER,
    property_id INTEGER, notes TEXT, created_at INTEGER NOT NULL, capture_id INTEGER)`,
  `CREATE TABLE properties (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    code TEXT NOT NULL UNIQUE, title TEXT NOT NULL, purpose TEXT NOT NULL DEFAULT 'venda',
    type TEXT NOT NULL DEFAULT 'apartamento', price REAL NOT NULL DEFAULT 0,
    condo_fee REAL, iptu REAL, district TEXT NOT NULL DEFAULT '',
    city TEXT NOT NULL DEFAULT 'Praia Grande', address TEXT,
    bedrooms INTEGER NOT NULL DEFAULT 0, suites INTEGER NOT NULL DEFAULT 0,
    bathrooms INTEGER NOT NULL DEFAULT 0, parking INTEGER NOT NULL DEFAULT 0,
    area_util REAL NOT NULL DEFAULT 0, area_total REAL, description TEXT,
    highlight TEXT, features TEXT, status TEXT NOT NULL DEFAULT 'disponivel',
    published INTEGER NOT NULL DEFAULT 1, featured INTEGER NOT NULL DEFAULT 0,
    owner_id INTEGER, views INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    slug TEXT, watermark_off INTEGER NOT NULL DEFAULT 0, in_condominium INTEGER,
    has_heranca INTEGER, has_posse INTEGER, has_financiamento INTEGER, has_aluguel INTEGER,
    portfolio_entry_at INTEGER, last_revalidation_at INTEGER, next_revalidation_at INTEGER,
    revalidation_status TEXT, serial TEXT)`,
];

async function freshDb(): Promise<AdminDb> {
  const client = createClient({ url: ":memory:" });
  const instance = drizzle(client, { schema });
  for (const statement of DDL) await instance.run(sql.raw(statement));
  return instance as unknown as AdminDb;
}

async function countLeads() {
  const rows = await db.all<{ n: number }>(sql`SELECT COUNT(*) as n FROM leads`);
  return rows[0]?.n ?? 0;
}

async function countNotes(leadId: number) {
  const rows = await db.all<{ n: number }>(
    sql`SELECT COUNT(*) as n FROM lead_notes WHERE lead_id = ${leadId}`,
  );
  return rows[0]?.n ?? 0;
}

/** Reproduz o caminho da rota POST /api/webhooks/leads/:token, sem HTTP. */
async function postWebhook(config: Record<string, string>, token: string, payload: Record<string, unknown>) {
  const portal = resolveWebhookPortal(config, token);
  if (!portal) return { status: 401 as const, body: { error: "unauthorized" } };

  const normalized = normalizeWebhookLead(payload, portal);
  if (!normalized.phone && !normalized.email) {
    return { status: 400 as const, body: { error: "informe telefone ou e-mail" } };
  }

  const result = await intakeLead(db, { ...normalized, propertyId: null });
  return {
    status: 200 as const,
    body: { ok: true, leadId: result.id, duplicated: result.duplicated },
    normalized,
  };
}

const TOKEN_ZAP = "a".repeat(20) + "1234567890abcdef1234567890ab";
const TOKEN_OLX = "b".repeat(20) + "1234567890abcdef1234567890ab";
const CONFIG = { tokenZap: TOKEN_ZAP, tokenOlx: TOKEN_OLX };

beforeEach(async () => {
  db = await freshDb();
});

describe("token revogado não chega a criar lead", () => {
  test('"zap" é rejeitado com 401 e nenhum lead entra no CRM', async () => {
    const res = await postWebhook(CONFIG, "zap", { nome: "Fraude", telefone: "13999990000" });
    expect(res.status).toBe(401);
    expect(await countLeads()).toBe(0);
  });

  test('"olx" e "imovelweb" também não criam lead', async () => {
    for (const token of ["olx", "imovelweb"]) {
      const res = await postWebhook(CONFIG, token, { nome: "Fraude", telefone: "13999990000" });
      expect(res.status).toBe(401);
    }
    expect(await countLeads()).toBe(0);
  });
});

describe("payload inválido não cria lead", () => {
  test("sem telefone e sem e-mail devolve 400 e não grava nada", async () => {
    const res = await postWebhook(CONFIG, TOKEN_ZAP, { nome: "Só o nome" });
    expect(res.status).toBe(400);
    expect(await countLeads()).toBe(0);
  });

  test("payload vazio devolve 400", async () => {
    const res = await postWebhook(CONFIG, TOKEN_ZAP, {});
    expect(res.status).toBe(400);
    expect(await countLeads()).toBe(0);
  });

  test("só e-mail já é suficiente (comportamento preservado)", async () => {
    const res = await postWebhook(CONFIG, TOKEN_ZAP, { nome: "Ana", email: "ana@example.com" });
    expect(res.status).toBe(200);
    expect(await countLeads()).toBe(1);
  });
});

describe("normalização de payload de portal preservada", () => {
  test("campos em português são reconhecidos", async () => {
    const res = await postWebhook(CONFIG, TOKEN_ZAP, {
      nome: "Maria Souza",
      telefone: "(13) 99999-1234",
      mensagem: "Tenho interesse no apartamento",
    });
    expect(res.status).toBe(200);

    const [lead] = await db.all<{ name: string; phone: string; message: string; source: string; channel: string }>(
      sql`SELECT name, phone, message, source, channel FROM leads`,
    );
    expect(lead?.name).toBe("Maria Souza");
    expect(lead?.phone).toBe("13999991234"); // só dígitos, como antes
    expect(lead?.message).toBe("Tenho interesse no apartamento");
    expect(lead?.channel).toBe("webhook");
  });

  test("a origem vem do token usado, não de um literal adivinhável", async () => {
    await postWebhook(CONFIG, TOKEN_ZAP, { nome: "A", telefone: "13911110000" });
    await postWebhook(CONFIG, TOKEN_OLX, { nome: "B", telefone: "13922220000" });

    const rows = await db.all<{ source: string }>(sql`SELECT source FROM leads ORDER BY id`);
    expect(rows.map((r) => r.source)).toEqual(["zap", "olx"]);
  });

  test("sem nome vira 'Contato sem nome' em vez de falhar", async () => {
    const res = await postWebhook(CONFIG, TOKEN_ZAP, { telefone: "13933330000" });
    expect(res.status).toBe(200);
    const [lead] = await db.all<{ name: string }>(sql`SELECT name FROM leads`);
    expect(lead?.name).toBe("Contato sem nome");
  });
});

describe("deduplicação preservada", () => {
  test("mesmo telefone duas vezes vira 1 lead + 1 nota", async () => {
    const first = await postWebhook(CONFIG, TOKEN_ZAP, { nome: "Carlos", telefone: "13988887777" });
    const second = await postWebhook(CONFIG, TOKEN_ZAP, {
      nome: "Carlos",
      telefone: "13988887777",
      mensagem: "Segundo contato",
    });

    expect(first.body).toMatchObject({ duplicated: false });
    expect(second.body).toMatchObject({ duplicated: true, leadId: (first.body as { leadId: number }).leadId });
    expect(await countLeads()).toBe(1);
    expect(await countNotes((first.body as { leadId: number }).leadId)).toBe(1);
  });

  test("o mesmo telefone em formatos diferentes ainda deduplica", async () => {
    await postWebhook(CONFIG, TOKEN_ZAP, { nome: "Carlos", telefone: "13988887777" });
    const again = await postWebhook(CONFIG, TOKEN_ZAP, { nome: "Carlos", telefone: "(13) 98888-7777" });
    expect(again.body).toMatchObject({ duplicated: true });
    expect(await countLeads()).toBe(1);
  });

  test("mesmo id externo deduplica mesmo com telefone diferente", async () => {
    await postWebhook(CONFIG, TOKEN_ZAP, { id: "ZAP-1", nome: "Ana", telefone: "13911112222" });
    const again = await postWebhook(CONFIG, TOKEN_ZAP, { id: "ZAP-1", nome: "Ana", telefone: "13955556666" });
    expect(again.body).toMatchObject({ duplicated: true });
    expect(await countLeads()).toBe(1);
  });

  test("telefones diferentes criam leads diferentes", async () => {
    await postWebhook(CONFIG, TOKEN_ZAP, { nome: "Ana", telefone: "13911112222" });
    await postWebhook(CONFIG, TOKEN_ZAP, { nome: "Bia", telefone: "13933334444" });
    expect(await countLeads()).toBe(2);
  });

  test("a janela de deduplicação configurada é respeitada", async () => {
    await db.run(
      sql`INSERT INTO integrations (key, status, enabled, config, updated_at)
          VALUES ('site_leads', 'conectado', 1, '{"dedupeHours":"1"}', ${Date.now()})`,
    );
    await postWebhook(CONFIG, TOKEN_ZAP, { nome: "Ana", telefone: "13911112222" });
    /* Empurra o lead para fora da janela de 1h.
       `created_at` é integer mode:"timestamp" no Drizzle => SEGUNDOS, não ms. */
    await db.run(
      sql`UPDATE leads SET created_at = ${Math.floor((Date.now() - 3 * 60 * 60 * 1000) / 1000)}`,
    );

    const again = await postWebhook(CONFIG, TOKEN_ZAP, { nome: "Ana", telefone: "13911112222" });
    expect(again.body).toMatchObject({ duplicated: false });
    expect(await countLeads()).toBe(2);
  });
});

describe("histórico do CRM continua sendo gravado", () => {
  test("lead novo gera evento de criação", async () => {
    const res = await postWebhook(CONFIG, TOKEN_ZAP, { nome: "Ana", telefone: "13911112222" });
    const rows = await db.all<{ kind: string; title: string }>(
      sql`SELECT kind, title FROM lead_events WHERE lead_id = ${(res.body as { leadId: number }).leadId}`,
    );
    expect(rows.some((r) => r.kind === "criado")).toBe(true);
  });

  test("nenhum evento de lead carrega o token", async () => {
    await postWebhook(CONFIG, TOKEN_ZAP, { nome: "Ana", telefone: "13911112222" });
    const rows = await db.all<{ title: string; detail: string | null }>(
      sql`SELECT title, detail FROM lead_events`,
    );
    const blob = JSON.stringify(rows);
    expect(blob).not.toContain(TOKEN_ZAP);
  });
});

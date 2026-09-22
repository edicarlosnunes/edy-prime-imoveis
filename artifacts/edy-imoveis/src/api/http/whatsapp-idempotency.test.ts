/**
 * Idempotência do webhook do WhatsApp Cloud (10/09/2026).
 *
 * O risco que estes testes travam: a Meta reenvia o mesmo webhook quando não
 * recebe 200 rápido. Antes desta correção, o reenvio gravava a mensagem duas
 * vezes no inbox e acionava o agente de IA de novo — o cliente recebia duas
 * respostas.
 *
 * Aqui a rota real (`registerWebhookRoutes`) roda contra um SQLite EM MEMÓRIA,
 * com `getDb` e `agentReply` trocados por mocks e `fetch` interceptado. Nenhuma
 * chamada sai para a Meta, nenhuma credencial real é usada, o banco de
 * produção nunca é tocado.
 */
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import * as schema from "../database/schema";
import type { AdminDb } from "../lib/admin-base";

let db: AdminDb;
let aiCalls = 0;
let graphCalls: { url: string; body: string }[] = [];

/* ------------------------------------------------------------- mocks */

mock.module("../lib/auth", () => ({
  getDb: async () => db,
  resolveSession: async () => null,
  sha256Hex: async (value: string) => value,
  randomHex: (n: number) => "0".repeat(n),
}));

/* Injeção de falha: onde o processamento deve explodir nesta requisição.
   Serve para provar que uma falha depois da reserva NÃO perde a mensagem. */
type FailPoint = null | "claim" | "conversation" | "store" | "lead" | "ai";
let failAt: FailPoint = null;

mock.module("../agent/broker", () => ({
  agentReply: async () => {
    aiCalls++;
    if (failAt === "ai") throw new Error("crash: gateway da IA fora do ar");
    return {
      text: "Olá! Sou o atendimento da Edy Prime.",
      handoff: false,
      handoffReason: null,
      usedProperties: [],
    };
  },
}));

/* Os wrappers abaixo delegam para a implementação REAL e só acrescentam o
   ponto de falha — o fluxo testado continua sendo o de produção. */
/* O namespace do módulo tem live binding: depois de `mock.module` ele passa a
   apontar para o próprio mock. Por isso as implementações reais são copiadas
   ANTES, senão o wrapper chamaria a si mesmo (stack overflow). */
const inboxReal = { ...(await import("../lib/inbox")) };
mock.module("../lib/inbox", () => ({
  ...inboxReal,
  ensureConversation: async (...args: Parameters<typeof inboxReal.ensureConversation>) => {
    if (failAt === "claim") throw new Error("crash: morreu logo após reservar o wamid");
    const conversation = await inboxReal.ensureConversation(...args);
    if (failAt === "conversation") throw new Error("crash: morreu após criar a conversa");
    return conversation;
  },
  addMessage: async (...args: Parameters<typeof inboxReal.addMessage>) => {
    const stored = await inboxReal.addMessage(...args);
    if (failAt === "store") throw new Error("crash: morreu após persistir a mensagem");
    return stored;
  },
}));

const intakeReal = { ...(await import("../lib/lead-intake")) };
mock.module("../lib/lead-intake", () => ({
  ...intakeReal,
  intakeLead: async (...args: Parameters<typeof intakeReal.intakeLead>) => {
    if (failAt === "lead") throw new Error("crash: morreu antes de ligar o lead");
    return intakeReal.intakeLead(...args);
  },
}));

/* O gateway precisa parecer configurado para a IA chegar a ser chamada. */
process.env.AI_GATEWAY_BASE_URL ||= "https://gateway.test";
process.env.AI_GATEWAY_API_KEY ||= "test-key";

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.includes("graph.facebook.com")) {
    graphCalls.push({ url, body: String(init?.body ?? "") });
    return new Response(JSON.stringify({ messages: [{ id: "wamid.out" }] }), { status: 200 });
  }
  return realFetch(input as RequestInfo, init);
}) as typeof fetch;

const { registerWebhookRoutes } = await import("./webhook-routes");

/* --------------------------------------------------------------- DDL */
/* Copiada da produção (sqlite_master) + os dois objetos NOVOS desta correção. */
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
  `CREATE TABLE integration_events (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    integration_key TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'sync',
    ok INTEGER NOT NULL DEFAULT 1, message TEXT, created_at INTEGER NOT NULL)`,
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
  `CREATE TABLE conversations (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    channel TEXT NOT NULL DEFAULT 'site', external_id TEXT, lead_id INTEGER,
    client_id INTEGER, property_id INTEGER, agent_id INTEGER, contact_name TEXT,
    contact_phone TEXT, mode TEXT NOT NULL DEFAULT 'ia', assigned_to INTEGER,
    assigned_name TEXT, transfer_reason TEXT, transferred_at INTEGER,
    status TEXT NOT NULL DEFAULT 'aberta', unread INTEGER NOT NULL DEFAULT 0,
    last_message TEXT, last_message_at INTEGER, created_at INTEGER NOT NULL)`,
  `CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    conversation_id INTEGER NOT NULL, direction TEXT NOT NULL DEFAULT 'in',
    author TEXT NOT NULL DEFAULT 'cliente', author_name TEXT, body TEXT NOT NULL,
    external_id TEXT, created_at INTEGER NOT NULL)`,
  `CREATE TABLE ai_agents (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 0,
    provider TEXT NOT NULL DEFAULT 'gateway', model TEXT NOT NULL DEFAULT 'openai/gpt-5.4-mini',
    greeting TEXT NOT NULL DEFAULT '', instructions TEXT NOT NULL DEFAULT '',
    tone TEXT NOT NULL DEFAULT '', hours_start TEXT NOT NULL DEFAULT '08:00',
    hours_end TEXT NOT NULL DEFAULT '20:00', channels TEXT NOT NULL DEFAULT '["site"]',
    qualification TEXT NOT NULL DEFAULT '', transfer_rules TEXT NOT NULL DEFAULT '',
    transfer_message TEXT NOT NULL DEFAULT '', idle_minutes INTEGER NOT NULL DEFAULT 30,
    human_conditions TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL)`,
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
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, slug TEXT,
    watermark_off INTEGER NOT NULL DEFAULT 0, in_condominium INTEGER,
    has_heranca INTEGER, has_posse INTEGER, has_financiamento INTEGER, has_aluguel INTEGER,
    portfolio_entry_at INTEGER, last_revalidation_at INTEGER, next_revalidation_at INTEGER,
    revalidation_status TEXT, serial TEXT)`,

  /* ------ NOVOS nesta correção (mesma DDL proposta para produção) ------ */
  `CREATE TABLE inbound_events (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    channel TEXT NOT NULL, external_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'processing', stage TEXT NOT NULL DEFAULT 'claimed',
    attempts INTEGER NOT NULL DEFAULT 1, last_error TEXT,
    claimed_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE UNIQUE INDEX inbound_events_channel_external_uk ON inbound_events (channel, external_id)`,
  `CREATE INDEX inbound_events_status_idx ON inbound_events (status, claimed_at)`,
  `CREATE INDEX inbound_events_created_idx ON inbound_events (created_at)`,
  `CREATE UNIQUE INDEX messages_conversation_external_uk ON messages (conversation_id, external_id)`,
];

/* ------------------------------------------------------------ fixture */

const APP_SECRET = "segredo-de-teste-nao-e-credencial-real";
const SELF_PHONE = "5513997726767";
const CLIENT_PHONE = "5513911112222";

let app: Hono;
let ipSeq = 0;

async function freshDb(): Promise<AdminDb> {
  const client = createClient({ url: ":memory:" });
  const instance = drizzle(client, { schema });
  for (const statement of DDL) await instance.run(sql.raw(statement));
  return instance as unknown as AdminDb;
}

async function seed(enabled = 1) {
  const now = Math.floor(Date.now() / 1000);
  await db.run(sql`INSERT INTO integrations (key, status, enabled, config, updated_at)
    VALUES ('whatsapp_cloud', 'conectado', ${enabled},
      ${JSON.stringify({
        phoneNumberId: "000000000000000",
        wabaId: "000000000000000",
        accessToken: "token-de-teste",
        verifyToken: "verify-de-teste",
        appSecret: APP_SECRET,
      })}, ${now})`);
  await db.run(sql`INSERT INTO ai_agents (name, active, channels, created_at, updated_at)
    VALUES ('Agente de teste', 1, '["site","whatsapp"]', ${now}, ${now})`);
}

async function sign(raw: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(APP_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw));
  return `sha256=${Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** POST real na rota, com assinatura válida. IP novo a cada chamada para não
    esbarrar no rate limit compartilhado (60/min por IP). */
async function post(payload: unknown, options: { signature?: string } = {}) {
  const raw = JSON.stringify(payload);
  ipSeq++;
  const response = await app.request("/api/webhooks/whatsapp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `10.0.0.${ipSeq % 250}`,
      "x-hub-signature-256": options.signature ?? (await sign(raw)),
    },
    body: raw,
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

const textMessage = (id: string, text = "Tenho interesse", from = CLIENT_PHONE) => ({
  object: "whatsapp_business_account",
  entry: [
    {
      id: "waba",
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { display_phone_number: SELF_PHONE, phone_number_id: "000000000000000" },
            contacts: [{ profile: { name: "Cliente Teste" }, wa_id: from }],
            messages: [{ from, id, timestamp: "1757400000", type: "text", text: { body: text } }],
          },
        },
      ],
    },
  ],
});

const statusEvent = (id: string, status: string) => ({
  object: "whatsapp_business_account",
  entry: [
    {
      id: "waba",
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { display_phone_number: SELF_PHONE, phone_number_id: "000000000000000" },
            statuses: [
              {
                id,
                status,
                timestamp: "1757400000",
                recipient_id: CLIENT_PHONE,
                conversation: { id: "conv" },
              },
            ],
          },
        },
      ],
    },
  ],
});

const count = async (table: string, where = "1=1") => {
  const rows = await db.all<{ n: number }>(sql.raw(`SELECT COUNT(*) as n FROM ${table} WHERE ${where}`));
  return rows[0]?.n ?? 0;
};

beforeEach(async () => {
  db = await freshDb();
  aiCalls = 0;
  graphCalls = [];
  failAt = null;
  app = new Hono();
  registerWebhookRoutes(app);
  await seed();
});

/* --------------------------------------------------------------- 1 */

describe("mensagem legítima", () => {
  test("primeira mensagem é processada exatamente uma vez", async () => {
    const res = await post(textMessage("wamid.AAA"));

    expect(res.status).toBe(200);
    expect(res.body.processed).toBe(1);
    expect(res.body.duplicated).toBe(0);
    expect(await count("conversations")).toBe(1);
    expect(await count("messages", "direction = 'in'")).toBe(1);
    expect(await count("leads")).toBe(1);
    expect(aiCalls).toBe(1);
    expect(graphCalls.length).toBe(1);
  });

  test("duas mensagens diferentes do mesmo cliente são ambas processadas", async () => {
    await post(textMessage("wamid.AAA", "Primeira"));
    await post(textMessage("wamid.BBB", "Segunda"));

    expect(await count("messages", "direction = 'in'")).toBe(2);
    expect(await count("conversations")).toBe(1); // mesma conversa
    expect(await count("leads")).toBe(1); // dedupe de lead preservado
    expect(aiCalls).toBe(2);
    expect(graphCalls.length).toBe(2);
  });
});

/* --------------------------------------------------------------- 2 */

describe("reenvio da Meta (idempotência)", () => {
  test("mesmo message id duas vezes: uma mensagem, uma resposta da IA", async () => {
    const first = await post(textMessage("wamid.AAA"));
    const second = await post(textMessage("wamid.AAA"));

    expect(first.body.processed).toBe(1);
    expect(second.status).toBe(200); // 200, não erro: a Meta não deve tentar de novo
    expect(second.body.processed).toBe(0);
    expect(second.body.duplicated).toBe(1);

    expect(await count("messages", "direction = 'in'")).toBe(1);
    expect(await count("conversations")).toBe(1);
    expect(await count("leads")).toBe(1);
    expect(aiCalls).toBe(1);
    expect(graphCalls.length).toBe(1);
  });

  test("reenvio não gera histórico duplicado no lead", async () => {
    await post(textMessage("wamid.AAA"));
    const eventsAfterFirst = await count("lead_events");
    await post(textMessage("wamid.AAA"));

    expect(await count("lead_events")).toBe(eventsAfterFirst);
  });

  test("cinco reenvios do mesmo evento continuam valendo por um só", async () => {
    for (let i = 0; i < 5; i++) await post(textMessage("wamid.AAA"));

    expect(await count("messages", "direction = 'in'")).toBe(1);
    expect(aiCalls).toBe(1);
    expect(graphCalls.length).toBe(1);
  });

  test("concorrência: duas requisições simultâneas com o mesmo id, só uma vence", async () => {
    const [a, b] = await Promise.all([post(textMessage("wamid.RACE")), post(textMessage("wamid.RACE"))]);

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(Number(a.body.processed) + Number(b.body.processed)).toBe(1);
    expect(Number(a.body.duplicated) + Number(b.body.duplicated)).toBe(1);
    expect(await count("messages", "direction = 'in'")).toBe(1);
    expect(aiCalls).toBe(1);
    expect(graphCalls.length).toBe(1);
  });
});

/* --------------------------------------------------------------- 3 */

describe("eventos que não são mensagem do cliente", () => {
  test("status sent/delivered/read/failed não aciona a IA nem cria conversa", async () => {
    for (const status of ["sent", "delivered", "read", "failed"]) {
      const res = await post(statusEvent(`wamid.OUT.${status}`, status));
      expect(res.status).toBe(200);
      expect(res.body.processed).toBe(0);
    }

    expect(await count("conversations")).toBe(0);
    expect(await count("messages")).toBe(0);
    expect(await count("leads")).toBe(0);
    expect(aiCalls).toBe(0);
    expect(graphCalls.length).toBe(0);
  });

  test("mensagem originada pelo próprio número não cria loop", async () => {
    const res = await post(textMessage("wamid.SELF", "resposta automática", SELF_PHONE));

    expect(res.status).toBe(200);
    expect(res.body.processed).toBe(0);
    expect(await count("conversations")).toBe(0);
    expect(aiCalls).toBe(0);
    expect(graphCalls.length).toBe(0);
  });

  test("mensagem que não é texto (áudio) é ignorada sem erro", async () => {
    const payload = textMessage("wamid.AUDIO") as unknown as {
      entry: { changes: { value: { messages: Record<string, unknown>[] } }[] }[];
    };
    payload.entry[0]!.changes[0]!.value.messages[0] = {
      from: CLIENT_PHONE,
      id: "wamid.AUDIO",
      type: "audio",
      audio: { id: "media-1" },
    };
    const res = await post(payload);

    expect(res.status).toBe(200);
    expect(await count("messages")).toBe(0);
    expect(aiCalls).toBe(0);
  });
});

/* --------------------------------------------------------------- 4 */

describe("regressão: inbox e CRM continuam funcionando", () => {
  test("a mensagem chega ao inbox e vira lead ligado à conversa", async () => {
    await post(textMessage("wamid.AAA", "Quero visitar o apartamento"));

    const [conversation] = await db.all<{
      channel: string;
      external_id: string;
      lead_id: number;
      unread: number;
      last_message: string;
      mode: string;
    }>(sql`SELECT channel, external_id, lead_id, unread, last_message, mode FROM conversations`);
    expect(conversation?.channel).toBe("whatsapp");
    expect(conversation?.external_id).toBe(CLIENT_PHONE);
    expect(conversation?.lead_id).toBeGreaterThan(0);
    expect(conversation?.unread).toBeGreaterThan(0);
    /* `last_message` guarda a última mensagem da conversa — depois do turno da
       IA é a resposta dela, não a fala do cliente. Comportamento de antes. */
    expect(conversation?.last_message).toBe("Olá! Sou o atendimento da Edy Prime.");
    expect(conversation?.mode).toBe("ia");

    const [inbound] = await db.all<{ body: string; author: string; external_id: string }>(
      sql`SELECT body, author, external_id FROM messages WHERE direction = 'in'`,
    );
    expect(inbound?.body).toBe("Quero visitar o apartamento");
    expect(inbound?.author).toBe("cliente");
    expect(inbound?.external_id).toBe("wamid.AAA");

    const [lead] = await db.all<{ source: string; channel: string; phone: string }>(
      sql`SELECT source, channel, phone FROM leads`,
    );
    expect(lead?.source).toBe("whatsapp");
    expect(lead?.channel).toBe("whatsapp");
    expect(lead?.phone).toContain("13911112222");
  });

  test("a resposta da IA é gravada como mensagem de saída", async () => {
    await post(textMessage("wamid.AAA"));

    const [reply] = await db.all<{ author: string; direction: string; external_id: string | null }>(
      sql`SELECT author, direction, external_id FROM messages WHERE direction = 'out'`,
    );
    expect(reply?.author).toBe("ia");
    expect(reply?.external_id).toBeNull();
  });

  test("duas respostas da IA na mesma conversa continuam podendo ser gravadas", async () => {
    await post(textMessage("wamid.AAA", "Primeira"));
    await post(textMessage("wamid.BBB", "Segunda"));

    expect(await count("messages", "direction = 'out'")).toBe(2);
  });
});

/* --------------------------------------------------------------- 5 */

describe("regressão: segurança e integrações vizinhas", () => {
  test("assinatura inválida continua sendo 401 e nada é gravado", async () => {
    const res = await post(textMessage("wamid.AAA"), { signature: "sha256=00" });

    expect(res.status).toBe(401);
    expect(await count("conversations")).toBe(0);
    expect(await count("inbound_events")).toBe(0);
    expect(aiCalls).toBe(0);
  });

  test("integração desativada continua devolvendo 200 ignorado, sem processar", async () => {
    await db.run(sql`UPDATE integrations SET enabled = 0 WHERE key = 'whatsapp_cloud'`);
    const res = await post(textMessage("wamid.AAA"));

    expect(res.status).toBe(200);
    expect(res.body.ignored).toBe(true);
    expect(await count("conversations")).toBe(0);
    expect(await count("inbound_events")).toBe(0);
    expect(aiCalls).toBe(0);
  });

  test("verificação GET segue exigindo o verify token correto", async () => {
    const ok = await app.request(
      "/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-de-teste&hub.challenge=1234",
    );
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("1234");

    const bad = await app.request(
      "/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=1234",
    );
    expect(bad.status).toBe(403);
  });

  test("webhook de leads com token inválido continua 401", async () => {
    const res = await app.request("/api/webhooks/leads/zap", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "10.9.9.9" },
      body: JSON.stringify({ nome: "Fraude", telefone: "13999990000" }),
    });
    expect(res.status).toBe(401);
    expect(await count("leads")).toBe(0);
  });

  test("webhook da Meta (instagram/messenger) não é afetado: sem assinatura, 401", async () => {
    const res = await app.request("/api/webhooks/meta", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "10.9.9.8" },
      body: JSON.stringify({ object: "instagram", entry: [] }),
    });
    expect(res.status).toBe(401);
    expect(await count("conversations")).toBe(0);
  });
});

/* --------------------------------------------------------------- 8 */
/* Falha no meio do processamento + reenvio da Meta.                */
/* Sem o ciclo de vida da reserva, TODOS estes casos perderiam a    */
/* mensagem do cliente para sempre.                                */

describe("falha antes de concluir: o reenvio retoma, não é descartado", () => {
  const stateOf = async (externalId: string) => {
    const rows = await db.all<{ status: string; stage: string; attempts: number }>(
      sql.raw(
        `SELECT status, stage, attempts FROM inbound_events WHERE external_id = '${externalId}'`,
      ),
    );
    return rows[0];
  };

  test("falha logo após reservar o wamid: retry processa a mensagem inteira", async () => {
    failAt = "claim";
    const crash = await post(textMessage("wamid.F1", "Quero visitar"));
    expect(crash.status).toBe(502);
    expect(crash.body.failed).toBe(1);
    expect(await count("messages")).toBe(0);
    expect(aiCalls).toBe(0);
    expect((await stateOf("wamid.F1"))?.status).toBe("failed");

    failAt = null;
    const retry = await post(textMessage("wamid.F1", "Quero visitar"));
    expect(retry.status).toBe(200);
    expect(retry.body.processed).toBe(1);
    expect(retry.body.resumed).toBe(1);
    expect(await count("messages", "direction = 'in'")).toBe(1);
    expect(await count("leads")).toBe(1);
    expect(aiCalls).toBe(1);
    expect((await stateOf("wamid.F1"))?.status).toBe("completed");
    /* uma reserva só, reaproveitada — não vira lixo acumulado */
    expect(await count("inbound_events")).toBe(1);
  });

  test("falha depois de criar a conversa: retry não duplica conversa nem mensagem", async () => {
    failAt = "conversation";
    const crash = await post(textMessage("wamid.F2"));
    expect(crash.status).toBe(502);
    expect(await count("conversations")).toBe(1);
    expect(await count("messages")).toBe(0);
    expect(aiCalls).toBe(0);

    failAt = null;
    const retry = await post(textMessage("wamid.F2"));
    expect(retry.status).toBe(200);
    expect(await count("conversations")).toBe(1);
    expect(await count("messages", "direction = 'in'")).toBe(1);
    expect(aiCalls).toBe(1);
  });

  test("falha depois de persistir a mensagem, antes da IA: retry completa e a IA roda uma vez", async () => {
    failAt = "store";
    const crash = await post(textMessage("wamid.F3", "Tenho interesse no 302"));
    expect(crash.status).toBe(502);
    /* a mensagem já está no inbox, mas nada de lead nem de IA aconteceu */
    expect(await count("messages", "direction = 'in'")).toBe(1);
    expect(await count("leads")).toBe(0);
    expect(aiCalls).toBe(0);

    failAt = null;
    const retry = await post(textMessage("wamid.F3", "Tenho interesse no 302"));
    expect(retry.status).toBe(200);
    expect(retry.body.resumed).toBe(1);
    /* o índice UNIQUE impede a segunda inserção da MESMA mensagem */
    expect(await count("messages", "direction = 'in'")).toBe(1);
    expect(await count("leads")).toBe(1);
    /* e a IA finalmente respondeu — exatamente uma vez */
    expect(aiCalls).toBe(1);
    expect(await count("messages", "direction = 'out'")).toBe(1);
  });

  test("falha ao ligar o lead: retry retoma da etapa do lead, sem reinserir a mensagem", async () => {
    failAt = "lead";
    const crash = await post(textMessage("wamid.F4"));
    expect(crash.status).toBe(502);
    expect(await count("messages", "direction = 'in'")).toBe(1);
    expect(await count("leads")).toBe(0);
    expect(aiCalls).toBe(0);
    /* a etapa `stored` ficou registrada: o retry não repete o que já foi feito */
    expect((await stateOf("wamid.F4"))?.stage).toBe("stored");

    failAt = null;
    const retry = await post(textMessage("wamid.F4"));
    expect(retry.status).toBe(200);
    expect(await count("messages", "direction = 'in'")).toBe(1);
    expect(await count("leads")).toBe(1);
    /* uma nota só no lead: o retry não duplicou histórico do CRM */
    expect(await count("lead_notes")).toBe(0);
    expect(aiCalls).toBe(1);
  });

  test("não lidas e histórico não são recontados no retry", async () => {
    failAt = "lead";
    await post(textMessage("wamid.F5"));
    const [before] = await db.all<{ unread: number }>(
      sql`SELECT unread FROM conversations LIMIT 1`,
    );

    failAt = null;
    await post(textMessage("wamid.F5"));
    const [after] = await db.all<{ unread: number }>(sql`SELECT unread FROM conversations LIMIT 1`);

    /* a mensagem do cliente contou uma vez só (a resposta da IA zera/não soma) */
    expect(after?.unread).toBe(before?.unread);
    expect(await count("messages", "direction = 'in'")).toBe(1);
    /* O histórico do CRM não foi recontado: nenhum par (kind, title) aparece
       duas vezes. Os eventos existentes vêm todos de UM único `intakeLead`
       (criado + qualificação + score), executado só no retry. */
    const [duplicados] = await db.all<{ n: number }>(
      sql`SELECT COUNT(*) AS n FROM (
            SELECT kind, title FROM lead_events GROUP BY kind, title HAVING COUNT(*) > 1
          )`,
    );
    expect(duplicados?.n).toBe(0);
    expect(await count("lead_events", "kind = 'criado'")).toBe(1);
  });

  /**
   * Falha DENTRO da IA é caso à parte: `aiTurn` já trata a exceção do gateway
   * internamente e transfere a conversa para atendimento humano, devolvendo
   * `replied: false`. Ela nunca sobe até o laço do webhook, então o evento
   * CONCLUI e a resposta é 200 — de propósito. Pedir reenvio à Meta aqui não
   * traria ganho nenhum: a etapa `replied` já foi consumida (o retry nunca
   * chamaria a IA de novo) e a conversa já está na mão do corretor.
   */
  test("falha na IA não gera segunda chamada de IA no retry", async () => {
    failAt = "ai";
    const crash = await post(textMessage("wamid.F6"));
    expect(crash.status).toBe(200);
    expect(aiCalls).toBe(1);
    expect(await count("messages", "direction = 'in'")).toBe(1);
    /* nenhuma resposta de IA foi gravada nem enviada: só o aviso de transferência */
    expect(await count("messages", "author = 'ia'")).toBe(0);
    expect(await count("conversations", "mode = 'humano'")).toBe(1);
    expect(graphCalls.length).toBe(0);
    expect((await stateOf("wamid.F6"))?.status).toBe("completed");

    failAt = null;
    const retry = await post(textMessage("wamid.F6"));
    expect(retry.status).toBe(200);
    expect(retry.body.duplicated).toBe(1);
    /* a IA é NO MÁXIMO uma vez por wamid: o reenvio não a chama de novo */
    expect(aiCalls).toBe(1);
    expect(graphCalls.length).toBe(0);
    /* a mensagem do cliente está preservada no inbox para atendimento humano */
    expect(await count("messages", "direction = 'in'")).toBe(1);
    expect(await count("messages", "author = 'ia'")).toBe(0);
  });

  test("evento já concluído recebido de novo: descartado, sem IA e sem gravação", async () => {
    await post(textMessage("wamid.F7"));
    expect(aiCalls).toBe(1);
    expect((await stateOf("wamid.F7"))?.status).toBe("completed");

    const again = await post(textMessage("wamid.F7"));
    expect(again.status).toBe(200);
    expect(again.body.duplicated).toBe(1);
    expect(again.body.processed).toBe(0);
    expect(again.body.resumed).toBe(0);
    expect(aiCalls).toBe(1);
    expect(await count("messages", "direction = 'in'")).toBe(1);
    expect(await count("messages", "direction = 'out'")).toBe(1);
    expect((await stateOf("wamid.F7"))?.attempts).toBe(1);
  });

  test("reserva em andamento não é roubada: concorrência com o mesmo wamid", async () => {
    const results = await Promise.all([
      post(textMessage("wamid.F8")),
      post(textMessage("wamid.F8")),
      post(textMessage("wamid.F8")),
    ]);
    const processedTotal = results.reduce((sum, r) => sum + Number(r.body.processed ?? 0), 0);

    expect(processedTotal).toBe(1);
    expect(aiCalls).toBe(1);
    expect(await count("messages", "direction = 'in'")).toBe(1);
    expect(await count("inbound_events")).toBe(1);
  });

  test("falha registra o motivo no histórico da integração", async () => {
    failAt = "claim";
    await post(textMessage("wamid.F9"));
    const rows = await db.all<{ message: string }>(
      sql`SELECT message FROM integration_events WHERE ok = 0 ORDER BY id DESC LIMIT 1`,
    );
    expect(rows[0]?.message).toContain("retry liberado");
  });
});

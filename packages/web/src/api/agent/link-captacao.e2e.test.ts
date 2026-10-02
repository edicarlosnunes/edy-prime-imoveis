/**
 * LINK_CAPTACAO — os seis cenários pedidos, ponta a ponta.
 *
 *  1. entrada pelo link (abertura exata, sem perguntar intenção)
 *  2. salvamento progressivo (resposta por resposta, na ordem do roteiro)
 *  3. retomada pelo mesmo telefone, sem repetir pergunta já respondida
 *  4. frase neutra exata quando a pergunta sai do roteiro
 *  5. foto de fachada e fechamento exato
 *  6. ausência de duplicidade (proprietário, imóvel, unidade do mesmo prédio)
 *
 * Como roda: SQLite temporário + o caminho real de produção
 * (`inbox#aiTurn` → `agent/broker#agentReply` → `agent/link-captacao` →
 * `owner-capture#saveCaptureAnswer` → `owner-intake`/`property_captures`).
 * Só o modelo é simulado: `generateText` é trocado por um dublê que recebe as
 * ferramentas reais e age como o extrator agiria — chamando
 * `salvarCadastroVenda` com o que o proprietário acabou de responder.
 *
 * O texto que vai para o cliente NÃO vem do dublê: quem escreve é
 * `link-captacao`. É exatamente isso que estes testes verificam.
 */
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { sql } from "drizzle-orm";
import { rm } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { Hono } from "hono";
import * as schema from "../database/schema";
import type { AdminDb } from "../lib/admin-base";
import {
  BROKER_LEAD_CLOSING_MESSAGE,
  CLOSING_MESSAGE,
  LINK_CAPTACAO_MESSAGE,
  LINK_CAPTACAO_ORIGIN,
  OFF_SCRIPT_REPLY,
  linkCaptacaoReply,
  linkCaptacaoState,
  linkCaptacaoUrl,
  linkQuestion,
} from "./link-captacao";
import {
  bindCaptureShareToCapture,
  issueCaptureShareToken,
  latestCaptureShareForSender,
  redeemCaptureShareToken,
} from "../lib/capture-share-tokens";

/* O broker só chama o modelo quando o gateway parece configurado. */
process.env.AI_GATEWAY_BASE_URL ||= "https://gateway.test";
process.env.AI_GATEWAY_API_KEY ||= "test-key";

/* ----------------------------------------------- dublê do modelo de IA */

interface FakeTool {
  execute: (input: unknown, options: unknown) => Promise<unknown>;
}
interface FakeCall {
  system: string;
  tools: Record<string, FakeTool>;
  messages: { role: string; content: string }[];
}
interface FakeStep {
  toolCalls: { toolName: string; input: unknown }[];
}
type Behavior = (call: FakeCall) => Promise<{ text: string; steps: FakeStep[] }>;

let behavior: Behavior = async () => ({ text: "ok", steps: [] });
let modelCalls = 0;
let lastSystem = "";
let lastTools: string[] = [];
let db: AdminDb;
let app: Hono;
let webhookMessageSeq = 0;
let testDbSeq = 0;
let testDatabasePath = "";
let testClient: ReturnType<typeof createClient>;
let issuedShareTokens: string[] = [];
const APP_SECRET = "segredo-de-teste";
const graphCalls: { url: string; body: string }[] = [];

/* `tool`, `stepCountIs` e o resto continuam reais: só `generateText` é dublê. */
const aiReal = { ...(await import("ai")) };
mock.module("ai", () => ({
  ...aiReal,
  generateText: async (options: FakeCall) => {
    modelCalls++;
    lastSystem = options.system;
    lastTools = Object.keys(options.tools ?? {});
    return behavior(options);
  },
}));

/* A rota usa o banco de produção por padrão; este teste injeta o SQLite em memória. */
mock.module("../lib/auth", () => ({
  getDb: async () => db,
  resolveSession: async () => null,
}));

/* Importado DEPOIS do mock para que o broker receba o `generateText` dublê. */
const { addMessage, aiTurn, conversationTurns, ensureConversation } = await import("../lib/inbox");
const { registerWebhookRoutes } = await import("../http/webhook-routes");

/* ------------------------------------------------------------------ DDL */

/* Espelha scripts/migrate.ts nas tabelas que este fluxo toca. */
const DDL = [
  `CREATE TABLE owners (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    notes TEXT,
    document TEXT,
    rg TEXT,
    capture_status TEXT NOT NULL DEFAULT 'prospeccao',
    possible_duplicate INTEGER NOT NULL DEFAULT 0,
    duplicate_of_owner_id INTEGER,
    duplicate_note TEXT,
    created_at INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE property_captures (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    owner_id INTEGER NOT NULL,
    city TEXT NOT NULL DEFAULT 'Praia Grande',
    district TEXT,
    address TEXT,
    property_type TEXT,
    serial TEXT,
    cep TEXT,
    street TEXT,
    number TEXT,
    state TEXT,
    complements TEXT,
    unit_key TEXT,
    doc_validated_by TEXT,
    doc_validated_at INTEGER,
    doc_validation_note TEXT,
    owner_photos TEXT,
    asking_price REAL,
    estimated_price REAL,
    source TEXT NOT NULL DEFAULT 'manual',
    stage TEXT NOT NULL DEFAULT 'novo_contato',
    intention TEXT,
    next_action TEXT,
    next_action_at INTEGER,
    appraisal_status TEXT NOT NULL DEFAULT 'pendente',
    appraisal_at INTEGER,
    appraisal_note TEXT,
    doc_status TEXT NOT NULL DEFAULT 'nao_iniciado',
    registration_status TEXT NOT NULL DEFAULT 'NOVO',
    registration_status_at INTEGER,
    completeness INTEGER NOT NULL DEFAULT 0,
    last_field_at INTEGER,
    address_key TEXT,
    building_key TEXT,
    outside_priority_area INTEGER NOT NULL DEFAULT 0,
    duplicate_of_capture_id INTEGER,
    duplicate_note TEXT,
    notes TEXT,
    lost_reason TEXT,
    lost_detail TEXT,
    converted_property_id INTEGER,
    converted_at INTEGER,
    stage_changed_at INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    title TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'visita',
    due_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pendente',
    lead_id INTEGER,
    client_id INTEGER,
    property_id INTEGER,
    capture_id INTEGER,
    notes TEXT,
    created_at INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    company_name TEXT NOT NULL DEFAULT 'Edy Prime Imóveis',
    broker_name TEXT NOT NULL DEFAULT 'Edy Prime',
    whatsapp TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    creci TEXT NOT NULL DEFAULT '',
    cnai TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    instagram TEXT NOT NULL DEFAULT '',
    facebook TEXT NOT NULL DEFAULT '',
    commission_rate REAL NOT NULL DEFAULT 6,
    priority_cities TEXT NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    channel TEXT NOT NULL DEFAULT 'site',
    external_id TEXT,
    lead_id INTEGER,
    client_id INTEGER,
    property_id INTEGER,
    agent_id INTEGER,
    contact_name TEXT,
    contact_phone TEXT,
    mode TEXT NOT NULL DEFAULT 'ia',
    assigned_to INTEGER,
    assigned_name TEXT,
    transfer_reason TEXT,
    transferred_at INTEGER,
    status TEXT NOT NULL DEFAULT 'aberta',
    unread INTEGER NOT NULL DEFAULT 0,
    last_message TEXT,
    last_message_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    conversation_id INTEGER NOT NULL,
    direction TEXT NOT NULL DEFAULT 'in',
    author TEXT NOT NULL DEFAULT 'cliente',
    author_name TEXT,
    body TEXT NOT NULL,
    external_id TEXT,
    created_at INTEGER NOT NULL DEFAULT 0)`,
  `CREATE UNIQUE INDEX messages_conversation_external_uk ON messages (conversation_id, external_id)`,
  `CREATE TABLE ai_agents (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    name TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 0,
    provider TEXT NOT NULL DEFAULT 'gateway',
    model TEXT NOT NULL DEFAULT 'openai/gpt-5.4-mini',
    greeting TEXT NOT NULL DEFAULT '',
    instructions TEXT NOT NULL DEFAULT '',
    tone TEXT NOT NULL DEFAULT '',
    hours_start TEXT NOT NULL DEFAULT '08:00',
    hours_end TEXT NOT NULL DEFAULT '20:00',
    channels TEXT NOT NULL DEFAULT '["site"]',
    qualification TEXT NOT NULL DEFAULT '',
    transfer_rules TEXT NOT NULL DEFAULT '',
    transfer_message TEXT NOT NULL DEFAULT '',
    idle_minutes INTEGER NOT NULL DEFAULT 30,
    human_conditions TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE automations (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    name TEXT NOT NULL,
    trigger TEXT NOT NULL,
    conditions TEXT NOT NULL DEFAULT '{}',
    actions TEXT NOT NULL DEFAULT '[]',
    active INTEGER NOT NULL DEFAULT 0,
    run_count INTEGER NOT NULL DEFAULT 0,
    error_count INTEGER NOT NULL DEFAULT 0,
    last_run_at INTEGER,
    last_error TEXT,
    created_at INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE automation_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    automation_id INTEGER NOT NULL,
    ok INTEGER NOT NULL DEFAULT 1,
    message TEXT,
    created_at INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE integrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    key TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'nao_configurado',
    enabled INTEGER NOT NULL DEFAULT 0,
    config TEXT,
    last_sync_at INTEGER,
    last_test_at INTEGER,
    last_error TEXT,
    updated_at INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE properties (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    code TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    purpose TEXT NOT NULL DEFAULT 'venda',
    type TEXT NOT NULL DEFAULT 'apartamento',
    price REAL NOT NULL DEFAULT 0,
    district TEXT NOT NULL DEFAULT '',
    city TEXT NOT NULL DEFAULT 'Praia Grande',
    bedrooms INTEGER NOT NULL DEFAULT 0,
    suites INTEGER NOT NULL DEFAULT 0,
    bathrooms INTEGER NOT NULL DEFAULT 0,
    parking INTEGER NOT NULL DEFAULT 0,
    area_util REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'disponivel',
    published INTEGER NOT NULL DEFAULT 1,
    featured INTEGER NOT NULL DEFAULT 0,
    owner_id INTEGER,
    views INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT 0,
    watermark_off INTEGER NOT NULL DEFAULT 0,
    portfolio_entry_at INTEGER,
    last_revalidation_at INTEGER,
    next_revalidation_at INTEGER,
    revalidation_status TEXT,
    commercial_status TEXT,
    commercial_status_at INTEGER,
    paused_at INTEGER,
    pause_reason TEXT,
    outside_priority_area INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    user_id INTEGER,
    user_name TEXT,
    action TEXT NOT NULL,
    entity TEXT,
    entity_id TEXT,
    detail TEXT,
    ip TEXT,
    created_at INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE integration_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    integration_key TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'sync',
    ok INTEGER NOT NULL DEFAULT 1,
    message TEXT,
    created_at INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE inbound_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    channel TEXT NOT NULL,
    external_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'processing',
    stage TEXT NOT NULL DEFAULT 'claimed',
    attempts INTEGER NOT NULL DEFAULT 1,
    last_error TEXT,
    claimed_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL)`,
  `CREATE UNIQUE INDEX inbound_events_channel_external_uk ON inbound_events (channel, external_id)`,
  `CREATE TABLE leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    interest TEXT NOT NULL,
    message TEXT,
    source TEXT NOT NULL DEFAULT 'site',
    created_at INTEGER NOT NULL,
    email TEXT,
    stage TEXT NOT NULL DEFAULT 'novo',
    status TEXT NOT NULL DEFAULT 'aberto',
    lost_reason TEXT,
    client_id INTEGER,
    property_id INTEGER,
    next_action TEXT,
    next_action_at INTEGER,
    updated_at INTEGER,
    portal TEXT,
    channel TEXT,
    campaign TEXT,
    utm_source TEXT,
    utm_medium TEXT,
    utm_campaign TEXT,
    external_id TEXT,
    score INTEGER NOT NULL DEFAULT 0,
    score_tier TEXT NOT NULL DEFAULT 'frio',
    score_reasons TEXT,
    score_at INTEGER,
    qualified_at INTEGER)`,
  `CREATE TABLE lead_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    lead_id INTEGER NOT NULL,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL)`,
  `CREATE TABLE lead_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    lead_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    detail TEXT,
    actor_type TEXT NOT NULL DEFAULT 'sistema',
    actor_name TEXT,
    score_before INTEGER,
    score_after INTEGER,
    created_at INTEGER NOT NULL)`,
  `CREATE TABLE lead_profile (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    lead_id INTEGER NOT NULL UNIQUE,
    purpose TEXT,
    property_type TEXT,
    city TEXT,
    districts TEXT,
    budget_min REAL,
    budget_max REAL,
    bedrooms INTEGER,
    suites INTEGER,
    parking INTEGER,
    area_min REAL,
    financing TEXT,
    fgts TEXT,
    trade_in TEXT,
    trade_in_detail TEXT,
    timeframe TEXT,
    preferences TEXT,
    restrictions TEXT,
    contact_preference TEXT,
    contact_window TEXT,
    summary TEXT,
    wants_visit INTEGER NOT NULL DEFAULT 0,
    wants_human INTEGER NOT NULL DEFAULT 0,
    cash_payment INTEGER NOT NULL DEFAULT 0,
    just_looking INTEGER NOT NULL DEFAULT 0,
    messages_count INTEGER NOT NULL DEFAULT 0,
    contact_days INTEGER NOT NULL DEFAULT 0,
    last_customer_at INTEGER,
    source TEXT NOT NULL DEFAULT 'deterministico',
    fields_source TEXT,
    completeness INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER)`,
  `CREATE TABLE media (
    id TEXT PRIMARY KEY NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    data TEXT NOT NULL,
    name TEXT,
    alt TEXT,
    original_id TEXT,
    variant TEXT,
    created_at INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE capture_share_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'active',
    sender_phone TEXT,
    capture_id INTEGER,
    created_by INTEGER NOT NULL,
    expires_at INTEGER NOT NULL DEFAULT 0,
    revoked_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT 0,
    redeemed_at INTEGER,
    completed_at INTEGER)`,
];

/** Telefone do WhatsApp: identidade do proprietário, nunca perguntado. */
const PHONE = "(13) 99714-1174";
const BASE_URL = "https://teste.local";

beforeEach(async () => {
  testDatabasePath = `/tmp/link-captacao-e2e-${process.pid}-${++testDbSeq}-${crypto.randomUUID()}.db`;
  testClient = createClient({
    url: `file:${testDatabasePath}`,
  });
  const instance = drizzle(testClient, { schema });
  for (const statement of DDL) await instance.run(sql.raw(statement));
  db = instance as unknown as AdminDb;
  await db.run(sql`INSERT INTO ai_agents (name, active, channels, transfer_message, created_at, updated_at)
    VALUES ('Atendimento Edy Prime', 1, '["site","whatsapp"]', 'Vou chamar um corretor.', 0, 0)`);
  await db.run(sql`INSERT INTO integrations (key, status, enabled, config, updated_at)
    VALUES ('whatsapp_cloud', 'conectado', 1, ${JSON.stringify({
      phoneNumberId: "000000000000000",
      accessToken: "token-de-teste",
      verifyToken: "verify-de-teste",
      appSecret: APP_SECRET,
    })}, 0)`);
  behavior = async () => ({ text: "ok", steps: [] });
  modelCalls = 0;
  lastSystem = "";
  lastTools = [];
  webhookMessageSeq = 0;
  issuedShareTokens = [];
  graphCalls.length = 0;
});

afterEach(async () => {
  await testClient.close();
  await Promise.all([
    rm(testDatabasePath, { force: true }),
    rm(`${testDatabasePath}-wal`, { force: true }),
    rm(`${testDatabasePath}-shm`, { force: true }),
  ]);
});

/* ------------------------------------------------------------ utilidades */

const conversation = async (externalId: string, contactPhone = PHONE) =>
  ensureConversation(db, {
    channel: "whatsapp",
    externalId,
    contactPhone,
    contactName: null,
  });

const toolOptions = { toolCallId: "call-1", messages: [] };

interface SaveResult {
  salvo?: boolean;
  motivo?: string;
  cadastroId?: number | null;
  aviso?: string | null;
}

/**
 * Um turno do proprietário no fluxo do link.
 *
 * Com `save`, o dublê age como o extrator: chama `salvarCadastroVenda` com o
 * que a pessoa respondeu. Sem `save`, o modelo não grava nada — é o turno em
 * que a pessoa fala qualquer coisa que não responde a pergunta pendente.
 *
 * A resposta ao cliente vem sempre do `link-captacao`, nunca do dublê: o
 * `text` devolvido aqui é de propósito um texto que o roteiro jamais usaria.
 */
async function linkTurn(
  conversationId: number,
  body: string,
  save?: Record<string, unknown>,
  trustedWhatsappMedia = false,
): Promise<{
  reply: string | undefined;
  saved: SaveResult | null;
  skipped?: string;
  replied: boolean;
}> {
  const [conversationRow] = await db.all<{ contact_phone: string | null }>(
    sql`SELECT contact_phone FROM conversations WHERE id = ${conversationId}`,
  );
  const sender = (conversationRow?.contact_phone ?? PHONE).replace(/\D/g, "");
  const [completedShare] = await db.all<{ id: number }>(
    sql`SELECT id FROM capture_share_tokens WHERE sender_phone = ${sender.startsWith("55") ? sender : `55${sender}`} AND status = 'completed' ORDER BY id DESC LIMIT 1`,
  );
  if (
    /^LINK_CAPTACAO:/i.test(body) ||
    (body === LINK_CAPTACAO_MESSAGE && !completedShare)
  ) {
    const token = await issueCaptureShareToken(db, 1);
    issuedShareTokens.push(token);
    const redemption = await redeemCaptureShareToken(db, token, conversationRow?.contact_phone ?? PHONE);
    expect(redemption.ok).toBe(true);
    body = `LINK_CAPTACAO:${token}`;
  }
  let saved: SaveResult | null = null;
  behavior = async (call) => {
    if (!save) return { text: "TEXTO DO MODELO (não deve chegar ao cliente)", steps: [] };
    saved = (await call.tools.salvarCadastroVenda!.execute(save, toolOptions)) as SaveResult;
    return {
      text: "TEXTO DO MODELO (não deve chegar ao cliente)",
      steps: [{ toolCalls: [{ toolName: "salvarCadastroVenda", input: save }] }],
    };
  };
  await addMessage(db, conversationId, { direction: "in", author: "cliente", body });
  const result = await aiTurn(db, conversationId, BASE_URL, {
    trustedWhatsappMedia,
  });
  return { reply: result.text, saved, skipped: result.skipped, replied: result.replied };
}

async function genericPublicTurn(
  conversationId: number,
  body: string,
  save?: Record<string, unknown>,
  trustedWhatsappMedia = false,
) {
  let saved: SaveResult | null = null;
  behavior = async (call) => {
    if (!save) return { text: "TEXTO DO MODELO (não deve chegar ao cliente)", steps: [] };
    saved = (await call.tools.salvarCadastroVenda!.execute(save, toolOptions)) as SaveResult;
    return {
      text: "TEXTO DO MODELO (não deve chegar ao cliente)",
      steps: [{ toolCalls: [{ toolName: "salvarCadastroVenda", input: save }] }],
    };
  };
  await addMessage(db, conversationId, { direction: "in", author: "cliente", body });
  const result = await aiTurn(db, conversationId, BASE_URL, { trustedWhatsappMedia });
  return { reply: result.text, saved, skipped: result.skipped, replied: result.replied };
}

/** O clique identifica o perfil antes de pedir o nome do proprietário. */
async function entrarPeloLink(conversationId: number) {
  const abertura = await linkTurn(conversationId, LINK_CAPTACAO_MESSAGE);
  expect(abertura.reply).toBe("Vamos iniciar o cadastro do seu imóvel?\n\nVocê é proprietário, locador ou corretor de imóveis?");
  return linkTurn(conversationId, "proprietário");
}

async function counts() {
  const [owners] = await db.all<{ n: number }>(sql`SELECT COUNT(*) as n FROM owners`);
  const [captures] = await db.all<{ n: number }>(sql`SELECT COUNT(*) as n FROM property_captures`);
  return { owners: owners?.n ?? 0, captures: captures?.n ?? 0 };
}

interface CaptureRow {
  id: number;
  owner_id: number;
  city: string;
  street: string | null;
  number: string | null;
  district: string | null;
  property_type: string | null;
  intention: string | null;
  asking_price: number | null;
  complements: string | null;
  registration_status: string;
  completeness: number;
  notes: string | null;
  source: string;
}

async function captureRows() {
  return db.all<CaptureRow>(sql`SELECT * FROM property_captures ORDER BY id`);
}

async function onlyCapture() {
  const rows = await captureRows();
  expect(rows.length).toBe(1);
  return rows[0]!;
}

async function outbound(conversationId: number) {
  const rows = await db.all<{ body: string; author: string }>(
    sql`SELECT body, author FROM messages WHERE conversation_id = ${conversationId} AND direction = 'out' ORDER BY id`,
  );
  return rows;
}

async function signWebhook(raw: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(APP_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw));
  return `sha256=${Array.from(new Uint8Array(mac), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

async function postWhatsapp(
  text: string,
  image = false,
  from = "5513997141174",
  messageId?: string,
) {
  const id = messageId ?? `wamid.capture.${++webhookMessageSeq}`;
  const message = {
    from,
    id,
    timestamp: "1757400000",
    type: image ? "image" : "text",
    ...(image
      ? { image: { id: "media-facade-test", mime_type: "image/jpeg" } }
      : { text: { body: text } }),
  };
  const payload = {
    object: "whatsapp_business_account",
    entry: [{
      id: "waba",
      changes: [{
        field: "messages",
        value: {
          messaging_product: "whatsapp",
          metadata: { display_phone_number: "5513997726767", phone_number_id: "000000000000000" },
          contacts: [{ profile: { name: "Maria Souza" }, wa_id: message.from }],
          messages: [message],
        },
      }],
    }],
  };
  const raw = JSON.stringify(payload);
  const response = await app.request("/api/webhooks/whatsapp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `10.10.0.${webhookMessageSeq}`,
      "x-hub-signature-256": await signWebhook(raw),
    },
    body: raw,
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

/* ------------------------------------------------ textos exigidos (literais) */

/* Escritos aqui letra por letra, de propósito: é o que o cliente pediu. Se
   alguém mexer no roteiro do módulo, estes testes caem. */
const ABERTURA = "Qual é o seu nome completo?";
const Q_ENTRY = "Vamos iniciar o cadastro do seu imóvel?\n\nVocê é proprietário, locador ou corretor de imóveis?";
const Q_PUBLIC_ENTRY = "Você é proprietário, locador ou corretor de imóveis?";
const Q_ENDERECO = "Qual é o endereço completo do imóvel?";
const Q_CONDOMINIO_PRESENCA = "O imóvel fica em condomínio? Responda SIM, NÃO ou NÃO SEI.";
const Q_NOME_CONDOMINIO = "Qual é o nome do condomínio e, se aplicável, a unidade do imóvel?";
const Q_CONDOMINIO = "Qual é o valor do condomínio? (0 se não houver • NÃO SEI se não souber)";
const Q_DOCUMENTACAO = "Qual é a situação da documentação do imóvel? Se não souber, digite NÃO SEI.";
const Q_FOTO = "Envie uma foto real da frente ou fachada do imóvel. Se não tiver agora, digite NÃO SEI; a foto ficará pendente para nossa equipe.";
const Q_OBSERVACAO_FINAL = "Tem algo importante sobre o imóvel que gostaria de informar? Se não souber ou não tiver mais nada a acrescentar, digite NÃO SEI.";
const FECHAMENTO = "Cadastro concluído com sucesso! Em breve entraremos em contato para dar continuidade ao atendimento.";
const NEUTRA = "Certo, vamos verificar essa informação e, se necessário, nossa equipe te dá um retorno.";

/**
 * O roteiro respondido, na ordem, com a pergunta que deve vir DEPOIS de cada
 * resposta. A confirmação final é tratada à parte e não depende do modelo.
 */
const SCRIPT: { step: string; body: string; save: Record<string, unknown>; next: string }[] = [
  { step: "nome", body: "Maria Souza", save: { nome: "Maria Souza" }, next: Q_ENDERECO },
  {
    step: "endereco",
    body: "Rua Guimarães Rosa, 492, Boqueirão, Praia Grande - SP, apartamento 163 bloco B",
    save: {
      rua: "Rua Guimarães Rosa",
      numero: "492",
      bairro: "Boqueirão",
      cidade: "Praia Grande",
      estado: "SP",
      cep: "11701-000",
      unidade: "163",
      bloco: "B",
    },
    next: Q_CONDOMINIO_PRESENCA,
  },
  {
    step: "condominioPresenca",
    body: "Sim",
    save: { condominioPresenca: "yes" },
    next: Q_NOME_CONDOMINIO,
  },
  {
    step: "nomeCondominio",
    body: "Residencial Boqueirão, apartamento 163 bloco B",
    save: { nomeCondominio: "Residencial Boqueirão", unidade: "163", bloco: "B" },
    next: Q_DOCUMENTACAO,
  },
  {
    step: "documentacao",
    body: "Está em meu nome, escritura registrada",
    save: { documentacao: "Escritura registrada no nome do proprietário" },
    next: linkQuestion("tipo"),
  },
  {
    step: "tipo",
    body: "É um apartamento",
    save: { tipoImovel: "apartamento" },
    next: linkQuestion("dormitorios"),
  },
  {
    step: "dormitorios",
    body: "3 dormitórios",
    save: { dormitorios: "3" },
    next: linkQuestion("suites"),
  },
  { step: "suites", body: "1 suíte", save: { suites: "1" }, next: linkQuestion("banheiros") },
  { step: "banheiros", body: "2 banheiros", save: { banheiros: "2" }, next: linkQuestion("vagas") },
  { step: "vagas", body: "1 vaga", save: { vagas: "1" }, next: linkQuestion("metragem") },
  {
    step: "metragem",
    body: "92 m² úteis",
    save: { metragem: "92 m²" },
    next: linkQuestion("valor"),
  },
  {
    step: "valor",
    body: "Quero 780 mil",
    save: { valorPretendido: 780000 },
    next: Q_CONDOMINIO,
  },
  {
    step: "condominio",
    body: "850 reais",
    save: { condominio: "R$ 850" },
    next: linkQuestion("custos"),
  },
  {
    step: "custos",
    body: "IPTU 1200 por ano",
    save: { custos: "IPTU R$ 1.200/ano" },
    next: Q_FOTO,
  },
];

/** Percorre o roteiro até a pergunta terminal de foto. */
async function percorrerRoteiro(conversationId: number, steps = SCRIPT) {
  const perguntas: (string | undefined)[] = [];
  for (const item of steps) {
    const turn = await linkTurn(conversationId, item.body, item.save);
    const deterministicNumber = ["dormitorios", "suites", "banheiros", "vagas"].includes(item.step);
    if (
      item.step !== "nome" &&
      item.step !== "condominioPresenca" &&
      item.step !== "nomeCondominio" &&
      !deterministicNumber
    ) {
      expect(turn.saved?.salvo, `passo ${item.step}`).toBe(true);
    }
    perguntas.push(turn.reply);
  }
  return perguntas;
}

/* -------------------------------------------------- 1. entrada pelo link */

describe("1. entrada pelo link de captação", () => {
  test("o link aponta para o WhatsApp da imobiliária com a frase exata de entrada", () => {
    expect(linkCaptacaoUrl("(13) 99714-1174")).toBe(
      `https://wa.me/5513997141174?text=${encodeURIComponent(LINK_CAPTACAO_MESSAGE)}`,
    );
    expect(LINK_CAPTACAO_MESSAGE).toBe("Vamos iniciar o cadastro do seu imóvel?");
  });

  test("abre com o texto exato e não pergunta intenção, compra nem locação", async () => {
    const conversa = await conversation("5513997141174");

    const primeiro = await entrarPeloLink(conversa.id);

    expect(primeiro.replied).toBe(true);
    expect(primeiro.reply).toBe(ABERTURA);
    /* Nada de intenção: quem entra pelo link já disse o que quer. */
    expect(primeiro.reply).not.toMatch(/comprar|alugar|loca[çc][ãa]o|interesse/i);
    /* Sem resposta para extrair, o modelo nem é chamado. */
    expect(modelCalls).toBe(0);
    /* Nada respondido ainda: nenhuma ficha criada. */
    expect(await counts()).toEqual({ owners: 0, captures: 0 });
  });

  test("o fluxo do link tem precedência: nenhuma ferramenta de comprador no turno", async () => {
    const conversa = await conversation("5513997141174");
    await entrarPeloLink(conversa.id);

    await linkTurn(conversa.id, SCRIPT[0]!.body, SCRIPT[0]!.save);
    expect(modelCalls).toBe(0);
    await linkTurn(conversa.id, SCRIPT[1]!.body, SCRIPT[1]!.save);

    expect(modelCalls).toBe(1);
    expect(lastTools).toEqual(["salvarCadastroVenda"]);
    expect(lastSystem).toContain("CADASTRO DE IMÓVEL PARA VENDA");
    expect(lastSystem).toContain("Nunca negocie, nunca avalie o imóvel");
  });

  test("o telefone nunca é perguntado: vem do canal e já fica na ficha", async () => {
    const conversa = await conversation("5513997141174");
    await entrarPeloLink(conversa.id);
    await linkTurn(conversa.id, SCRIPT[0]!.body, SCRIPT[0]!.save);

    const [owner] = await db.all<{ name: string; phone: string | null }>(
      sql`SELECT name, phone FROM owners LIMIT 1`,
    );
    expect(owner?.name).toBe("Maria Souza");
    expect(owner?.phone?.replace(/\D/g, "")).toBe(PHONE.replace(/\D/g, ""));
    for (const message of await outbound(conversa.id)) {
      expect(message.body).not.toMatch(/telefone|celular|whatsapp/i);
    }
  });
});

describe("webhook Vercel legado → IA → persistência CRM", () => {
  test("aceita somente token emitido, protege replay e vincula cada link a um remetente", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("graph.facebook.com")) {
        graphCalls.push({ url: String(input), body: String(init?.body ?? "") });
        return new Response(JSON.stringify({ messages: [{ id: "wamid.out.token" }] }), { status: 200 });
      }
      return realFetch(input, init);
    }) as typeof fetch;
    try {
      app = new Hono();
      registerWebhookRoutes(app);

      const staticMessage = await postWhatsapp(LINK_CAPTACAO_MESSAGE, false, "5513997141174");
      expect(staticMessage.body.processed).toBe(1);
      const staticReply = JSON.parse(graphCalls.at(-1)!.body) as { text: { body: string } };
      expect(staticReply.text.body).toBe(Q_PUBLIC_ENTRY);
      expect(await counts()).toEqual({ owners: 0, captures: 0 });

      const firstToken = await issueCaptureShareToken(db, 1);
      const firstMessageId = "wamid.capture.replay";
      const first = await postWhatsapp(`LINK_CAPTACAO:${firstToken}`, false, "5513997141174", firstMessageId);
      expect(first.body.processed).toBe(1);
      const replay = await postWhatsapp(`LINK_CAPTACAO:${firstToken}`, false, "5513997141174", firstMessageId);
      expect(replay.body.duplicated).toBe(1);
      expect(replay.body.processed).toBe(0);

      const stolen = await postWhatsapp(`LINK_CAPTACAO:${firstToken}`, false, "5513997000001");
      expect(stolen.body.processed).toBe(1);
      const secondToken = await issueCaptureShareToken(db, 1);
      const second = await postWhatsapp(`LINK_CAPTACAO:${secondToken}`, false, "5513997000001");
      expect(second.body.processed).toBe(1);

      const rows = await db.all<{ status: string; sender_phone: string | null }>(
        sql`SELECT status, sender_phone FROM capture_share_tokens ORDER BY id`,
      );
      expect(rows).toEqual([
        { status: "redeemed", sender_phone: "5513997141174" },
        { status: "redeemed", sender_phone: "5513997000001" },
      ]);
      expect(await counts()).toEqual({ owners: 0, captures: 0 });
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test("a mensagem WhatsApp assinada percorre a rota real e grava a captação no CRM", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("graph.facebook.com")) {
        graphCalls.push({ url, body: String(init?.body ?? "") });
        return new Response(JSON.stringify({ messages: [{ id: "wamid.out.test" }] }), { status: 200 });
      }
      return realFetch(input, init);
    }) as typeof fetch;

    try {
      behavior = async (call) => {
        const save = {
          rua: "Rua das Flores",
          numero: "88",
          bairro: "Boqueirão",
          cidade: "Praia Grande",
          estado: "SP",
        };
        const result = await call.tools.salvarCadastroVenda!.execute(save, toolOptions) as SaveResult;
        expect(result.salvo).toBe(true);
        return {
          text: "TEXTO DO MODELO (não deve ser enviado)",
          steps: [{ toolCalls: [{ toolName: "salvarCadastroVenda", input: save }] }],
        };
      };
      app = new Hono();
      registerWebhookRoutes(app);

       const shareToken = await issueCaptureShareToken(db, 1);
       for (const text of [`LINK_CAPTACAO:${shareToken}`, "proprietário", "Maria Souza"]) {
        const response = await postWhatsapp(text);
        expect(response.status).toBe(200);
        expect(response.body.processed).toBe(1);
      }
       const address = await postWhatsapp(
        "Rua das Flores, 88, Boqueirão, Praia Grande - SP",
      );

      expect(address.status).toBe(200);
      expect(address.body.processed).toBe(1);
      expect(modelCalls).toBe(1);
      expect(lastTools).toEqual(["salvarCadastroVenda"]);
      expect(graphCalls).toHaveLength(4);
      const sent = JSON.parse(graphCalls.at(-1)!.body) as { text: { body: string } };
      expect(sent.text.body).toBe(Q_CONDOMINIO_PRESENCA);
      expect(sent.text.body).not.toContain("TEXTO DO MODELO");

      const [capture] = await db.all<{
        id: number;
        source: string;
        intention: string | null;
        street: string | null;
        number: string | null;
        notes: string | null;
      }>(sql`SELECT id, source, intention, street, number, notes FROM property_captures`);
      expect(capture?.source).toBe("link_captacao");
      expect(capture?.intention).toBe("venda");
      expect(capture?.street).toBe("Rua das Flores");
      expect(capture?.number).toBe("88");
      expect(capture?.notes).toContain(`Origem do cadastro: ${LINK_CAPTACAO_ORIGIN}`);
      const [boundShare] = await db.all<{ capture_id: number | null; status: string }>(
        sql`SELECT capture_id, status FROM capture_share_tokens LIMIT 1`,
      );
      expect(boundShare).toEqual({ capture_id: capture?.id, status: "redeemed" });

      const [lead] = await db.all<{ source: string; channel: string }>(
        sql`SELECT source, channel FROM leads`,
      );
      expect(lead?.source).toBe("whatsapp");
      expect(lead?.channel).toBe("whatsapp");
      expect(await counts()).toEqual({ owners: 1, captures: 1 });
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test("duas respostas de endereço simultâneas só podem criar uma ficha para o mesmo token", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("graph.facebook.com")) {
        graphCalls.push({ url, body: String(init?.body ?? "") });
        return new Response(JSON.stringify({ messages: [{ id: "wamid.out.concurrent" }] }), { status: 200 });
      }
      return realFetch(input, init);
    }) as typeof fetch;

    try {
      app = new Hono();
      registerWebhookRoutes(app);
      const token = await issueCaptureShareToken(db, 1);
      for (const text of [`LINK_CAPTACAO:${token}`, "proprietário", "Maria Souza"]) {
        const response = await postWhatsapp(text);
        expect(response.status).toBe(200);
        expect(response.body.processed).toBe(1);
      }
      const [before] = await db.all<{ capture_id: number | null }>(
        sql`SELECT capture_id FROM capture_share_tokens LIMIT 1`,
      );
      expect(before?.capture_id).toBeNull();

      const results = await Promise.all([
        postWhatsapp("Rua Concorrente A, 10"),
        postWhatsapp("Avenida Concorrente B, 20"),
      ]);
      expect(results.every((result) => result.status === 200)).toBe(true);
      expect(results.every((result) => result.body.processed === 1)).toBe(true);

      const captures = await db.all<{ id: number; street: string; number: string }>(
        sql`SELECT id, street, number FROM property_captures`,
      );
      expect(captures).toHaveLength(1);
      expect(["Rua Concorrente A", "Avenida Concorrente B"]).toContain(captures[0]?.street);
      const [share] = await db.all<{ capture_id: number | null; status: string }>(
        sql`SELECT capture_id, status FROM capture_share_tokens LIMIT 1`,
      );
      expect(share).toEqual({ capture_id: captures[0]?.id, status: "redeemed" });
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test("token vinculado retoma somente sua ficha mesmo quando outra ficha é a mais recente", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("graph.facebook.com")) {
        graphCalls.push({ url, body: String(init?.body ?? "") });
        return new Response(JSON.stringify({ messages: [{ id: "wamid.out.bound" }] }), { status: 200 });
      }
      return realFetch(input, init);
    }) as typeof fetch;

    try {
      app = new Hono();
      registerWebhookRoutes(app);
      const token = await issueCaptureShareToken(db, 1);
      behavior = async (call) => {
        const save = {
          rua: "Rua Vinculada",
          numero: "88",
          bairro: "Boqueirão",
          cidade: "Praia Grande",
          estado: "SP",
        };
        await call.tools.salvarCadastroVenda!.execute(save, toolOptions);
        return {
          text: "TEXTO DO MODELO (não deve ser enviado)",
          steps: [{ toolCalls: [{ toolName: "salvarCadastroVenda", input: save }] }],
        };
      };
      for (const text of [
        `LINK_CAPTACAO:${token}`,
        "proprietário",
        "Maria Souza",
        "Rua Vinculada, 88, Boqueirão, Praia Grande - SP",
      ]) {
        const response = await postWhatsapp(text);
        expect(response.status).toBe(200);
        expect(response.body.processed).toBe(1);
      }

      const [bound] = await db.all<{ id: number; owner_id: number; street: string; number: string }>(
        sql`SELECT id, owner_id, street, number FROM property_captures LIMIT 1`,
      );
      expect(bound?.street).toBe("Rua Vinculada");
      const [share] = await db.all<{ capture_id: number | null }>(
        sql`SELECT capture_id FROM capture_share_tokens LIMIT 1`,
      );
      expect(share?.capture_id).toBe(bound?.id);

      await db.run(sql`
        INSERT INTO property_captures
          (owner_id, city, address, street, number, source, stage, created_at, updated_at)
        VALUES
          (${bound!.owner_id}, 'Praia Grande', 'Avenida Sombra, 101', 'Avenida Sombra', '101',
           'manual', 'novo_contato', 0, 0)
      `);
      const [shadow] = await db.all<{ id: number; street: string; number: string }>(
        sql`SELECT id, street, number FROM property_captures WHERE id <> ${bound!.id} LIMIT 1`,
      );
      expect(shadow?.street).toBe("Avenida Sombra");

      const replay = await postWhatsapp(`LINK_CAPTACAO:${token}`);
      expect(replay.body.processed).toBe(1);
      const reply = JSON.parse(graphCalls.at(-1)!.body) as { text: { body: string } };
      expect(reply.text.body).toBe(Q_CONDOMINIO_PRESENCA);

      behavior = async (call) => {
        const hostileAddress = {
          rua: "Avenida Invasora",
          numero: "999",
          bairro: "Outro bairro",
          cidade: "Outra cidade",
          estado: "RJ",
        };
        await call.tools.salvarCadastroVenda!.execute(hostileAddress, toolOptions);
        return {
          text: "TEXTO DO MODELO (não deve ser enviado)",
          steps: [{ toolCalls: [{ toolName: "salvarCadastroVenda", input: hostileAddress }] }],
        };
      };
      await postWhatsapp("Avenida Invasora, 999, Outro bairro, Outra cidade - RJ");

      const captures = await db.all<{ id: number; street: string; number: string }>(
        sql`SELECT id, street, number FROM property_captures ORDER BY id`,
      );
      expect(captures).toHaveLength(2);
      expect(captures).toEqual([
        { id: bound!.id, street: "Rua Vinculada", number: "88" },
        { id: shadow!.id, street: "Avenida Sombra", number: "101" },
      ]);
      const [stillBound] = await db.all<{ capture_id: number | null; status: string }>(
        sql`SELECT capture_id, status FROM capture_share_tokens LIMIT 1`,
      );
      expect(stillBound).toEqual({ capture_id: bound!.id, status: "redeemed" });
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test("imagem real do WhatsApp conclui a captação no mesmo turno", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("media-facade-test")) {
        return new Response(JSON.stringify({
          url: "https://media.test/fachada.jpg",
          mime_type: "image/jpeg",
          file_size: 3,
        }), { status: 200 });
      }
      if (url === "https://media.test/fachada.jpg") {
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "content-type": "image/jpeg" },
        });
      }
      if (url.includes("graph.facebook.com")) {
        graphCalls.push({ url, body: String(init?.body ?? "") });
        return new Response(JSON.stringify({ messages: [{ id: "wamid.out.photo" }] }), { status: 200 });
      }
      return realFetch(input, init);
    }) as typeof fetch;

    try {
      app = new Hono();
      registerWebhookRoutes(app);
      const shareToken = await issueCaptureShareToken(db, 1);
      issuedShareTokens.push(shareToken);
      behavior = async (call) => {
        const last = call.messages.at(-1)?.content ?? "";
        const item = SCRIPT.find((step) => step.body === last);
        if (!item) return { text: "TEXTO DO MODELO (não deve ser enviado)", steps: [] };
        const saved = await call.tools.salvarCadastroVenda!.execute(item.save, toolOptions) as SaveResult;
        expect(saved.salvo).toBe(true, `salvamento do passo ${item.step}`);
        return {
          text: "TEXTO DO MODELO (não deve ser enviado)",
          steps: [{ toolCalls: [{ toolName: "salvarCadastroVenda", input: item.save }] }],
        };
      };
      const opened = await postWhatsapp(`LINK_CAPTACAO:${shareToken}`);
      expect(opened.status).toBe(200);
      expect(opened.body.processed).toBe(1);
      const unboundImageGraphCalls = graphCalls.length;
      const unboundImage = await postWhatsapp("", true);
      expect(unboundImage.status).toBe(200);
      expect(unboundImage.body.processed).toBe(1);
      expect(graphCalls).toHaveLength(unboundImageGraphCalls);
      const [unboundMedia] = await db.all<{ n: number }>(sql`SELECT COUNT(*) AS n FROM media`);
      expect(unboundMedia?.n).toBe(0);

      for (const text of ["proprietário", SCRIPT[0]!.body, SCRIPT[1]!.body]) {
        const response = await postWhatsapp(text);
        expect(response.status).toBe(200);
        expect(response.body.processed).toBe(1);
      }

      const [boundShare] = await db.all<{ capture_id: number | null; status: string }>(
        sql`SELECT capture_id, status FROM capture_share_tokens LIMIT 1`,
      );
      expect(boundShare?.status).toBe("redeemed");
      expect(boundShare?.capture_id).not.toBeNull();
      const [boundCapture] = await db.all<{ id: number; owner_photos: string | null }>(
        sql`SELECT id, owner_photos FROM property_captures LIMIT 1`,
      );
      expect(boundCapture?.id).toBe(boundShare?.capture_id);

      const replay = await postWhatsapp(`LINK_CAPTACAO:${shareToken}`);
      expect(replay.body.processed).toBe(1);
      const replayReply = JSON.parse(graphCalls.at(-1)!.body) as { text: { body: string } };
      expect(replayReply.text.body).toBe(Q_CONDOMINIO_PRESENCA);
      await postWhatsapp("proprietário");
      await postWhatsapp("Avenida invadida, 999, Boqueirão, Praia Grande - SP");
      expect(await counts()).toEqual({ owners: 1, captures: 1 });
      const [stillBound] = await db.all<{ capture_id: number | null }>(
        sql`SELECT capture_id FROM capture_share_tokens LIMIT 1`,
      );
      expect(stillBound?.capture_id).toBe(boundShare?.capture_id);

      const earlyImageGraphCalls = graphCalls.length;
      const earlyImage = await postWhatsapp("", true);
      expect(earlyImage.status).toBe(200);
      expect(earlyImage.body.processed).toBe(1);
      expect(graphCalls).toHaveLength(earlyImageGraphCalls);
      const [earlyMedia] = await db.all<{ n: number }>(sql`SELECT COUNT(*) AS n FROM media`);
      expect(earlyMedia?.n).toBe(0);
      const [beforePhoto] = await db.all<{ owner_photos: string | null }>(
        sql`SELECT owner_photos FROM property_captures WHERE id = ${boundCapture!.id}`,
      );
      expect(beforePhoto?.owner_photos).toBeNull();

      for (const step of SCRIPT.slice(2)) {
        const response = await postWhatsapp(step.body);
        expect(response.status).toBe(200);
        expect(response.body.processed).toBe(1);
      }
      const callsBefore = modelCalls;

      const received = await postWhatsapp("", true);

      expect(received.status).toBe(200);
      expect(received.body.processed).toBe(1);
      expect(modelCalls).toBe(callsBefore);
      const sent = JSON.parse(graphCalls.at(-1)!.body) as { text: { body: string } };
      expect(sent.text.body).toBe(Q_OBSERVACAO_FINAL);
      const [photoStageShare] = await db.all<{ status: string }>(
        sql`SELECT status FROM capture_share_tokens ORDER BY id LIMIT 1`,
      );
      expect(photoStageShare?.status).toBe("redeemed");
      await postWhatsapp("NÃO SEI");
      expect(JSON.parse(graphCalls.at(-1)!.body).text.body).toBe(FECHAMENTO);
      const capture = await onlyCapture();
      expect(capture.notes).toContain("Foto da fachada recebida");
      const [usedShare] = await db.all<{ status: string }>(
        sql`SELECT status, capture_id FROM capture_share_tokens ORDER BY id LIMIT 1`,
      );
      expect(usedShare?.status).toBe("completed");
      const [media] = await db.all<{ mime: string; size: number }>(
        sql`SELECT mime, size FROM media LIMIT 1`,
      );
      expect(media).toEqual({ mime: "image/jpeg", size: 3 });

      const repeat = await postWhatsapp("Quero cadastrar outro imóvel");
      expect(repeat.body.processed).toBe(1);
      const repeatedText = JSON.parse(graphCalls.at(-1)!.body) as { text: { body: string } };
      expect(repeatedText.text.body).toBe("Solicite outro link para cadastro.");
      expect(await counts()).toEqual({ owners: 1, captures: 1 });

      /* The public reusable phrase shares the exclusive link's complete route,
         including the authenticated facade image and final observation. */
      const genericSaveByText: Record<string, Record<string, unknown>> = {
        "Escritura registrada": { documentacao: "Escritura registrada" },
        "92 m²": { metragem: "92 m²" },
        "780 mil": { valorPretendido: 780000 },
        "R$ 850 de condomínio": { condominio: "R$ 850" },
        "IPTU R$ 1.200 por ano": { custos: "IPTU R$ 1.200/ano" },
      };
      behavior = async (call) => {
        const body = call.messages.at(-1)?.content ?? "";
        const save = genericSaveByText[body];
        if (!save) return { text: "TEXTO DO MODELO (não deve ser enviado)", steps: [] };
        const result = await call.tools.salvarCadastroVenda!.execute(save, toolOptions) as SaveResult;
        expect(result.salvo).toBe(true, `salvamento genérico ${body}`);
        return {
          text: "TEXTO DO MODELO (não deve ser enviado)",
          steps: [{ toolCalls: [{ toolName: "salvarCadastroVenda", input: save }] }],
        };
      };
      const callsBeforeUnsolicitedPhoto = graphCalls.length;
      const mediaBeforeUnsolicitedPhoto = await db.all<{ n: number }>(sql`SELECT COUNT(*) AS n FROM media`);
      const unsolicitedPhoto = await postWhatsapp("", true);
      expect(unsolicitedPhoto.body.processed).toBe(1);
      expect(graphCalls).toHaveLength(callsBeforeUnsolicitedPhoto);
      const mediaAfterUnsolicitedPhoto = await db.all<{ n: number }>(sql`SELECT COUNT(*) AS n FROM media`);
      expect(mediaAfterUnsolicitedPhoto[0]?.n).toBe(mediaBeforeUnsolicitedPhoto[0]?.n);

      const genericStart = await postWhatsapp(LINK_CAPTACAO_MESSAGE);
      expect(genericStart.body.processed).toBe(1);
      expect(JSON.parse(graphCalls.at(-1)!.body).text.body)
        .toBe(Q_PUBLIC_ENTRY);
      expect(await counts()).toEqual({ owners: 1, captures: 1 });
      const repeatedStart = await postWhatsapp(LINK_CAPTACAO_MESSAGE);
      expect(repeatedStart.body.processed).toBe(1);
      expect(JSON.parse(graphCalls.at(-1)!.body).text.body)
        .toBe(Q_PUBLIC_ENTRY);
      expect(await counts()).toEqual({ owners: 1, captures: 1 });

      for (const [text, expected] of [
        ["proprietário", "Qual é o seu nome completo?"],
        ["Ana Souza", Q_ENDERECO],
        ["Avenida Brasil, 210", Q_CONDOMINIO_PRESENCA],
        ["Sim", Q_NOME_CONDOMINIO],
        ["Residencial Brasil, apartamento 21", Q_DOCUMENTACAO],
      ] as const) {
        await postWhatsapp(text);
        expect(JSON.parse(graphCalls.at(-1)!.body).text.body).toBe(expected);
      }
      const [newCaptureAfterAddress] = await db.all<{ id: number; street: string | null }>(
        sql`SELECT id, street FROM property_captures ORDER BY id DESC LIMIT 1`,
      );
      expect(newCaptureAfterAddress?.id).not.toBe(boundCapture?.id);
      expect(newCaptureAfterAddress?.street).toBe("Avenida Brasil");
      expect(await counts()).toEqual({ owners: 1, captures: 2 });

      const genericAnswers: [string, string][] = [
        ["Escritura registrada", linkQuestion("tipo")],
        ["apartamento", linkQuestion("dormitorios")],
        ["3", linkQuestion("suites")],
        ["1", linkQuestion("banheiros")],
        ["2", linkQuestion("vagas")],
        ["1", linkQuestion("metragem")],
        ["92 m²", linkQuestion("valor")],
        ["780 mil", Q_CONDOMINIO],
        ["R$ 850 de condomínio", linkQuestion("custos")],
        ["IPTU R$ 1.200 por ano", Q_FOTO],
      ];
      for (const [text, expected] of genericAnswers) {
        await postWhatsapp(text);
        expect(JSON.parse(graphCalls.at(-1)!.body).text.body).toBe(expected);
      }
      const [progressiveCapture] = await db.all<{
        id: number;
        street: string | null;
        owner_photos: string | null;
        notes: string | null;
      }>(
        sql`SELECT id, street, owner_photos, notes FROM property_captures ORDER BY id DESC LIMIT 1`,
      );
      expect(progressiveCapture?.id).toBe(newCaptureAfterAddress?.id);
      expect(progressiveCapture?.owner_photos).toBeNull();
      expect(progressiveCapture?.notes).not.toContain("Foto da fachada recebida");
      expect(await counts()).toEqual({ owners: 1, captures: 2 });
      const [ownerBeforeConfirmation] = await db.all<{ notes: string | null }>(
        sql`SELECT notes FROM owners LIMIT 1`,
      );
      expect(ownerBeforeConfirmation?.notes)
        .toContain(`[LINK_CAPTACAO_FICHA_ATIVA:${newCaptureAfterAddress!.id}:`);

      const genuinePhoto = await postWhatsapp("", true);
      expect(genuinePhoto.body.processed).toBe(1);
      expect(JSON.parse(graphCalls.at(-1)!.body).text.body).toBe(Q_OBSERVACAO_FINAL);
      await postWhatsapp("NÃO SEI");
      expect(JSON.parse(graphCalls.at(-1)!.body).text.body).toBe(FECHAMENTO);
      const [confirmedCapture] = await db.all<{ notes: string | null }>(
        sql`SELECT notes FROM property_captures WHERE id = ${newCaptureAfterAddress!.id}`,
      );
      expect(confirmedCapture?.notes).toContain("- Confirmação final: OK");
      const [ownerAfterConfirmation] = await db.all<{ notes: string | null }>(
        sql`SELECT notes FROM owners LIMIT 1`,
      );
      expect(ownerAfterConfirmation?.notes ?? "").not.toContain("[LINK_CAPTACAO_FICHA_ATIVA:");
      const callsAfterClose = modelCalls;
      for (const message of ["oi", "oi", "Quero continuar o cadastro"]) {
        const followup = await postWhatsapp(message);
        expect(followup.body.processed).toBe(1);
        expect(JSON.parse(graphCalls.at(-1)!.body).text.body)
          .toBe("Solicite outro link para cadastro.");
        expect(modelCalls).toBe(callsAfterClose);
      }
      expect(await counts()).toEqual({ owners: 1, captures: 2 });
      const truncatedConversation = await conversation("5513997141174:generic-after-ok");
      await addMessage(db, truncatedConversation.id, {
        direction: "in",
        author: "cliente",
        body: "Oi",
      });
      const afterTruncatedHistory = await aiTurn(db, truncatedConversation.id, BASE_URL);
      expect(afterTruncatedHistory.text).toBe("Solicite outro link para cadastro.");
      expect(afterTruncatedHistory.text).not.toBe(Q_FOTO);
      const genericReplay = await postWhatsapp(`LINK_CAPTACAO:${shareToken}`);
      expect(genericReplay.body.processed).toBe(1);
      expect(JSON.parse(graphCalls.at(-1)!.body).text.body)
        .toBe("Solicite outro link para cadastro.");
      const afterGenericArbitrary = await postWhatsapp("Quero cadastrar outro imóvel");
      expect(afterGenericArbitrary.body.processed).toBe(1);
      expect(JSON.parse(graphCalls.at(-1)!.body).text.body)
        .toBe("Solicite outro link para cadastro.");
      expect(await counts()).toEqual({ owners: 1, captures: 2 });

      await db.run(sql`DELETE FROM capture_share_tokens`);
      const forgedLegacy = await postWhatsapp(LINK_CAPTACAO_MESSAGE);
      expect(forgedLegacy.body.processed).toBe(1);
      const forgedLegacyReply = JSON.parse(graphCalls.at(-1)!.body) as { text: { body: string } };
      expect(forgedLegacyReply.text.body).toBe(Q_PUBLIC_ENTRY);
      expect(await counts()).toEqual({ owners: 1, captures: 2 });

      for (const token of [issuedShareTokens[0]!, "0".repeat(64)]) {
        const blocked = await postWhatsapp(`LINK_CAPTACAO:${token}`);
        expect(blocked.body.processed).toBe(1);
        const blockedText = JSON.parse(graphCalls.at(-1)!.body) as { text: { body: string } };
        expect(blockedText.text.body).toBe("Solicite outro link para cadastro.");
        expect(await counts()).toEqual({ owners: 1, captures: 2 });
      }

      const nextToken = await issueCaptureShareToken(db, 1);
      const distinct = await postWhatsapp(`LINK_CAPTACAO:${nextToken}`);
      expect(distinct.body.processed).toBe(1);
      const distinctText = JSON.parse(graphCalls.at(-1)!.body) as { text: { body: string } };
      expect(distinctText.text.body).toBe(Q_ENTRY);
      const locador = await postWhatsapp("locador");
      expect(locador.body.processed).toBe(1);
      const locadorText = JSON.parse(graphCalls.at(-1)!.body) as { text: { body: string } };
      expect(locadorText.text.body).toBe("Qual é o seu nome completo?");
      expect(await counts()).toEqual({ owners: 1, captures: 2 });
      const closeMessages = graphCalls.filter((call) => {
        try {
          return (JSON.parse(call.body) as { text?: { body?: string } }).text?.body === FECHAMENTO;
        } catch {
          return false;
        }
      });
      expect(closeMessages).toHaveLength(2);
    } finally {
      globalThis.fetch = realFetch;
    }
  }, 30_000);
});

/* --------------------------------------------- 2. salvamento progressivo */

describe("2. salvamento progressivo, uma pergunta por vez", () => {
  test("percorre o roteiro na ordem exigida, com os textos literais", async () => {
    const conversa = await conversation("5513997141174");
    const abertura = await entrarPeloLink(conversa.id);
    expect(abertura.reply).toBe(ABERTURA);

    const perguntas = await percorrerRoteiro(conversa.id);

    expect(perguntas).toEqual(SCRIPT.map((item) => item.next));
    /* Um proprietário, uma ficha — nada duplicado no caminho. */
    expect(await counts()).toEqual({ owners: 1, captures: 1 });
  });

  test.each([
    ["Apto", "apartamento"],
    ["Apartamento", "apartamento"],
  ])("tipo curto %s é gravado sem repetir a pergunta", async (answer, expectedType) => {
    const conversa = await conversation("5513997141174");
    await entrarPeloLink(conversa.id);

    /* Avança até a pergunta de tipo usando o extrator já coberto pelo roteiro. */
    for (const item of SCRIPT.slice(0, 5)) {
      await linkTurn(conversa.id, item.body, item.save);
    }

    const callsBefore = modelCalls;
    const turn = await linkTurn(conversa.id, answer);

    expect(turn.replied).toBe(true);
    expect(turn.reply).toBe(linkQuestion("dormitorios"));
    expect(modelCalls).toBe(callsBefore);

    const ficha = await onlyCapture();
    expect(ficha.property_type).toBe(expectedType);
  });

  test("locador segue o roteiro e informa aluguel mensal, sem chamar IA para números curtos", async () => {
    const conversa = await conversation("5513997141174:locador");
    expect((await linkTurn(conversa.id, LINK_CAPTACAO_MESSAGE)).reply).toBe(
      Q_ENTRY,
    );
    expect((await linkTurn(conversa.id, "locador")).reply).toBe(ABERTURA);
    expect((await linkTurn(conversa.id, "Maria Souza")).reply).toBe(Q_ENDERECO);
    expect((await linkTurn(conversa.id, "Rua Guimarães Rosa 492")).reply).toBe(
      Q_CONDOMINIO_PRESENCA,
    );
    await linkTurn(conversa.id, SCRIPT[2]!.body, SCRIPT[2]!.save);
    await linkTurn(conversa.id, SCRIPT[3]!.body, SCRIPT[3]!.save);
    await linkTurn(conversa.id, SCRIPT[4]!.body, SCRIPT[4]!.save);
    expect((await linkTurn(conversa.id, "Apartamento")).reply).toBe(
      linkQuestion("dormitorios"),
    );

    const beforeNumbers = modelCalls;
    expect((await linkTurn(conversa.id, "3")).reply).toBe(linkQuestion("suites"));
    expect((await linkTurn(conversa.id, "1")).reply).toBe(linkQuestion("banheiros"));
    expect((await linkTurn(conversa.id, "2")).reply).toBe(linkQuestion("vagas"));
    expect((await linkTurn(conversa.id, "1")).reply).toBe(linkQuestion("metragem"));
    expect(modelCalls).toBe(beforeNumbers);

    const metragem = await linkTurn(conversa.id, "92 m²", { metragem: "92 m²" });
    expect(metragem.reply).toBe(
      "Qual é o valor mensal do aluguel pretendido? Se ainda não souber, digite NÃO SEI.",
    );
    const beforePrice = modelCalls;
    const aluguel = await linkTurn(conversa.id, "R$ 1.200,00");
    expect(aluguel.reply).toBe(linkQuestion("condominio"));
    expect(modelCalls).toBe(beforePrice);
    const ficha = await onlyCapture();
    expect(ficha.intention).toBe("locacao");
    expect(ficha.asking_price).toBe(1200);
  });

  test.each([
    ["SIM", Q_NOME_CONDOMINIO],
    ["NÃO", Q_DOCUMENTACAO],
    ["NÃO SEI", Q_DOCUMENTACAO],
  ])("resposta de presença do condomínio %s controla as perguntas seguintes", async (answer, expected) => {
    const conversa = await conversation(`5513997141174:condominio-${answer}`);
    await entrarPeloLink(conversa.id);
    await linkTurn(conversa.id, "Maria Souza");
    expect((await linkTurn(conversa.id, "Rua das Flores 88")).reply).toBe(Q_CONDOMINIO_PRESENCA);
    expect((await linkTurn(conversa.id, answer)).reply).toBe(expected);
    const saved = (await onlyCapture()).notes ?? "";
    expect(saved).toContain("Presença de condomínio");
  });

  test("cada resposta é gravada na hora, sem esperar o fim do roteiro", async () => {
    const conversa = await conversation("5513997141174");
    await entrarPeloLink(conversa.id);

    /* Nome: a ficha nasce aqui, já marcada como venda e com a origem do link. */
    await linkTurn(conversa.id, SCRIPT[0]!.body, SCRIPT[0]!.save);
    expect(await counts()).toEqual({ owners: 1, captures: 1 });
    let ficha = await onlyCapture();
    expect(ficha.intention).toBe("venda");
    expect(ficha.notes).toContain(`Origem do cadastro: ${LINK_CAPTACAO_ORIGIN}`);

    /* Endereço: gravado no mesmo cadastro, não em outro. */
    await linkTurn(conversa.id, SCRIPT[1]!.body, SCRIPT[1]!.save);
    ficha = await onlyCapture();
    expect(ficha.street).toBe("Rua Guimarães Rosa");
    expect(ficha.number).toBe("492");
    expect(ficha.district).toBe("Boqueirão");
    expect(ficha.city).toBe("Praia Grande");

    /* O fluxo grava condomínio/unidade antes de pedir documentação. */
    await linkTurn(conversa.id, SCRIPT[2]!.body, SCRIPT[2]!.save);
    await linkTurn(conversa.id, SCRIPT[3]!.body, SCRIPT[3]!.save);
    await linkTurn(conversa.id, SCRIPT[4]!.body, SCRIPT[4]!.save);
    ficha = await onlyCapture();
    expect(ficha.notes).toContain("Imóvel registrado em nome do proprietário: Escritura registrada");
    expect(ficha.complements).toContain("163");
    expect(await counts()).toEqual({ owners: 1, captures: 1 });
  });

  test("a ficha fica completa ao fim do roteiro, com tudo o que foi respondido", async () => {
    const conversa = await conversation("5513997141174");
    await entrarPeloLink(conversa.id);
    await percorrerRoteiro(conversa.id);

    const ficha = await onlyCapture();
    expect(ficha.property_type).toBe("apartamento");
    expect(ficha.intention).toBe("venda");
    expect(ficha.asking_price).toBe(780000);
    expect(ficha.completeness).toBeGreaterThan(50);
    expect(ficha.notes).toContain("[captacao-ia]");
    expect(ficha.notes).toContain(`Origem do cadastro: ${LINK_CAPTACAO_ORIGIN}`);
    /* Os rótulos do bloco vêm do roteiro já em uso no WhatsApp (CAPTURE_STEPS). */
    expect(ficha.notes).toContain(
      "Imóvel registrado em nome do proprietário: Escritura registrada",
    );
    expect(ficha.notes).toContain("Dormitórios: 3");
    expect(ficha.notes).toContain("Suítes: 1");
    expect(ficha.notes).toContain("Banheiros: 2");
    expect(ficha.notes).toContain("Vagas de garagem: 1");
    expect(ficha.notes).toContain("Metragem: 92 m²");
    expect(ficha.notes).toContain("Condomínio e unidade: R$ 850");
    expect(ficha.notes).toContain("IPTU R$ 1.200/ano");
  });

  test("a IA não escreve o texto do cliente: só as frases do roteiro saem", async () => {
    const conversa = await conversation("5513997141174");
    await entrarPeloLink(conversa.id);
    await percorrerRoteiro(conversa.id);

    const permitidas = new Set<string>([Q_ENTRY, ABERTURA, ...SCRIPT.map((item) => item.next)]);
    for (const message of await outbound(conversa.id)) {
      expect(permitidas.has(message.body), message.body).toBe(true);
      expect(message.body).not.toContain("TEXTO DO MODELO");
    }
  });
});

/* -------------------------------------------------------- 3. retomada */

describe("3. retomada pelo mesmo telefone", () => {
  test("volta dias depois, em outra conversa e sem clicar no link, na pergunta pendente", async () => {
    const primeira = await conversation("5513997141174");
    await entrarPeloLink(primeira.id);
    await linkTurn(primeira.id, SCRIPT[0]!.body, SCRIPT[0]!.save);
    await linkTurn(primeira.id, SCRIPT[1]!.body, SCRIPT[1]!.save);

    /* Outra thread do WhatsApp, mesmo telefone, sem o link: a origem gravada
       na ficha é o que mantém o fluxo. */
    const volta = await conversation("5513997141174:retorno");
    const retomada = await linkTurn(volta.id, "Oi, voltei para continuar");

    expect(retomada.skipped).toBeUndefined();
    /* Retoma no ponto exato: documentação, não o nome nem o endereço de novo. */
    expect(retomada.reply).toBe(Q_CONDOMINIO_PRESENCA);
    expect(await counts()).toEqual({ owners: 1, captures: 1 });
  });

  test("termina o roteiro depois da volta, sem duplicar proprietário nem ficha", async () => {
    const primeira = await conversation("5513997141174");
    await entrarPeloLink(primeira.id);
    await percorrerRoteiro(primeira.id, SCRIPT.slice(0, 5));

    const volta = await conversation("5513997141174:retorno");
    const perguntas = await percorrerRoteiro(volta.id, SCRIPT.slice(5));

    expect(perguntas).toEqual(SCRIPT.slice(5).map((item) => item.next));
    expect(await counts()).toEqual({ owners: 1, captures: 1 });
    const ficha = await onlyCapture();
    expect(ficha.asking_price).toBe(780000);
    expect(ficha.street).toBe("Rua Guimarães Rosa");
  });

  test("resposta que não informa nada mantém a mesma pergunta, sem avançar", async () => {
    const conversa = await conversation("5513997141174");
    await entrarPeloLink(conversa.id);
    await linkTurn(conversa.id, SCRIPT[0]!.body, SCRIPT[0]!.save);

    /* O extrator não grava nada: a pergunta pendente continua sendo a mesma. */
    const vazio = await linkTurn(conversa.id, "não entendi");
    expect(vazio.reply).toBe(Q_ENDERECO);

    const depois = await linkTurn(conversa.id, SCRIPT[1]!.body, SCRIPT[1]!.save);
    expect(depois.reply).toBe(Q_CONDOMINIO_PRESENCA);
    expect(await counts()).toEqual({ owners: 1, captures: 1 });
  });
});

/* ----------------------------------------------------- 4. frase neutra */

describe("4. pergunta fora do roteiro", () => {
  test("responde a frase neutra exata, volta à pergunta pendente e registra nas observações", async () => {
    const conversa = await conversation("5513997141174");
    await entrarPeloLink(conversa.id);
    await linkTurn(conversa.id, SCRIPT[0]!.body, SCRIPT[0]!.save);
    await linkTurn(conversa.id, SCRIPT[1]!.body, SCRIPT[1]!.save);

    const fora = await linkTurn(conversa.id, "Quanto vocês cobram de comissão na venda?", {
      observacao: "Perguntou a comissão cobrada na venda",
    });

    expect((await onlyCapture()).notes).toContain("Perguntou a comissão cobrada na venda");
    expect(fora.reply).toBe(`${NEUTRA}\n\n${Q_CONDOMINIO_PRESENCA}`);
    expect(OFF_SCRIPT_REPLY).toBe(NEUTRA);
    /* Nada de negociação, avaliação ou promessa na resposta. */
    expect(fora.reply).not.toMatch(/comiss[ãa]o|%|vale|garanto|prometo/i);

    const ficha = await onlyCapture();
    expect(ficha.notes).toContain("[captacao-ia]");
    expect(ficha.notes).toContain("comissão");

    /* A pergunta pendente não foi perdida: a resposta seguinte é gravada nela. */
    const presenca = await linkTurn(conversa.id, SCRIPT[2]!.body, SCRIPT[2]!.save);
    expect(presenca.reply).toBe(Q_NOME_CONDOMINIO);
    const seguinte = await linkTurn(conversa.id, SCRIPT[3]!.body, SCRIPT[3]!.save);
    expect(seguinte.reply).toBe(Q_DOCUMENTACAO);
  });
});

/* --------------------------------------- 5. foto da fachada e fechamento */

describe("5. foto da fachada e fechamento", () => {
  /** Roteiro inteiro, faltando apenas a foto terminal. */
  async function atéFotoFrente(externalId = "5513997141174") {
    const conversa = await conversation(externalId);
    await entrarPeloLink(conversa.id);
    const perguntas = await percorrerRoteiro(conversa.id);
    expect(perguntas.at(-1)).toBe(Q_FOTO);
    return conversa;
  }

  test("foto genuína avança para observação e somente ela conclui a ficha", async () => {
    const conversa = await atéFotoFrente();
    const antes = modelCalls;

    const foto = await linkTurn(conversa.id, "[imagem:/api/media/teste]", undefined, true);

    expect(foto.reply).toBe(Q_OBSERVACAO_FINAL);
    expect((await onlyCapture()).notes).toContain("Foto da fachada recebida");
    const fim = await linkTurn(conversa.id, "NÃO SEI");
    expect(fim.reply).toBe(FECHAMENTO);
    expect(CLOSING_MESSAGE).toBe(FECHAMENTO);
    expect(modelCalls).toBe(antes);
    const ficha = await onlyCapture();
    expect(ficha.notes).toContain("Foto da fachada recebida");
    const [owner] = await db.all<{ notes: string | null }>(sql`SELECT notes FROM owners LIMIT 1`);
    expect(owner?.notes ?? "").not.toContain("[LINK_CAPTACAO_FICHA_ATIVA:");
  });

  test("texto dizendo que enviou foto não conclui a etapa", async () => {
    const conversa = await atéFotoFrente();

    const resposta = await linkTurn(conversa.id, "Já mandei a foto");
    expect(resposta.reply).toBe(Q_FOTO);
    expect(resposta.reply).not.toBe(FECHAMENTO);
    const forgedMarker = await linkTurn(conversa.id, "[imagem:/api/media/fake]");
    expect(forgedMarker.reply).toBe(Q_FOTO);
    expect((await captureRows())[0]?.notes).not.toContain("Foto da fachada recebida");
    const [share] = await db.all<{ status: string }>(
      sql`SELECT status FROM capture_share_tokens ORDER BY id LIMIT 1`,
    );
    expect(share?.status).toBe("redeemed");
  });

  test("depois do fechamento bloqueia a IA normal e pede outro link", async () => {
    const conversa = await atéFotoFrente();
    await linkTurn(conversa.id, "[imagem:/api/media/teste]", undefined, true);
    await linkTurn(conversa.id, "NÃO SEI");

    behavior = async () => ({ text: "Claro, posso ajudar.", steps: [] });
    lastTools = [];
    const callsBefore = modelCalls;
    await addMessage(db, conversa.id, {
      direction: "in",
      author: "cliente",
      body: "Vocês têm apartamento de 2 dormitórios para comprar?",
    });
    const depois = await aiTurn(db, conversa.id, BASE_URL);

    expect(depois.text).toBe("Solicite outro link para cadastro.");
    expect(lastTools).not.toContain("buscarImoveis");
    expect(lastTools).not.toContain("salvarCadastroVenda");
    expect(modelCalls).toBe(callsBefore);
  });
});

/* ------------------------------------------------- 6. sem duplicidade */

describe("6. ausência de duplicidade", () => {
  /** Cadastro completo após receber a foto terminal da fachada. */
  async function primeiroImovelConcluido() {
    const conversa = await conversation("5513997141174");
    await entrarPeloLink(conversa.id);
    await percorrerRoteiro(conversa.id);
    const foto = await linkTurn(conversa.id, "[imagem:/api/media/teste]", undefined, true);
    expect(foto.reply).toBe(Q_OBSERVACAO_FINAL);
    const fim = await linkTurn(conversa.id, "NÃO SEI");
    expect(fim.reply).toBe(FECHAMENTO);
    return conversa;
  }

  test("a frase pública exata abre outra sessão após conclusão", async () => {
    await primeiroImovelConcluido();
    const volta = await conversation("5513997141174:segundo");

    const novo = await linkTurn(volta.id, LINK_CAPTACAO_MESSAGE);

    expect(novo.reply).toBe(Q_PUBLIC_ENTRY);
    expect(await counts()).toEqual({ owners: 1, captures: 1 });
  });

  test("token de entrada distinto permite futura retomada de outro cadastro", async () => {
    await primeiroImovelConcluido();
    const volta = await conversation("5513997141174:segundo");

    const novo = await linkTurn(volta.id, "LINK_CAPTACAO:cadastro-distinto-123");

    expect(novo.reply).toBe(Q_ENTRY);
    expect((await linkTurn(volta.id, "proprietário")).reply).toBe(ABERTURA);
    expect((await linkTurn(volta.id, "Maria Souza")).reply).toBe(Q_ENDERECO);
    expect(await counts()).toEqual({ owners: 1, captures: 1 });
  });

  test("mesmo prédio com unidade diferente é outro imóvel", async () => {
    await primeiroImovelConcluido();
    const volta = await conversation("5513997141174:segundo");
    await linkTurn(volta.id, "LINK_CAPTACAO:cadastro-distinto-123");
    await linkTurn(volta.id, "proprietário");
    await linkTurn(volta.id, "Maria Souza");

    const endereco = await linkTurn(
      volta.id,
      "Rua Guimarães Rosa, 492, Boqueirão, Praia Grande - SP, apartamento 205",
      {
        rua: "Rua Guimarães Rosa",
        numero: "492",
        bairro: "Boqueirão",
        cidade: "Praia Grande",
        estado: "SP",
        cep: "11701-000",
        unidade: "205",
      },
    );

    expect(endereco.saved?.salvo).toBe(true);
    expect(endereco.reply).toBe(Q_CONDOMINIO_PRESENCA);
    /* Um proprietário, dois imóveis: a unidade é o que os separa. */
    expect(await counts()).toEqual({ owners: 1, captures: 2 });
    const [primeiro, segundo] = await captureRows();
    expect(primeiro!.complements).toContain("163");
    expect(segundo!.complements).toContain("205");
    expect(segundo!.intention).toBe("venda");
    expect(segundo!.notes).toContain(`Origem do cadastro: ${LINK_CAPTACAO_ORIGIN}`);
  });

  test("o MESMO imóvel informado de novo não abre segunda ficha", async () => {
    await primeiroImovelConcluido();
    const volta = await conversation("5513997141174:segundo");
    await linkTurn(volta.id, "LINK_CAPTACAO:cadastro-distinto-123");
    await linkTurn(volta.id, "proprietário");
    await linkTurn(volta.id, "Maria Souza");

    /* Mesmo endereço e mesma unidade do cadastro que já existe. */
    const repetido = await linkTurn(volta.id, SCRIPT[1]!.body, {
      ...SCRIPT[1]!.save,
      unidade: "163",
      bloco: "B",
    });

    expect(repetido.saved?.salvo).toBe(true);
    expect((await counts()).captures).toBe(1);
  });

  test("não abre um segundo imóvel enquanto o primeiro está incompleto", async () => {
    const conversa = await conversation("5513997141174");
    await entrarPeloLink(conversa.id);
    await percorrerRoteiro(conversa.id, SCRIPT.slice(0, 2));

    /* Cadastro em andamento: o roteiro continua no imóvel atual. */
    const turn = await linkTurn(conversa.id, "Tenho outro imóvel para cadastrar também", {
      observacao: "Proprietário tem outro imóvel para cadastrar",
    });

    expect(turn.reply).toBe(`${NEUTRA}\n\n${Q_CONDOMINIO_PRESENCA}`);
    expect(await counts()).toEqual({ owners: 1, captures: 1 });
  });
});

describe("7. respostas após a identificação no link genérico", () => {
  test("frase pública sem token encerra e repete somente a orientação de outro link", async () => {
    const conversa = await conversation("5513997141174:publico-sem-token");
    expect((await genericPublicTurn(conversa.id, LINK_CAPTACAO_MESSAGE)).reply).toBe(Q_PUBLIC_ENTRY);
    expect((await genericPublicTurn(conversa.id, "proprietário")).reply).toBe(ABERTURA);
    for (const item of SCRIPT) {
      expect((await genericPublicTurn(conversa.id, item.body, item.save)).reply).toBe(item.next);
    }
    expect((await genericPublicTurn(conversa.id, "[imagem:/api/media/teste]", undefined, true)).reply)
      .toBe(Q_OBSERVACAO_FINAL);
    expect((await genericPublicTurn(conversa.id, "NÃO SEI")).reply).toBe(FECHAMENTO);
    const callsAfterClose = modelCalls;
    for (const message of ["oi", "oi", "Quero continuar"]) {
      expect((await genericPublicTurn(conversa.id, message)).reply)
        .toBe("Solicite outro link para cadastro.");
      expect(modelCalls).toBe(callsAfterClose);
    }
    expect(await counts()).toEqual({ owners: 1, captures: 1 });
  });

  test("fechamento no histórico bloqueia a IA mesmo sem ficha selecionada", async () => {
    const conversa = await conversation("5513997141174:fechamento-sem-ficha");
    await addMessage(db, conversa.id, {
      direction: "out", author: "ia", body: FECHAMENTO,
    });
    const callsBefore = modelCalls;
    for (const message of ["oi", "oi de novo", "Quero continuar"]) {
      await addMessage(db, conversa.id, {
        direction: "in", author: "cliente", body: message,
      });
      expect((await aiTurn(db, conversa.id, BASE_URL)).text)
        .toBe("Solicite outro link para cadastro.");
      expect(modelCalls).toBe(callsBefore);
    }
  });

  async function iniciarCadastro(conversationId: number) {
    expect((await linkTurn(conversationId, LINK_CAPTACAO_MESSAGE)).reply).toBe(
      Q_ENTRY,
    );
    expect((await linkTurn(conversationId, "proprietário")).reply).toBe(
      linkQuestion("nome"),
    );
    expect((await linkTurn(conversationId, "ana exemplo")).reply).toBe(
      linkQuestion("endereco"),
    );
  }

  test("entrada pública conclui apenas o rascunho e deixa intacto token resgatado não relacionado", async () => {
    const conversa = await conversation("5513997141174:publico-token-nao-relacionado");
    expect((await genericPublicTurn(conversa.id, LINK_CAPTACAO_MESSAGE)).reply).toBe(Q_PUBLIC_ENTRY);
    expect((await genericPublicTurn(conversa.id, "proprietário")).reply).toBe(linkQuestion("nome"));
    for (const item of SCRIPT) {
      await genericPublicTurn(conversa.id, item.body, item.save);
    }
    expect((await genericPublicTurn(conversa.id, "[imagem:/api/media/fachada]", undefined, true)).reply)
      .toBe(Q_OBSERVACAO_FINAL);

    const turns = await conversationTurns(db, conversa.id);
    const publicState = await linkCaptacaoState(db, PHONE, turns);
    expect(publicState?.genericPublic).toBe(true);
    expect(publicState?.nextStep).toBe("observacaoFinal");

    const unrelatedToken = await issueCaptureShareToken(db, 1);
    expect((await redeemCaptureShareToken(db, unrelatedToken, PHONE)).ok).toBe(true);
    const [unrelatedRow] = await db.all<{ id: number }>(
      sql`SELECT id FROM capture_share_tokens ORDER BY id DESC LIMIT 1`,
    );
    expect(await bindCaptureShareToCapture(db, PHONE, 999)).toMatchObject({ ok: true });

    const [agent] = await db.select().from(schema.aiAgents).limit(1);
    const result = await linkCaptacaoReply(
      db,
      agent!,
      [...turns, { role: "user", content: "A varanda foi reformada recentemente." }],
      PHONE,
      publicState!,
    );
    expect(result.text).toBe(CLOSING_MESSAGE);
    expect(await latestCaptureShareForSender(db, PHONE)).toMatchObject({
      id: unrelatedRow.id,
      captureId: 999,
      status: "redeemed",
    });
  });

  test("entrada pública posterior abre imóvel separado sem alterar token resgatado anterior", async () => {
    const conversa = await conversation("5513997141174:publico-depois-token");
    await addMessage(db, conversa.id, {
      direction: "out",
      author: "assistant",
      body: CLOSING_MESSAGE,
    });
    expect((await linkTurn(conversa.id, LINK_CAPTACAO_MESSAGE)).reply).toBe(Q_ENTRY);
    expect(await bindCaptureShareToCapture(db, PHONE, 999)).toMatchObject({ ok: true });
    const [tokenBefore] = await db.all<{ id: number; capture_id: number | null; status: string }>(
      sql`SELECT id, capture_id, status FROM capture_share_tokens ORDER BY id DESC LIMIT 1`,
    );
    expect(typeof tokenBefore?.id).toBe("number");
    expect(tokenBefore?.capture_id).toBe(999);
    expect(tokenBefore?.status).toBe("redeemed");

    expect((await genericPublicTurn(conversa.id, LINK_CAPTACAO_MESSAGE)).reply).toBe(Q_PUBLIC_ENTRY);
    expect((await genericPublicTurn(conversa.id, "proprietário")).reply).toBe(linkQuestion("nome"));
    for (const item of SCRIPT) {
      const body = item.step === "endereco"
        ? "Avenida Independência, 700, Canto do Forte, Praia Grande - SP"
        : item.body;
      const save = item.step === "endereco"
        ? {
            ...item.save,
            rua: "Avenida Independência",
            numero: "700",
            bairro: "Canto do Forte",
          }
        : item.save;
      expect((await genericPublicTurn(conversa.id, body, save)).reply, item.step).toBe(item.next);
    }
    expect((await genericPublicTurn(
      conversa.id,
      "[imagem:/api/media/fachada-publica]",
      undefined,
      true,
    )).reply).toBe(Q_OBSERVACAO_FINAL);
    expect((await genericPublicTurn(conversa.id, "NÃO SEI")).reply).toBe(FECHAMENTO);

    const [tokenAfter] = await db.all<{ id: number; capture_id: number | null; status: string }>(
      sql`SELECT id, capture_id, status FROM capture_share_tokens ORDER BY id DESC LIMIT 1`,
    );
    const captures = await captureRows();
    expect(tokenAfter).toEqual(tokenBefore);
    expect(captures).toHaveLength(1);
    const publicCapture = captures[0];
    expect(publicCapture?.street).toBe("Avenida Independência");
    expect(publicCapture?.id).not.toBe(tokenBefore!.capture_id);
  });

  test("corretora segue para identificação profissional, sem abrir ficha de proprietário", async () => {
    const conversa = await conversation("5513997141174:corretora");
    await linkTurn(conversa.id, LINK_CAPTACAO_MESSAGE);
    const perfil = await linkTurn(conversa.id, "corretora");

    expect(perfil.reply).toBe("Qual é o seu CRECI?");
    expect(await counts()).toEqual({ owners: 0, captures: 0 });
  });

  test("encerramento público do corretor permanece fechado com histórico completo, truncado e conversa nova", async () => {
    const conversa = await conversation("corretor-publico-encerramento");
    await db.run(sql`INSERT INTO owners (name, phone, notes, created_at)
      VALUES ('Dono anterior', ${PHONE}, 'nota preservada', 0)`);
    await db.run(sql`INSERT INTO property_captures
      (owner_id, city, address, street, notes, created_at, updated_at)
      VALUES (1, 'Praia Grande', 'Rua Antiga, 10', 'Rua Antiga', 'ficha preservada', 0, 0)`);
    const ownersBefore = await db.all(sql`SELECT * FROM owners`);
    const capturesBefore = await db.all(sql`SELECT * FROM property_captures`);
    const journey: [string, string][] = [
      [LINK_CAPTACAO_MESSAGE, Q_PUBLIC_ENTRY],
      ["corretor", "Qual é o seu CRECI?"],
      ["134718-F", ABERTURA],
      ["Corretor de Teste", "O imóvel é para venda ou locação?"],
      ["locação", "Qual é o nome do proprietário do imóvel, se souber? Responda NÃO SEI se não souber."],
      ["Dona de Teste", Q_ENDERECO],
      ["Rua das Flores 88", Q_CONDOMINIO_PRESENCA],
      ["não", Q_DOCUMENTACAO],
      ["Escritura registrada", linkQuestion("tipo")],
      ["terreno", linkQuestion("caracteristicas")],
      ["10 x 40 metros", linkQuestion("valor", { intention: "locacao" })],
      ["R$ 2.000 mensais", linkQuestion("custos")],
      ["R$ 100", Q_FOTO],
      ["NÃO SEI", Q_OBSERVACAO_FINAL],
      ["Sem observações", BROKER_LEAD_CLOSING_MESSAGE],
    ];
    const transcript: { entrada: string; saida: string | undefined }[] = [];
    for (const [answer, expected] of journey) {
      const result = await genericPublicTurn(conversa.id, answer);
      transcript.push({ entrada: answer, saida: result.reply });
      expect(result.reply).toBe(expected);
    }
    const { loadLatestBrokerLeadDraft } = await import("./broker-lead-draft");
    const closed = await loadLatestBrokerLeadDraft(db, PHONE, "generic");
    expect(closed?.status).toBe("complete");
    expect(closed?.answers).toMatchObject({
      role: "corretor", creci: "134718-F", nome: "Corretor de Teste",
      intencao: "locacao", proprietarioNome: "Dona de Teste",
      endereco: "Rua das Flores 88", condominioPresenca: "não",
      documentacao: "Escritura registrada", tipo: "terreno",
      caracteristicas: "10 x 40 metros", valor: "R$ 2.000 mensais",
      custos: "R$ 100", fotoFrente: "NÃO SEI", observacaoFinal: "Sem observações",
    });
    const callsBefore = modelCalls;
    expect((await genericPublicTurn(conversa.id, "oi")).reply).toBe("Solicite outro link para cadastro.");
    const [agent] = await db.select().from(schema.aiAgents).limit(1);
    for (const turns of [
      [{ role: "assistant" as const, content: BROKER_LEAD_CLOSING_MESSAGE }, { role: "user" as const, content: "Quero continuar" }],
      [{ role: "user" as const, content: "oi" }],
    ]) {
      const state = await linkCaptacaoState(db, PHONE, turns);
      expect(state?.presenter).toBe("corretor");
      expect(state?.completionGuard).toBe(true);
      expect(state?.nextQuestion).toBeNull();
      expect((await linkCaptacaoReply(db, agent!, turns, PHONE, state!)).text)
        .toBe("Solicite outro link para cadastro.");
    }
    const retorno = await conversation("corretor-publico-conversa-nova");
    expect((await genericPublicTurn(retorno.id, "oi")).reply).toBe("Solicite outro link para cadastro.");
    expect(modelCalls).toBe(callsBefore);
    expect(await db.all(sql`SELECT * FROM owners`)).toEqual(ownersBefore);
    expect(await db.all(sql`SELECT * FROM property_captures`)).toEqual(capturesBefore);
    expect(await loadLatestBrokerLeadDraft(db, PHONE, "generic")).toEqual(closed);
    expect(await db.all(sql`SELECT id FROM capture_share_tokens`)).toHaveLength(0);
    const finalMessages = (await conversationTurns(db, conversa.id))
      .filter((turn) => turn.role === "assistant" && turn.content === BROKER_LEAD_CLOSING_MESSAGE);
    expect(finalMessages).toHaveLength(1);
    console.log("FLUXO_CORRETOR_LITERAL", JSON.stringify(transcript));
  }, 60000);

  test("encerramento público do locador preserva dados e não reabre depois da conclusão", async () => {
    const conversa = await conversation("locador-publico-encerramento");
    await db.run(sql`INSERT INTO owners (name, phone, notes, created_at)
      VALUES ('Maria Souza', ${PHONE}, 'nota anterior preservada', 0)`);
    await db.run(sql`INSERT INTO property_captures
      (owner_id, city, address, street, notes, registration_status, created_at, updated_at)
      VALUES (1, 'Praia Grande', 'Rua Anterior, 10', 'Rua Anterior', 'cadastro anterior preservado', 'CONCLUIDO', 0, 0)`);
    const oldCapture = await db.all(sql`SELECT * FROM property_captures WHERE id = 1`);
    const transcript: { entrada: string; saida: string | undefined }[] = [];
    const submit = async (body: string, expected: string, save?: Record<string, unknown>) => {
      const result = await genericPublicTurn(conversa.id, body, save, body.startsWith("[imagem:"));
      transcript.push({ entrada: body, saida: result.reply });
      expect(result.reply).toBe(expected);
    };
    await submit(LINK_CAPTACAO_MESSAGE, Q_PUBLIC_ENTRY);
    await submit("locador", ABERTURA);
    for (const item of SCRIPT) {
      const body = item.step === "valor" ? "R$ 2.500 mensais" : item.body;
      const save = item.step === "valor" ? { valorPretendido: 2500 } : item.save;
      const next = item.step === "metragem"
        ? linkQuestion("valor", { intention: "locacao" })
        : item.next;
      await submit(body, next, save);
    }
    await submit("[imagem:https://cdn.example.test/locador-fachada.jpg]", Q_OBSERVACAO_FINAL);
    await submit("Locação anual. Sem outras observações.", FECHAMENTO);
    const fichas = await captureRows();
    expect(fichas).toHaveLength(2);
    const ficha = fichas[1]!;
    expect(await db.all(sql`SELECT * FROM property_captures WHERE id = 1`)).toEqual(oldCapture);
    expect(ficha.intention).toBe("locacao");
    expect(ficha.asking_price).toBe(2500);
    expect(ficha.property_type).toBe("apartamento");
    const { captureSnapshot } = await import("./owner-capture");
    const snapshot = await captureSnapshot(db, PHONE);
    expect(snapshot.answers).toMatchObject({
      origem: LINK_CAPTACAO_ORIGIN, condominioPresenca: "yes",
      dormitorios: "3", suites: "1",
      banheiros: "2", vagas: "1", metragem: "92 m²",
      documentacao: "Escritura registrada no nome do proprietário",
      condominio: "R$ 850", custos: "IPTU R$ 1.200/ano",
      fotoFrente: "Foto da fachada recebida",
      observacaoFinal: "Locação anual. Sem outras observações.",
      confirmacaoFinal: "OK",
    });
    expect(snapshot.captureId).toBe(ficha.id);
    const state = await linkCaptacaoState(db, PHONE, await conversationTurns(db, conversa.id));
    expect(state?.complete).toBe(true);
    expect(state?.nextQuestion).toBeNull();
    const ownersBefore = await db.all(sql`SELECT * FROM owners`);
    const capturesBefore = await db.all(sql`SELECT * FROM property_captures`);
    const callsBefore = modelCalls;
    for (const message of ["oi", "Quero continuar", "locador"]) {
      expect((await genericPublicTurn(conversa.id, message)).reply).toBe("Solicite outro link para cadastro.");
    }
    const retorno = await conversation("locador-publico-conversa-nova");
    expect((await genericPublicTurn(retorno.id, "oi")).reply).toBe("Solicite outro link para cadastro.");
    expect(await db.all(sql`SELECT * FROM owners`)).toEqual(ownersBefore);
    expect(await db.all(sql`SELECT * FROM property_captures`)).toEqual(capturesBefore);
    expect(modelCalls).toBe(callsBefore);
    expect(await counts()).toEqual({ owners: 1, captures: 2 });
    expect(await db.all(sql`SELECT id FROM capture_share_tokens`)).toHaveLength(0);
    expect((await outbound(conversa.id)).filter((message) => message.body === FECHAMENTO)).toHaveLength(1);
    console.log("FLUXO_LOCADOR_LITERAL", JSON.stringify(transcript));
  }, 60000);

  test("locador público retoma a etapa pendente em outra conversa sem abrir outra ficha", async () => {
    const inicio = await conversation("locador-publico-incompleto");
    expect((await genericPublicTurn(inicio.id, LINK_CAPTACAO_MESSAGE)).reply).toBe(Q_PUBLIC_ENTRY);
    expect((await genericPublicTurn(inicio.id, "locador")).reply).toBe(ABERTURA);
    expect((await genericPublicTurn(inicio.id, SCRIPT[0]!.body, SCRIPT[0]!.save)).reply).toBe(Q_ENDERECO);
    expect((await genericPublicTurn(inicio.id, SCRIPT[1]!.body, SCRIPT[1]!.save)).reply).toBe(Q_CONDOMINIO_PRESENCA);
    const antes = await onlyCapture();
    const retorno = await conversation("locador-publico-retomada");
    expect((await genericPublicTurn(retorno.id, "sim")).reply).toBe(Q_NOME_CONDOMINIO);
    const depois = await onlyCapture();
    expect(depois.id).toBe(antes.id);
    expect(depois.intention).toBe("locacao");
    const state = await linkCaptacaoState(db, PHONE, await conversationTurns(db, retorno.id));
    expect(state?.complete).toBe(false);
    expect(state?.completionGuard).toBe(false);
    expect(state?.nextQuestion).toBe(Q_NOME_CONDOMINIO);
  }, 60000);

  test("corretor preenche questionário de lead sem criar ficha nem proprietário", async () => {
    const conversa = await conversation("5513997141174:corretor-nome");
    expect((await linkTurn(conversa.id, LINK_CAPTACAO_MESSAGE)).reply).toBe(
      Q_ENTRY,
    );
    expect((await linkTurn(conversa.id, "corretor")).reply).toBe("Qual é o seu CRECI?");
    expect((await linkTurn(conversa.id, "134718-F")).reply).toBe("Qual é o seu nome completo?");

    const depoisDoNome = await linkTurn(conversa.id, "Edson Muniz");
    expect(depoisDoNome.reply).toBe("O imóvel é para venda ou locação?");
    expect(await counts()).toEqual({ owners: 0, captures: 0 });
    expect((await linkTurn(conversa.id, "locação")).reply)
      .toBe("Qual é o nome do proprietário do imóvel, se souber? Responda NÃO SEI se não souber.");
    expect((await linkTurn(conversa.id, "Maria Souza")).reply).toBe(Q_ENDERECO);
    expect((await linkTurn(conversa.id, "Rua das Flores 88")).reply).toBe(Q_CONDOMINIO_PRESENCA);
    expect((await linkTurn(conversa.id, "sim")).reply).toBe(Q_NOME_CONDOMINIO);
    expect((await linkTurn(conversa.id, "Residencial Flores, unidade 12")).reply).toBe(Q_DOCUMENTACAO);
    expect((await linkTurn(conversa.id, "Escritura registrada")).reply).toBe(linkQuestion("tipo"));
    expect((await linkTurn(conversa.id, "apartamento")).reply).toBe(linkQuestion("dormitorios"));
    expect((await linkTurn(conversa.id, "2")).reply).toBe(linkQuestion("suites"));
    expect((await linkTurn(conversa.id, "1")).reply).toBe(linkQuestion("banheiros"));
    expect((await linkTurn(conversa.id, "2")).reply).toBe(linkQuestion("vagas"));
    expect((await linkTurn(conversa.id, "1")).reply).toBe(linkQuestion("metragem"));
    expect((await linkTurn(conversa.id, "75 m²")).reply).toBe(linkQuestion("valor", { intention: "locacao" }));
    expect((await linkTurn(conversa.id, "R$ 2.500")).reply).toBe(Q_CONDOMINIO);
    expect((await linkTurn(conversa.id, "R$ 450")).reply).toBe(linkQuestion("custos"));
    expect((await linkTurn(conversa.id, "R$ 120")).reply).toBe(Q_FOTO);
    expect((await linkTurn(conversa.id, "NÃO SEI")).reply).toBe(Q_OBSERVACAO_FINAL);
    expect((await linkTurn(conversa.id, "O imóvel tem varanda gourmet.")).reply)
      .toBe(BROKER_LEAD_CLOSING_MESSAGE);
    expect(await counts()).toEqual({ owners: 0, captures: 0 });
    expect(modelCalls).toBe(0);
    expect(await latestCaptureShareForSender(db, PHONE)).toMatchObject({
      captureId: null,
      status: "completed",
    });
    const replayTurns = [
      ...await conversationTurns(db, conversa.id),
      { role: "user" as const, content: `LINK_CAPTACAO:${issuedShareTokens[0]}` },
    ];
    const replayState = await linkCaptacaoState(db, PHONE, replayTurns);
    expect(replayState?.completionGuard).toBe(true);
    const [agent] = await db.select().from(schema.aiAgents).limit(1);
    const replayReply = await linkCaptacaoReply(db, agent!, replayTurns, PHONE, replayState!);
    expect(replayReply.text).toBe("Solicite outro link para cadastro.");
  });

  test("rascunho do corretor retoma após truncamento das 60 mensagens", async () => {
    const conversa = await conversation("5513997141174:corretor-rascunho-truncado");
    expect((await linkTurn(conversa.id, LINK_CAPTACAO_MESSAGE)).reply).toBe(Q_ENTRY);
    expect((await linkTurn(conversa.id, "corretor")).reply).toBe("Qual é o seu CRECI?");
    expect((await linkTurn(conversa.id, "134718-F")).reply).toBe("Qual é o seu nome completo?");
    expect((await linkTurn(conversa.id, "Edson Muniz")).reply).toBe("O imóvel é para venda ou locação?");

    for (let index = 0; index < 65; index++) {
      await addMessage(db, conversa.id, {
        direction: "in",
        author: "cliente",
        body: `Esclarecimento lateral ${index}`,
      });
      await addMessage(db, conversa.id, {
        direction: "out",
        author: "ia",
        body: "Pode me contar mais?",
      });
    }

    expect((await linkTurn(conversa.id, "locação")).reply)
      .toBe("Qual é o nome do proprietário do imóvel, se souber? Responda NÃO SEI se não souber.");
    expect(await counts()).toEqual({ owners: 0, captures: 0 });
    const [draftLead] = await db.all<{ lead_id: number }>(
      sql`SELECT lead_id FROM lead_notes WHERE body LIKE '[broker-lead-draft:v1]%' ORDER BY id DESC LIMIT 1`,
    );
    expect(draftLead?.lead_id).toBeDefined();
    const [draftCount] = await db.all<{ n: number }>(
      sql`SELECT COUNT(*) AS n FROM lead_notes WHERE body LIKE '[broker-lead-draft:v1]%'`,
    );
    expect(draftCount?.n).toBe(5);
  });

  test("rascunho ativo do corretor retoma em outra conversa do mesmo telefone", async () => {
    const primeira = await conversation("5513997141174:corretor-primeira-conversa");
    expect((await linkTurn(primeira.id, LINK_CAPTACAO_MESSAGE)).reply).toBe(Q_ENTRY);
    expect((await linkTurn(primeira.id, "corretor")).reply).toBe("Qual é o seu CRECI?");
    expect((await linkTurn(primeira.id, "134718-F")).reply).toBe("Qual é o seu nome completo?");

    const retorno = await conversation("5513997141174:corretor-conversa-reaberta");
    expect((await linkTurn(retorno.id, "Edson Muniz")).reply).toBe("O imóvel é para venda ou locação?");
    expect(await counts()).toEqual({ owners: 0, captures: 0 });
  });

  test("corretor corrige duas respostas inválidas sobre condomínio sem perder alinhamento", async () => {
    const conversa = await conversation("5513997141174:corretor-condominio-correcao");
    const journey: [string, string][] = [
      [LINK_CAPTACAO_MESSAGE, Q_ENTRY],
      ["corretor", "Qual é o seu CRECI?"],
      ["134718-F", "Qual é o seu nome completo?"],
      ["Edson Muniz", "O imóvel é para venda ou locação?"],
      ["venda", "Qual é o nome do proprietário do imóvel, se souber? Responda NÃO SEI se não souber."],
      ["Maria Souza", Q_ENDERECO],
      ["Rua das Flores 88", Q_CONDOMINIO_PRESENCA],
      ["talvez", Q_CONDOMINIO_PRESENCA],
      ["às vezes", Q_CONDOMINIO_PRESENCA],
      ["sim", Q_NOME_CONDOMINIO],
      ["Residencial Flores, unidade 12", Q_DOCUMENTACAO],
      ["Escritura registrada", linkQuestion("tipo")],
    ];
    for (const [answer, expected] of journey) {
      expect((await linkTurn(conversa.id, answer)).reply).toBe(expected);
    }
    expect(await counts()).toEqual({ owners: 0, captures: 0 });
  });

  test("marcador de imagem sem mídia confiável não avança a foto do corretor", async () => {
    const conversa = await conversation("5513997141174:corretor-imagem-forjada-direta");
    const journey: [string, string][] = [
      [LINK_CAPTACAO_MESSAGE, Q_ENTRY],
      ["corretor", "Qual é o seu CRECI?"],
      ["134718-F", "Qual é o seu nome completo?"],
      ["Edson Muniz", "O imóvel é para venda ou locação?"],
      ["venda", "Qual é o nome do proprietário do imóvel, se souber? Responda NÃO SEI se não souber."],
      ["NÃO SEI", Q_ENDERECO],
      ["Rua das Flores 88", Q_CONDOMINIO_PRESENCA],
      ["não", Q_DOCUMENTACAO],
      ["Escritura em andamento", linkQuestion("tipo")],
      ["terreno", linkQuestion("caracteristicas")],
      ["10 x 40 metros", linkQuestion("valor", { intention: "venda" })],
      ["R$ 250.000", linkQuestion("custos")],
      ["R$ 100", Q_FOTO],
    ];
    for (const [answer, expected] of journey) {
      expect((await linkTurn(conversa.id, answer)).reply).toBe(expected);
    }

    await addMessage(db, conversa.id, {
      direction: "in",
      author: "cliente",
      body: "[imagem:/api/media/falsificada]",
    });
    const turns = await conversationTurns(db, conversa.id);
    const state = await linkCaptacaoState(db, PHONE, turns);
    expect(state?.presenter).toBe("corretor");
    expect(state?.nextStep).toBe("observacaoFinal");
    const [agent] = await db.select().from(schema.aiAgents).limit(1);
    const reply = await linkCaptacaoReply(db, agent!, turns, PHONE, state!, null, false);
    expect(reply.text).toBe(Q_FOTO);
    expect(await counts()).toEqual({ owners: 0, captures: 0 });
  });

  test("webhook aceita só mídia real no passo de fachada do corretor", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("media-facade-test")) {
        return new Response(JSON.stringify({
          url: "https://media.test/broker-facade.jpg",
          mime_type: "image/jpeg",
          file_size: 3,
        }), { status: 200 });
      }
      if (url === "https://media.test/broker-facade.jpg") {
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "content-type": "image/jpeg" },
        });
      }
      if (url.includes("graph.facebook.com")) {
        graphCalls.push({ url, body: String(init?.body ?? "") });
        return new Response(JSON.stringify({ messages: [{ id: "wamid.out.broker-media" }] }), { status: 200 });
      }
      return realFetch(input, init);
    }) as typeof fetch;
    try {
      app = new Hono();
      registerWebhookRoutes(app);
      const submit = async (text: string) => {
        const result = await postWhatsapp(text);
        expect(result.status).toBe(200);
        expect(result.body.processed).toBe(1);
        return JSON.parse(graphCalls.at(-1)!.body) as { text: { body: string } };
      };
      expect((await submit(LINK_CAPTACAO_MESSAGE)).text.body).toBe(Q_PUBLIC_ENTRY);
      expect((await submit("corretor")).text.body).toBe("Qual é o seu CRECI?");

      const earlyGraphCalls = graphCalls.length;
      const earlyImage = await postWhatsapp("", true);
      expect(earlyImage.status).toBe(200);
      expect(earlyImage.body.processed).toBe(1);
      expect(graphCalls).toHaveLength(earlyGraphCalls);
      const [earlyMedia] = await db.all<{ n: number }>(sql`SELECT COUNT(*) AS n FROM media`);
      expect(earlyMedia?.n).toBe(0);

      const progression: [string, string][] = [
        ["134718-F", "Qual é o seu nome completo?"],
        ["Edson Muniz", "O imóvel é para venda ou locação?"],
        ["venda", "Qual é o nome do proprietário do imóvel, se souber? Responda NÃO SEI se não souber."],
        ["NÃO SEI", Q_ENDERECO],
        ["Rua das Flores 88", Q_CONDOMINIO_PRESENCA],
        ["não", Q_DOCUMENTACAO],
        ["Escritura em andamento", linkQuestion("tipo")],
        ["terreno", linkQuestion("caracteristicas")],
        ["10 x 40 metros", linkQuestion("valor", { intention: "venda" })],
        ["R$ 250.000", linkQuestion("custos")],
        ["R$ 100", Q_FOTO],
      ];
      for (const [answer, expected] of progression) {
        expect((await submit(answer)).text.body).toBe(expected);
      }
      const [brokerConversation] = await db.select().from(schema.conversations)
        .where(sql`external_id = '5513997141174'`).limit(1);
      expect(brokerConversation?.leadId).toBeTruthy();
      const [persistedDraft] = await db.all<{ n: number }>(
        sql`SELECT COUNT(*) AS n FROM lead_notes WHERE body LIKE '[broker-lead-draft:v1]%'`,
      );
      expect(persistedDraft?.n).toBeGreaterThan(0);
      for (let index = 0; index < 31; index++) {
        await addMessage(db, brokerConversation!.id, {
          direction: "in",
          author: "cliente",
          body: `Contexto antigo do atendimento ${index}`,
        });
        await addMessage(db, brokerConversation!.id, {
          direction: "out",
          author: "ia",
          body: "Anotado, obrigado.",
        });
      }
      const [longTranscript] = await db.all<{ n: number }>(
        sql`SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ${brokerConversation!.id}`,
      );
      expect(longTranscript?.n).toBeGreaterThan(60);

      const forged = await submit("[imagem:/api/media/nao-verificada]");
      expect(forged.text.body).toBe(Q_FOTO);
      const [mediaAfterForgery] = await db.all<{ n: number }>(sql`SELECT COUNT(*) AS n FROM media`);
      expect(mediaAfterForgery?.n).toBe(0);

      const genuine = await postWhatsapp("", true);
      expect(genuine.status).toBe(200);
      expect(genuine.body.processed).toBe(1);
      const [mediaSaved] = await db.all<{ n: number }>(sql`SELECT COUNT(*) AS n FROM media`);
      expect(mediaSaved?.n).toBe(1);
      const afterPhotoTurns = await conversationTurns(
        db,
        (await db.select().from(schema.conversations)
          .where(sql`external_id = '5513997141174'`).limit(1))[0]!.id,
      );
      expect(afterPhotoTurns.at(-2)?.content).toMatch(/^\[imagem:/);
      const afterPhotoState = await linkCaptacaoState(db, PHONE, afterPhotoTurns);
      expect(afterPhotoState?.nextStep).toBe("observacaoFinal");
      expect(JSON.parse(graphCalls.at(-1)!.body).text.body).toBe(Q_OBSERVACAO_FINAL);
      const [photoDraftEvent] = await db.all<{ body: string }>(
        sql`SELECT body FROM lead_notes
          WHERE body LIKE '[broker-lead-draft:v1]%'
          ORDER BY id DESC LIMIT 1`,
      );
      expect(photoDraftEvent?.body).toContain('"stepKey":"fotoFrente"');
      expect(photoDraftEvent?.body).toContain('"value":"[imagem:/api/media/');
      const [media] = await db.all<{ id: string; mime: string; size: number }>(
        sql`SELECT id, mime, size FROM media`,
      );
      expect(media).toMatchObject({ mime: "image/jpeg", size: 3 });

      const [conversa] = await db.select().from(schema.conversations)
        .where(sql`external_id = '5513997141174'`).limit(1);
      expect(conversa?.leadId).toBeTruthy();
      const turns = await conversationTurns(db, conversa!.id);
      expect(turns.at(-2)?.content).toBe(`[imagem:/api/media/${media!.id}]`);
      expect(await counts()).toEqual({ owners: 0, captures: 0 });
      const [lead] = await db.all<{ id: number }>(
        sql`SELECT id FROM leads WHERE id = ${conversa!.leadId}`,
      );
      expect(lead?.id).toBe(conversa?.leadId);
    } finally {
      globalThis.fetch = realFetch;
    }
  }, 15_000);

  test("token exclusivo não prende entrada pública nem impede sua foto real", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("media-facade-test")) {
        return new Response(JSON.stringify({
          url: "https://media.test/public-facade.jpg",
          mime_type: "image/jpeg",
          file_size: 3,
        }), { status: 200 });
      }
      if (url === "https://media.test/public-facade.jpg") {
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "content-type": "image/jpeg" },
        });
      }
      if (url.includes("graph.facebook.com")) {
        graphCalls.push({ url, body: String(init?.body ?? "") });
        return new Response(JSON.stringify({ messages: [{ id: "wamid.out.public-media" }] }), { status: 200 });
      }
      return realFetch(input, init);
    }) as typeof fetch;

    try {
      app = new Hono();
      registerWebhookRoutes(app);
      behavior = async (call) => {
        const last = call.messages.at(-1)?.content ?? "";
        const item = SCRIPT.find((step) => step.body === last);
        if (!item) return { text: "TEXTO DO MODELO (não deve ser enviado)", steps: [] };
        const saved = await call.tools.salvarCadastroVenda!.execute(item.save, toolOptions) as SaveResult;
        expect(saved.salvo).toBe(true, `salvamento do passo ${item.step}`);
        return {
          text: "TEXTO DO MODELO (não deve ser enviado)",
          steps: [{ toolCalls: [{ toolName: "salvarCadastroVenda", input: item.save }] }],
        };
      };
      const submit = async (text: string) => {
        const response = await postWhatsapp(text);
        expect(response.status).toBe(200);
        expect(response.body.processed).toBe(1);
        return JSON.parse(graphCalls.at(-1)!.body) as { text: { body: string } };
      };

      const token = await issueCaptureShareToken(db, 1);
      issuedShareTokens.push(token);
      expect((await submit(`LINK_CAPTACAO:${token}`)).text.body).toBe(Q_ENTRY);
      const [unboundToken] = await db.all<{ id: number; capture_id: number | null; status: string }>(
        sql`SELECT id, capture_id, status FROM capture_share_tokens ORDER BY id DESC LIMIT 1`,
      );
      expect(unboundToken?.capture_id).toBeNull();
      expect(unboundToken?.status).toBe("redeemed");

      expect((await submit(LINK_CAPTACAO_MESSAGE)).text.body).toBe(Q_PUBLIC_ENTRY);
      expect((await submit("proprietário")).text.body).toBe(linkQuestion("nome"));
      for (const item of SCRIPT) {
        const response = await submit(item.body);
        expect(response.text.body, item.step).toBe(item.next);
      }
      const [tokenBeforePhoto] = await db.all<{
        id: number;
        capture_id: number | null;
        status: string;
      }>(sql`SELECT id, capture_id, status FROM capture_share_tokens ORDER BY id DESC LIMIT 1`);
      expect(tokenBeforePhoto).toEqual(unboundToken);
      const [publicCapture] = await db.all<{ id: number; street: string | null }>(
        sql`SELECT id, street FROM property_captures ORDER BY id DESC LIMIT 1`,
      );
      expect(publicCapture?.street).toBe("Rua Guimarães Rosa");
      expect(publicCapture?.id).not.toBe(unboundToken?.capture_id);

      const photo = await postWhatsapp("", true);
      expect(photo.status).toBe(200);
      expect(photo.body.processed).toBe(1);
      expect(JSON.parse(graphCalls.at(-1)!.body).text.body).toBe(Q_OBSERVACAO_FINAL);
      const [tokenAfterPhoto] = await db.all<{
        id: number;
        capture_id: number | null;
        status: string;
      }>(sql`SELECT id, capture_id, status FROM capture_share_tokens ORDER BY id DESC LIMIT 1`);
      expect(tokenAfterPhoto).toEqual(unboundToken);
      const [savedCapture] = await db.all<{
        id: number;
        owner_photos: string | null;
      }>(sql`SELECT id, owner_photos FROM property_captures WHERE id = ${publicCapture!.id}`);
      expect(savedCapture?.owner_photos).toContain("/api/media/");
      expect(await counts()).toEqual({ owners: 1, captures: 1 });
      const [mediaCount] = await db.all<{ n: number }>(sql`SELECT COUNT(*) AS n FROM media`);
      expect(mediaCount?.n).toBe(1);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test("webhook assinado mantém o questionário do corretor no transcript e não altera fichas existentes", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("graph.facebook.com")) {
        graphCalls.push({ url: String(input), body: String(init?.body ?? "") });
        return new Response(JSON.stringify({ messages: [{ id: "wamid.out.broker-lead" }] }), { status: 200 });
      }
      return realFetch(input, init);
    }) as typeof fetch;
    try {
      app = new Hono();
      registerWebhookRoutes(app);
      const [oldOwner] = await db.all<{ id: number }>(sql`
        INSERT INTO owners (name, phone, notes, created_at)
        VALUES ('Proprietário anterior', '5513997141174', 'nota preservada', 0)
        RETURNING id
      `);
      await db.run(sql`INSERT INTO property_captures
        (owner_id, city, address, street, notes, created_at, updated_at)
        VALUES (${oldOwner!.id}, 'Praia Grande', 'Rua Antiga, 10', 'Rua Antiga',
          'captura preservada', 0, 0)`);
      const beforeOwner = await db.all(
        sql`SELECT id, name, phone, notes, capture_status FROM owners WHERE id = ${oldOwner!.id}`,
      );
      const beforeCapture = await db.all(
        sql`SELECT id, owner_id, address, street, notes, intention, registration_status
          FROM property_captures WHERE owner_id = ${oldOwner!.id}`,
      );

      const submit = async (text: string) => {
        const result = await postWhatsapp(text);
        expect(result.status).toBe(200);
        expect(result.body.processed).toBe(1);
        return JSON.parse(graphCalls.at(-1)!.body) as { text: { body: string } };
      };
      expect((await submit(LINK_CAPTACAO_MESSAGE)).text.body).toBe(Q_PUBLIC_ENTRY);
      expect((await submit("corretor")).text.body).toBe("Qual é o seu CRECI?");
      expect((await submit("134718-F")).text.body).toBe("Qual é o seu nome completo?");
      expect((await submit("Edson Muniz")).text.body).toBe("O imóvel é para venda ou locação?");
      expect((await submit("Ainda estou avaliando")).text.body).toBe("O imóvel é para venda ou locação?");
      expect((await submit("Compra de terreno")).text.body).toBe("O imóvel é para venda ou locação?");

      const [conversa] = await db.select().from(schema.conversations)
        .where(sql`external_id = '5513997141174'`).limit(1);
      expect(conversa?.leadId).toBeTruthy();
      const transcript = await conversationTurns(db, conversa!.id);
      const resumed = await linkCaptacaoState(db, PHONE, transcript);
      expect(resumed?.presenter).toBe("corretor");
      expect(resumed?.nextQuestion).toBe("O imóvel é para venda ou locação?");

      const journey: [string, string][] = [
        ["aluguel", "Qual é o nome do proprietário do imóvel, se souber? Responda NÃO SEI se não souber."],
        ["NÃO SEI", Q_ENDERECO],
        ["Rua das Flores 88", Q_CONDOMINIO_PRESENCA],
        ["não", Q_DOCUMENTACAO],
        ["Escritura em andamento", linkQuestion("tipo")],
        ["terreno", linkQuestion("caracteristicas")],
        ["10 x 40 metros", linkQuestion("valor", { intention: "locacao" })],
        ["R$ 2.000 mensais", linkQuestion("custos")],
        ["R$ 100", Q_FOTO],
        ["NÃO SEI", Q_OBSERVACAO_FINAL],
        ["Sem observações", BROKER_LEAD_CLOSING_MESSAGE],
      ];
      for (const [answer, expected] of journey) {
        expect((await submit(answer)).text.body).toBe(expected);
      }

      const afterOwner = await db.all(
        sql`SELECT id, name, phone, notes, capture_status FROM owners WHERE id = ${oldOwner!.id}`,
      );
      const afterCapture = await db.all(
        sql`SELECT id, owner_id, address, street, notes, intention, registration_status
          FROM property_captures WHERE owner_id = ${oldOwner!.id}`,
      );
      expect(afterOwner).toEqual(beforeOwner);
      expect(afterCapture).toEqual(beforeCapture);
      expect(await counts()).toEqual({ owners: 1, captures: 1 });
      const leads = await db.all<{ id: number; interest: string }>(
        sql`SELECT id, interest FROM leads`,
      );
      expect(leads.length).toBeGreaterThan(0);
      expect(leads.some((lead) => lead.id === conversa?.leadId)).toBe(true);
      expect(modelCalls).toBe(0);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test("finalidade inválida repete a pergunta sem presumir venda ou consumir nome do proprietário", async () => {
    const conversa = await conversation("5513997141174:corretor-finalidade-invalida");
    await linkTurn(conversa.id, LINK_CAPTACAO_MESSAGE);
    expect((await linkTurn(conversa.id, "corretor")).reply).toBe("Qual é o seu CRECI?");
    expect((await linkTurn(conversa.id, "134718-F")).reply).toBe("Qual é o seu nome completo?");
    expect((await linkTurn(conversa.id, "Edson Muniz")).reply).toBe("O imóvel é para venda ou locação?");

    const primeiraInvalida = await linkTurn(conversa.id, "Ainda estou avaliando");
    const segundaInvalida = await linkTurn(conversa.id, "Compra de terreno");
    expect(primeiraInvalida.reply).toBe("O imóvel é para venda ou locação?");
    expect(segundaInvalida.reply).toBe("O imóvel é para venda ou locação?");
    expect(await counts()).toEqual({ owners: 0, captures: 0 });

    const state = await linkCaptacaoState(db, PHONE, [
      { role: "user", content: `LINK_CAPTACAO:${issuedShareTokens.at(-1)}` },
      { role: "user", content: "corretor" },
      { role: "user", content: "134718-F" },
      { role: "user", content: "Edson Muniz" },
      { role: "user", content: "Ainda estou avaliando" },
      { role: "user", content: "Compra de terreno" },
    ]);
    expect(state?.intention).toBeNull();
    expect(state?.nextQuestion).toBe("O imóvel é para venda ou locação?");

    expect((await linkTurn(conversa.id, "aluguel")).reply)
      .toBe("Qual é o nome do proprietário do imóvel, se souber? Responda NÃO SEI se não souber.");
    expect((await linkTurn(conversa.id, "NÃO SEI")).reply).toBe(Q_ENDERECO);
    expect(await counts()).toEqual({ owners: 0, captures: 0 });
  });

  test("novo token de corretor após fechamento reinicia o contexto sem herdar a ficha anterior", async () => {
    const conversa = await conversation("5513997141174:corretor-relink");
    await linkTurn(conversa.id, LINK_CAPTACAO_MESSAGE);
    await linkTurn(conversa.id, "proprietário");
    for (const item of SCRIPT) {
      await linkTurn(conversa.id, item.body, item.save);
    }
    const foto = await linkTurn(conversa.id, "[imagem:/api/media/fachada]", undefined, true);
    expect(foto.reply).toBe(Q_OBSERVACAO_FINAL);
    const fechado = await linkTurn(conversa.id, "NÃO SEI");
    expect(fechado.reply).toBe(CLOSING_MESSAGE);

    const [oldCapture] = await db.all<{ id: number; owner_id: number; address: string }>(
      sql`SELECT id, owner_id, address FROM property_captures LIMIT 1`,
    );
    expect(oldCapture?.address).toContain("Rua Guimarães Rosa");

    const distinctEntry = await linkTurn(conversa.id, "LINK_CAPTACAO:novo-token-corretor");
    expect(distinctEntry.reply).toBe(Q_ENTRY);
    const noHistoricalRoleLeak = await linkCaptacaoState(db, PHONE, [
      { role: "user", content: `LINK_CAPTACAO:${issuedShareTokens[0]}` },
      { role: "user", content: "corretor" },
      { role: "assistant", content: "Qual é o seu CRECI?" },
      { role: "user", content: "CRECI ANTIGO" },
      { role: "user", content: "Corretor Antigo" },
      { role: "assistant", content: CLOSING_MESSAGE },
      { role: "user", content: `LINK_CAPTACAO:${issuedShareTokens.at(-1)}` },
    ]);
    expect(noHistoricalRoleLeak?.presenter).toBe("proprietario");
    expect(noHistoricalRoleLeak?.broker).toBeNull();
    expect((await linkTurn(conversa.id, "corretor")).reply).toBe("Qual é o seu CRECI?");
    expect((await linkTurn(conversa.id, "CRECI 12345")).reply).toBe("Qual é o seu nome completo?");
    expect((await linkTurn(conversa.id, "Corretora Nova")).reply).toBe("O imóvel é para venda ou locação?");
    expect((await linkTurn(conversa.id, "venda")).reply)
      .toBe("Qual é o nome do proprietário do imóvel, se souber? Responda NÃO SEI se não souber.");
    expect((await linkTurn(conversa.id, "Maria Souza")).reply).toBe(Q_ENDERECO);

    const state = await linkCaptacaoState(db, PHONE, [
      { role: "user", content: `LINK_CAPTACAO:${issuedShareTokens.at(-1)}` },
      { role: "user", content: "corretor" },
      { role: "user", content: "CRECI 12345" },
      { role: "user", content: "Corretora Nova" },
      { role: "user", content: "venda" },
      { role: "user", content: "Maria Souza" },
    ]);
    expect(state?.active).toBe(true);
    expect(state?.presenter).toBe("corretor");
    expect(state?.broker).toEqual({
      creci: "CRECI 12345",
      name: "Corretora Nova",
      phone: PHONE,
    });
    expect(state?.snapshot.address).toContain("Rua Guimarães Rosa");
    expect(state?.snapshot.ownerName).toBe("Maria Souza");

    const address = await linkTurn(conversa.id, "Rua Broker Nova, 55");
    expect(address.reply).toBe(Q_CONDOMINIO_PRESENCA);
    const captures = await db.all<{ id: number; owner_id: number; address: string; street: string; notes: string }>(
      sql`SELECT id, owner_id, address, street, notes FROM property_captures ORDER BY id`,
    );
    expect(captures).toHaveLength(1);
    expect(captures[0]?.id).toBe(oldCapture?.id);
    expect(captures[0]?.address).toBe(oldCapture?.address);
    const [owner] = await db.all<{ name: string }>(
      sql`SELECT name FROM owners WHERE id = ${oldCapture!.owner_id} LIMIT 1`,
    );
    expect(owner?.name).toBe("Maria Souza");
    const [share] = await db.all<{ capture_id: number | null; status: string }>(
      sql`SELECT capture_id, status FROM capture_share_tokens ORDER BY id DESC LIMIT 1`,
    );
    expect(share).toEqual({ capture_id: null, status: "redeemed" });
  });

  test("nome em minúsculas e rua com número são gravados antes da próxima pergunta", async () => {
    const conversa = await conversation("5513997141174:novo");
    await iniciarCadastro(conversa.id);

    const [owner] = await db.all<{ name: string; phone: string }>(
      sql`SELECT name, phone FROM owners LIMIT 1`,
    );
    expect(owner?.name?.toLowerCase()).toBe("ana exemplo");
    expect(owner?.phone?.replace(/\D/g, "")).toBe(PHONE.replace(/\D/g, ""));
    expect(await counts()).toEqual({ owners: 1, captures: 1 });

    const endereco = await linkTurn(conversa.id, "Rua Guimarães Rosa 492");
    expect(endereco.reply).toBe(Q_CONDOMINIO_PRESENCA);
    const ficha = await onlyCapture();
    expect(ficha.street).toBe("Rua Guimarães Rosa");
    expect(ficha.number).toBe("492");
  });

  test("nova entrada do mesmo contato não deixa uma ficha vazia ao repetir o endereço", async () => {
    const primeira = await conversation("5513997141174:primeira");
    await iniciarCadastro(primeira.id);
    await linkTurn(primeira.id, "Rua Guimarães Rosa 492");
    expect(await counts()).toEqual({ owners: 1, captures: 1 });

    const segunda = await conversation("5513997141174:segunda");
    await iniciarCadastro(segunda.id);
    const endereco = await linkTurn(segunda.id, "Rua Guimarães Rosa 492");

    expect(endereco.reply).toBe(Q_CONDOMINIO_PRESENCA);
    expect(await counts()).toEqual({ owners: 1, captures: 1 });
    expect((await onlyCapture()).number).toBe("492");
  });

  test("outro endereço abre outra ficha sem alterar a ficha pendente anterior", async () => {
    const primeira = await conversation("5513997141174:imovel-antigo");
    await iniciarCadastro(primeira.id);
    await linkTurn(primeira.id, "Rua Guimarães Rosa 492");
    const [anterior] = await captureRows();
    expect(anterior?.street).toBe("Rua Guimarães Rosa");

    const segunda = await conversation("5513997141174:imovel-novo");
    await iniciarCadastro(segunda.id);
    expect(await counts()).toEqual({ owners: 1, captures: 1 });
    const endereco = await linkTurn(segunda.id, "Rua das Flores 88");

    expect(endereco.reply).toBe(Q_CONDOMINIO_PRESENCA);
    expect(await counts()).toEqual({ owners: 1, captures: 2 });
    const [antiga, nova] = await captureRows();
    expect(antiga?.id).toBe(anterior?.id);
    expect(antiga?.street).toBe("Rua Guimarães Rosa");
    expect(antiga?.number).toBe("492");
    expect(nova?.street).toBe("Rua das Flores");
    expect(nova?.number).toBe("88");
  });

  test("ficha antiga sem endereço é completada sem abrir uma segunda ficha vazia", async () => {
    const primeira = await conversation("5513997141174:sem-endereco");
    await iniciarCadastro(primeira.id);
    const [pendente] = await captureRows();
    expect(pendente?.street).toBeNull();

    const segunda = await conversation("5513997141174:retorno");
    await iniciarCadastro(segunda.id);
    expect(await counts()).toEqual({ owners: 1, captures: 1 });
    const endereco = await linkTurn(segunda.id, "Rua Guimarães Rosa 492");

    expect(endereco.reply).toBe(Q_CONDOMINIO_PRESENCA);
    expect(await counts()).toEqual({ owners: 1, captures: 1 });
    const ficha = await onlyCapture();
    expect(ficha.id).toBe(pendente?.id);
    expect(ficha.street).toBe("Rua Guimarães Rosa");
    expect(ficha.number).toBe("492");
  });

  test("endereço completo extraído pela IA também avança e mantém uma só ficha", async () => {
    const conversa = await conversation("5513997141174:endereco-completo");
    await iniciarCadastro(conversa.id);

    const endereco = await linkTurn(
      conversa.id,
      "Rua Guimarães Rosa, 492, Boqueirão, Praia Grande - SP",
      { rua: "Rua Guimarães Rosa", numero: "492", bairro: "Boqueirão", cidade: "Praia Grande", estado: "SP" },
    );

    expect(endereco.saved?.salvo).toBe(true);
    expect(endereco.reply).toBe(Q_CONDOMINIO_PRESENCA);
    expect(await counts()).toEqual({ owners: 1, captures: 1 });
    const ficha = await onlyCapture();
    expect(ficha.street).toBe("Rua Guimarães Rosa");
    expect(ficha.number).toBe("492");
    expect(ficha.city).toBe("Praia Grande");
  });

  test("nome e rua com palavras de perfil não reiniciam a pergunta do perfil", async () => {
    const conversa = await conversation("5513997141174:palavras-perfil");
    await linkTurn(conversa.id, LINK_CAPTACAO_MESSAGE);
    await linkTurn(conversa.id, "proprietário");
    expect((await linkTurn(conversa.id, "dona maria")).reply).toBe(linkQuestion("endereco"));

    const endereco = await linkTurn(conversa.id, "Rua dos Proprietários 10");
    expect(endereco.reply).toBe(Q_CONDOMINIO_PRESENCA);
    const ficha = await onlyCapture();
    expect(ficha.street).toBe("Rua dos Proprietários");
    expect(ficha.number).toBe("10");
  });

  test("contato conhecido retoma o endereço em outra conversa sem levar mensagens comuns para a captação", async () => {
    await db.run(sql`INSERT INTO owners (name, phone, notes)
      VALUES ('Contato Original', ${PHONE}, 'Anotação humana preservada')`);
    const entrada = await conversation("5513997141174:marcador");
    await iniciarCadastro(entrada.id);
    expect(await counts()).toEqual({ owners: 1, captures: 0 });
    const [aguardando] = await db.all<{ notes: string }>(sql`SELECT notes FROM owners LIMIT 1`);
    expect(aguardando?.notes).toContain("Anotação humana preservada");
    expect(aguardando?.notes).toContain("[LINK_CAPTACAO_AGUARDANDO_ENDERECO:");

    const retorno = await conversation("5513997141174:outra-conversa");
    const comum = await linkTurn(retorno.id, "Oi, tudo bem?");
    expect(comum.reply).not.toBe(linkQuestion("endereco"));
    expect(await counts()).toEqual({ owners: 1, captures: 0 });

    const endereco = await linkTurn(retorno.id, "Rua dos Proprietários 10");
    expect(endereco.reply).toBe(Q_CONDOMINIO_PRESENCA);
    expect(await counts()).toEqual({ owners: 1, captures: 1 });
    expect((await onlyCapture()).number).toBe("10");
    const [concluido] = await db.all<{ notes: string }>(sql`SELECT notes FROM owners LIMIT 1`);
    expect(concluido?.notes).toContain("Anotação humana preservada");
    expect(concluido?.notes).not.toContain("[LINK_CAPTACAO_AGUARDANDO_ENDERECO:");
  });

  test("endereço em outra conversa não sobrescreve o imóvel pendente anterior", async () => {
    const antigo = await conversation("5513997141174:pendente-anterior");
    await iniciarCadastro(antigo.id);
    await linkTurn(antigo.id, "Rua Guimarães Rosa 492");
    const [anterior] = await captureRows();

    const entrada = await conversation("5513997141174:novo-link");
    await iniciarCadastro(entrada.id);
    expect(await counts()).toEqual({ owners: 1, captures: 1 });

    const retorno = await conversation("5513997141174:resposta-em-outra-conversa");
    const endereco = await linkTurn(retorno.id, "Rua das Flores 88");
    expect(endereco.reply).toBe(Q_CONDOMINIO_PRESENCA);
    expect(await counts()).toEqual({ owners: 1, captures: 2 });
    const [primeira, segunda] = await captureRows();
    expect(primeira?.id).toBe(anterior?.id);
    expect(primeira?.street).toBe("Rua Guimarães Rosa");
    expect(primeira?.number).toBe("492");
    expect(segunda?.street).toBe("Rua das Flores");
    expect(segunda?.number).toBe("88");
  });

  test("endereço completo em outra conversa usa o extrator e remove o marcador", async () => {
    await db.run(sql`INSERT INTO owners (name, phone, notes)
      VALUES ('Contato Original', ${PHONE}, 'Observação anterior')`);
    const entrada = await conversation("5513997141174:extrator-entrada");
    await iniciarCadastro(entrada.id);
    expect(await counts()).toEqual({ owners: 1, captures: 0 });

    const retorno = await conversation("5513997141174:extrator-retorno");
    const endereco = await linkTurn(
      retorno.id,
      "Rua Guimarães Rosa, 492, Boqueirão, Praia Grande - SP",
      { rua: "Rua Guimarães Rosa", numero: "492", bairro: "Boqueirão", cidade: "Praia Grande", estado: "SP" },
    );

    expect(endereco.saved?.salvo).toBe(true);
    expect(endereco.reply).toBe(Q_CONDOMINIO_PRESENCA);
    expect((await onlyCapture()).street).toBe("Rua Guimarães Rosa");
    const [owner] = await db.all<{ notes: string }>(sql`SELECT notes FROM owners LIMIT 1`);
    expect(owner?.notes).toContain("Observação anterior");
    expect(owner?.notes).not.toContain("[LINK_CAPTACAO_AGUARDANDO_ENDERECO:");
  });

  test("marcador vencido não captura mensagem nova e preserva observações", async () => {
    await db.run(sql`INSERT INTO owners (name, phone, notes)
      VALUES ('Contato Original', ${PHONE}, 'Observação humana\n\n[LINK_CAPTACAO_AGUARDANDO_ENDERECO:1000000000000]')`);
    const conversa = await conversation("5513997141174:marcador-vencido");
    await linkTurn(conversa.id, "Rua das Flores 88");

    expect(await counts()).toEqual({ owners: 1, captures: 0 });
    const [owner] = await db.all<{ notes: string }>(sql`SELECT notes FROM owners LIMIT 1`);
    expect(owner?.notes).toBe("Observação humana");
  });

  test("atualização no CRM da ficha antiga não desvia a resposta seguinte do imóvel novo", async () => {
    const antigo = await conversation("5513997141174:imovel-em-aberto");
    await iniciarCadastro(antigo.id);
    await linkTurn(antigo.id, "Rua Guimarães Rosa 492");
    const [anterior] = await captureRows();

    const novo = await conversation("5513997141174:imovel-em-atendimento");
    await iniciarCadastro(novo.id);
    await linkTurn(novo.id, "Rua das Flores 88");
    expect(await counts()).toEqual({ owners: 1, captures: 2 });

    /* Uma edição posterior do CRM não pode redefinir qual imóvel o WhatsApp está cadastrando. */
    await db.run(sql`UPDATE property_captures SET updated_at = ${Math.floor(Date.now() / 1000) + 3600}
      WHERE id = ${anterior!.id}`);
    await linkTurn(novo.id, "Sim");
    await linkTurn(novo.id, "Residencial das Flores");
    await linkTurn(novo.id, "Escritura da segunda casa", {
      documentacao: "Escritura da segunda casa",
    });

    const [primeira, segunda] = await captureRows();
    expect(primeira?.notes).not.toContain("Escritura da segunda casa");
    expect(segunda?.notes).toContain("Escritura da segunda casa");

    const retorno = await conversation("5513997141174:retorno-apos-edicao");
    const tipo = await linkTurn(retorno.id, "Apartamento");
    expect(tipo.reply).toBe(linkQuestion("dormitorios"));
    const [antigaDepois, novaDepois] = await captureRows();
    expect(antigaDepois?.property_type).toBeNull();
    expect(novaDepois?.property_type).toBe("apartamento");
  });

  test("a foto terminal remove o identificador da ficha ativa", async () => {
    const conversa = await conversation("5513997141174:encerramento");
    await iniciarCadastro(conversa.id);
    await linkTurn(conversa.id, "Rua das Flores 88");
    const ficha = await onlyCapture();
    const [durante] = await db.all<{ notes: string }>(sql`SELECT notes FROM owners LIMIT 1`);
    expect(durante?.notes).toContain(`[LINK_CAPTACAO_FICHA_ATIVA:${ficha.id}:`);

    const { saveCaptureAnswer } = await import("./owner-capture");
    const salvo = await saveCaptureAnswer(db, {
      phone: PHONE,
      targetCaptureId: ficha.id,
      origem: LINK_CAPTACAO_ORIGIN,
      fotoFrente: "Foto da fachada recebida",
    });
    expect(salvo.saved).toBe(true);
    const [depois] = await db.all<{ notes: string | null }>(sql`SELECT notes FROM owners LIMIT 1`);
    expect(depois?.notes ?? "").not.toContain("[LINK_CAPTACAO_FICHA_ATIVA:");
  });
});

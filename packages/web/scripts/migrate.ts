/**
 * Migração idempotente do banco existente (Turso).
 * Só cria tabelas/colunas/índices que faltam — nunca apaga dados.
 * Uso: cd packages/web && bun --env-file=../../.env scripts/migrate.ts
 */
import { createClient } from "@libsql/client/web";
import { FALLBACK_MODEL } from "../src/api/agent/model";

const url = (process.env.DATABASE_URL ?? "").replace(/^libsql:\/\//, "https://");
if (!url) throw new Error("DATABASE_URL ausente");
const db = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN });

const statements = [
  `CREATE TABLE IF NOT EXISTS admin_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin',
    last_login_at INTEGER,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS admin_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    user_id INTEGER NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS properties (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    code TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    purpose TEXT NOT NULL DEFAULT 'venda',
    type TEXT NOT NULL DEFAULT 'apartamento',
    price REAL NOT NULL DEFAULT 0,
    condo_fee REAL,
    iptu REAL,
    district TEXT NOT NULL DEFAULT '',
    city TEXT NOT NULL DEFAULT 'Praia Grande',
    address TEXT,
    bedrooms INTEGER NOT NULL DEFAULT 0,
    suites INTEGER NOT NULL DEFAULT 0,
    bathrooms INTEGER NOT NULL DEFAULT 0,
    parking INTEGER NOT NULL DEFAULT 0,
    area_util REAL NOT NULL DEFAULT 0,
    area_total REAL,
    description TEXT,
    highlight TEXT,
    features TEXT,
    status TEXT NOT NULL DEFAULT 'disponivel',
    published INTEGER NOT NULL DEFAULT 1,
    featured INTEGER NOT NULL DEFAULT 0,
    owner_id INTEGER,
    views INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS properties_status_idx ON properties (status)`,
  `CREATE TABLE IF NOT EXISTS property_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    property_id INTEGER NOT NULL,
    url TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_primary INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS property_images_property_idx ON property_images (property_id)`,
  `CREATE TABLE IF NOT EXISTS media (
    id TEXT PRIMARY KEY NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    data TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS owners (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    notes TEXT,
    capture_status TEXT NOT NULL DEFAULT 'prospeccao',
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT,
    interest TEXT,
    price_min REAL,
    price_max REAL,
    districts TEXT,
    bedrooms INTEGER,
    notes TEXT,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS client_interactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    client_id INTEGER NOT NULL,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS lead_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    lead_id INTEGER NOT NULL,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  /* F4.1 — perfil de necessidade (1:1 com leads) e timeline comercial */
  `CREATE TABLE IF NOT EXISTS lead_profile (
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
    updated_at INTEGER
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS lead_profile_lead_idx ON lead_profile (lead_id)`,
  `CREATE TABLE IF NOT EXISTS lead_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    lead_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    detail TEXT,
    actor_type TEXT NOT NULL DEFAULT 'sistema',
    actor_name TEXT,
    score_before INTEGER,
    score_after INTEGER,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS lead_events_lead_idx ON lead_events (lead_id)`,
  `CREATE INDEX IF NOT EXISTS lead_events_created_idx ON lead_events (created_at)`,
  `CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    title TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'visita',
    due_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pendente',
    lead_id INTEGER,
    client_id INTEGER,
    property_id INTEGER,
    notes TEXT,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS deals (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    client_id INTEGER,
    lead_id INTEGER,
    property_id INTEGER,
    client_name TEXT,
    asking_price REAL,
    offer_price REAL,
    status TEXT NOT NULL DEFAULT 'enviada',
    commission_rate REAL,
    commission_value REAL,
    notes TEXT,
    deal_date INTEGER,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    company_name TEXT NOT NULL DEFAULT 'Edy Premi Imóveis',
    broker_name TEXT NOT NULL DEFAULT 'Edy Premi',
    whatsapp TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    creci TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    instagram TEXT NOT NULL DEFAULT '',
    facebook TEXT NOT NULL DEFAULT '',
    commission_rate REAL NOT NULL DEFAULT 6,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    interest TEXT NOT NULL,
    message TEXT,
    source TEXT NOT NULL DEFAULT 'site',
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS site_content (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    data TEXT NOT NULL,
    label TEXT,
    author TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    published_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS site_content_status_idx ON site_content (status)`,
  `CREATE TABLE IF NOT EXISTS integrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    key TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'nao_configurado',
    enabled INTEGER NOT NULL DEFAULT 0,
    config TEXT,
    last_sync_at INTEGER,
    last_test_at INTEGER,
    last_error TEXT,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS integration_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    integration_key TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'sync',
    ok INTEGER NOT NULL DEFAULT 1,
    message TEXT,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS integration_events_key_idx ON integration_events (integration_key)`,
  `CREATE TABLE IF NOT EXISTS property_channels (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    property_id INTEGER NOT NULL,
    channel TEXT NOT NULL,
    authorized INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'nao_enviado',
    message TEXT,
    last_sync_at INTEGER,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS property_channels_property_idx ON property_channels (property_id)`,
  `CREATE TABLE IF NOT EXISTS conversations (
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
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS conversations_status_idx ON conversations (status)`,
  `CREATE INDEX IF NOT EXISTS conversations_channel_external_idx ON conversations (channel, external_id)`,
  `CREATE TABLE IF NOT EXISTS chat_guard_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    channel TEXT NOT NULL DEFAULT 'site',
    fingerprint TEXT NOT NULL,
    kind TEXT NOT NULL,
    reason TEXT,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS chat_guard_events_lookup_idx ON chat_guard_events (channel, kind, created_at)`,
  `CREATE INDEX IF NOT EXISTS chat_guard_events_fingerprint_idx ON chat_guard_events (fingerprint, created_at)`,
  `CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    conversation_id INTEGER NOT NULL,
    direction TEXT NOT NULL DEFAULT 'in',
    author TEXT NOT NULL DEFAULT 'cliente',
    author_name TEXT,
    body TEXT NOT NULL,
    external_id TEXT,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS messages_conversation_idx ON messages (conversation_id)`,
  `CREATE TABLE IF NOT EXISTS ai_agents (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    name TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 0,
    provider TEXT NOT NULL DEFAULT 'gateway',
    model TEXT NOT NULL DEFAULT '${FALLBACK_MODEL}',
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
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS automations (
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
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS automation_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    automation_id INTEGER NOT NULL,
    ok INTEGER NOT NULL DEFAULT 1,
    message TEXT,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS automation_runs_automation_idx ON automation_runs (automation_id)`,
  `CREATE TABLE IF NOT EXISTS watermark_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0,
    logo_url TEXT,
    size INTEGER NOT NULL DEFAULT 22,
    opacity INTEGER NOT NULL DEFAULT 70,
    margin INTEGER NOT NULL DEFAULT 4,
    position TEXT NOT NULL DEFAULT 'bottom-right',
    apply_to_new_uploads INTEGER NOT NULL DEFAULT 1,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    user_id INTEGER,
    user_name TEXT,
    action TEXT NOT NULL,
    entity TEXT,
    entity_id TEXT,
    detail TEXT,
    ip TEXT,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS audit_log_created_idx ON audit_log (created_at)`,
];

/** Colunas adicionadas à tabela media (biblioteca de mídia do editor do site). */
const mediaColumns: Record<string, string> = {
  name: "TEXT",
  alt: "TEXT",
  original_id: "TEXT",
  variant: "TEXT",
};

/** Colunas adicionadas à tabela properties. */
const propertyColumns: Record<string, string> = {
  slug: "TEXT",
  watermark_off: "INTEGER NOT NULL DEFAULT 0",
};

/** Coluna que preserva a foto original quando há marca d'água. */
const propertyImageColumns: Record<string, string> = {
  original_url: "TEXT",
};

/** Colunas adicionadas à tabela leads que já existia em produção. */
const leadColumns: Record<string, string> = {
  email: "TEXT",
  portal: "TEXT",
  channel: "TEXT",
  campaign: "TEXT",
  utm_source: "TEXT",
  utm_medium: "TEXT",
  utm_campaign: "TEXT",
  external_id: "TEXT",
  stage: "TEXT NOT NULL DEFAULT 'novo'",
  status: "TEXT NOT NULL DEFAULT 'aberto'",
  lost_reason: "TEXT",
  client_id: "INTEGER",
  property_id: "INTEGER",
  next_action: "TEXT",
  next_action_at: "INTEGER",
  updated_at: "INTEGER",
  /* F4.1 — qualificação determinística */
  score: "INTEGER NOT NULL DEFAULT 0",
  score_tier: "TEXT NOT NULL DEFAULT 'frio'",
  score_reasons: "TEXT",
  score_at: "INTEGER",
  qualified_at: "INTEGER",
};

for (const sql of statements) {
  await db.execute(sql);
  console.log("ok:", sql.slice(0, 60).replace(/\s+/g, " "));
}

const mediaInfo = await db.execute("PRAGMA table_info(media)");
const mediaExisting = new Set(mediaInfo.rows.map((r) => String(r.name)));
for (const [column, type] of Object.entries(mediaColumns)) {
  if (mediaExisting.has(column)) continue;
  await db.execute(`ALTER TABLE media ADD COLUMN ${column} ${type}`);
  console.log("media += ", column);
}

for (const [table, columns] of [
  ["properties", propertyColumns],
  ["property_images", propertyImageColumns],
] as const) {
  const tableInfo = await db.execute(`PRAGMA table_info(${table})`);
  const present = new Set(tableInfo.rows.map((r) => String(r.name)));
  for (const [column, type] of Object.entries(columns)) {
    if (present.has(column)) continue;
    await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    console.log(`${table} += `, column);
  }
}

const info = await db.execute("PRAGMA table_info(leads)");
const existing = new Set(info.rows.map((r) => String(r.name)));
for (const [column, type] of Object.entries(leadColumns)) {
  if (existing.has(column)) continue;
  await db.execute(`ALTER TABLE leads ADD COLUMN ${column} ${type}`);
  console.log("leads += ", column);
}

/* índices sobre colunas recém-adicionadas (após os ALTER TABLE acima) */
for (const sql of [
  "CREATE INDEX IF NOT EXISTS leads_stage_idx ON leads (stage)",
  "CREATE INDEX IF NOT EXISTS leads_phone_idx ON leads (phone)",
  "CREATE INDEX IF NOT EXISTS leads_score_idx ON leads (score)",
  "CREATE INDEX IF NOT EXISTS leads_next_action_idx ON leads (next_action_at)",
]) {
  await db.execute(sql);
  console.log("ok:", sql.slice(0, 60));
}

const tables = await db.execute(
  "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
);
console.log("TABELAS:", tables.rows.map((r) => r.name).join(", "));
const leadCount = await db.execute("SELECT count(*) as n FROM leads");
console.log("LEADS PRESERVADOS:", leadCount.rows[0]?.n);

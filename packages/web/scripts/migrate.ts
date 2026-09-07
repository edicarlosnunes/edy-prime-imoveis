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
    company_name TEXT NOT NULL DEFAULT 'Edy Prime Imóveis',
    broker_name TEXT NOT NULL DEFAULT 'Edy Prime',
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

  /* ------------------------------- V2: documentação inteligente + revalidação */
  `CREATE TABLE IF NOT EXISTS property_checklist (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    property_id INTEGER NOT NULL,
    item_key TEXT NOT NULL,
    answer TEXT NOT NULL,
    note TEXT,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS property_checklist_property_idx ON property_checklist (property_id)`,
  `CREATE TABLE IF NOT EXISTS document_files (
    id TEXT PRIMARY KEY NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    data TEXT NOT NULL,
    name TEXT,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS property_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    property_id INTEGER NOT NULL,
    category TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'recebido',
    title TEXT,
    file_id TEXT,
    file_name TEXT,
    note TEXT,
    received_at INTEGER,
    analyzed_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS property_documents_property_idx ON property_documents (property_id)`,
  `CREATE TABLE IF NOT EXISTS property_revalidations (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    property_id INTEGER NOT NULL,
    outcome TEXT NOT NULL,
    note TEXT,
    revalidated_at INTEGER NOT NULL,
    next_due_at INTEGER,
    user_name TEXT,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS property_revalidations_property_idx ON property_revalidations (property_id)`,

  /* ----------------------------------------------- Radar de Captação V1 */
  `CREATE TABLE IF NOT EXISTS property_captures (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    owner_id INTEGER NOT NULL,
    city TEXT NOT NULL DEFAULT 'Praia Grande',
    district TEXT,
    address TEXT,
    property_type TEXT,
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
    notes TEXT,
    lost_reason TEXT,
    lost_detail TEXT,
    converted_property_id INTEGER,
    converted_at INTEGER,
    stage_changed_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS property_captures_owner_idx ON property_captures (owner_id)`,
  `CREATE INDEX IF NOT EXISTS property_captures_stage_idx ON property_captures (stage)`,
  `CREATE INDEX IF NOT EXISTS property_captures_next_action_idx ON property_captures (next_action_at)`,

  /* ------------------------------------- Captação V3: serial + documentos */
  /* Contador do sequencial GLOBAL do serial. Linha única id=1, semente
     next=0, então o primeiro serial emitido é 000001. */
  `CREATE TABLE IF NOT EXISTS crm_serials (
    id INTEGER PRIMARY KEY NOT NULL,
    next INTEGER NOT NULL DEFAULT 0
  )`,
  /* Ficha Técnica (FC-) e Autorização de Venda (AV-). O serial é herdado do
     imóvel; snapshot congela os dados da via impressa/assinada. */
  `CREATE TABLE IF NOT EXISTS crm_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    kind TEXT NOT NULL,
    serial TEXT NOT NULL,
    base_serial TEXT,
    capture_id INTEGER,
    property_id INTEGER,
    owner_id INTEGER,
    status TEXT NOT NULL DEFAULT 'gerada',
    snapshot TEXT,
    note TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS crm_documents_serial_idx ON crm_documents (serial)`,
  `CREATE INDEX IF NOT EXISTS crm_documents_capture_idx ON crm_documents (capture_id)`,
  `CREATE INDEX IF NOT EXISTS crm_documents_property_idx ON crm_documents (property_id)`,
  `CREATE TABLE IF NOT EXISTS crm_document_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    document_id INTEGER NOT NULL,
    status TEXT NOT NULL,
    note TEXT,
    user_id INTEGER,
    user_name TEXT,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS crm_document_events_document_idx ON crm_document_events (document_id)`,
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
  /* V2 — documentação. Nullable de propósito: NULL = ainda não respondido,
     diferente de 0 (respondido "não"). Nenhum dado existente é alterado. */
  in_condominium: "INTEGER",
  has_heranca: "INTEGER",
  has_posse: "INTEGER",
  has_financiamento: "INTEGER",
  has_aluguel: "INTEGER",
  /* V2 — revalidação. portfolio_entry_at fica NULL nos imóveis já existentes:
     sem backfill automático, então eles não entram na fila até alguém definir
     a data (backfill em massa marcaria toda a carteira como vencida). */
  portfolio_entry_at: "INTEGER",
  last_revalidation_at: "INTEGER",
  next_revalidation_at: "INTEGER",
  revalidation_status: "TEXT",
  /* V3 — serial global TIPO-ANO-SEQUENCIAL. Nullable: os imóveis que já
     existem ficam com NULL e o `code` antigo NÃO é renumerado. */
  serial: "TEXT",
};

/**
 * Colunas adicionadas à tabela owners — alerta de POSSÍVEL DUPLICADO (V3).
 *
 * Só sinalizam para revisão humana: nenhum proprietário existente é alterado,
 * nenhum merge antigo é desfeito e o alerta nunca bloqueia cadastro.
 */
const ownerColumns: Record<string, string> = {
  possible_duplicate: "INTEGER NOT NULL DEFAULT 0",
  duplicate_of_owner_id: "INTEGER",
  duplicate_note: "TEXT",
};

/**
 * Colunas adicionadas à tabela property_captures — ficha única V3.
 *
 * Todas nullable de propósito: as captações que já existem continuam válidas
 * sem nenhum backfill. `address` (texto livre) segue existindo e não é
 * reescrito; o endereço estruturado é o caminho novo.
 */
const propertyCaptureColumns: Record<string, string> = {
  serial: "TEXT",
  cep: "TEXT",
  street: "TEXT",
  number: "TEXT",
  state: "TEXT",
  /* complementos em JSON; a busca por unidade usa unit_key, que é indexado */
  complements: "TEXT",
  unit_key: "TEXT",
  /* "DOCUMENTAÇÃO VALIDADA PELA EQUIPE": quem validou, quando e por quê */
  doc_validated_by: "TEXT",
  doc_validated_at: "INTEGER",
  doc_validation_note: "TEXT",
};

/** Coluna que preserva a foto original quando há marca d'água. */
const propertyImageColumns: Record<string, string> = {
  original_url: "TEXT",
};


/** Colunas adicionadas à tabela tasks para vínculo estrutural com o Radar. */
const taskColumns: Record<string, string> = {
  capture_id: "INTEGER",
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

/**
 * Mapa único tabela -> colunas aditivas.
 *
 * Fonte de verdade tanto da migração quanto do modo `--check`: se a coluna
 * estiver aqui, ela é conferida. Manter duas listas separadas era o caminho
 * garantido para o `--check` aprovar um schema incompleto.
 */
const columnMaps: Record<string, Record<string, string>> = {
  media: mediaColumns,
  properties: propertyColumns,
  property_images: propertyImageColumns,
  tasks: taskColumns,
  leads: leadColumns,
  owners: ownerColumns,
  property_captures: propertyCaptureColumns,
};

/** Índices que dependem de colunas adicionadas acima — criados por último. */
const lateIndexes = [
  "CREATE INDEX IF NOT EXISTS leads_stage_idx ON leads (stage)",
  "CREATE INDEX IF NOT EXISTS leads_phone_idx ON leads (phone)",
  "CREATE INDEX IF NOT EXISTS leads_score_idx ON leads (score)",
  "CREATE INDEX IF NOT EXISTS leads_next_action_idx ON leads (next_action_at)",
  /* V2 — índice da fila de revalidação (coluna adicionada acima) */
  "CREATE INDEX IF NOT EXISTS properties_next_revalidation_idx ON properties (next_revalidation_at)",
  "CREATE INDEX IF NOT EXISTS tasks_capture_idx ON tasks (capture_id)",
  /* V3 — backstop do serial: o banco recusa duplicata mesmo se alguém gerar
     serial por fora de lib/serial-counter.ts. UNIQUE aceita vários NULL no
     SQLite, então imóveis e captações antigos (serial NULL) não conflitam. */
  "CREATE UNIQUE INDEX IF NOT EXISTS properties_serial_idx ON properties (serial)",
  "CREATE UNIQUE INDEX IF NOT EXISTS property_captures_serial_idx ON property_captures (serial)",
  /* identidade da unidade: NÃO é único, porque um imóvel perdido pode ser
     recaptado depois. A duplicidade é avisada pela aplicação, não travada. */
  "CREATE INDEX IF NOT EXISTS property_captures_unit_idx ON property_captures (unit_key)",
];

/**
 * Sementes idempotentes.
 *
 * `INSERT OR IGNORE` para que rodar a migração de novo não zere o contador de
 * serial — zerar reemitiria seriais já impressos em documentos assinados.
 */
const seeds = ["INSERT OR IGNORE INTO crm_serials (id, next) VALUES (1, 0)"];

const nameOf = (pattern: RegExp, sources: string[]) =>
  sources.map((s) => pattern.exec(s)?.[1]).filter((n): n is string => Boolean(n));

const expectedTables = nameOf(/CREATE TABLE IF NOT EXISTS (\w+)/i, statements);
const expectedIndexes = nameOf(
  /CREATE (?:UNIQUE )?INDEX IF NOT EXISTS (\w+)/i,
  [...statements, ...lateIndexes],
);

const objectNames = async (type: "table" | "index") => {
  const rows = await db.execute(`SELECT name FROM sqlite_master WHERE type='${type}'`);
  return new Set(rows.rows.map((r) => String(r.name)));
};

const columnsOf = async (table: string) => {
  const info = await db.execute(`PRAGMA table_info(${table})`);
  return new Set(info.rows.map((r) => String(r.name)));
};

/**
 * Modo --check: NÃO escreve nada. Lista o que falta e sai com código 1.
 *
 * Existe porque `schema.ts` é a única descrição do schema de produção e nada
 * verificava se os dois batiam. É o gate para conferir o banco depois de
 * aplicar a migração, antes de publicar o código que depende dela.
 */
if (process.argv.includes("--check")) {
  const drift: string[] = [];

  const tables = await objectNames("table");
  for (const table of expectedTables) {
    if (!tables.has(table)) drift.push(`TABELA AUSENTE: ${table}`);
  }

  for (const [table, columns] of Object.entries(columnMaps)) {
    if (!tables.has(table)) continue; /* já reportado como tabela ausente */
    const present = await columnsOf(table);
    for (const column of Object.keys(columns)) {
      if (!present.has(column)) drift.push(`COLUNA AUSENTE: ${table}.${column}`);
    }
  }

  const indexes = await objectNames("index");
  for (const name of expectedIndexes) {
    if (!indexes.has(name)) drift.push(`ÍNDICE AUSENTE: ${name}`);
  }

  if (tables.has("crm_serials")) {
    const seeded = await db.execute("SELECT count(*) as n FROM crm_serials WHERE id = 1");
    if (Number(seeded.rows[0]?.n ?? 0) === 0) {
      drift.push("SEMENTE AUSENTE: crm_serials id=1");
    }
  }

  if (drift.length === 0) {
    console.log("CHECK: schema em dia — nada a aplicar.");
    console.log(
      `CONFERIDO: ${expectedTables.length} tabelas, ${expectedIndexes.length} índices,`,
      `${Object.values(columnMaps).reduce((n, c) => n + Object.keys(c).length, 0)} colunas aditivas.`,
    );
  } else {
    console.log(`CHECK: ${drift.length} divergência(s) — NADA foi escrito.`);
    for (const line of drift) console.log(" -", line);
    process.exitCode = 1;
  }
} else {
  for (const sql of statements) {
    await db.execute(sql);
    console.log("ok:", sql.slice(0, 60).replace(/\s+/g, " "));
  }

  for (const [table, columns] of Object.entries(columnMaps)) {
    const present = await columnsOf(table);
    for (const [column, type] of Object.entries(columns)) {
      if (present.has(column)) continue;
      await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
      console.log(`${table} += `, column);
    }
  }

  for (const sql of lateIndexes) {
    await db.execute(sql);
    console.log("ok:", sql.slice(0, 60));
  }

  for (const sql of seeds) {
    await db.execute(sql);
    console.log("ok:", sql.slice(0, 60));
  }

  const tables = await db.execute(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
  );
  console.log("TABELAS:", tables.rows.map((r) => r.name).join(", "));
  const leadCount = await db.execute("SELECT count(*) as n FROM leads");
  console.log("LEADS PRESERVADOS:", leadCount.rows[0]?.n);
}

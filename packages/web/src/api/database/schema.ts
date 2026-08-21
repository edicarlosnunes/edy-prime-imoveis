import { sqliteTable, integer, text, real, index } from "drizzle-orm/sqlite-core";

/**
 * Schema do site + painel administrativo.
 * Migrações aditivas e idempotentes: packages/web/scripts/migrate.ts
 */

/* ---------------------------------------------------------------- usuários */

export const adminUsers = sqliteTable("admin_users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  passwordSalt: text("password_salt").notNull(),
  role: text("role").notNull().default("admin"),
  lastLoginAt: integer("last_login_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const adminSessions = sqliteTable("admin_sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

/* --------------------------------------------------------------- imóveis */

export const properties = sqliteTable(
  "properties",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    code: text("code").notNull().unique(),
    title: text("title").notNull(),
    /** venda | locacao | venda_locacao */
    purpose: text("purpose").notNull().default("venda"),
    /** apartamento | casa | cobertura | terreno | sala_comercial | sobrado | chacara | outro */
    type: text("type").notNull().default("apartamento"),
    price: real("price").notNull().default(0),
    condoFee: real("condo_fee"),
    iptu: real("iptu"),
    district: text("district").notNull().default(""),
    city: text("city").notNull().default("Praia Grande"),
    address: text("address"),
    bedrooms: integer("bedrooms").notNull().default(0),
    suites: integer("suites").notNull().default(0),
    bathrooms: integer("bathrooms").notNull().default(0),
    parking: integer("parking").notNull().default(0),
    areaUtil: real("area_util").notNull().default(0),
    areaTotal: real("area_total"),
    description: text("description"),
    /** frase curta usada no card da vitrine */
    highlight: text("highlight"),
    /** JSON: string[] */
    features: text("features"),
    /** disponivel | reservado | vendido | alugado */
    status: text("status").notNull().default("disponivel"),
    published: integer("published").notNull().default(1),
    featured: integer("featured").notNull().default(0),
    ownerId: integer("owner_id"),
    views: integer("views").notNull().default(0),
    /** URL amigável da página individual (/imovel/:slug) */
    slug: text("slug"),
    /** 1 = não aplicar marca d'água nas fotos deste imóvel */
    watermarkOff: integer("watermark_off").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index("properties_status_idx").on(t.status)],
);

export const propertyImages = sqliteTable(
  "property_images",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    propertyId: integer("property_id").notNull(),
    url: text("url").notNull(),
    /** foto original sem marca d'água (nunca sobrescrita) */
    originalUrl: text("original_url"),
    sortOrder: integer("sort_order").notNull().default(0),
    isPrimary: integer("is_primary").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index("property_images_property_idx").on(t.propertyId)],
);

/** Fotos enviadas pelo painel, guardadas no próprio banco e servidas em /api/media/:id */
export const media = sqliteTable("media", {
  id: text("id").primaryKey(),
  mime: text("mime").notNull(),
  size: integer("size").notNull(),
  data: text("data").notNull(),
  /** nome original do arquivo, mostrado na biblioteca de mídia */
  name: text("name"),
  /** texto alternativo (acessibilidade/SEO) */
  alt: text("alt"),
  /** id da mídia original quando esta é uma versão derivada (marca d'água) */
  originalId: text("original_id"),
  /** original | watermarked */
  variant: text("variant"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

/* ------------------------------------------------------- proprietários */

export const owners = sqliteTable("owners", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  phone: text("phone"),
  email: text("email"),
  notes: text("notes"),
  /** prospeccao | em_negociacao | captado | perdido */
  captureStatus: text("capture_status").notNull().default("prospeccao"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

/* ------------------------------------------------------------ clientes */

export const clients = sqliteTable("clients", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  email: text("email"),
  interest: text("interest"),
  priceMin: real("price_min"),
  priceMax: real("price_max"),
  districts: text("districts"),
  bedrooms: integer("bedrooms"),
  notes: text("notes"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const clientInteractions = sqliteTable("client_interactions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  clientId: integer("client_id").notNull(),
  body: text("body").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

/* --------------------------------------------------------------- leads */

export const leads = sqliteTable("leads", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  interest: text("interest").notNull(),
  message: text("message"),
  source: text("source").notNull().default("site"),
  email: text("email"),
  /** novo | primeiro_contato | qualificado | imovel_apresentado | visita_agendada | proposta_enviada | negociacao | venda_fechada */
  stage: text("stage").notNull().default("novo"),
  /** aberto | perdido | ganho */
  status: text("status").notNull().default("aberto"),
  lostReason: text("lost_reason"),
  clientId: integer("client_id"),
  propertyId: integer("property_id"),
  nextAction: text("next_action"),
  nextActionAt: integer("next_action_at", { mode: "timestamp" }),
  /* origem externa (portais, Meta, campanhas) */
  portal: text("portal"),
  channel: text("channel"),
  campaign: text("campaign"),
  utmSource: text("utm_source"),
  utmMedium: text("utm_medium"),
  utmCampaign: text("utm_campaign"),
  externalId: text("external_id"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }),
});

export type Lead = typeof leads.$inferSelect;

export const leadNotes = sqliteTable("lead_notes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  leadId: integer("lead_id").notNull(),
  body: text("body").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

/* ------------------------------------------------------ agenda/tarefas */

export const tasks = sqliteTable("tasks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  /** visita | retorno | reuniao | proposta | follow_up | outro */
  type: text("type").notNull().default("visita"),
  dueAt: integer("due_at", { mode: "timestamp" }).notNull(),
  /** pendente | concluida | cancelada */
  status: text("status").notNull().default("pendente"),
  leadId: integer("lead_id"),
  clientId: integer("client_id"),
  propertyId: integer("property_id"),
  notes: text("notes"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

/* -------------------------------------------------- propostas/negócios */

export const deals = sqliteTable("deals", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  clientId: integer("client_id"),
  leadId: integer("lead_id"),
  propertyId: integer("property_id"),
  clientName: text("client_name"),
  askingPrice: real("asking_price"),
  offerPrice: real("offer_price"),
  /** enviada | em_negociacao | aceita | recusada | fechada */
  status: text("status").notNull().default("enviada"),
  commissionRate: real("commission_rate"),
  commissionValue: real("commission_value"),
  notes: text("notes"),
  dealDate: integer("deal_date", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

/* ------------------------------------------------------- configurações */

export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyName: text("company_name").notNull().default("Edy Premi Imóveis"),
  brokerName: text("broker_name").notNull().default("Edy Premi"),
  whatsapp: text("whatsapp").notNull().default(""),
  email: text("email").notNull().default(""),
  creci: text("creci").notNull().default(""),
  address: text("address").notNull().default(""),
  instagram: text("instagram").notNull().default(""),
  facebook: text("facebook").notNull().default(""),
  commissionRate: real("commission_rate").notNull().default(6),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

/* ------------------------------------------------- editor do site (CMS) */

/**
 * Versões do conteúdo editável do site público.
 * status: draft (rascunho em edição) | published (no ar) | archived (histórico)
 * data: JSON com o conteúdo completo (ver src/web/lib/site-content.ts)
 */
export const siteContent = sqliteTable(
  "site_content",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    status: text("status").notNull().default("draft"),
    data: text("data").notNull(),
    label: text("label"),
    author: text("author"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    publishedAt: integer("published_at", { mode: "timestamp" }),
  },
  (t) => [index("site_content_status_idx").on(t.status)],
);

export type SiteContentRow = typeof siteContent.$inferSelect;

/* ------------------------------------------------------ integrações */

/**
 * Integrações externas (portais, WhatsApp/Meta, Google, feeds, IA).
 * `config` guarda credenciais e SÓ é lido no servidor — a API devolve mascarado.
 * status: nao_configurado | aguardando_credencial | configurando | conectado | erro
 */
export const integrations = sqliteTable("integrations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  key: text("key").notNull().unique(),
  status: text("status").notNull().default("nao_configurado"),
  enabled: integer("enabled").notNull().default(0),
  /** JSON com credenciais/opções — nunca enviado cru ao navegador */
  config: text("config"),
  lastSyncAt: integer("last_sync_at", { mode: "timestamp" }),
  lastTestAt: integer("last_test_at", { mode: "timestamp" }),
  lastError: text("last_error"),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

/** Histórico de testes, sincronizações e webhooks de cada integração. */
export const integrationEvents = sqliteTable(
  "integration_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    integrationKey: text("integration_key").notNull(),
    /** test | sync | webhook | error | config */
    kind: text("kind").notNull().default("sync"),
    ok: integer("ok").notNull().default(1),
    message: text("message"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index("integration_events_key_idx").on(t.integrationKey)],
);

/** Autorização e situação de cada imóvel em cada canal de distribuição. */
export const propertyChannels = sqliteTable(
  "property_channels",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    propertyId: integer("property_id").notNull(),
    /** site | feed | zap | vivareal | olx | imovelweb */
    channel: text("channel").notNull(),
    authorized: integer("authorized").notNull().default(0),
    /** nao_enviado | aguardando | publicado | erro */
    status: text("status").notNull().default("nao_enviado"),
    message: text("message"),
    lastSyncAt: integer("last_sync_at", { mode: "timestamp" }),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index("property_channels_property_idx").on(t.propertyId)],
);

/* -------------------------------------------------- conversas / inbox */

export const conversations = sqliteTable(
  "conversations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** whatsapp | instagram | facebook | site | teste */
    channel: text("channel").notNull().default("site"),
    externalId: text("external_id"),
    leadId: integer("lead_id"),
    clientId: integer("client_id"),
    propertyId: integer("property_id"),
    agentId: integer("agent_id"),
    contactName: text("contact_name"),
    contactPhone: text("contact_phone"),
    /** ia | humano */
    mode: text("mode").notNull().default("ia"),
    assignedTo: integer("assigned_to"),
    assignedName: text("assigned_name"),
    transferReason: text("transfer_reason"),
    transferredAt: integer("transferred_at", { mode: "timestamp" }),
    /** aberta | fechada */
    status: text("status").notNull().default("aberta"),
    unread: integer("unread").notNull().default(0),
    lastMessage: text("last_message"),
    lastMessageAt: integer("last_message_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("conversations_status_idx").on(t.status),
    index("conversations_channel_external_idx").on(t.channel, t.externalId),
  ],
);

export const messages = sqliteTable(
  "messages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    conversationId: integer("conversation_id").notNull(),
    /** in (cliente) | out (nós) */
    direction: text("direction").notNull().default("in"),
    /** cliente | ia | humano | sistema */
    author: text("author").notNull().default("cliente"),
    authorName: text("author_name"),
    body: text("body").notNull(),
    externalId: text("external_id"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index("messages_conversation_idx").on(t.conversationId)],
);

/* --------------------------------------------------------- agentes IA */

export const aiAgents = sqliteTable("ai_agents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  active: integer("active").notNull().default(0),
  provider: text("provider").notNull().default("gateway"),
  model: text("model").notNull().default("openai/gpt-5.4-mini"),
  greeting: text("greeting").notNull().default(""),
  instructions: text("instructions").notNull().default(""),
  tone: text("tone").notNull().default(""),
  hoursStart: text("hours_start").notNull().default("08:00"),
  hoursEnd: text("hours_end").notNull().default("20:00"),
  /** JSON: string[] de canais permitidos */
  channels: text("channels").notNull().default("[\"site\"]"),
  qualification: text("qualification").notNull().default(""),
  transferRules: text("transfer_rules").notNull().default(""),
  transferMessage: text("transfer_message").notNull().default(""),
  idleMinutes: integer("idle_minutes").notNull().default(30),
  humanConditions: text("human_conditions").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

/* --------------------------------------------------------- automações */

export const automations = sqliteTable("automations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  trigger: text("trigger").notNull(),
  /** JSON */
  conditions: text("conditions").notNull().default("{}"),
  /** JSON: array de ações */
  actions: text("actions").notNull().default("[]"),
  active: integer("active").notNull().default(0),
  runCount: integer("run_count").notNull().default(0),
  errorCount: integer("error_count").notNull().default(0),
  lastRunAt: integer("last_run_at", { mode: "timestamp" }),
  lastError: text("last_error"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const automationRuns = sqliteTable(
  "automation_runs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    automationId: integer("automation_id").notNull(),
    ok: integer("ok").notNull().default(1),
    message: text("message"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index("automation_runs_automation_idx").on(t.automationId)],
);

/* ------------------------------------------------------- marca d'água */

/** Linha única (id = 1) com a configuração da marca d'água das fotos. */
export const watermarkSettings = sqliteTable("watermark_settings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  enabled: integer("enabled").notNull().default(0),
  logoUrl: text("logo_url"),
  /** largura da marca em % da largura da foto */
  size: integer("size").notNull().default(22),
  /** 0-100 */
  opacity: integer("opacity").notNull().default(70),
  /** margem em % da largura da foto */
  margin: integer("margin").notNull().default(4),
  /** top-left | top-center | ... | bottom-right */
  position: text("position").notNull().default("bottom-right"),
  applyToNewUploads: integer("apply_to_new_uploads").notNull().default(1),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

/* ---------------------------------------------------------- auditoria */

export const auditLog = sqliteTable(
  "audit_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id"),
    userName: text("user_name"),
    action: text("action").notNull(),
    entity: text("entity"),
    entityId: text("entity_id"),
    detail: text("detail"),
    ip: text("ip"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index("audit_log_created_idx").on(t.createdAt)],
);

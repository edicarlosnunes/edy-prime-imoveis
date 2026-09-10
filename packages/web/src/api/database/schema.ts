import { sqliteTable, integer, text, real, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { FALLBACK_MODEL } from "../agent/model";

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
    /**
     * V3 — serial global `TIPO-ANO-SEQUENCIAL` (ex.: AP-2026-000124).
     *
     * Nullable de propósito: os imóveis que já existem ficam com NULL e o
     * `code` antigo deles NÃO é renumerado. Índice UNIQUE aceita vários NULL
     * no SQLite, então a unicidade vale só para os seriais realmente emitidos.
     */
    serial: text("serial"),
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

    /* ------------------------------------------------ V2: documentação */
    /**
     * Pergunta independente: o imóvel pertence a condomínio?
     * NÃO é inferida do `type` — casa comum fora de condomínio responde 0.
     * NULL = ainda não respondido.
     */
    inCondominium: integer("in_condominium"),
    /** 1 = há herança/inventário/espólio envolvido (liga o bloco) */
    hasHeranca: integer("has_heranca"),
    /** 1 = negociação de posse/cessão de direitos (liga o bloco) */
    hasPosse: integer("has_posse"),
    /** 1 = financiamento ativo / alienação fiduciária (liga o bloco) */
    hasFinanciamento: integer("has_financiamento"),
    /** 1 = imóvel ocupado/alugado (liga o bloco) */
    hasAluguel: integer("has_aluguel"),

    /* ------------------------------------------------ V2: revalidação */
    /**
     * Entrada na carteira — origem do ciclo de 4 meses. NULL nos imóveis
     * que já existiam: não são backfillados automaticamente e ficam fora
     * da fila até alguém definir a data.
     */
    portfolioEntryAt: integer("portfolio_entry_at", { mode: "timestamp" }),
    lastRevalidationAt: integer("last_revalidation_at", { mode: "timestamp" }),
    nextRevalidationAt: integer("next_revalidation_at", { mode: "timestamp" }),
    /** último desfecho registrado (ver property-revalidation.ts) */
    revalidationStatus: text("revalidation_status"),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("properties_status_idx").on(t.status),
    index("properties_next_revalidation_idx").on(t.nextRevalidationAt),
    /* backstop do serial: o banco recusa duplicata mesmo se alguém gerar
       serial por fora de lib/serial-counter.ts */
    uniqueIndex("properties_serial_idx").on(t.serial),
  ],
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

/* --------------------------------------- V2: documentação inteligente */

/**
 * Respostas do checklist. Uma linha por item respondido — item não respondido
 * simplesmente não tem linha. `itemKey` vem do catálogo em
 * web/lib/property-docs-catalog.ts.
 */
export const propertyChecklist = sqliteTable(
  "property_checklist",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    propertyId: integer("property_id").notNull(),
    itemKey: text("item_key").notNull(),
    /** sim | nao | nao_sabe | na */
    answer: text("answer").notNull(),
    note: text("note"),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index("property_checklist_property_idx").on(t.propertyId)],
);

/**
 * Arquivos privados de documentação. Tabela SEPARADA de `media` de propósito:
 * `media` é servida publicamente em /api/media/:id e alimenta a vitrine.
 * Documento de proprietário (matrícula, RG, inventário) nunca pode cair nessa
 * rota — estes só saem por rota autenticada do painel.
 */
export const documentFiles = sqliteTable("document_files", {
  id: text("id").primaryKey(),
  mime: text("mime").notNull(),
  size: integer("size").notNull(),
  /** conteúdo em base64 */
  data: text("data").notNull(),
  /** nome original do arquivo */
  name: text("name"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

/**
 * Documento do imóvel. Independente do checklist: o proprietário pode
 * responder todo o checklist sem anexar nada, e um documento pode existir
 * sem arquivo (só o registro do status).
 */
export const propertyDocuments = sqliteTable(
  "property_documents",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    propertyId: integer("property_id").notNull(),
    /** matricula | iptu | escritura | condominio | inventario | procuracao | contrato | certidao | planta_habite_se | outros */
    category: text("category").notNull(),
    /** recebido | aguardando_analise | analisado | regular | pendencia */
    status: text("status").notNull().default("recebido"),
    /** rótulo livre ("Matrícula 12.345 - 2º CRI") */
    title: text("title"),
    /** id em document_files — NULL quando não há anexo */
    fileId: text("file_id"),
    fileName: text("file_name"),
    /** observação da análise / motivo da pendência */
    note: text("note"),
    receivedAt: integer("received_at", { mode: "timestamp" }),
    analyzedAt: integer("analyzed_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index("property_documents_property_idx").on(t.propertyId)],
);

/* ------------------------------------------- V2: revalidação 4 meses */

/** Histórico de revalidações. Append-only: nada aqui é apagado ou editado. */
export const propertyRevalidations = sqliteTable(
  "property_revalidations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    propertyId: integer("property_id").notNull(),
    /** disponivel | vendido | nao_deseja_vender | alterou_condicoes | retornar_depois | sem_resposta */
    outcome: text("outcome").notNull(),
    note: text("note"),
    /** data do contato/desfecho */
    revalidatedAt: integer("revalidated_at", { mode: "timestamp" }).notNull(),
    /** próxima data calculada no momento do registro (NULL quando encerra) */
    nextDueAt: integer("next_due_at", { mode: "timestamp" }),
    userName: text("user_name"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index("property_revalidations_property_idx").on(t.propertyId)],
);

/* ------------------------------------------------------- proprietários */

export const owners = sqliteTable("owners", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  phone: text("phone"),
  email: text("email"),
  notes: text("notes"),
  /**
   * V3 — CPF ou CNPJ do proprietário e documento de identidade (RG/CNH).
   *
   * Alimentam a Ficha Técnica e a Autorização de Venda. NÃO identificam
   * imóvel: a identidade da unidade continua sendo CEP + número +
   * complementos, e a do proprietário continua sendo o telefone.
   */
  document: text("document"),
  rg: text("rg"),
  /** prospeccao | em_negociacao | captado | perdido */
  captureStatus: text("capture_status").notNull().default("prospeccao"),
  /**
   * V3 — alerta de POSSÍVEL DUPLICADO (revisão humana).
   *
   * O telefone é a chave de reuso do proprietário; o e-mail NÃO mescla mais.
   * E-mail repetido cria o proprietário normalmente e apenas levanta este
   * alerta, que nunca bloqueia e não afeta serial, captação ou documentos.
   * Limpar o alerta = `possible_duplicate = 0`, preservando a referência.
   */
  possibleDuplicate: integer("possible_duplicate").notNull().default(0),
  duplicateOfOwnerId: integer("duplicate_of_owner_id"),
  duplicateNote: text("duplicate_note"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

/* ------------------------------------------- serial global do CRM (V3) */

/**
 * Contador do sequencial GLOBAL do serial (`TIPO-ANO-SEQUENCIAL`).
 *
 * Linha única (`id = 1`). Sem contador por tipo e sem reinício por ano, de
 * propósito: dois tipos diferentes nunca compartilham o mesmo número-base.
 * A reserva é feita em um único statement atômico — ver `lib/serial-counter.ts`.
 */
export const crmSerials = sqliteTable("crm_serials", {
  id: integer("id").primaryKey(),
  /** último número reservado; a próxima reserva devolve `next + 1` */
  next: integer("next").notNull().default(0),
});


/* ----------------------------------------------- Radar de Captação V1 */

export const propertyCaptures = sqliteTable(
  "property_captures",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ownerId: integer("owner_id").notNull(),
    city: text("city").notNull().default("Praia Grande"),
    district: text("district"),
    address: text("address"),
    propertyType: text("property_type"),
    /**
     * V3 — serial global do imóvel. Nullable: captações antigas ficam com NULL
     * e nada é renumerado. Ficha Técnica (FC-) e Autorização (AV-) herdam este
     * número-base, nunca criam sequência nova.
     */
    serial: text("serial"),
    /* V3 — endereço estruturado. `address` (texto livre) continua existindo e
       não é reescrito: as colunas abaixo são o caminho novo, preenchidas pela
       consulta de CEP ou pelo preenchimento manual. */
    cep: text("cep"),
    street: text("street"),
    number: text("number"),
    state: text("state"),
    /**
     * Complementos em JSON (apartamento, bloco, torre, sala, lote...).
     *
     * Decisão de implementação: um campo JSON em vez de 14 colunas esparsas —
     * os 14 campos do formulário continuam existindo, mas a consulta por
     * unidade é servida por `unit_key`, que é o que precisa ser indexado.
     */
    complements: text("complements"),
    /**
     * Identidade da unidade: CEP + número + complementos identificadores.
     *
     * Duas captações com a mesma chave são o MESMO imóvel. O telefone do
     * proprietário NÃO entra aqui: telefone identifica pessoa, não imóvel.
     * Gerado por `lib/capture-address.ts#unitKey`.
     */
    unitKey: text("unit_key"),
    /* V3 — "DOCUMENTAÇÃO VALIDADA PELA EQUIPE": registro de quem validou e
       quando, sem exigir upload falso de documento. */
    docValidatedBy: text("doc_validated_by"),
    docValidatedAt: integer("doc_validated_at", { mode: "timestamp" }),
    docValidationNote: text("doc_validation_note"),
    /**
     * V3 — FOTOS DO PROPRIETÁRIO / PROVISÓRIAS, em JSON.
     *
     * Ficam aqui de propósito, fora de `property_images`: aquela tabela é a
     * fonte do que o site público mostra, e foto de proprietário só vira
     * oficial por ato explícito do corretor. Ver lib/capture-photos.ts.
     */
    ownerPhotos: text("owner_photos"),
    askingPrice: real("asking_price"),
    estimatedPrice: real("estimated_price"),
    source: text("source").notNull().default("manual"),
    /** novo_contato | avaliacao | documentacao | captado | perdido */
    stage: text("stage").notNull().default("novo_contato"),
    intention: text("intention"),
    nextAction: text("next_action"),
    nextActionAt: integer("next_action_at", { mode: "timestamp" }),
    appraisalStatus: text("appraisal_status").notNull().default("pendente"),
    appraisalAt: integer("appraisal_at", { mode: "timestamp" }),
    appraisalNote: text("appraisal_note"),
    docStatus: text("doc_status").notNull().default("nao_iniciado"),
    notes: text("notes"),
    lostReason: text("lost_reason"),
    lostDetail: text("lost_detail"),
    convertedPropertyId: integer("converted_property_id"),
    convertedAt: integer("converted_at", { mode: "timestamp" }),
    stageChangedAt: integer("stage_changed_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("property_captures_owner_idx").on(t.ownerId),
    index("property_captures_stage_idx").on(t.stage),
    index("property_captures_next_action_idx").on(t.nextActionAt),
    /* backstop do serial, igual ao de properties */
    uniqueIndex("property_captures_serial_idx").on(t.serial),
    /* NÃO é único: o mesmo imóvel pode ser recaptado depois de perdido, e
       bloquear isso no banco impediria trabalho legítimo. A verificação de
       duplicidade é feita na aplicação, que avisa em vez de travar. */
    index("property_captures_unit_idx").on(t.unitKey),
  ],
);

export type PropertyCapture = typeof propertyCaptures.$inferSelect;

/* ------------------------- documentos impressos do CRM (V3): FC / AV */

/**
 * Ficha Técnica (`FC-`) e Autorização de Venda (`AV-`).
 *
 * Uma linha por documento emitido, com serial herdado do imóvel e rastreio de
 * status. `snapshot` guarda os dados como estavam na emissão: se o preço mudar
 * depois, a via impressa que o proprietário assinou continua conferindo com o
 * que está registrado aqui.
 */
export const crmDocuments = sqliteTable(
  "crm_documents",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** ficha_tecnica | autorizacao */
    kind: text("kind").notNull(),
    /** FC-AP-2026-000124 | AV-AP-2026-000124 — herda o serial-base */
    serial: text("serial").notNull(),
    baseSerial: text("base_serial"),
    captureId: integer("capture_id"),
    propertyId: integer("property_id"),
    ownerId: integer("owner_id"),
    /**
     * gerada | impressa | com_corretor | entregue_ao_proprietario | assinada |
     * devolvida | arquivada | cancelada
     */
    status: text("status").notNull().default("gerada"),
    /** dados congelados na emissão (JSON) */
    snapshot: text("snapshot"),
    note: text("note"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    uniqueIndex("crm_documents_serial_idx").on(t.serial),
    index("crm_documents_capture_idx").on(t.captureId),
    index("crm_documents_property_idx").on(t.propertyId),
  ],
);

/** Histórico de status do documento — só cresce, nunca é reescrito. */
export const crmDocumentEvents = sqliteTable(
  "crm_document_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    documentId: integer("document_id").notNull(),
    status: text("status").notNull(),
    note: text("note"),
    userId: integer("user_id"),
    userName: text("user_name"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index("crm_document_events_document_idx").on(t.documentId)],
);

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
  /* qualificação determinística (F4.1) — score 0-100, sem IA */
  score: integer("score").notNull().default(0),
  /** quente | morno | frio */
  scoreTier: text("score_tier").notNull().default("frio"),
  /** JSON string[] com os motivos explicáveis do score */
  scoreReasons: text("score_reasons"),
  scoreAt: integer("score_at", { mode: "timestamp" }),
  qualifiedAt: integer("qualified_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }),
}, (table) => ({
  stageIdx: index("leads_stage_idx").on(table.stage),
  scoreIdx: index("leads_score_idx").on(table.score),
  phoneIdx: index("leads_phone_idx").on(table.phone),
  nextActionIdx: index("leads_next_action_idx").on(table.nextActionAt),
}));

export type Lead = typeof leads.$inferSelect;

export const leadNotes = sqliteTable("lead_notes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  leadId: integer("lead_id").notNull(),
  body: text("body").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

/**
 * Perfil de necessidade do lead (1:1). Tudo nullable de propósito:
 * `null` significa "não informado" — nunca inventar dado ausente.
 * `fieldsSource` guarda a origem de cada campo (deterministico | ia | manual);
 * campo com origem `manual` nunca é sobrescrito automaticamente.
 */
export const leadProfile = sqliteTable("lead_profile", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  leadId: integer("lead_id").notNull().unique(),
  /** comprar | alugar | investir | vender */
  purpose: text("purpose"),
  propertyType: text("property_type"),
  city: text("city"),
  /** JSON string[] */
  districts: text("districts"),
  budgetMin: real("budget_min"),
  budgetMax: real("budget_max"),
  bedrooms: integer("bedrooms"),
  suites: integer("suites"),
  parking: integer("parking"),
  areaMin: real("area_min"),
  /** sim | nao | nao_sei */
  financing: text("financing"),
  fgts: text("fgts"),
  tradeIn: text("trade_in"),
  tradeInDetail: text("trade_in_detail"),
  /** imediato | 30_dias | 90_dias | sem_pressa */
  timeframe: text("timeframe"),
  /** JSON string[] */
  preferences: text("preferences"),
  /** JSON string[] */
  restrictions: text("restrictions"),
  /** whatsapp | ligacao | email */
  contactPreference: text("contact_preference"),
  contactWindow: text("contact_window"),
  summary: text("summary"),
  /* sinais persistidos que alimentam o score */
  wantsVisit: integer("wants_visit").notNull().default(0),
  wantsHuman: integer("wants_human").notNull().default(0),
  cashPayment: integer("cash_payment").notNull().default(0),
  justLooking: integer("just_looking").notNull().default(0),
  messagesCount: integer("messages_count").notNull().default(0),
  contactDays: integer("contact_days").notNull().default(0),
  lastCustomerAt: integer("last_customer_at", { mode: "timestamp" }),
  /** deterministico | ia | manual */
  source: text("source").notNull().default("deterministico"),
  /** JSON Record<campo, origem> */
  fieldsSource: text("fields_source"),
  completeness: integer("completeness").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }),
});

export type LeadProfile = typeof leadProfile.$inferSelect;

/** Timeline comercial append-only. Nada aqui é editado ou apagado. */
export const leadEvents = sqliteTable("lead_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  leadId: integer("lead_id").notNull(),
  /** criado | mensagem | qualificacao | score | etapa | nota | automacao */
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  detail: text("detail"),
  /** cliente | ia | corretor | sistema */
  actorType: text("actor_type").notNull().default("sistema"),
  actorName: text("actor_name"),
  scoreBefore: integer("score_before"),
  scoreAfter: integer("score_after"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
}, (table) => ({
  leadIdx: index("lead_events_lead_idx").on(table.leadId),
  createdIdx: index("lead_events_created_idx").on(table.createdAt),
}));

export type LeadEvent = typeof leadEvents.$inferSelect;

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
  /** vínculo estrutural com o Radar; nullable para tarefas antigas */
  captureId: integer("capture_id"),
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
  companyName: text("company_name").notNull().default("Edy Prime Imóveis"),
  brokerName: text("broker_name").notNull().default("Edy Prime"),
  whatsapp: text("whatsapp").notNull().default(""),
  email: text("email").notNull().default(""),
  creci: text("creci").notNull().default(""),
  /** V3 — registro de perito avaliador, impresso nos documentos. */
  cnai: text("cnai").notNull().default(""),
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
  (t) => [
    index("messages_conversation_idx").on(t.conversationId),
    /**
     * Idempotência (10/09/2026): a Meta reenvia o mesmo webhook quando não
     * recebe 200 rápido. Sem unicidade, a mesma mensagem entrava duas vezes no
     * inbox e a IA respondia duas vezes ao cliente.
     * No SQLite NULLs são distintos entre si, então mensagens sem `external_id`
     * (chat do site, IA, sistema) continuam podendo ser inseridas à vontade.
     */
    uniqueIndex("messages_conversation_external_uk").on(t.conversationId, t.externalId),
  ],
);

/**
 * Registro de idempotência dos webhooks de entrada.
 *
 * É a trava principal contra reprocessamento: antes de tocar em conversa,
 * mensagem, lead ou IA, a rota tenta "reservar" o id externo do evento aqui.
 * O INSERT com unicidade em (channel, external_id) é atômico, então em duas
 * requisições concorrentes com o mesmo id apenas uma vence — a outra é
 * descartada como duplicata. O escopo por canal evita colisão entre
 * WhatsApp (wamid...), Instagram/Messenger (mid...) e Lead Ads.
 */
export const inboundEvents = sqliteTable(
  "inbound_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** whatsapp | instagram | facebook | leadgen */
    channel: text("channel").notNull(),
    externalId: text("external_id").notNull(),
    /**
     * processing = alguém está processando agora (dono do prazo em claimed_at)
     * completed  = concluído; todo reenvio posterior é descartado
     * failed     = falhou de forma controlada; retry liberado imediatamente
     *
     * Sem esse estado, uma falha depois da reserva deixaria a mensagem presa:
     * o reenvio da Meta bateria numa reserva órfã e seria descartado para
     * sempre, perdendo mensagem legítima de cliente.
     */
    status: text("status").notNull().default("processing"),
    /** até onde o processamento chegou: claimed | stored | lead_linked | replied */
    stage: text("stage").notNull().default("claimed"),
    /** nº de vezes que a reserva foi assumida; usado como compare-and-swap */
    attempts: integer("attempts").notNull().default(1),
    lastError: text("last_error"),
    /** início do prazo da reserva; expirado, outro processo pode assumir */
    claimedAt: integer("claimed_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    uniqueIndex("inbound_events_channel_external_uk").on(t.channel, t.externalId),
    index("inbound_events_status_idx").on(t.status, t.claimedAt),
    index("inbound_events_created_idx").on(t.createdAt),
  ],
);

/* ------------------------------------------- guarda do chat publico */

/**
 * Contadores persistentes do chat público (canal `site`) contra abuso e custo.
 * `fingerprint` é hash com segredo do servidor — o IP nunca é gravado em claro.
 * `kind`: "conversation" (conversa nova), "ai" (chamada do modelo),
 * "block" (limite atingido; `reason` guarda o motivo interno para auditoria).
 */
export const chatGuardEvents = sqliteTable(
  "chat_guard_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    channel: text("channel").notNull().default("site"),
    fingerprint: text("fingerprint").notNull(),
    kind: text("kind").notNull(),
    reason: text("reason"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("chat_guard_events_lookup_idx").on(t.channel, t.kind, t.createdAt),
    index("chat_guard_events_fingerprint_idx").on(t.fingerprint, t.createdAt),
  ],
);

/* --------------------------------------------------------- agentes IA */

export const aiAgents = sqliteTable("ai_agents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  active: integer("active").notNull().default(0),
  provider: text("provider").notNull().default("gateway"),
  model: text("model").notNull().default(FALLBACK_MODEL),
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

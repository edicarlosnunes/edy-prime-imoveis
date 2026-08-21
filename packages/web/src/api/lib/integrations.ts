/**
 * Catálogo de integrações + leitura/escrita da configuração.
 *
 * REGRA: nada de integração falsa. Cada item declara o método OFICIAL suportado
 * pelo serviço e o que ainda falta para funcionar. `secret: true` nunca volta
 * cru para o navegador (ver `maskConfig`).
 */
import { and, desc, eq } from "drizzle-orm";
import * as schema from "../database/schema";
import type { AdminDb } from "./admin-base";

export type IntegrationStatus =
  | "nao_configurado"
  | "aguardando_credencial"
  | "configurando"
  | "conectado"
  | "erro"
  | "nao_disponivel";

export type FieldType = "text" | "password" | "url" | "textarea" | "select" | "switch";

export interface IntegrationField {
  key: string;
  label: string;
  type: FieldType;
  help?: string;
  placeholder?: string;
  secret?: boolean;
  options?: { value: string; label: string }[];
}

export interface IntegrationDef {
  key: string;
  category: string;
  name: string;
  /** iniciais mostradas no lugar do logotipo (não usamos marcas de terceiros) */
  mark: string;
  purpose: string;
  /** método oficialmente suportado pelo serviço */
  method: string;
  /** o que o usuário precisa providenciar fora do sistema */
  pending: string[];
  fields: IntegrationField[];
  canTest: boolean;
  canSync: boolean;
  docsUrl?: string;
  /** false = não existe caminho oficial hoje (fica em "não disponível") */
  available: boolean;
  /** integrações que funcionam sem credencial externa (feed, sitemap, site) */
  selfServed?: boolean;
}

export const CATEGORIES = [
  "Portais de Imóveis",
  "Entrada de Leads",
  "WhatsApp",
  "Instagram / Facebook / Meta",
  "Google",
  "XML / Feeds",
  "Site Edy Premi",
  "Agentes de IA",
] as const;

const imageVariantField: IntegrationField = {
  key: "imageVariant",
  label: "Fotos enviadas ao canal",
  type: "select",
  help: "Cada portal tem regra própria sobre marca d'água. A foto original nunca é alterada.",
  options: [
    { value: "marcada", label: "Com marca d'água (quando ativa)" },
    { value: "original", label: "Original, sem marca" },
  ],
};

const feedFields: IntegrationField[] = [
  {
    key: "notes",
    label: "Observações internas",
    type: "textarea",
    help: "Anote aqui o e-mail/protocolo do contato com o portal.",
  },
];

export const INTEGRATIONS: IntegrationDef[] = [
  /* ------------------------------------------------ portais de imóveis */
  {
    key: "zap_vivareal",
    category: "Portais de Imóveis",
    name: "ZAP Imóveis / VivaReal (Canal Pro)",
    mark: "ZV",
    purpose: "Publicar os imóveis autorizados no ZAP e no VivaReal.",
    method:
      "Importação por XML: o portal lê o feed em uma URL pública a cada ~12 h. Não existe API pública de publicação.",
    pending: [
      "Contrato ativo do Canal Pro (Grupo ZAP)",
      "Cadastrar a URL do nosso feed XML no Canal Pro",
      "Aguardar a primeira leitura do portal e conferir os imóveis importados",
    ],
    fields: [
      { key: "accountId", label: "Identificação do anunciante (Canal Pro)", type: "text" },
      imageVariantField,
      ...feedFields,
    ],
    canTest: true,
    canSync: false,
    docsUrl: "https://ajuda.zapimoveis.com.br/s/article/como-ativar-a-integracao-de-imoveis",
    available: true,
  },
  {
    key: "olx",
    category: "Portais de Imóveis",
    name: "OLX Imóveis",
    mark: "OL",
    purpose: "Publicar os imóveis autorizados na OLX.",
    method:
      "Importação de anúncios por XML documentada pela OLX (developers.olx.com.br) — o portal busca o arquivo na URL informada.",
    pending: [
      "Conta elegível para importação por XML na OLX",
      "Informar a URL do feed no painel da OLX",
    ],
    fields: [
      { key: "accountId", label: "Conta/anunciante OLX", type: "text" },
      imageVariantField,
      ...feedFields,
    ],
    canTest: true,
    canSync: false,
    docsUrl: "https://developers.olx.com.br/anuncio/xml/real_estate/home.html",
    available: true,
  },
  {
    key: "imovelweb",
    category: "Portais de Imóveis",
    name: "Imovelweb / Wimoveis",
    mark: "IW",
    purpose: "Publicar os imóveis autorizados no Imovelweb.",
    method:
      "XML cadastrado na Central do Anunciante + integração de leads configurada no painel do portal.",
    pending: [
      "Plano ativo na Central do Anunciante",
      "Cadastrar a URL do feed XML",
      "Ativar a integração de leads apontando para o nosso webhook",
    ],
    fields: [
      { key: "accountId", label: "Código do anunciante", type: "text" },
      imageVariantField,
      ...feedFields,
    ],
    canTest: true,
    canSync: false,
    docsUrl: "https://help.imovelweb.com.br/s/article/Como-habilito-uma-integra%C3%A7%C3%A3o-de-leads",
    available: true,
  },
  {
    key: "mercadolivre",
    category: "Portais de Imóveis",
    name: "Mercado Livre Imóveis",
    mark: "ML",
    purpose: "Publicar imóveis no Mercado Livre.",
    method:
      "Não há hoje caminho oficial de publicação de imóveis por API/feed liberado para imobiliárias no Brasil. Anúncio é manual no painel do Mercado Livre.",
    pending: ["Depende do Mercado Livre liberar publicação de imóveis por API ou XML."],
    fields: [],
    canTest: false,
    canSync: false,
    available: false,
  },

  /* ---------------------------------------------------- entrada de leads */
  {
    key: "lead_webhook",
    category: "Entrada de Leads",
    name: "Webhook de leads (portais e parceiros)",
    mark: "WH",
    purpose:
      "Endereço único para portais/parceiros entregarem leads direto no CRM, com origem, campanha e UTM.",
    method: "POST JSON em /api/webhooks/leads/:token — token gerado aqui, validado no servidor.",
    pending: ["Informar a URL do webhook no painel de cada portal/parceiro"],
    fields: [
      {
        key: "token",
        label: "Token do webhook",
        type: "password",
        secret: true,
        help: "Gerado automaticamente ao salvar. Faz parte da URL.",
      },
    ],
    canTest: true,
    canSync: false,
    available: true,
    selfServed: true,
  },
  {
    key: "meta_lead_ads",
    category: "Entrada de Leads",
    name: "Meta Lead Ads (Facebook/Instagram)",
    mark: "LA",
    purpose: "Receber leads dos formulários de anúncio da Meta no CRM.",
    method:
      "Webhook oficial da Graph API (campo leadgen) + token de página com permissão leads_retrieval.",
    pending: [
      "App na Meta for Developers com produto Webhooks",
      "Página do Facebook conectada e token de página (leads_retrieval)",
      "Revisão/permissões aprovadas pela Meta",
      "App Secret para validar a assinatura X-Hub-Signature-256",
    ],
    fields: [
      { key: "appId", label: "App ID", type: "text" },
      { key: "appSecret", label: "App Secret", type: "password", secret: true },
      { key: "pageId", label: "ID da página", type: "text" },
      { key: "pageToken", label: "Token da página", type: "password", secret: true },
      { key: "verifyToken", label: "Verify token do webhook", type: "password", secret: true },
    ],
    canTest: true,
    canSync: false,
    docsUrl: "https://developers.facebook.com/docs/marketing-api/guides/lead-ads",
    available: true,
  },

  /* ------------------------------------------------------------ whatsapp */
  {
    key: "whatsapp_cloud",
    category: "WhatsApp",
    name: "WhatsApp Cloud API (oficial)",
    mark: "WA",
    purpose: "Receber e responder mensagens de WhatsApp dentro do painel (com ou sem IA).",
    method:
      "WhatsApp Cloud API da Meta: número aprovado, token do sistema, webhook verificado. Nada de WhatsApp Web/scraping.",
    pending: [
      "Conta Meta Business verificada",
      "App na Meta for Developers com o produto WhatsApp",
      "Número de telefone aprovado e registrado na Cloud API",
      "Phone Number ID + WABA ID",
      "Token permanente (system user) com whatsapp_business_messaging",
      "Webhook apontando para /api/webhooks/whatsapp com o verify token abaixo",
      "Templates aprovados para mensagens fora da janela de 24 h",
    ],
    fields: [
      { key: "phoneNumberId", label: "Phone Number ID", type: "text" },
      { key: "wabaId", label: "WhatsApp Business Account ID", type: "text" },
      { key: "accessToken", label: "Access token permanente", type: "password", secret: true },
      { key: "verifyToken", label: "Verify token do webhook", type: "password", secret: true },
      { key: "appSecret", label: "App Secret (assinatura)", type: "password", secret: true },
    ],
    canTest: true,
    canSync: false,
    docsUrl: "https://developers.facebook.com/docs/whatsapp/cloud-api",
    available: true,
  },

  /* ---------------------------------------------------------------- meta */
  {
    key: "instagram_dm",
    category: "Instagram / Facebook / Meta",
    name: "Instagram Direct",
    mark: "IG",
    purpose: "Atender mensagens do Instagram no painel.",
    method: "Instagram Messaging API (Graph) com conta profissional ligada a uma página do Facebook.",
    pending: [
      "Conta Instagram profissional vinculada a uma página",
      "App Meta com Instagram Messaging e permissões aprovadas",
      "Token de página e webhook de mensagens",
    ],
    fields: [
      { key: "igUserId", label: "Instagram User ID", type: "text" },
      { key: "pageToken", label: "Token da página", type: "password", secret: true },
      { key: "verifyToken", label: "Verify token do webhook", type: "password", secret: true },
    ],
    canTest: true,
    canSync: false,
    docsUrl: "https://developers.facebook.com/docs/messenger-platform/instagram",
    available: true,
  },
  {
    key: "facebook_messenger",
    category: "Instagram / Facebook / Meta",
    name: "Facebook Messenger",
    mark: "FB",
    purpose: "Atender mensagens da página do Facebook no painel.",
    method: "Messenger Platform (Graph API) com token de página e webhook de mensagens.",
    pending: [
      "Página do Facebook com token de acesso",
      "App Meta com Messenger e permissão pages_messaging aprovada",
    ],
    fields: [
      { key: "pageId", label: "ID da página", type: "text" },
      { key: "pageToken", label: "Token da página", type: "password", secret: true },
      { key: "verifyToken", label: "Verify token do webhook", type: "password", secret: true },
    ],
    canTest: true,
    canSync: false,
    docsUrl: "https://developers.facebook.com/docs/messenger-platform",
    available: true,
  },

  /* -------------------------------------------------------------- google */
  {
    key: "google_search_console",
    category: "Google",
    name: "Google Search Console",
    mark: "SC",
    purpose: "Provar a propriedade do site e acompanhar a indexação.",
    method:
      "Verificação por meta tag HTML: o código colado aqui é publicado no <head> do site público.",
    pending: ["Código de verificação da propriedade no Search Console"],
    fields: [
      {
        key: "verification",
        label: "Código google-site-verification",
        type: "text",
        placeholder: "Só o conteúdo do content=...",
      },
    ],
    canTest: true,
    canSync: false,
    docsUrl: "https://search.google.com/search-console",
    available: true,
    selfServed: true,
  },
  {
    key: "google_analytics",
    category: "Google",
    name: "Google Analytics 4",
    mark: "GA",
    purpose: "Medir acessos e origem das visitas.",
    method: "Tag gtag.js carregada no site público com o ID de medição G-XXXXXXX.",
    pending: ["ID de medição do GA4"],
    fields: [{ key: "measurementId", label: "ID de medição (G-...)", type: "text" }],
    canTest: true,
    canSync: false,
    available: true,
    selfServed: true,
  },
  {
    key: "google_ads",
    category: "Google",
    name: "Google Ads (conversões)",
    mark: "AD",
    purpose: "Registrar conversão quando um lead é enviado pelo site.",
    method: "Tag de conversão do Google Ads (AW-...) disparada no envio do formulário.",
    pending: ["ID de conversão (AW-...) e rótulo da conversão"],
    fields: [
      { key: "conversionId", label: "ID de conversão (AW-...)", type: "text" },
      { key: "conversionLabel", label: "Rótulo da conversão", type: "text" },
    ],
    canTest: true,
    canSync: false,
    available: true,
    selfServed: true,
  },
  {
    key: "google_business",
    category: "Google",
    name: "Google Business Profile",
    mark: "GB",
    purpose: "Ficha da imobiliária no Google Maps/Busca.",
    method:
      "A Business Profile API exige solicitação de acesso aprovada pelo Google por projeto. Sem isso, a gestão é manual no painel do Google.",
    pending: [
      "Ficha verificada no Google Business Profile",
      "Acesso à Business Profile API aprovado pelo Google (formulário de solicitação)",
    ],
    fields: [
      { key: "profileUrl", label: "Link da ficha (Maps)", type: "url" },
      { key: "placeId", label: "Place ID", type: "text" },
    ],
    canTest: false,
    canSync: false,
    docsUrl: "https://developers.google.com/my-business",
    available: true,
  },

  /* ----------------------------------------------------------- xml/feeds */
  {
    key: "feed_imoveis",
    category: "XML / Feeds",
    name: "Feed XML dos imóveis",
    mark: "XM",
    purpose: "Arquivo público com os imóveis autorizados, lido pelos portais.",
    method: "Gerado por este sistema em /feed/imoveis.xml, sempre com o dado atual do banco.",
    pending: [],
    fields: [
      imageVariantField,
      {
        key: "includeUnpublished",
        label: "Incluir imóveis não publicados",
        type: "switch",
        help: "Padrão: não. Só entram imóveis publicados e autorizados no canal.",
      },
    ],
    canTest: true,
    canSync: true,
    available: true,
    selfServed: true,
  },
  {
    key: "sitemap",
    category: "XML / Feeds",
    name: "Sitemap e robots.txt",
    mark: "SM",
    purpose: "Ajudar o Google a encontrar a home e cada página de imóvel.",
    method: "Gerados por este sistema em /sitemap.xml e /robots.txt.",
    pending: [],
    fields: [],
    canTest: true,
    canSync: true,
    available: true,
    selfServed: true,
  },

  /* ------------------------------------------------------- site próprio */
  {
    key: "site_leads",
    category: "Site Edy Premi",
    name: "Formulários do site",
    mark: "SI",
    purpose: "Leads da home e das páginas de imóvel caem direto no CRM.",
    method: "Rota interna leads.create (oRPC) com deduplicação por telefone/e-mail.",
    pending: [],
    fields: [
      {
        key: "dedupeHours",
        label: "Janela de deduplicação (horas)",
        type: "text",
        help: "Mesma pessoa dentro dessa janela vira nota no lead existente. Padrão: 72.",
      },
    ],
    canTest: true,
    canSync: false,
    available: true,
    selfServed: true,
  },

  /* -------------------------------------------------------- agentes IA */
  {
    key: "ai_gateway",
    category: "Agentes de IA",
    name: "Provedor de IA (gateway)",
    mark: "IA",
    purpose: "Modelo de linguagem usado pelos agentes de atendimento.",
    method:
      "Gateway já provisionado no servidor (AI_GATEWAY_BASE_URL / AI_GATEWAY_API_KEY). Chaves ficam só no servidor.",
    pending: [],
    fields: [
      {
        key: "defaultModel",
        label: "Modelo padrão",
        type: "select",
        options: [
          { value: "openai/gpt-5.4-mini", label: "openai/gpt-5.4-mini (rápido)" },
          { value: "openai/gpt-5.4", label: "openai/gpt-5.4" },
          { value: "anthropic/claude-haiku-4.5", label: "anthropic/claude-haiku-4.5" },
          { value: "anthropic/claude-sonnet-4.6", label: "anthropic/claude-sonnet-4.6" },
          { value: "google/gemini-3-flash", label: "google/gemini-3-flash" },
        ],
      },
    ],
    canTest: true,
    canSync: false,
    available: true,
    selfServed: true,
  },
];

export function findIntegration(key: string) {
  return INTEGRATIONS.find((item) => item.key === key);
}

/* ------------------------------------------------------------ persistência */

export type ConfigMap = Record<string, string>;

export function parseConfig(raw: string | null | undefined): ConfigMap {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: ConfigMap = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "string") out[key] = value;
      else if (typeof value === "number" || typeof value === "boolean") out[key] = String(value);
    }
    return out;
  } catch {
    return {};
  }
}

/** Some o valor dos campos secretos, mantendo só uma dica de que existe. */
export function maskConfig(def: IntegrationDef, config: ConfigMap) {
  const out: ConfigMap = {};
  const filled: string[] = [];
  for (const field of def.fields) {
    const value = config[field.key] ?? "";
    if (value) filled.push(field.key);
    out[field.key] = field.secret && value ? `••••${value.slice(-4)}` : value;
  }
  return { config: out, filled };
}

export async function getIntegrationRow(db: AdminDb, key: string) {
  const [row] = await db
    .select()
    .from(schema.integrations)
    .where(eq(schema.integrations.key, key))
    .limit(1);
  return row ?? null;
}

/** Configuração crua — SÓ para uso no servidor (webhooks, chamadas externas). */
export async function readConfig(db: AdminDb, key: string) {
  const row = await getIntegrationRow(db, key);
  return { row, config: parseConfig(row?.config) };
}

export async function saveIntegration(
  db: AdminDb,
  key: string,
  patch: { config?: ConfigMap; status?: IntegrationStatus; enabled?: boolean; lastError?: string | null },
) {
  const row = await getIntegrationRow(db, key);
  const config = patch.config ? JSON.stringify(patch.config) : undefined;
  if (!row) {
    await db.insert(schema.integrations).values({
      key,
      config: config ?? "{}",
      status: patch.status ?? "nao_configurado",
      enabled: patch.enabled ? 1 : 0,
      lastError: patch.lastError ?? null,
      updatedAt: new Date(),
    });
    return;
  }
  await db
    .update(schema.integrations)
    .set({
      ...(config === undefined ? {} : { config }),
      ...(patch.status === undefined ? {} : { status: patch.status }),
      ...(patch.enabled === undefined ? {} : { enabled: patch.enabled ? 1 : 0 }),
      ...(patch.lastError === undefined ? {} : { lastError: patch.lastError }),
      updatedAt: new Date(),
    })
    .where(eq(schema.integrations.key, key));
}

export async function logEvent(
  db: AdminDb,
  key: string,
  kind: "test" | "sync" | "webhook" | "error" | "config",
  ok: boolean,
  message: string,
) {
  try {
    await db.insert(schema.integrationEvents).values({
      integrationKey: key,
      kind,
      ok: ok ? 1 : 0,
      message: message.slice(0, 500),
    });
  } catch {
    // histórico é acessório
  }
}

export async function listEvents(db: AdminDb, key: string, limit = 20) {
  return db
    .select()
    .from(schema.integrationEvents)
    .where(eq(schema.integrationEvents.integrationKey, key))
    .orderBy(desc(schema.integrationEvents.createdAt))
    .limit(limit);
}

/** Status calculado quando o usuário salva credenciais. */
export function statusFromConfig(def: IntegrationDef, config: ConfigMap): IntegrationStatus {
  if (!def.available) return "nao_disponivel";
  const required = def.fields.filter((field) => field.secret);
  if (def.selfServed) {
    return "conectado";
  }
  const anyFilled = def.fields.some((field) => (config[field.key] ?? "").trim() !== "");
  if (!anyFilled) return "nao_configurado";
  const missingSecret = required.some((field) => (config[field.key] ?? "").trim() === "");
  return missingSecret ? "aguardando_credencial" : "configurando";
}

/** Marca d'água/feed usam este helper para saber se o canal está autorizado. */
export async function channelAuthorized(db: AdminDb, propertyId: number, channel: string) {
  const [row] = await db
    .select()
    .from(schema.propertyChannels)
    .where(
      and(eq(schema.propertyChannels.propertyId, propertyId), eq(schema.propertyChannels.channel, channel)),
    )
    .limit(1);
  return row?.authorized === 1;
}

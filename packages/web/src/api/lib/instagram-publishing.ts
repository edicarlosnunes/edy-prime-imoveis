import { formatPropertyPrice } from "../../shared/property-price";
const GRAPH_VERSION = "v26.0";
const GRAPH_BASE = `https://graph.instagram.com/${GRAPH_VERSION}`;

export interface InstagramConfig {
  userId: string;
  accessToken: string;
}

export interface InstagramPropertyForPost {
  code: string;
  title: string;
  purpose: string;
  price: number;
  features?: string | null;
  opportunityPrice?: number | null;
  district: string;
  city: string;
  bedrooms: number;
  suites: number;
  parking: number;
  areaUtil: number;
  description?: string | null;
  link: string;
  imageUrl: string;
}

export interface InstagramPublishResult {
  externalId: string;
  permalink: string | null;
  containerId: string;
}

export function buildInstagramCaption(property: InstagramPropertyForPost) {
  const lines = [property.title.trim(), ""];
  const purpose = property.purpose === "locacao"
    ? "Locação"
    : property.purpose === "venda_locacao"
      ? "Venda ou locação"
      : "Venda";
  lines.push(`🏠 ${purpose}`);
  if (property.district || property.city) {
    lines.push(`📍 ${[property.district, property.city].filter(Boolean).join(" - ")}`);
  }
  if (property.price > 0) lines.push(`💰 ${formatPropertyPrice(property)}`);

  const details: string[] = [];
  if (property.bedrooms > 0) details.push(`${property.bedrooms} dorm.`);
  if (property.suites > 0) details.push(`${property.suites} suíte${property.suites > 1 ? "s" : ""}`);
  if (property.parking > 0) details.push(`${property.parking} vaga${property.parking > 1 ? "s" : ""}`);
  if (property.areaUtil > 0) details.push(`${property.areaUtil} m²`);
  if (details.length) lines.push(`✨ ${details.join(" · ")}`);

  const description = (property.description ?? "").trim();
  if (description) lines.push("", description.slice(0, 900));

  lines.push(
    "",
    `🔗 Mais fotos e detalhes: ${property.link}`,
    `Código do imóvel: ${property.code}`,
    "",
    "#imoveis #imobiliaria #corretordeimoveis",
  );
  return lines.join("\n").slice(0, 2200);
}

type GraphBody = {
  id?: string;
  username?: string;
  account_type?: string;
  permalink?: string;
  status_code?: string;
  status?: string;
  error?: {
    message?: string;
    code?: number;
    error_subcode?: number;
    error_user_title?: string;
    error_user_msg?: string;
  };
};

async function graphJson(path: string, init: RequestInit, token: string): Promise<GraphBody> {
  const response = await fetch(`${GRAPH_BASE}/${path.replace(/^\//, "")}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });
  const body = (await response.json().catch(() => ({}))) as GraphBody;
  if (!response.ok || body.error) {
    const detail = body.error?.error_user_msg ?? body.error?.message ?? `HTTP ${response.status}`;
    throw new Error(detail);
  }
  return body;
}

export async function testInstagramConnection(config: InstagramConfig) {
  if (!config.userId || !config.accessToken) {
    throw new Error("Informe o Instagram User ID e o Access Token.");
  }
  const body = await graphJson(
    `${encodeURIComponent(config.userId)}?fields=id,username,account_type`,
    { method: "GET" },
    config.accessToken,
  );
  if (!body.id) throw new Error("A Meta respondeu sem identificar a conta do Instagram.");
  return {
    id: body.id,
    username: body.username ?? body.id,
    accountType: body.account_type ?? null,
    graphVersion: GRAPH_VERSION,
  };
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForContainer(containerId: string, token: string) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const body = await graphJson(
      `${encodeURIComponent(containerId)}?fields=status_code,status`,
      { method: "GET" },
      token,
    );
    const statusCode = body.status_code ?? "";
    if (statusCode === "FINISHED" || statusCode === "PUBLISHED") return;
    if (statusCode === "ERROR" || statusCode === "EXPIRED") {
      throw new Error(body.status || `A mídia do Instagram ficou com status ${statusCode}.`);
    }
    await wait(1500);
  }
  throw new Error("A imagem ainda está sendo processada pelo Instagram. Tente publicar novamente em alguns instantes.");
}

export async function publishInstagramProperty(
  config: InstagramConfig,
  property: InstagramPropertyForPost,
): Promise<InstagramPublishResult> {
  if (!config.userId || !config.accessToken) throw new Error("Instagram ainda não está configurado.");
  if (!property.imageUrl) throw new Error("O imóvel precisa ter uma foto pública para publicar no Instagram.");

  const createParams = new URLSearchParams();
  createParams.set("image_url", property.imageUrl);
  createParams.set("caption", buildInstagramCaption(property));

  const created = await graphJson(
    `${encodeURIComponent(config.userId)}/media`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: createParams,
    },
    config.accessToken,
  );
  if (!created.id) throw new Error("O Instagram não devolveu o ID do container de mídia.");

  await waitForContainer(created.id, config.accessToken);

  const publishParams = new URLSearchParams();
  publishParams.set("creation_id", created.id);
  const published = await graphJson(
    `${encodeURIComponent(config.userId)}/media_publish`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: publishParams,
    },
    config.accessToken,
  );
  if (!published.id) throw new Error("O Instagram publicou, mas não devolveu o ID do conteúdo.");

  let permalink: string | null = null;
  try {
    const media = await graphJson(
      `${encodeURIComponent(published.id)}?fields=permalink`,
      { method: "GET" },
      config.accessToken,
    );
    permalink = media.permalink ?? null;
  } catch {
    permalink = null;
  }

  return { externalId: published.id, permalink, containerId: created.id };
}

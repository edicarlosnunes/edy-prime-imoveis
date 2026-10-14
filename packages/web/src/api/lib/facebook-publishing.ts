import { formatPropertyPrice } from "../../shared/property-price";
const GRAPH_VERSION = "v26.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

export interface FacebookConfig {
  pageId: string;
  pageToken: string;
}

export interface FacebookPropertyForPost {
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
  imageUrl?: string | null;
}

export interface FacebookPublishResult {
  externalId: string;
  permalink: string | null;
  mode: "photo" | "link";
}

export function buildFacebookCaption(property: FacebookPropertyForPost) {
  const lines = [property.title.trim(), ""];
  const purpose = property.purpose === "locacao" ? "Locação" : property.purpose === "venda_locacao" ? "Venda ou locação" : "Venda";
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
  if (description) {
    lines.push("", description.slice(0, 900));
  }

  lines.push("", `🔗 Veja fotos e detalhes: ${property.link}`, `Código do imóvel: ${property.code}`);
  return lines.join("\n");
}

async function graphJson(path: string, init: RequestInit, token: string) {
  const response = await fetch(`${GRAPH_BASE}/${path.replace(/^\//, "")}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });
  const body = (await response.json().catch(() => ({}))) as {
    id?: string;
    post_id?: string;
    name?: string;
    permalink_url?: string;
    link?: string;
    error?: { message?: string; code?: number; error_subcode?: number };
  };
  if (!response.ok || body.error) {
    const detail = body.error?.message ?? `HTTP ${response.status}`;
    throw new Error(detail);
  }
  return body;
}

export async function testFacebookConnection(config: FacebookConfig) {
  if (!config.pageId || !config.pageToken) {
    throw new Error("Informe o ID da Página e o Page Access Token.");
  }
  const body = await graphJson(`${encodeURIComponent(config.pageId)}?fields=id,name`, { method: "GET" }, config.pageToken);
  if (!body.id) throw new Error("A Meta respondeu sem identificar a Página.");
  return { id: body.id, name: body.name ?? body.id, graphVersion: GRAPH_VERSION };
}

async function readPermalink(externalId: string, token: string) {
  try {
    const body = await graphJson(`${encodeURIComponent(externalId)}?fields=permalink_url,link`, { method: "GET" }, token);
    return body.permalink_url ?? body.link ?? null;
  } catch {
    return null;
  }
}

export async function publishFacebookProperty(
  config: FacebookConfig,
  property: FacebookPropertyForPost,
): Promise<FacebookPublishResult> {
  if (!config.pageId || !config.pageToken) {
    throw new Error("Facebook ainda não está configurado.");
  }

  const caption = buildFacebookCaption(property);
  const params = new URLSearchParams();
  let endpoint: string;
  let mode: FacebookPublishResult["mode"];

  if (property.imageUrl) {
    endpoint = `${encodeURIComponent(config.pageId)}/photos`;
    mode = "photo";
    params.set("url", property.imageUrl);
    params.set("caption", caption);
    params.set("published", "true");
  } else {
    endpoint = `${encodeURIComponent(config.pageId)}/feed`;
    mode = "link";
    params.set("message", caption);
    params.set("link", property.link);
  }

  const body = await graphJson(
    endpoint,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: params,
    },
    config.pageToken,
  );

  const externalId = body.post_id ?? body.id;
  if (!externalId) throw new Error("A Meta publicou, mas não devolveu o ID do conteúdo.");
  const permalink = await readPermalink(externalId, config.pageToken);
  return { externalId, permalink, mode };
}

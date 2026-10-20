import { formatPropertyPrice, propertyPrice } from "../../shared/property-price";
/**
 * Feed XML dos imóveis + sitemap + robots.
 *
 * O feed é a forma OFICIAL de publicar em ZAP/VivaReal, OLX e Imovelweb:
 * os portais leem um arquivo XML em URL pública. Aqui geramos sempre a partir
 * do banco, então qualquer alteração no imóvel já entra na próxima leitura.
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import * as schema from "../database/schema";
import { propertySlug } from "./slug";
import type { AdminDb } from "./admin-base";

export const FEED_CHANNELS = ["feed", "zap", "olx", "imovelweb", "imovelguide"] as const;
export type FeedChannel = (typeof FEED_CHANNELS)[number];

export interface FeedProperty {
  id: number;
  code: string;
  title: string;
  purpose: string;
  type: string;
  price: number;
  condoFee: number | null;
  iptu: number | null;
  district: string;
  city: string;
  address: string | null;
  bedrooms: number;
  suites: number;
  bathrooms: number;
  parking: number;
  areaUtil: number;
  areaTotal: number | null;
  description: string;
  features: string[];
  status: string;
  slug: string;
  updatedAt: Date | null;
  images: { url: string; originalUrl: string | null; isPrimary: boolean }[];
}

function parseFeatures(raw: string | null) {
  if (!raw) return [] as string[];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [] as string[];
  }
}

/**
 * Imóveis que podem sair no canal: publicados, disponíveis/reservados e
 * autorizados naquele canal. Vendido/alugado nunca entra.
 */
export async function feedProperties(db: AdminDb, channel: FeedChannel): Promise<FeedProperty[]> {
  const rows = await db
    .select()
    .from(schema.properties)
    .where(eq(schema.properties.published, 1));

  const authorizations = await db
    .select()
    .from(schema.propertyChannels)
    .where(eq(schema.propertyChannels.channel, channel));

  const allowed = new Set(
    Array.from(new Map(authorizations.sort((a, b) => a.id - b.id).map((row) => [row.propertyId, row])).values()).filter((row) => row.authorized === 1).map((row) => row.propertyId),
  );

  const eligible = rows.filter(
    (row) => allowed.has(row.id) && (row.status === "disponivel" || row.status === "reservado"),
  );
  if (eligible.length === 0) return [];

  const images = await db
    .select()
    .from(schema.propertyImages)
    .where(
      inArray(
        schema.propertyImages.propertyId,
        eligible.map((row) => row.id),
      ),
    )
    .orderBy(asc(schema.propertyImages.sortOrder), asc(schema.propertyImages.id));

  return eligible.map((row) => ({
    id: row.id,
    code: row.code,
    title: row.title,
    purpose: row.purpose,
    type: row.type,
    price: propertyPrice(row).current,
    condoFee: row.condoFee,
    iptu: row.iptu,
    district: row.district,
    city: row.city,
    address: row.address,
    bedrooms: row.bedrooms,
    suites: row.suites,
    bathrooms: row.bathrooms,
    parking: row.parking,
    areaUtil: row.areaUtil,
    areaTotal: row.areaTotal,
    description: [row.description, propertyPrice(row).discounted ? `Valor: ${formatPropertyPrice(row)}` : null].filter(Boolean).join("\n\n"),
    features: parseFeatures(row.features).filter((feature) => !feature.startsWith("__opportunity_price:") && !feature.startsWith("__referral_note:") && !feature.startsWith("__negotiation:")),
    status: row.status,
    slug: row.slug ?? propertySlug(row),
    updatedAt: row.updatedAt ?? null,
    images: images
      .filter((image) => image.propertyId === row.id)
      .map((image) => ({
        url: image.url,
        originalUrl: image.originalUrl,
        isPrimary: image.isPrimary === 1,
      })),
  }));
}

function esc(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function tag(name: string, value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return "";
  return `      <${name}>${esc(String(value))}</${name}>\n`;
}

const purposeLabel: Record<string, string> = {
  venda: "For Sale",
  locacao: "For Rent",
  venda_locacao: "For Sale/Rent",
};

const typeLabel: Record<string, string> = {
  apartamento: "Apartamento",
  casa: "Casa",
  cobertura: "Cobertura",
  terreno: "Terreno",
  sala_comercial: "Sala Comercial",
  sobrado: "Sobrado",
  chacara: "Chácara",
  outro: "Imóvel",
};

export interface FeedOptions {
  baseUrl: string;
  /** original = foto sem marca d'água; marcada = versão com marca */
  imageVariant?: "original" | "marcada";
  channel: FeedChannel;
}

/**
 * XML no modelo genérico usado pelos portais brasileiros (Carga/Imoveis/Imovel),
 * com todos os campos do cadastro. Na homologação de cada portal o mapeamento
 * de campos pode precisar de ajuste fino — por isso os portais só ficam
 * "conectado" depois que o próprio portal confirmar a leitura.
 */
export function feedXml(properties: FeedProperty[], options: FeedOptions) {
  if (options.channel === "imovelguide") return guideFeedXml(properties, options);
  const now = new Date().toISOString();
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<Carga>",
    "  <Cabecalho>",
    `    <Gerado>${now}</Gerado>`,
    `    <Canal>${esc(options.channel)}</Canal>`,
    `    <Quantidade>${properties.length}</Quantidade>`,
    "  </Cabecalho>",
    "  <Imoveis>",
  ];

  for (const property of properties) {
    const link = `${options.baseUrl}/imovel/${property.slug}`;
    lines.push("    <Imovel>");
    let body = "";
    body += tag("CodigoImovel", property.code);
    body += tag("TipoImovel", typeLabel[property.type] ?? "Imóvel");
    body += tag("SubTipoImovel", property.type);
    body += tag("Finalidade", purposeLabel[property.purpose] ?? property.purpose);
    body += tag("Titulo", property.title);
    body += tag("Observacao", property.description);
    body += tag("PrecoVenda", property.purpose === "locacao" ? "" : property.price || "");
    body += tag("PrecoLocacao", property.purpose === "venda" ? "" : property.price || "");
    body += tag("PrecoCondominio", property.condoFee ?? "");
    body += tag("PrecoIptu", property.iptu ?? "");
    body += tag("Bairro", property.district);
    body += tag("Cidade", property.city);
    body += tag("UF", "SP");
    body += tag("Pais", "Brasil");
    body += tag("Endereco", property.address ?? "");
    body += tag("QtdDormitorios", property.bedrooms);
    body += tag("QtdSuites", property.suites);
    body += tag("QtdBanheiros", property.bathrooms);
    body += tag("QtdVagas", property.parking);
    body += tag("AreaUtil", property.areaUtil || "");
    body += tag("AreaTotal", property.areaTotal ?? "");
    body += tag("UnidadeMetrica", "M2");
    body += tag("Situacao", property.status);
    body += tag("UrlImovel", link);
    body += tag("DataAtualizacao", (property.updatedAt ?? new Date()).toISOString());
    lines.push(body.replace(/\n$/, ""));

    if (property.features.length) {
      lines.push("      <Caracteristicas>");
      for (const feature of property.features) {
        lines.push(`        <Caracteristica>${esc(feature)}</Caracteristica>`);
      }
      lines.push("      </Caracteristicas>");
    }

    if (property.images.length) {
      lines.push("      <Fotos>");
      let order = 1;
      for (const image of property.images) {
        const chosen =
          options.imageVariant === "original" ? (image.originalUrl ?? image.url) : image.url;
        const url = chosen.startsWith("http") ? chosen : `${options.baseUrl}${chosen}`;
        lines.push("        <Foto>");
        lines.push(`          <Ordem>${order}</Ordem>`);
        lines.push(`          <Principal>${image.isPrimary ? "1" : "0"}</Principal>`);
        lines.push(`          <URLArquivo>${esc(url)}</URLArquivo>`);
        lines.push("        </Foto>");
        order += 1;
      }
      lines.push("      </Fotos>");
    }

    lines.push("    </Imovel>");
  }

  lines.push("  </Imoveis>", "</Carga>");
  return lines.filter((line) => line !== "").join("\n");
}

/** Sitemap com a home e a página de cada imóvel publicado. */
export async function sitemapXml(db: AdminDb, baseUrl: string) {
  const rows = await db
    .select({
      code: schema.properties.code,
      title: schema.properties.title,
      slug: schema.properties.slug,
      district: schema.properties.district,
      city: schema.properties.city,
      type: schema.properties.type,
      updatedAt: schema.properties.updatedAt,
    })
    .from(schema.properties)
    .where(and(eq(schema.properties.published, 1)));

  const urls = [
    `  <url>\n    <loc>${baseUrl}/</loc>\n    <changefreq>daily</changefreq>\n    <priority>1.0</priority>\n  </url>`,
  ];
  for (const row of rows) {
    const slug = row.slug ?? propertySlug(row);
    const lastmod = (row.updatedAt ?? new Date()).toISOString().slice(0, 10);
    urls.push(
      `  <url>\n    <loc>${baseUrl}/imovel/${slug}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.8</priority>\n  </url>`,
    );
  }

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>`;
}

export function robotsTxt(baseUrl: string, indexable: boolean) {
  if (!indexable) {
    return `User-agent: *\nDisallow: /\n`;
  }
  return [
    "User-agent: *",
    "Allow: /",
    "Allow: /api/media/",
    "Disallow: /admin",
    "Disallow: /api",
    "",
    `Sitemap: ${baseUrl}/sitemap.xml`,
    "",
  ].join("\n");
}

/** Carga XML dedicada. A aceitação do formato deve ser confirmada pelo portal. */
export function guideFeedXml(properties: FeedProperty[], options: FeedOptions) {
  const items = properties.map((p) => {
    const fields = [tag("CodigoImovel", p.code), tag("TituloImovel", p.title),
      tag("TipoImovel", typeLabel[p.type] ?? "Imóvel"), tag("Finalidade", p.purpose === "locacao" ? "Aluguel" : "Venda"),
      tag("PrecoVenda", p.purpose === "locacao" ? null : p.price),
      tag("PrecoAluguel", p.purpose === "venda" ? null : p.price),
      tag("PrecoCondominio", p.condoFee), tag("IPTU", p.iptu), tag("Observacao", p.description),
      tag("Estado", "São Paulo"), tag("UF", "SP"), tag("Cidade", p.city), tag("Bairro", p.district),
      tag("QtdDormitorios", p.bedrooms), tag("QtdSuites", p.suites), tag("QtdBanheiros", p.bathrooms),
      tag("QtdVagas", p.parking), tag("AreaUtil", p.areaUtil), tag("AreaTotal", p.areaTotal),
      tag("UrlImovel", `${options.baseUrl}/imovel/${p.slug}`)].join("");
    const primary = p.images.findIndex((i) => i.isPrimary);
    const photos = p.images.map((i, index) => {
      const chosen = options.imageVariant === "original" ? i.originalUrl ?? i.url : i.url;
      const url = new URL(chosen, options.baseUrl).href;
      return `        <Foto><URLArquivo>${esc(url)}</URLArquivo><Principal>${index === (primary < 0 ? 0 : primary) ? 1 : 0}</Principal></Foto>`;
    }).join("\n");
    // Não expor endereço exato, complemento ou dados privados do proprietário.
    return `    <Imovel>\n${fields}      <Fotos>\n${photos}\n      </Fotos>\n    </Imovel>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Carga>\n  <Imoveis>\n${items.join("\n")}\n  </Imoveis>\n</Carga>`;
}

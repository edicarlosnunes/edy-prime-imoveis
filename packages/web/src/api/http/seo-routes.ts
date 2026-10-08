import type { Hono } from "hono";
import { eq } from "drizzle-orm";
import * as schema from "../database/schema";
import { getDb } from "../lib/auth";
import { siteBaseUrl } from "../lib/base-url";
import { propertySlug } from "../lib/slug";
import {
  allowedSeoTypes,
  findSeoCity,
  findSeoDistrict,
  findSeoTypeSegment,
  foldSeo,
  type SeoCity,
  type SeoDistrict,
  type SeoIntent,
  type SeoPropertyType,
} from "../lib/seo-market";

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function renderSeoLanding(
  c: any,
  city: SeoCity,
  district?: SeoDistrict,
  propertyType?: SeoPropertyType,
  intent?: SeoIntent,
) {
  const baseUrl = siteBaseUrl(c.req.raw.headers);
  const areaName = district ? `${district.name}, ${city.name}` : city.name;
  const intentText = intent === "locacao" ? "para alugar" : "à venda";
  const pageLabel = propertyType
    ? `${propertyType.plural[0].toUpperCase()}${propertyType.plural.slice(1)} ${intentText} em ${areaName}`
    : `Imóveis em ${areaName}`;
  const title = `${pageLabel} | E. Santos Corretor`;
  const description = propertyType
    ? `Encontre ${propertyType.plural} ${intentText} em ${areaName}. Imóveis publicados pela E. Santos Corretor, atualizados conforme o estoque real do CRM.`
    : `${city.focus} Consulte imóveis em ${areaName} e encontre oportunidades atualizadas diretamente do CRM da E. Santos Corretor.`;
  const segment = propertyType
    ? intent === "locacao"
      ? propertyType.slugLocacao
      : propertyType.slugVenda
    : undefined;
  const canonical = `${baseUrl}/imoveis/${city.slug}${district ? `/${district.slug}` : ""}${segment ? `/${segment}` : ""}`;

  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.properties)
    .where(eq(schema.properties.published, 1))
    .limit(500);

  const matching = rows
    .filter((row) => {
      if (foldSeo(row.city) !== city.slug) return false;
      if (district && foldSeo(row.district) !== district.slug) return false;
      if (propertyType && !propertyType.dbTypes.includes(row.type)) return false;
      if (intent === "venda" && row.purpose === "locacao") return false;
      if (intent === "locacao" && row.purpose === "venda") return false;
      return true;
    })
    .slice(0, 24);

  // Só indexa combinações tipo + intenção quando houver estoque real.
  // Assim o leque cresce com qualidade sem criar milhares de páginas vazias.
  const indexable = !propertyType || matching.length > 0;

  const cards = matching.length
    ? matching
        .map((property) => {
          const slug = property.slug ?? propertySlug(property);
          const price =
            property.price > 0
              ? property.price.toLocaleString("pt-BR", {
                  style: "currency",
                  currency: "BRL",
                  maximumFractionDigits: 0,
                })
              : "Consulte";
          return `<article class="card"><h3><a href="/imovel/${escapeHtml(slug)}">${escapeHtml(property.title)}</a></h3><p>${escapeHtml(property.district)} · ${escapeHtml(property.city)}</p><strong>${escapeHtml(price)}</strong></article>`;
        })
        .join("")
    : `<p class="empty">Ainda não há imóveis publicados nesta seleção. Esta URL fica fora do índice do Google até existir estoque real correspondente.</p>`;

  const typeLinks = allowedSeoTypes(city, district)
    .map(
      (item) =>
        `<a class="pill" href="/imoveis/${city.slug}${district ? `/${district.slug}` : ""}/${item.slugVenda}">${escapeHtml(item.plural)} à venda</a>`,
    )
    .join("");

  const districtLinks = (!district
    ? city.districts
    : city.districts.filter((item) => item.slug !== district.slug).slice(0, 8))
    .map(
      (item) =>
        `<a class="pill" href="/imoveis/${city.slug}/${item.slug}">${escapeHtml(item.name)}</a>`,
    )
    .join("");

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: title,
    description,
    url: canonical,
    about: { "@type": "Place", name: areaName },
    isPartOf: { "@type": "WebSite", name: "E. Santos Corretor", url: baseUrl },
  };

  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}"><meta name="robots" content="${indexable ? "index,follow" : "noindex,follow"}"><link rel="canonical" href="${escapeHtml(canonical)}"><meta property="og:type" content="website"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:url" content="${escapeHtml(canonical)}"><script type="application/ld+json">${JSON.stringify(jsonLd)}</script><style>body{margin:0;font-family:Arial,sans-serif;color:#171717;background:#fafafa}header,main,footer{max-width:1120px;margin:auto;padding:24px}header{display:flex;justify-content:space-between;align-items:center}header a{color:#111;text-decoration:none;font-weight:700}.hero{padding:52px 24px 30px}.hero h1{font-size:clamp(32px,6vw,58px);margin:0 0 16px}.hero p{max-width:820px;font-size:18px;line-height:1.6}.types,.areas{display:flex;flex-wrap:wrap;gap:10px;margin:20px 0}.pill{padding:10px 14px;border:1px solid #ddd;border-radius:999px;text-decoration:none;color:#222;background:white}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px}.card{background:white;border:1px solid #e6e6e6;border-radius:16px;padding:18px}.card h3{margin-top:0}.card a{color:#111}.empty{background:#fff;border:1px solid #e6e6e6;border-radius:16px;padding:20px}.cta{margin:42px 0;padding:26px;border-radius:18px;background:#111;color:white}.cta a{color:white}footer{font-size:14px;color:#666}</style></head><body><header><a href="/">E. Santos Corretor</a><a href="/">Ver site</a></header><main><section class="hero"><p>Imóveis · ${escapeHtml(city.name)}${district ? ` · ${escapeHtml(district.name)}` : ""}</p><h1>${escapeHtml(pageLabel)}</h1><p>${escapeHtml(description)}</p><div class="types">${typeLinks}</div><div class="areas">${districtLinks}</div></section><section><h2>Imóveis disponíveis</h2><div class="grid">${cards}</div></section><section class="cta"><h2>Encontre o imóvel certo</h2><p>Consulte os imóveis disponíveis e fale com a E. Santos Corretor para receber atendimento especializado na região.</p><a href="/">Buscar imóveis</a></section></main><footer>E. Santos Corretor · CRECI 134718-F · Baixada Santista e Litoral Sul de São Paulo</footer></body></html>`;

  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}

export function registerSeoRoutes(app: Hono) {
  app.get("/api/seo2/imoveis/:city", async (c) => {
    const city = findSeoCity(c.req.param("city"));
    if (!city) return c.text("not found", 404);
    return renderSeoLanding(c, city);
  });

  app.get("/api/seo2/imoveis/:city/:segment", async (c) => {
    const city = findSeoCity(c.req.param("city"));
    if (!city) return c.text("not found", 404);

    const segment = c.req.param("segment");
    const district = findSeoDistrict(city, segment);
    if (district) return renderSeoLanding(c, city, district);

    const resolved = findSeoTypeSegment(segment);
    if (!resolved || !allowedSeoTypes(city).some((item) => item.key === resolved.type.key)) {
      return c.text("not found", 404);
    }
    return renderSeoLanding(c, city, undefined, resolved.type, resolved.intent);
  });

  app.get("/api/seo2/imoveis/:city/:district/:segment", async (c) => {
    const city = findSeoCity(c.req.param("city"));
    if (!city) return c.text("not found", 404);

    const district = findSeoDistrict(city, c.req.param("district"));
    const resolved = findSeoTypeSegment(c.req.param("segment"));
    if (
      !district ||
      !resolved ||
      !allowedSeoTypes(city, district).some((item) => item.key === resolved.type.key)
    ) {
      return c.text("not found", 404);
    }
    return renderSeoLanding(c, city, district, resolved.type, resolved.intent);
  });
}

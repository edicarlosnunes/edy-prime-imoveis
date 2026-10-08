/**
 * Rotas públicas de arquivo: feed XML dos portais, sitemap, robots e o
 * prerender da página do imóvel (título/meta/OG/JSON-LD para Google e
 * WhatsApp, que não executam JavaScript).
 *
 * O servidor de desenvolvimento só encaminha /api/* para o Hono, por isso as
 * rotas vivem sob /api/... e o vercel.json reescreve as URLs bonitas
 * (/feed/imoveis.xml, /sitemap.xml, /robots.txt, /imovel/:slug).
 */
import type { Hono } from "hono";
import { eq } from "drizzle-orm";
import * as schema from "../database/schema";
import { getDb } from "../lib/auth";
import { siteBaseUrl } from "../lib/base-url";
import { FEED_CHANNELS, feedProperties, feedXml, robotsTxt, sitemapXml } from "../lib/feed";
import { parseConfig } from "../lib/integrations";
import { propertySlug } from "../lib/slug";
import { findSeoCity, findSeoDistrict, foldSeo, type SeoCity, type SeoDistrict } from "../lib/seo-market";

const FILE_TO_CHANNEL: Record<string, (typeof FEED_CHANNELS)[number]> = {
  "imoveis.xml": "feed",
  "zap.xml": "zap",
  "vivareal.xml": "zap",
  "olx.xml": "olx",
  "imovelweb.xml": "imovelweb",
};

const INTEGRATION_BY_CHANNEL: Record<string, string> = {
  feed: "feed_imoveis",
  zap: "zap_vivareal",
  olx: "olx",
  imovelweb: "imovelweb",
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function registerFeedRoutes(app: Hono) {
  /** XML lido pelos portais. */
  app.get("/api/feed/:file", async (c) => {
    const file = c.req.param("file");
    const channel = FILE_TO_CHANNEL[file];
    if (!channel) return c.text("not found", 404);

    const db = await getDb();
    const baseUrl = siteBaseUrl(c.req.raw.headers);
    const [row] = await db
      .select()
      .from(schema.integrations)
      .where(eq(schema.integrations.key, INTEGRATION_BY_CHANNEL[channel] ?? "feed_imoveis"))
      .limit(1);
    const config = parseConfig(row?.config);
    const imageVariant = config.imageVariant === "original" ? "original" : "marcada";

    const items = await feedProperties(db, channel);
    const xml = feedXml(items, { baseUrl, channel, imageVariant });

    return new Response(xml, {
      status: 200,
      headers: {
        "content-type": "application/xml; charset=utf-8",
        "cache-control": "public, max-age=600",
      },
    });
  });

  app.get("/api/sitemap.xml", async (c) => {
    const db = await getDb();
    const xml = await sitemapXml(db, siteBaseUrl(c.req.raw.headers));
    return new Response(xml, {
      status: 200,
      headers: {
        "content-type": "application/xml; charset=utf-8",
        "cache-control": "public, max-age=3600",
      },
    });
  });

  app.get("/api/robots.txt", async (c) => {
    const db = await getDb();
    const [row] = await db
      .select()
      .from(schema.integrations)
      .where(eq(schema.integrations.key, "sitemap"))
      .limit(1);
    const config = parseConfig(row?.config);
    const indexable = config.noindex !== "true";
    return new Response(robotsTxt(siteBaseUrl(c.req.raw.headers), indexable), {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" },
    });
  });

  async function renderSeoLanding(c: any, city: SeoCity, district?: SeoDistrict) {
    const baseUrl = siteBaseUrl(c.req.raw.headers);
    const canonical = `${baseUrl}/imoveis/${city.slug}${district ? `/${district.slug}` : ""}`;
    const areaName = district ? `${district.name}, ${city.name}` : city.name;
    const title = district
      ? `Imóveis em ${district.name}, ${city.name} | E. Santos Corretor`
      : `Imóveis em ${city.name} | E. Santos Corretor`;
    const description = district
      ? `Encontre imóveis em ${district.name}, ${city.name}. Casas, apartamentos, terrenos e oportunidades selecionadas pela E. Santos Corretor.`
      : `Imóveis em ${city.name} para comprar, vender ou alugar. Consulte casas, apartamentos, terrenos e oportunidades com a E. Santos Corretor.`;

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
        return true;
      })
      .slice(0, 24);

    const typeNames = district?.types ?? city.types;
    const cards = matching.length
      ? matching
          .map((property) => {
            const slug = property.slug ?? propertySlug(property);
            const price = property.price > 0
              ? property.price.toLocaleString("pt-BR", {
                  style: "currency",
                  currency: "BRL",
                  maximumFractionDigits: 0,
                })
              : "Consulte";
            return `<article class="card"><h3><a href="/imovel/${escapeHtml(slug)}">${escapeHtml(property.title)}</a></h3><p>${escapeHtml(property.district)} · ${escapeHtml(property.city)}</p><strong>${escapeHtml(price)}</strong></article>`;
          })
          .join("")
      : `<p class="empty">Ainda não há imóveis publicados nesta seleção. A página permanece ativa para orientar sua busca e será atualizada automaticamente conforme novos imóveis forem publicados.</p>`;

    const districtLinks = (!district ? city.districts : city.districts.filter((item) => item.slug !== district.slug).slice(0, 8))
      .map((item) => `<a class="pill" href="/imoveis/${city.slug}/${item.slug}">${escapeHtml(item.name)}</a>`)
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

    const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}"><link rel="canonical" href="${escapeHtml(canonical)}"><meta property="og:type" content="website"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:url" content="${escapeHtml(canonical)}"><script type="application/ld+json">${JSON.stringify(jsonLd)}</script><style>body{margin:0;font-family:Arial,sans-serif;color:#171717;background:#fafafa}header,main,footer{max-width:1120px;margin:auto;padding:24px}header{display:flex;justify-content:space-between;align-items:center}header a{color:#111;text-decoration:none;font-weight:700}.hero{padding:52px 24px 30px}.hero h1{font-size:clamp(32px,6vw,58px);margin:0 0 16px}.hero p{max-width:800px;font-size:18px;line-height:1.6}.types,.areas{display:flex;flex-wrap:wrap;gap:10px;margin:20px 0}.pill{padding:10px 14px;border:1px solid #ddd;border-radius:999px;text-decoration:none;color:#222;background:white}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px}.card{background:white;border:1px solid #e6e6e6;border-radius:16px;padding:18px}.card h3{margin-top:0}.card a{color:#111}.empty{background:#fff;border:1px solid #e6e6e6;border-radius:16px;padding:20px}.cta{margin:42px 0;padding:26px;border-radius:18px;background:#111;color:white}.cta a{color:white}footer{font-size:14px;color:#666}</style></head><body><header><a href="/">E. Santos Corretor</a><a href="/">Ver site</a></header><main><section class="hero"><p>Imóveis · ${escapeHtml(city.name)}</p><h1>${escapeHtml(district ? `Imóveis em ${district.name}` : `Imóveis em ${city.name}`)}</h1><p>${escapeHtml(city.focus)}</p><div class="types">${typeNames.map((type) => `<span class="pill">${escapeHtml(type)}</span>`).join("")}</div></section><section><h2>Imóveis publicados nesta região</h2><div class="grid">${cards}</div></section><section><h2>${district ? `Outros bairros de ${city.name}` : `Bairros em destaque em ${city.name}`}</h2><div class="areas">${districtLinks}</div></section><section class="cta"><h2>Quer comprar, vender ou alugar em ${escapeHtml(areaName)}?</h2><p>Consulte a E. Santos Corretor para atendimento imobiliário personalizado.</p><a href="/">Falar com a E. Santos Corretor</a></section></main><footer>© E. Santos Corretor · CRECI 134718-F</footer></body></html>`;

    return new Response(html, {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "public, max-age=600",
      },
    });
  }

  app.get("/api/seo/imoveis/:city", async (c) => {
    const city = findSeoCity(c.req.param("city"));
    if (!city) return c.text("not found", 404);
    return renderSeoLanding(c, city);
  });

  app.get("/api/seo/imoveis/:city/:district", async (c) => {
    const city = findSeoCity(c.req.param("city"));
    if (!city) return c.text("not found", 404);
    const district = findSeoDistrict(city, c.req.param("district"));
    if (!district) return c.text("not found", 404);
    return renderSeoLanding(c, city, district);
  });

  /**
   * HTML da página do imóvel com as meta tags já preenchidas.
   * Se qualquer coisa falhar, devolve o index.html original — a SPA assume.
   */
  app.get("/api/prerender/imovel/:slug", async (c) => {
    const slug = c.req.param("slug");
    const baseUrl = siteBaseUrl(c.req.raw.headers);
    let html = "";
    try {
      const response = await fetch(`${baseUrl}/index.html`, {
        headers: { "user-agent": "edy-premi-prerender" },
      });
      html = await response.text();
    } catch {
      return c.redirect(`/?imovel=${encodeURIComponent(slug)}`, 302);
    }
    if (!html.includes("</head>")) {
      return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    try {
      const db = await getDb();
      const rows = await db
        .select()
        .from(schema.properties)
        .where(eq(schema.properties.published, 1))
        .limit(500);
      const wanted = slug.toLowerCase();
      const property =
        rows.find((row) => (row.slug ?? propertySlug(row)).toLowerCase() === wanted) ??
        rows.find((row) => row.code.toLowerCase() === wanted);
      if (!property) {
        return new Response(
          "<!doctype html><html lang=\"pt-BR\"><head><meta charset=\"utf-8\"><meta name=\"robots\" content=\"noindex,follow\"><title>Imóvel não encontrado | E. Santos Corretor</title></head><body><h1>Imóvel não encontrado</h1><p>Este imóvel não está mais disponível nesta URL.</p></body></html>",
          {
            status: 404,
            headers: {
              "content-type": "text/html; charset=utf-8",
              "cache-control": "public, max-age=0, must-revalidate",
            },
          },
        );
      }

      const images = await db
        .select()
        .from(schema.propertyImages)
        .where(eq(schema.propertyImages.propertyId, property.id))
        .limit(20);
      const cover = images.find((image) => image.isPrimary === 1) ?? images[0];
      const image = cover ? (cover.url.startsWith("http") ? cover.url : `${baseUrl}${cover.url}`) : "";
      const price = property.price.toLocaleString("pt-BR", {
        style: "currency",
        currency: "BRL",
        maximumFractionDigits: 0,
      });
      const title = `${property.title} — ${property.district}, ${property.city} | E. Santos`;
      const description = `${property.bedrooms} dorm., ${property.parking} vaga(s), ${property.areaUtil} m² em ${property.district}. ${price}. Código ${property.code}.`;
      const url = `${baseUrl}/imovel/${property.slug ?? propertySlug(property)}`;

      const jsonLd = {
        "@context": "https://schema.org",
        "@type": "RealEstateListing",
        name: property.title,
        description: (property.description ?? description).slice(0, 500),
        url,
        image: image || undefined,
        offers: {
          "@type": "Offer",
          price: property.price,
          priceCurrency: "BRL",
          availability:
            property.status === "disponivel"
              ? "https://schema.org/InStock"
              : "https://schema.org/OutOfStock",
        },
        address: {
          "@type": "PostalAddress",
          addressLocality: property.city,
          addressRegion: "SP",
          addressCountry: "BR",
          streetAddress: property.district,
        },
        numberOfRooms: property.bedrooms,
        floorSize: { "@type": "QuantitativeValue", value: property.areaUtil, unitCode: "MTK" },
      };

      const head = [
        `<title>${escapeHtml(title)}</title>`,
        `<meta name="description" content="${escapeHtml(description)}" />`,
        `<link rel="canonical" href="${escapeHtml(url)}" />`,
        `<meta property="og:type" content="website" />`,
        `<meta property="og:title" content="${escapeHtml(title)}" />`,
        `<meta property="og:description" content="${escapeHtml(description)}" />`,
        `<meta property="og:url" content="${escapeHtml(url)}" />`,
        image ? `<meta property="og:image" content="${escapeHtml(image)}" />` : "",
        `<meta name="twitter:card" content="summary_large_image" />`,
        `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`,
      ]
        .filter(Boolean)
        .join("\n");

      /* Remove as meta tags genéricas do index.html para não duplicar. */
      const patched = html
        .replace(/<title>[\s\S]*?<\/title>/i, "")
        .replace(/<meta\s+name="description"[^>]*>/gi, "")
        .replace(/<meta\s+property="og:(?:type|title|description|url|image)"[^>]*>/gi, "")
        .replace(/<meta\s+name="twitter:[^"]*"[^>]*>/gi, "")
        .replace(/<link\s+rel="canonical"[^>]*>/gi, "")
        .replace("</head>", `${head}\n</head>`);

      return new Response(patched, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" },
      });
    } catch {
      return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
    }
  });
}

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
        return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
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
      const title = `${property.title} — ${property.district}, ${property.city} | Edy Prime Imóveis`;
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

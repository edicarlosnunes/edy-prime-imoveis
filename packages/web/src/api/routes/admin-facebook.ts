import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { and, asc, desc, eq } from "drizzle-orm";
import { adminBase } from "../lib/admin-base";
import { audit } from "../lib/audit";
import { clientIp, siteBaseUrl } from "../lib/base-url";
import { propertySlug } from "../lib/slug";
import {
  logEvent,
  readConfig,
  saveIntegration,
} from "../lib/integrations";
import {
  publishFacebookProperty,
  testFacebookConnection,
} from "../lib/facebook-publishing";
import * as schema from "../database/schema";

const INTEGRATION_KEY = "facebook_publicacao";
const MASK_PREFIX = "••••";
const DEFAULT_PAGE_ID = "101408975339330";

function isMasked(value: string) {
  return value.startsWith(MASK_PREFIX);
}

async function facebookChannelRow(db: Parameters<typeof readConfig>[0], propertyId: number) {
  const [row] = await db
    .select()
    .from(schema.propertyChannels)
    .where(
      and(
        eq(schema.propertyChannels.propertyId, propertyId),
        eq(schema.propertyChannels.channel, "facebook"),
      ),
    )
    .orderBy(desc(schema.propertyChannels.id))
    .limit(1);
  return row ?? null;
}

export const adminFacebook = {
  overview: adminBase.handler(async ({ context }) => {
    const { row, config } = await readConfig(context.db, INTEGRATION_KEY);
    const properties = await context.db
      .select({
        id: schema.properties.id,
        code: schema.properties.code,
        title: schema.properties.title,
        purpose: schema.properties.purpose,
        price: schema.properties.price,
        district: schema.properties.district,
        city: schema.properties.city,
        updatedAt: schema.properties.updatedAt,
      })
      .from(schema.properties)
      .where(and(eq(schema.properties.published, 1), eq(schema.properties.status, "disponivel")))
      .orderBy(desc(schema.properties.updatedAt))
      .limit(250);

    /* O Facebook só recebe imóvel que já passou pela liberação editorial do CRM
       (`published = 1`), está disponível e tem ao menos uma foto cadastrada.
       A foto vem SEMPRE da galeria do próprio imóvel; não existe upload
       separado só para a rede social. */
    const imageRows = await context.db
      .select({ propertyId: schema.propertyImages.propertyId })
      .from(schema.propertyImages);
    const imageCountByProperty = new Map<number, number>();
    for (const image of imageRows) {
      imageCountByProperty.set(
        image.propertyId,
        (imageCountByProperty.get(image.propertyId) ?? 0) + 1,
      );
    }
    const readyProperties = properties.filter((property) => {
      const imageCount = imageCountByProperty.get(property.id) ?? 0;
      return (
        imageCount > 0 &&
        property.title.trim().length > 0 &&
        property.price > 0 &&
        property.city.trim().length > 0
      );
    });

    const channels = await context.db
      .select()
      .from(schema.propertyChannels)
      .where(eq(schema.propertyChannels.channel, "facebook"));
    const byProperty = new Map<number, (typeof channels)[number]>();
    for (const channel of channels) {
      const current = byProperty.get(channel.propertyId);
      if (!current || channel.id > current.id) byProperty.set(channel.propertyId, channel);
    }

    return {
      integration: {
        pageId: config.pageId ?? DEFAULT_PAGE_ID,
        pageToken: config.pageToken ? `${MASK_PREFIX}${config.pageToken.slice(-4)}` : "",
        imageVariant: config.imageVariant === "original" ? "original" : "marcada",
        enabled: row?.enabled === 1,
        status: row?.status ?? "nao_configurado",
        lastError: row?.lastError ?? null,
        lastTestAt: row?.lastTestAt ?? null,
      },
      properties: readyProperties.map((property) => {
        const channel = byProperty.get(property.id);
        return {
          ...property,
          imageCount: imageCountByProperty.get(property.id) ?? 0,
          facebook: {
            status: channel?.status ?? "nao_enviado",
            message: channel?.message ?? null,
            lastSyncAt: channel?.lastSyncAt ?? null,
          },
        };
      }),
    };
  }),

  save: adminBase
    .input(
      z.object({
        pageId: z.string().trim().max(80),
        pageToken: z.string().max(6000),
        imageVariant: z.enum(["marcada", "original"]).default("marcada"),
        enabled: z.boolean().default(true),
      }),
    )
    .handler(async ({ input, context }) => {
      const current = await readConfig(context.db, INTEGRATION_KEY);
      const pageToken =
        !input.pageToken || isMasked(input.pageToken)
          ? (current.config.pageToken ?? "")
          : input.pageToken.trim();
      const config = {
        pageId: input.pageId.trim(),
        pageToken,
        imageVariant: input.imageVariant,
      };
      const status = !config.pageId && !config.pageToken
        ? "nao_configurado"
        : config.pageId && config.pageToken
          ? "configurando"
          : "aguardando_credencial";

      await saveIntegration(context.db, INTEGRATION_KEY, {
        config,
        status,
        enabled: input.enabled,
        lastError: null,
      });
      await logEvent(context.db, INTEGRATION_KEY, "config", true, "Configuração de publicação no Facebook salva.");
      await audit(context.db, context.user, "facebook.configurar", {
        entity: "integration",
        entityId: INTEGRATION_KEY,
        detail: `página ${config.pageId || "não informada"} · ${input.enabled ? "ativa" : "desativada"}`,
        ip: clientIp(context.headers),
      });
      return { ok: true, status };
    }),

  test: adminBase.handler(async ({ context }) => {
    const { config } = await readConfig(context.db, INTEGRATION_KEY);
    try {
      const result = await testFacebookConnection({
        pageId: config.pageId ?? "",
        pageToken: config.pageToken ?? "",
      });
      await saveIntegration(context.db, INTEGRATION_KEY, {
        status: "conectado",
        lastError: null,
      });
      await context.db
        .update(schema.integrations)
        .set({ lastTestAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.integrations.key, INTEGRATION_KEY));
      const message = `Conectado à Página ${result.name} (${result.id}) via Graph API ${result.graphVersion}.`;
      await logEvent(context.db, INTEGRATION_KEY, "test", true, message);
      await audit(context.db, context.user, "facebook.testar", {
        entity: "integration",
        entityId: INTEGRATION_KEY,
        detail: message,
        ip: clientIp(context.headers),
      });
      return { ok: true, message };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao testar a conexão com a Meta.";
      await saveIntegration(context.db, INTEGRATION_KEY, {
        status: "erro",
        lastError: message,
      });
      await context.db
        .update(schema.integrations)
        .set({ lastTestAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.integrations.key, INTEGRATION_KEY));
      await logEvent(context.db, INTEGRATION_KEY, "test", false, message);
      return { ok: false, message };
    }
  }),

  publish: adminBase
    .input(z.object({ propertyId: z.number().int().positive(), force: z.boolean().default(false) }))
    .handler(async ({ input, context }) => {
      const { row: integration, config } = await readConfig(context.db, INTEGRATION_KEY);
      if (!integration || integration.enabled !== 1) {
        throw new ORPCError("BAD_REQUEST", { message: "Ative a publicação no Facebook antes de anunciar." });
      }
      if (!config.pageId || !config.pageToken) {
        throw new ORPCError("BAD_REQUEST", { message: "Configure o ID da Página e o Page Access Token." });
      }

      const [property] = await context.db
        .select()
        .from(schema.properties)
        .where(eq(schema.properties.id, input.propertyId))
        .limit(1);
      if (!property) throw new ORPCError("NOT_FOUND", { message: "Imóvel não encontrado." });
      if (property.published !== 1 || property.status !== "disponivel") {
        throw new ORPCError("BAD_REQUEST", {
          message: "Só imóvel já aprovado/publicado no CRM e disponível pode ser anunciado no Facebook.",
        });
      }
      if (!property.title.trim() || property.price <= 0 || !property.city.trim()) {
        throw new ORPCError("BAD_REQUEST", {
          message: "O cadastro do imóvel ainda não está 100% pronto para divulgação. Revise título, preço e cidade.",
        });
      }

      const previous = await facebookChannelRow(context.db, property.id);
      if (previous?.status === "publicado" && !input.force) {
        throw new ORPCError("CONFLICT", {
          message: "Este imóvel já foi publicado no Facebook. Use Republicar somente se quiser criar uma nova publicação.",
        });
      }

      const images = await context.db
        .select()
        .from(schema.propertyImages)
        .where(eq(schema.propertyImages.propertyId, property.id))
        .orderBy(desc(schema.propertyImages.isPrimary), asc(schema.propertyImages.sortOrder), asc(schema.propertyImages.id));
      if (images.length === 0) {
        throw new ORPCError("BAD_REQUEST", {
          message: "O imóvel precisa ter ao menos uma foto no próprio cadastro antes de ser liberado para o Facebook.",
        });
      }
      const selected = images[0];
      const rawImage = config.imageVariant === "original"
        ? (selected?.originalUrl ?? selected?.url ?? "")
        : (selected?.url ?? "");
      const baseUrl = siteBaseUrl(context.headers);
      const imageUrl = rawImage
        ? rawImage.startsWith("http")
          ? rawImage
          : `${baseUrl}${rawImage.startsWith("/") ? "" : "/"}${rawImage}`
        : null;
      const link = `${baseUrl}/imovel/${property.slug ?? propertySlug(property)}`;

      try {
        const result = await publishFacebookProperty(
          { pageId: config.pageId, pageToken: config.pageToken },
          {
            code: property.code,
            title: property.title,
            purpose: property.purpose,
            price: property.price,
            features: property.features,
            district: property.district,
            city: property.city,
            bedrooms: property.bedrooms,
            suites: property.suites,
            parking: property.parking,
            areaUtil: property.areaUtil,
            description: property.description,
            link,
            imageUrl,
          },
        );

        const message = [
          `Publicado no Facebook (${result.mode === "photo" ? "foto" : "link"}).`,
          `ID: ${result.externalId}`,
          result.permalink ? `URL: ${result.permalink}` : null,
        ].filter(Boolean).join(" ");

        if (previous) {
          await context.db
            .update(schema.propertyChannels)
            .set({
              authorized: 1,
              status: "publicado",
              message,
              lastSyncAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(schema.propertyChannels.id, previous.id));
        } else {
          await context.db.insert(schema.propertyChannels).values({
            propertyId: property.id,
            channel: "facebook",
            authorized: 1,
            status: "publicado",
            message,
            lastSyncAt: new Date(),
          });
        }

        await logEvent(context.db, INTEGRATION_KEY, "sync", true, `${property.code}: ${message}`);
        await audit(context.db, context.user, "facebook.publicar", {
          entity: "property",
          entityId: property.id,
          detail: `${property.code} · ${result.externalId}${input.force ? " · republicação" : ""}`,
          ip: clientIp(context.headers),
        });
        return { ok: true, message, ...result };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Falha ao publicar no Facebook.";
        if (previous) {
          await context.db
            .update(schema.propertyChannels)
            .set({ status: "erro", message, updatedAt: new Date() })
            .where(eq(schema.propertyChannels.id, previous.id));
        } else {
          await context.db.insert(schema.propertyChannels).values({
            propertyId: property.id,
            channel: "facebook",
            authorized: 0,
            status: "erro",
            message,
          });
        }
        await saveIntegration(context.db, INTEGRATION_KEY, { lastError: message });
        await logEvent(context.db, INTEGRATION_KEY, "error", false, `${property.code}: ${message}`);
        throw new ORPCError("BAD_REQUEST", { message });
      }
    }),
};

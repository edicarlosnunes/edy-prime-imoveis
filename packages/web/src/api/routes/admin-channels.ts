/**
 * Publicação e portais por imóvel.
 * Nenhum imóvel vai para portal sem autorização explícita aqui.
 */
import { z } from "zod";
import { and, asc, eq, inArray } from "drizzle-orm";
import { adminBase } from "../lib/admin-base";
import { audit } from "../lib/audit";
import { clientIp, siteBaseUrl } from "../lib/base-url";
import { FEED_CHANNELS, feedProperties } from "../lib/feed";
import * as schema from "../database/schema";

const channelEnum = z.enum(["feed", "zap", "olx", "imovelweb"]);

export const adminChannels = {
  /** Canais de um imóvel. */
  forProperty: adminBase
    .input(z.object({ propertyId: z.number().int() }))
    .handler(async ({ input, context }) => {
      const rows = await context.db
        .select()
        .from(schema.propertyChannels)
        .where(eq(schema.propertyChannels.propertyId, input.propertyId));
      return FEED_CHANNELS.map((channel) => {
        const row = rows.find((item) => item.channel === channel);
        return {
          channel,
          authorized: row?.authorized === 1,
          status: row?.status ?? "nao_enviado",
          message: row?.message ?? null,
          lastSyncAt: row?.lastSyncAt ?? null,
        };
      });
    }),

  /** Autoriza/desautoriza um imóvel em um canal. */
  setAuthorized: adminBase
    .input(
      z.object({
        propertyId: z.number().int(),
        channel: channelEnum,
        authorized: z.boolean(),
      }),
    )
    .handler(async ({ input, context }) => {
      const [row] = await context.db
        .select()
        .from(schema.propertyChannels)
        .where(
          and(
            eq(schema.propertyChannels.propertyId, input.propertyId),
            eq(schema.propertyChannels.channel, input.channel),
          ),
        )
        .limit(1);

      const status = input.authorized ? "aguardando" : "nao_enviado";
      const message = input.authorized
        ? "No próximo XML lido pelo portal"
        : "Fora do XML deste canal";

      if (row) {
        await context.db
          .update(schema.propertyChannels)
          .set({ authorized: input.authorized ? 1 : 0, status, message, updatedAt: new Date() })
          .where(eq(schema.propertyChannels.id, row.id));
      } else {
        await context.db.insert(schema.propertyChannels).values({
          propertyId: input.propertyId,
          channel: input.channel,
          authorized: input.authorized ? 1 : 0,
          status,
          message,
        });
      }

      await audit(context.db, context.user, "canal.autorizacao", {
        entity: "property",
        entityId: input.propertyId,
        detail: `${input.channel}: ${input.authorized ? "autorizado" : "removido"}`,
        ip: clientIp(context.headers),
      });
      return { ok: true };
    }),

  /** Autoriza vários imóveis de uma vez em um canal. */
  bulkAuthorize: adminBase
    .input(
      z.object({
        propertyIds: z.array(z.number().int()).min(1).max(400),
        channel: channelEnum,
        authorized: z.boolean(),
      }),
    )
    .handler(async ({ input, context }) => {
      const existing = await context.db
        .select()
        .from(schema.propertyChannels)
        .where(
          and(
            eq(schema.propertyChannels.channel, input.channel),
            inArray(schema.propertyChannels.propertyId, input.propertyIds),
          ),
        );
      const known = new Map(existing.map((row) => [row.propertyId, row]));
      const status = input.authorized ? "aguardando" : "nao_enviado";

      for (const propertyId of input.propertyIds) {
        const row = known.get(propertyId);
        if (row) {
          await context.db
            .update(schema.propertyChannels)
            .set({ authorized: input.authorized ? 1 : 0, status, updatedAt: new Date() })
            .where(eq(schema.propertyChannels.id, row.id));
        } else {
          await context.db.insert(schema.propertyChannels).values({
            propertyId,
            channel: input.channel,
            authorized: input.authorized ? 1 : 0,
            status,
          });
        }
      }

      await audit(context.db, context.user, "canal.autorizacao_lote", {
        entity: "channel",
        entityId: input.channel,
        detail: `${input.propertyIds.length} imóveis: ${input.authorized ? "autorizados" : "removidos"}`,
        ip: clientIp(context.headers),
      });
      return { ok: true, count: input.propertyIds.length };
    }),

  /** Visão geral: quantos imóveis cada canal está entregando agora. */
  overview: adminBase.handler(async ({ context }) => {
    const baseUrl = siteBaseUrl(context.headers);
    const channels = [];
    for (const channel of FEED_CHANNELS) {
      const items = await feedProperties(context.db, channel);
      channels.push({
        channel,
        count: items.length,
        url: `${baseUrl}/feed/${channel === "feed" ? "imoveis" : channel}.xml`,
      });
    }

    const published = await context.db
      .select({ id: schema.properties.id })
      .from(schema.properties)
      .where(eq(schema.properties.published, 1));

    return { channels, publishedCount: published.length };
  }),

  /** Grade imóvel x canal para a tela de portais. */
  matrix: adminBase.handler(async ({ context }) => {
    const properties = await context.db
      .select({
        id: schema.properties.id,
        code: schema.properties.code,
        title: schema.properties.title,
        status: schema.properties.status,
        published: schema.properties.published,
      })
      .from(schema.properties)
      .orderBy(asc(schema.properties.code))
      .limit(400);

    const rows = await context.db.select().from(schema.propertyChannels);

    return properties.map((property) => ({
      ...property,
      published: property.published === 1,
      channels: Object.fromEntries(
        FEED_CHANNELS.map((channel) => [
          channel,
          rows.some(
            (row) =>
              row.propertyId === property.id && row.channel === channel && row.authorized === 1,
          ),
        ]),
      ) as Record<(typeof FEED_CHANNELS)[number], boolean>,
    }));
  }),
};

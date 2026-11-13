import { asc, eq } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { base } from "../__core/app";
import { campaigns } from "../database/schema";
import { adminBase } from "../lib/admin-base";
import { getDb } from "../lib/auth";

const slug = z.string().max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const https = z.string().max(2000).url().refine((value) => value.startsWith("https://"));
const image = z.union([z.literal(""), z.string().regex(/^\/api\/media\/[a-f0-9]{8,64}$/)]);
const campaign = z.object({
  title: z.string().trim().min(1).max(160),
  highlight: z.string().trim().max(250),
  description: z.string().trim().max(3000),
  cover: image,
  background: image,
  video: https.or(z.literal("")),
  website: https.or(z.literal("")),
  email: z.string().trim().email().max(160).or(z.literal("")),
  whatsapp: z.string().regex(/^(55\d{10,11})?$/),
});

export const publicCampaigns = {
  get: base.input(z.object({ slug })).handler(async ({ input }) => {
    const db = await getDb();
    const [row] = await db.select({ live: campaigns.live }).from(campaigns)
      .where(eq(campaigns.slug, input.slug)).limit(1);
    return row?.live ? campaign.parse(JSON.parse(row.live)) : null;
  }),
};

export const adminCampaigns = {
  list: adminBase.handler(async ({ context }) => {
    const rows = await context.db.select().from(campaigns).orderBy(asc(campaigns.slug));
    return rows.map((row: typeof campaigns.$inferSelect) => ({
      slug: row.slug,
      draft: campaign.parse(JSON.parse(row.draft)),
      published: Boolean(row.live),
      hasChanges: row.draft !== row.live,
    }));
  }),
  save: adminBase.input(z.object({
    slug,
    data: campaign,
    publish: z.boolean(),
    create: z.boolean(),
  })).handler(async ({ input, context }) => {
    const { data, publish } = input;
    if (publish && (!data.cover || !data.video || !data.whatsapp || !data.email || !data.website || !data.description)) {
      throw new ORPCError("BAD_REQUEST", { message: "Preencha descrição, capa, vídeo, site, e-mail e WhatsApp antes de publicar." });
    }
    const draft = JSON.stringify(data);
    const changes = { draft, ...(publish ? { live: draft } : {}) };
    if (input.create) {
      const [created] = await context.db.insert(campaigns).values({ slug: input.slug, ...changes })
        .onConflictDoNothing({ target: campaigns.slug }).returning({ slug: campaigns.slug });
      if (!created) throw new ORPCError("CONFLICT", { message: "Esse endereço já pertence a outra campanha." });
      return;
    }
    const [updated] = await context.db.update(campaigns).set(changes)
      .where(eq(campaigns.slug, input.slug)).returning({ slug: campaigns.slug });
    if (!updated) throw new ORPCError("NOT_FOUND", { message: "Campanha não encontrada." });
  }),
  unpublish: adminBase.input(z.object({ slug })).handler(async ({ input, context }) => {
    await context.db.update(campaigns).set({ live: null }).where(eq(campaigns.slug, input.slug));
  }),
};

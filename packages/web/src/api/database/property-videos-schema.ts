import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Arquivos de vídeo originais vinculados ao imóvel.
 *
 * Não participam da regra de liberação/publicação do imóvel: ausência de vídeo
 * é somente pendência operacional. A URL aponta para Vercel Blob; o vídeo
 * publicado no YouTube continua sendo registrado em properties.youtubeUrl e
 * property_channels.
 */
export const propertyVideos = sqliteTable(
  "property_videos",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    propertyId: integer("property_id").notNull(),
    /** short_social | youtube_long */
    kind: text("kind").notNull(),
    url: text("url").notNull(),
    pathname: text("pathname"),
    fileName: text("file_name"),
    mime: text("mime"),
    size: integer("size"),
    durationSeconds: integer("duration_seconds"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("property_videos_property_idx").on(t.propertyId),
    uniqueIndex("property_videos_slot_idx").on(t.propertyId, t.kind),
  ],
);

export type PropertyVideo = typeof propertyVideos.$inferSelect;

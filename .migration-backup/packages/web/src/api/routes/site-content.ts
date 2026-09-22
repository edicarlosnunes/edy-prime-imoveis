import { desc, eq } from "drizzle-orm";
import { base } from "../__core/app";
import * as schema from "../database/schema";
import { getDb } from "../lib/auth";

/**
 * Conteúdo PUBLICADO do site (Editor do Site / CMS) — rota pública.
 * Devolve o JSON cru; o site funde sobre os padrões (src/web/lib/site-content.ts),
 * então se não houver nada publicado ou a chamada falhar, o site segue igual.
 */
export const siteContent = {
  get: base.handler(async () => {
    try {
      const db = await getDb();
      const [row] = await db
        .select()
        .from(schema.siteContent)
        .where(eq(schema.siteContent.status, "published"))
        .orderBy(desc(schema.siteContent.publishedAt))
        .limit(1);
      if (!row) return null;
      return {
        publishedAt: row.publishedAt,
        data: JSON.parse(row.data) as unknown,
      };
    } catch {
      return null;
    }
  }),
};

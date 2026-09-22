import { base } from "../__core/app";
import * as schema from "../database/schema";
import { getDb } from "../lib/auth";

/**
 * Dados públicos da imobiliária (editáveis em /admin → Configurações).
 * O site tem os mesmos valores embutidos como padrão: se esta chamada falhar,
 * nada quebra — os textos estáticos continuam valendo.
 */
export const siteConfig = {
  get: base.handler(async () => {
    try {
      const db = await getDb();
      const [row] = await db.select().from(schema.settings).limit(1);
      if (!row) return null;
      return {
        brand: row.companyName,
        broker: row.brokerName,
        whatsapp: row.whatsapp,
        email: row.email,
        creci: row.creci,
        address: row.address,
        instagram: row.instagram,
        facebook: row.facebook,
      };
    } catch {
      return null;
    }
  }),
};

import { listPropertyTypes } from "./property-type-catalog";
import type { SerialDb } from "./serial-counter";

/** A campaign is identified by its configured label, not the generated CRM type key. */
export async function isCampaignPropertyType(db: SerialDb, type: string): Promise<boolean> {
  const rows = await listPropertyTypes(db);
  return rows.some(row => row.key === type && row.label.trim().toLocaleLowerCase("pt-BR") === "campanha");
}

export const CAMPAIGN_CAPTURE_URL = "https://www.esantoscorretor.com.br/captar";
export const CAMPAIGN_SITE_URL = "https://www.esantoscorretor.com.br";
export const CAMPAIGN_CONTACT_EMAIL = "esantosgestorimobiliario@gmail.com";
export const CAMPAIGN_WHATSAPP_URL = "https://wa.me/5513997141174";

/** Shared, publication-safe campaign copy. Reserve room for all contacts even if the description is long. */
export function campaignPublicationCaption(property: { title?: string | null; description?: string | null }, maxLength = 2100): string {
  const footer = [
    "Cadastre seu imóvel: " + CAMPAIGN_CAPTURE_URL,
    "Site: " + CAMPAIGN_SITE_URL,
    "E-mail: " + CAMPAIGN_CONTACT_EMAIL,
    "WhatsApp: " + CAMPAIGN_WHATSAPP_URL,
  ].join("\n");
  const title = (property.title || "").trim();
  const description = (property.description || "").trim();
  const intro = [title, description].filter(Boolean).join("\n\n");
  return intro.slice(0, Math.max(0, maxLength - footer.length - 2)).trimEnd() + "\n\n" + footer;
}

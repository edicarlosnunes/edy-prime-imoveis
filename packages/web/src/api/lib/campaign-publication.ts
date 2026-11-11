import { propertyContactStartLink } from "./property-publication-link";
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
/** Mensagem de intenção de captação, separada dos imóveis específicos. */
export function campaignWhatsapp1174Link(source: "facebook" | "instagram" | "tiktok" | "youtube" | "site" = "tiktok", campaignCode?: string | null) {
  const reference = campaignCode?.trim() ? ` Referência do anúncio: ${campaignCode.trim()}.` : "";
  const message = `Olá! Vim do anúncio de captação no ${source.toUpperCase()}. Quero vender ou colocar um imóvel para locação. Origem: ${source.toUpperCase()}. Tipo: CAPTACAO.${reference}`;
  return `https://wa.me/5513997141174?text=${encodeURIComponent(message)}`;
}
export const CAMPAIGN_WHATSAPP_URL = campaignWhatsapp1174Link();

/** Shared, publication-safe campaign copy. Reserve room for all contacts even if the description is long. */
export function campaignPublicationCaption(property: { title?: string | null; description?: string | null; code?: string | null }, maxLength = 2100, source: "facebook" | "instagram" | "tiktok" | "youtube" = "tiktok"): string {
  const footer = [
    "Site: " + CAMPAIGN_SITE_URL,
    "Cadastre seu imóvel: Link: " + CAMPAIGN_CAPTURE_URL,
    "Autorização de venda: Link: https://www.esantoscorretor.com.br/autorizar",
    "ou solicite seu link individual pelo WhatsApp.",
    "E-mail: " + CAMPAIGN_CONTACT_EMAIL,
    (property.code ? "Campanha/Referência: " + property.code : "Campanha: CAPTACAO"),
    "WhatsApp (captação identificada): " + (property.code?.trim()
      ? propertyContactStartLink({ code: property.code }, source, CAMPAIGN_SITE_URL)
      : campaignWhatsapp1174Link(source)),
  ].join("\n");
  const title = (property.title || "").trim();
  const description = (property.description || "").trim();
  const intro = [title, description].filter(Boolean).join("\n\n");
  return intro.slice(0, Math.max(0, maxLength - footer.length - 2)).trimEnd() + "\n\n" + footer;
}

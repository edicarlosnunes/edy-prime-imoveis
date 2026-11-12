import { sanitizePublicPropertyText } from "../../shared/negotiation";

/** The public detail route accepts both the saved slug and the property code. */
export function propertyPublicationLink(property: { slug?: string | null; code: string }, baseUrl: string) {
  const key = property.code.trim() || property.slug?.trim();
  if (!key) throw new Error("O imóvel precisa de um código para gerar o link público.");
  return `${baseUrl.replace(/\/$/, "")}/imovel/${encodeURIComponent(key)}`;
}

/** Link nativo Messenger com referência do imóvel, sem alterar tokens ou WhatsApp. */
export function propertyMessengerLink(
  property: { code: string }, pageId: string,
) {
  const page = pageId.trim();
  if (!/^\d{5,25}$/.test(page)) throw new Error("Page ID do Facebook inválido");
  return `https://m.me/${page}?ref=${encodeURIComponent(`imovel:${property.code.trim()}`)}`;
}

/** O link do WhatsApp Business 1174 é somente uma conversa pré-preenchida.
 * Não registra, intercepta ou encaminha mensagens para o CRM.
 * Códigos EPI são obtidos do cadastro real do imóvel e nunca inventados.
 */
export function propertyWhatsapp1174Link(
  property: { code: string },
  source: "facebook" | "instagram" | "tiktok" | "youtube" | "site",
  purpose: string = "venda",
) {
  const code = property.code.trim();
  if (!code) throw new Error("Imóvel sem código para identificar conversa");
  const goal = purpose === "locacao"
    ? "alugar"
    : purpose === "venda_locacao"
      ? "comprar ou alugar"
      : "comprar";
  const message = `Olá! Quero ${goal} imóvel do código ${code}. Origem: ${source.toUpperCase()}.`;
  return `https://wa.me/5513997141174?text=${encodeURIComponent(message)}`;
}

/** Rota Y no próprio CRM: registra o clique não confirmado antes de abrir o WhatsApp. */
export function propertyContactStartLink(
  property: { code: string },
  source: "facebook" | "instagram" | "tiktok" | "youtube" | "site",
  baseUrl: string,
) {
  if (!property.code.trim()) throw new Error("Imóvel sem código para identificar contato");
  const shortSource = { facebook: "f", instagram: "i", tiktok: "t", youtube: "y", site: "s" }[source];
  const url = new URL(`/w/${encodeURIComponent(property.code.trim())}/${shortSource}`, baseUrl);
  return url.toString();
}

/** Reserve room for the call to action even when the supplied description is long. */
export function withPropertyLink(
  body: string,
  property: { slug?: string | null; code: string },
  baseUrl: string,
  max: number,
  source?: "facebook" | "instagram" | "tiktok" | "youtube",
) {
  const link = new URL(propertyPublicationLink(property, baseUrl));
  if (source) {
    link.searchParams.set("utm_source", source);
    link.searchParams.set("utm_medium", "social");
    link.searchParams.set("utm_campaign", `imovel-${property.code.trim().toLowerCase()}`);
  }
  const whatsapp = source
    ? `\nWhatsApp (imóvel ${property.code}): ${propertyContactStartLink(property, source, baseUrl)}`
    : "";
  const essential = `Veja o imóvel ${property.code}: ${link.toString()}${whatsapp}`;
  // Em legendas curtas, omitir o e-mail antes de cortar um link.
  const email = "\nE-mail: esantosgestorimobiliario@gmail.com";
  const footer = essential.length + email.length + 2 <= max ? essential + email : essential;
  const safeBody = sanitizePublicPropertyText(body);
  const intro = safeBody.slice(0, Math.max(0, max - footer.length - 2)).trimEnd();
  return intro ? `${intro}\n\n${footer}` : footer;
}

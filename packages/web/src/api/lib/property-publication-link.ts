/** The public detail route accepts both the saved slug and the property code. */
export function propertyPublicationLink(property: { slug?: string | null; code: string }, baseUrl: string) {
  const key = property.code.trim() || property.slug?.trim();
  if (!key) throw new Error("O imóvel precisa de um código para gerar o link público.");
  return `${baseUrl.replace(/\/$/, "")}/imovel/${encodeURIComponent(key)}`;
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
  const footer = `Veja o imóvel ${property.code}: ${link.toString()}\nE-mail: esantosgestorimobiliario@gmail.com`;
  return `${body.slice(0, Math.max(0, max - footer.length - 2)).trimEnd()}\n\n${footer}`;
}

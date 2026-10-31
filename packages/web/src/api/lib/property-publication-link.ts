/** The public detail route accepts both the saved slug and the property code. */
export function propertyPublicationLink(property: { slug?: string | null; code: string }, baseUrl: string) {
  const key = property.slug?.trim() || property.code.trim();
  if (!key) throw new Error("O imóvel precisa de um código para gerar o link público.");
  return `${baseUrl.replace(/\/$/, "")}/imovel/${encodeURIComponent(key)}`;
}

/** Reserve room for the call to action even when the supplied description is long. */
export function withPropertyLink(body: string, property: { slug?: string | null; code: string }, baseUrl: string, max: number) {
  const footer = `Quer conhecer melhor o imóvel? Clique ou copie o link: ${propertyPublicationLink(property, baseUrl)}`;
  return `${body.slice(0, Math.max(0, max - footer.length - 2)).trimEnd()}\n\n${footer}`;
}

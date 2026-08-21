/** URL amigável dos imóveis: /imovel/:slug */

export function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
}

/** Slug estável: texto do imóvel + código (o código garante unicidade). */
export function propertySlug(input: {
  code: string;
  title: string;
  type?: string | null;
  district?: string | null;
  city?: string | null;
}) {
  const parts = [input.title, input.district ?? "", input.city ?? ""].filter(Boolean).join(" ");
  const base = slugify(parts) || slugify(input.type ?? "imovel");
  const code = slugify(input.code);
  return base.endsWith(code) ? base : `${base}-${code}`;
}

/** Aceita slug completo ou apenas o código do imóvel. */
export function codeFromSlug(slug: string) {
  const parts = slugify(slug).split("-");
  return parts[parts.length - 1] ?? "";
}

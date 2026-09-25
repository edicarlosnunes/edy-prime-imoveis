/**
 * Identidade exibida na prévia. Os registros publicados no CMS e nas
 * Configurações permanecem intactos até a aprovação da publicação.
 */
export const PUBLIC_IDENTITY = {
  name: "E. Santos",
  role: "Gestor Imobiliário",
  creci: "CRECI 134718-F",
  logo: "/esantos-logo.png",
  shareImage: "https://esantoscorretor.com.br/og-esantos.png",
  title: "E. Santos | Gestor Imobiliário em Praia Grande/SP",
  description:
    "E. Santos — Gestor Imobiliário · CRECI 134718-F. Assessoria em imóveis de médio e alto padrão em Praia Grande/SP.",
  shareTitle: "E. Santos | Gestor Imobiliário · CRECI 134718-F",
} as const;

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? { ...value as Record<string, unknown> }
    : {};
}

export function previewPublicSiteContent(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  const data = record(value);
  const menu = record(data.menu);
  data.menu = { ...menu, logoText: PUBLIC_IDENTITY.name, logoSuffix: "", logoUrl: PUBLIC_IDENTITY.logo };

  const sections = record(data.sections);
  const sobre = record(sections.sobre);
  data.sections = { ...sections, sobre: { ...sobre, badgeName: PUBLIC_IDENTITY.name } };

  const company = record(data.company);
  data.company = {
    ...company,
    name: PUBLIC_IDENTITY.name,
    brandSuffix: "",
    broker: PUBLIC_IDENTITY.name,
    role: PUBLIC_IDENTITY.role,
    creci: PUBLIC_IDENTITY.creci,
  };

  data.theme = {
    ...record(data.theme),
    logoUrl: PUBLIC_IDENTITY.logo,
    faviconUrl: PUBLIC_IDENTITY.logo,
  };
  data.seo = {
    ...record(data.seo),
    title: PUBLIC_IDENTITY.title,
    description: PUBLIC_IDENTITY.description,
    ogImageUrl: PUBLIC_IDENTITY.shareImage,
    shareTitle: PUBLIC_IDENTITY.shareTitle,
  };
  return data;
}

/** Somente para textos de saída: não altera instruções ou regras do agente. */
export function publicBrandText(value: string) {
  return value
    .replace(/Edy Prime(?: Im[oó]veis)?/gi, PUBLIC_IDENTITY.name)
    .replace(/https?:\/\/(?:www\.)?edyprimeimoveis\.com\.br/gi, "https://esantoscorretor.com.br");
}
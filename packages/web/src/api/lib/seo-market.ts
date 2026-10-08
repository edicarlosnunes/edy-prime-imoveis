export type SeoPriority = "A++" | "A+" | "A" | "B";

export type SeoDistrict = {
  name: string;
  slug: string;
  priority: SeoPriority;
  types: string[];
};

export type SeoCity = {
  name: string;
  slug: string;
  priority: SeoPriority;
  focus: string;
  types: string[];
  districts: SeoDistrict[];
};

export const SEO_CITIES: SeoCity[] = [
  {
    name: "Praia Grande",
    slug: "praia-grande",
    priority: "A++",
    focus: "Eixo principal da E. Santos Corretor, com cobertura ampla para compra, venda e locação de imóveis.",
    types: ["apartamento", "casa", "terreno", "sobrado", "cobertura", "comercial", "lançamento", "alto padrão"],
    districts: [
      ["Canto do Forte", "canto-do-forte", ["apartamento", "casa", "cobertura", "alto padrão"]],
      ["Boqueirão", "boqueirao", ["apartamento", "casa", "comercial", "cobertura"]],
      ["Guilhermina", "guilhermina", ["apartamento", "casa", "cobertura"]],
      ["Aviação", "aviacao", ["apartamento", "casa", "cobertura"]],
      ["Tupi", "tupi", ["apartamento", "casa", "cobertura"]],
      ["Ocian", "ocian", ["apartamento", "casa", "comercial", "cobertura"]],
      ["Mirim", "mirim", ["apartamento", "casa", "terreno"]],
      ["Maracanã", "maracana", ["apartamento", "casa", "terreno"]],
      ["Caiçara", "caicara", ["apartamento", "casa", "terreno"]],
      ["Real", "real", ["casa", "terreno", "apartamento"]],
      ["Flórida", "florida", ["casa", "terreno", "alto padrão"]],
      ["Solemar", "solemar", ["casa", "terreno", "apartamento"]],
    ].map(([name, slug, types]) => ({
      name: name as string,
      slug: slug as string,
      priority: "A++" as const,
      types: types as string[],
    })),
  },
  {
    name: "Itanhaém",
    slug: "itanhaem",
    priority: "A++",
    focus: "Eixo secundário estratégico, com atenção especial a casas, terrenos, chácaras e imóveis em expansão urbana.",
    types: ["casa", "terreno", "chácara", "sítio", "apartamento", "alto padrão"],
    districts: [
      ["Belas Artes", "belas-artes", ["casa", "terreno", "apartamento", "alto padrão"]],
      ["Praia do Sonho", "praia-do-sonho", ["casa", "apartamento", "alto padrão"]],
      ["Jardim Corumbá", "jardim-corumba", ["casa", "terreno"]],
      ["Cibratel I", "cibratel-1", ["casa", "terreno", "alto padrão"]],
      ["Cibratel II", "cibratel-2", ["casa", "terreno", "alto padrão"]],
      ["Suarão", "suarao", ["casa", "terreno", "apartamento"]],
      ["Gaivota", "gaivota", ["casa", "terreno"]],
      ["Bopiranga", "bopiranga", ["casa", "terreno", "chácara"]],
    ].map(([name, slug, types], index) => ({
      name: name as string,
      slug: slug as string,
      priority: index < 5 ? "A++" as const : "A+" as const,
      types: types as string[],
    })),
  },
];

export function foldSeo(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function findSeoCity(slug: string) {
  return SEO_CITIES.find((city) => city.slug === foldSeo(slug));
}

export function findSeoDistrict(city: SeoCity, slug: string) {
  return city.districts.find((district) => district.slug === foldSeo(slug));
}

export const SEO_LANDING_PATHS = SEO_CITIES.flatMap((city) => [
  `/imoveis/${city.slug}`,
  ...city.districts.map((district) => `/imoveis/${city.slug}/${district.slug}`),
]);

export type SeoIntent = "venda" | "locacao";

export type SeoPropertyType = {
  key: string;
  singular: string;
  plural: string;
  slugVenda: string;
  slugLocacao?: string;
  dbTypes: string[];
};

export const SEO_PROPERTY_TYPES: SeoPropertyType[] = [
  { key: "apartamento", singular: "apartamento", plural: "apartamentos", slugVenda: "apartamentos-a-venda", slugLocacao: "apartamentos-para-alugar", dbTypes: ["apartamento"] },
  { key: "casa", singular: "casa", plural: "casas", slugVenda: "casas-a-venda", slugLocacao: "casas-para-alugar", dbTypes: ["casa"] },
  { key: "terreno", singular: "terreno", plural: "terrenos", slugVenda: "terrenos-a-venda", dbTypes: ["terreno"] },
  { key: "sobrado", singular: "sobrado", plural: "sobrados", slugVenda: "sobrados-a-venda", slugLocacao: "sobrados-para-alugar", dbTypes: ["sobrado"] },
  { key: "cobertura", singular: "cobertura", plural: "coberturas", slugVenda: "coberturas-a-venda", slugLocacao: "coberturas-para-alugar", dbTypes: ["cobertura"] },
  { key: "comercial", singular: "imóvel comercial", plural: "imóveis comerciais", slugVenda: "imoveis-comerciais-a-venda", slugLocacao: "imoveis-comerciais-para-alugar", dbTypes: ["sala_comercial"] },
  { key: "chácara", singular: "chácara", plural: "chácaras", slugVenda: "chacaras-a-venda", dbTypes: ["chacara"] },
];

export function findSeoTypeSegment(segment: string) {
  for (const item of SEO_PROPERTY_TYPES) {
    if (item.slugVenda === segment) return { type: item, intent: "venda" as const };
    if (item.slugLocacao === segment) return { type: item, intent: "locacao" as const };
  }
  return undefined;
}

export function allowedSeoTypes(city: SeoCity, district?: SeoDistrict) {
  const allowed = new Set((district?.types ?? city.types).map((item) => foldSeo(item)));
  return SEO_PROPERTY_TYPES.filter((item) => allowed.has(foldSeo(item.key)));
}

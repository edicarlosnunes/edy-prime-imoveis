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

const d = (name: string, slug: string, priority: SeoPriority, types: string[]): SeoDistrict => ({
  name,
  slug,
  priority,
  types,
});

export const SEO_CITIES: SeoCity[] = [
  {
    name: "Praia Grande",
    slug: "praia-grande",
    priority: "A++",
    focus: "Eixo principal da E. Santos Corretor, com cobertura máxima de bairros, tipos e intenções de busca para compra, venda e locação.",
    types: ["apartamento", "casa", "terreno", "sobrado", "cobertura", "comercial", "lançamento", "alto padrão"],
    districts: [
      d("Canto do Forte", "canto-do-forte", "A++", ["apartamento", "casa", "cobertura", "alto padrão"]),
      d("Boqueirão", "boqueirao", "A++", ["apartamento", "casa", "comercial", "cobertura"]),
      d("Guilhermina", "guilhermina", "A++", ["apartamento", "casa", "cobertura"]),
      d("Aviação", "aviacao", "A++", ["apartamento", "casa", "cobertura"]),
      d("Tupi", "tupi", "A++", ["apartamento", "casa", "cobertura"]),
      d("Ocian", "ocian", "A++", ["apartamento", "casa", "comercial", "cobertura"]),
      d("Mirim", "mirim", "A++", ["apartamento", "casa", "terreno"]),
      d("Maracanã", "maracana", "A++", ["apartamento", "casa", "terreno"]),
      d("Caiçara", "caicara", "A++", ["apartamento", "casa", "terreno"]),
      d("Real", "real", "A++", ["casa", "terreno", "apartamento"]),
      d("Flórida", "florida", "A++", ["casa", "terreno", "alto padrão"]),
      d("Solemar", "solemar", "A++", ["casa", "terreno", "apartamento"]),
      d("Sítio do Campo", "sitio-do-campo", "A+", ["casa", "terreno", "comercial"]),
      d("Nova Mirim", "nova-mirim", "A+", ["casa", "terreno", "apartamento"]),
      d("Quietude", "quietude", "A+", ["casa", "terreno"]),
      d("Tupiry", "tupiry", "A+", ["casa", "terreno"]),
      d("Antártica", "antartica", "A+", ["casa", "terreno"]),
      d("Vila Sônia", "vila-sonia", "A+", ["casa", "terreno"]),
      d("Glória", "gloria", "A+", ["casa", "terreno"]),
      d("Melvi", "melvi", "A+", ["casa", "terreno"]),
      d("Samambaia", "samambaia", "A+", ["casa", "terreno"]),
      d("Esmeralda", "esmeralda", "A+", ["casa", "terreno"]),
      d("Ribeirópolis", "ribeiropolis", "A+", ["casa", "terreno"]),
      d("Anhanguera", "anhanguera", "A+", ["casa", "terreno", "comercial"]),
      d("Santa Marina", "santa-marina", "A+", ["casa", "terreno"]),
      d("Andaraguá", "andaragua", "B", ["terreno", "comercial"]),
      d("Serra do Mar", "serra-do-mar", "B", ["casa", "terreno"]),
      d("Cidade da Criança", "cidade-da-crianca", "B", ["casa", "terreno"]),
      d("Princesa", "princesa", "B", ["casa", "terreno"]),
      d("Imperador", "imperador", "B", ["casa", "terreno"]),
      d("Xixová", "xixova", "B", ["casa", "terreno"]),
      d("Militar", "militar", "B", ["casa", "terreno"]),
    ],
  },
  {
    name: "Itanhaém",
    slug: "itanhaem",
    priority: "A++",
    focus: "Eixo secundário estratégico com centro em Belas Artes e cobertura forte para casas, terrenos, chácaras, imóveis de expansão e oportunidades de investimento.",
    types: ["casa", "terreno", "chácara", "sítio", "apartamento", "alto padrão"],
    districts: [
      d("Belas Artes", "belas-artes", "A++", ["casa", "terreno", "apartamento", "alto padrão"]),
      d("Praia do Sonho", "praia-do-sonho", "A++", ["casa", "apartamento", "alto padrão"]),
      d("Jardim Corumbá", "jardim-corumba", "A++", ["casa", "terreno"]),
      d("Cibratel I", "cibratel-1", "A++", ["casa", "terreno", "alto padrão"]),
      d("Cibratel II", "cibratel-2", "A++", ["casa", "terreno", "alto padrão"]),
      d("Jardim Ieda", "jardim-ieda", "A+", ["casa", "terreno", "chácara"]),
      d("Jardim Sabaúna", "jardim-sabauna", "A+", ["casa", "terreno", "chácara"]),
      d("Chácara das Tâmaras", "chacara-das-tamaras", "A+", ["casa", "terreno", "chácara"]),
      d("Centro", "centro", "A+", ["casa", "apartamento", "comercial"]),
      d("Suarão", "suarao", "A+", ["casa", "terreno", "apartamento"]),
      d("Gaivota", "gaivota", "A+", ["casa", "terreno"]),
      d("Jamaica", "jamaica", "A", ["casa", "terreno"]),
      d("Bopiranga", "bopiranga", "A+", ["casa", "terreno", "chácara"]),
      d("São Fernando", "sao-fernando", "A", ["casa", "terreno", "chácara"]),
      d("Savoy", "savoy", "A", ["casa", "terreno"]),
      d("Nova Itanhaém", "nova-itanhaem", "A", ["casa", "terreno"]),
      d("Oásis", "oasis", "B", ["casa", "terreno"]),
      d("Guapurá", "guapura", "B", ["casa", "terreno", "chácara"]),
      d("Ivoty", "ivoty", "B", ["casa", "terreno"]),
      d("Loty", "loty", "B", ["casa", "terreno"]),
      d("Umuarama", "umuarama", "B", ["casa", "terreno"]),
    ],
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

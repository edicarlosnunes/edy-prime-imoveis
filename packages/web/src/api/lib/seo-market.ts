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
    focus: "Eixo secundário estratégico com centro em Belas Artes e cobertura forte para casas, terrenos, chácaras, sítios, imóveis de expansão e oportunidades de investimento.",
    types: ["casa", "terreno", "chácara", "sítio", "apartamento", "alto padrão"],
    districts: [
      d("Belas Artes", "belas-artes", "A++", ["casa", "terreno", "apartamento", "alto padrão"]),
      d("Praia do Sonho", "praia-do-sonho", "A++", ["casa", "apartamento", "alto padrão"]),
      d("Jardim Corumbá", "jardim-corumba", "A++", ["casa", "terreno"]),
      d("Cibratel I", "cibratel-1", "A++", ["casa", "terreno", "alto padrão"]),
      d("Cibratel II", "cibratel-2", "A++", ["casa", "terreno", "alto padrão"]),
      d("Jardim Ieda", "jardim-ieda", "A+", ["casa", "terreno", "chácara"]),
      d("Jardim Sabaúna", "jardim-sabauna", "A+", ["casa", "terreno", "chácara"]),
      d("Chácara das Tâmaras", "chacara-das-tamaras", "A+", ["casa", "terreno", "chácara", "sítio"]),
      d("Centro", "centro", "A+", ["casa", "apartamento", "comercial"]),
      d("Suarão", "suarao", "A+", ["casa", "terreno", "apartamento"]),
      d("Gaivota", "gaivota", "A+", ["casa", "terreno"]),
      d("Jamaica", "jamaica", "A", ["casa", "terreno"]),
      d("Bopiranga", "bopiranga", "A+", ["casa", "terreno", "chácara", "sítio"]),
      d("São Fernando", "sao-fernando", "A", ["casa", "terreno", "chácara", "sítio"]),
      d("Savoy", "savoy", "A", ["casa", "terreno"]),
      d("Nova Itanhaém", "nova-itanhaem", "A", ["casa", "terreno"]),
      d("Oásis", "oasis", "B", ["casa", "terreno"]),
      d("Guapurá", "guapura", "B", ["casa", "terreno", "chácara", "sítio"]),
      d("Ivoty", "ivoty", "B", ["casa", "terreno"]),
      d("Loty", "loty", "B", ["casa", "terreno"]),
      d("Umuarama", "umuarama", "B", ["casa", "terreno"]),
    ],
  },
  {
    name: "São Vicente",
    slug: "sao-vicente",
    priority: "A+",
    focus: "Terceiro eixo do leque, com cobertura forte e seletiva para apartamentos e casas nos bairros de maior interesse imobiliário.",
    types: ["apartamento", "casa", "sobrado", "comercial"],
    districts: [
      d("Itararé", "itarare", "A+", ["apartamento", "casa"]),
      d("Gonzaguinha", "gonzaguinha", "A+", ["apartamento", "casa"]),
      d("Centro", "centro", "A+", ["apartamento", "casa", "comercial"]),
      d("Boa Vista", "boa-vista", "A+", ["apartamento", "casa"]),
      d("Vila Valença", "vila-valenca", "A", ["apartamento", "casa"]),
      d("Catiapoã", "catiapoa", "A", ["casa", "apartamento"]),
      d("Parque Bitarú", "parque-bitaru", "A", ["casa", "apartamento"]),
      d("Cidade Náutica", "cidade-nautica", "A", ["casa", "apartamento"]),
      d("Japuí", "japui", "A", ["casa", "apartamento"]),
      d("Parque Prainha", "parque-prainha", "B", ["casa", "apartamento"]),
      d("Jardim Rio Branco", "jardim-rio-branco", "B", ["casa"]),
      d("Samaritá", "samarita", "B", ["casa", "terreno"]),
    ],
  },
  {
    name: "Mongaguá",
    slug: "mongagua",
    priority: "A",
    focus: "Quarto eixo do leque, com cobertura intermediária focada principalmente em casas, terrenos e apartamentos nas regiões mais comerciais e litorâneas.",
    types: ["casa", "terreno", "apartamento", "sobrado"],
    districts: [
      d("Centro", "centro", "A", ["apartamento", "casa", "comercial"]),
      d("Agenor de Campos", "agenor-de-campos", "A", ["casa", "terreno", "apartamento"]),
      d("Vera Cruz", "vera-cruz", "A", ["casa", "apartamento"]),
      d("Flórida Mirim", "florida-mirim", "A", ["casa", "terreno", "apartamento"]),
      d("Jardim Praia Grande", "jardim-praia-grande", "A", ["casa", "terreno", "apartamento"]),
      d("Vila Seabra", "vila-seabra", "B", ["casa", "terreno"]),
      d("Santa Eugênia", "santa-eugenia", "B", ["casa", "terreno"]),
      d("Oceanópolis", "oceanopolis", "B", ["casa", "terreno"]),
      d("Jussara", "jussara", "B", ["casa", "terreno"]),
      d("Itaguaí", "itaguai", "B", ["casa", "terreno"]),
    ],
  },
  {
    name: "Peruíbe",
    slug: "peruibe",
    priority: "A",
    focus: "Quinto eixo do leque, com foco seletivo em casas, terrenos, chácaras, sítios e imóveis de padrão elevado onde houver estoque real.",
    types: ["casa", "terreno", "chácara", "sítio", "apartamento"],
    districts: [
      d("Centro", "centro", "A", ["casa", "apartamento", "comercial"]),
      d("Stella Maris", "stella-maris", "A", ["casa", "terreno", "apartamento"]),
      d("Arpoador", "arpoador", "A", ["casa", "terreno", "apartamento"]),
      d("Oásis", "oasis", "A", ["casa", "terreno"]),
      d("Parque Turístico", "parque-turistico", "A", ["casa", "terreno"]),
      d("Flórida", "florida", "A", ["casa", "terreno"]),
      d("Caraguava", "caraguava", "B", ["casa", "terreno", "chácara", "sítio"]),
      d("Jardim Veneza", "jardim-veneza", "B", ["casa", "terreno"]),
      d("Jardim Brasil", "jardim-brasil", "B", ["casa", "terreno"]),
      d("Vila Romar", "vila-romar", "B", ["casa", "terreno"]),
      d("Prados", "prados", "B", ["casa", "terreno", "chácara"]),
    ],
  },
  {
    name: "Santos",
    slug: "santos",
    priority: "A",
    focus: "Sexto eixo do leque, com cobertura seletiva para apartamentos, casas e imóveis comerciais nos bairros de maior procura da área urbana.",
    types: ["apartamento", "casa", "cobertura", "comercial"],
    districts: [
      d("Gonzaga", "gonzaga", "A", ["apartamento", "cobertura", "comercial"]),
      d("Boqueirão", "boqueirao", "A", ["apartamento", "casa", "cobertura", "comercial"]),
      d("Embaré", "embare", "A", ["apartamento", "casa", "cobertura"]),
      d("Aparecida", "aparecida", "A", ["apartamento", "casa", "cobertura"]),
      d("Ponta da Praia", "ponta-da-praia", "A", ["apartamento", "cobertura"]),
      d("José Menino", "jose-menino", "A", ["apartamento", "cobertura"]),
      d("Pompeia", "pompeia", "A", ["apartamento", "cobertura"]),
      d("Campo Grande", "campo-grande", "B", ["apartamento", "casa"]),
      d("Marapé", "marape", "B", ["apartamento", "casa"]),
      d("Vila Belmiro", "vila-belmiro", "B", ["apartamento", "casa"]),
      d("Centro", "centro", "B", ["apartamento", "comercial"]),
    ],
  },
  {
    name: "Guarujá",
    slug: "guaruja",
    priority: "B",
    focus: "Sétimo eixo do leque, com cobertura seletiva concentrada em apartamentos, casas e imóveis de padrão elevado nas regiões de maior interesse imobiliário.",
    types: ["apartamento", "casa", "cobertura", "terreno"],
    districts: [
      d("Pitangueiras", "pitangueiras", "A", ["apartamento", "cobertura"]),
      d("Enseada", "enseada", "A", ["apartamento", "casa", "cobertura"]),
      d("Astúrias", "asturias", "A", ["apartamento", "casa", "cobertura"]),
      d("Tombo", "tombo", "A", ["apartamento", "casa"]),
      d("Pernambuco", "pernambuco", "A", ["casa", "terreno"]),
      d("Perequê", "pereque", "B", ["casa", "terreno"]),
      d("Santa Cruz dos Navegantes", "santa-cruz-dos-navegantes", "B", ["casa", "terreno"]),
      d("Cidade Atlântica", "cidade-atlantica", "B", ["casa", "apartamento"]),
    ],
  },
  {
    name: "Cubatão",
    slug: "cubatao",
    priority: "B",
    focus: "Oitavo eixo do leque, com cobertura enxuta e orientada a casas e terrenos nas áreas residenciais com estoque real.",
    types: ["casa", "terreno", "sobrado", "comercial"],
    districts: [
      d("Jardim Casqueiro", "jardim-casqueiro", "A", ["casa", "sobrado", "terreno"]),
      d("Centro", "centro", "A", ["casa", "comercial"]),
      d("Vila Nova", "vila-nova", "A", ["casa", "terreno"]),
      d("Vila Natal", "vila-natal", "B", ["casa", "terreno"]),
      d("Jardim Nova República", "jardim-nova-republica", "B", ["casa", "terreno"]),
      d("Vila São José", "vila-sao-jose", "B", ["casa", "terreno"]),
      d("Jardim Costa e Silva", "jardim-costa-e-silva", "B", ["casa", "terreno"]),
      d("Vila Couto", "vila-couto", "B", ["casa", "terreno"]),
      d("Vale Verde", "vale-verde", "B", ["casa", "terreno"]),
    ],
  },
];

const SEO_ALIASES: Record<string, string> = {
  // Compatibilidade com variações antigas já existentes no CRM.
  guilherminia: "guilhermina",
};

export function foldSeo(value: string) {
  const folded = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return SEO_ALIASES[folded] ?? folded;
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
  { key: "sítio", singular: "sítio", plural: "sítios", slugVenda: "sitios-a-venda", dbTypes: ["sitio"] },
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

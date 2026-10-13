/**
 * Percentual de preenchimento do cadastro de imóvel.
 *
 * Cálculo puro e determinístico: nenhuma chamada de API, nenhum efeito.
 * Serve só para orientar o corretor sobre o que ainda falta — não bloqueia
 * navegação nem salvamento, e não altera nada do payload enviado.
 */

export interface PropertyProgressInput {
  code: string;
  title: string;
  city: string;
  district: string;
  price: string;
  bedrooms: string;
  bathrooms: string;
  areaUtil: string;
  description: string;
  highlight: string;
  features: string[];
  ownerId: string;
  imageCount: number;
}

export interface ProgressItem {
  key: string;
  label: string;
  /** seção do formulário onde o item é preenchido */
  section: string;
  weight: number;
  done: boolean;
}

export interface PropertyProgress {
  percent: number;
  items: ProgressItem[];
  missing: ProgressItem[];
}

function filled(value: string) {
  return value.trim().length > 0;
}

/** Quantidade preenchida = número > 0. "0" conta como não preenchido. */
function positive(value: string) {
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0;
}

/** Dinheiro em padrão BR: só precisa ter algum dígito diferente de zero. */
function hasAmount(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length > 0 && Number(digits) > 0;
}

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Tipos sem edificação não possuem dormitórios/banheiros obrigatórios.
 * O cadastro usa código serial por tipo e também leva o tipo no título,
 * então esta regra cobre cadastros existentes sem exigir novo campo no banco.
 */
function isLandOnlyProperty(input: PropertyProgressInput) {
  const codePrefix = input.code.trim().toUpperCase().split("-")[0] ?? "";
  const landPrefixes = new Set(["TE", "LO", "SI", "FA", "GL", "LT", "AR", "CH"]);
  if (landPrefixes.has(codePrefix)) return true;

  const title = normalize(input.title);
  return [
    "terreno",
    "lote",
    "sitio",
    "fazenda",
    "gleba",
    "loteamento",
    "area",
    "chacara",
  ].some((type) => title.includes(type));
}

export function propertyProgress(input: PropertyProgressInput): PropertyProgress {
  const landOnly = isLandOnlyProperty(input);

  const items: ProgressItem[] = [
    { key: "code", label: "Código", section: "basico", weight: 10, done: filled(input.code) },
    { key: "title", label: "Título", section: "basico", weight: 10, done: filled(input.title) },
    {
      key: "highlight",
      label: "Frase de destaque",
      section: "basico",
      weight: 5,
      done: filled(input.highlight),
    },
    { key: "city", label: "Cidade", section: "local", weight: 5, done: filled(input.city) },
    { key: "district", label: "Bairro", section: "local", weight: 10, done: filled(input.district) },
    {
      key: "areaUtil",
      label: "Área útil",
      section: "caracteristicas",
      weight: 10,
      done: positive(input.areaUtil),
    },
    {
      key: "rooms",
      label: landOnly ? "Tipo sem edificação" : "Dormitórios e banheiros",
      section: "caracteristicas",
      weight: 5,
      done: landOnly || positive(input.bedrooms) || positive(input.bathrooms),
    },
    { key: "price", label: "Preço", section: "valores", weight: 15, done: hasAmount(input.price) },
    {
      key: "owner",
      label: "Proprietário vinculado",
      section: "proprietario",
      weight: 5,
      done: filled(input.ownerId),
    },
    {
      key: "description",
      label: "Descrição",
      section: "descricao",
      weight: 10,
      done: input.description.trim().length >= 40,
    },
    {
      key: "features",
      label: "Diferenciais",
      section: "descricao",
      weight: 5,
      done: input.features.length > 0,
    },
    {
      key: "photos",
      label: "Fotos do imóvel",
      section: "fotos",
      weight: 10,
      done: input.imageCount > 0,
    },
  ];

  const total = items.reduce((sum, item) => sum + item.weight, 0);
  const earned = items.reduce((sum, item) => (item.done ? sum + item.weight : sum), 0);

  return {
    percent: total === 0 ? 0 : Math.round((earned / total) * 100),
    items,
    missing: items.filter((item) => !item.done),
  };
}

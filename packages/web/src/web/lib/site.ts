/**
 * Dados do negócio — edite aqui e o site inteiro se atualiza.
 */
export const site = {
  brand: "Edy Prime",
  brandSuffix: "Imóveis",
  broker: "Edy Prime",
  role: "Consultor de imóveis · Praia Grande/SP",
  creci: "CRECI 248229",
  city: "Praia Grande",
  state: "SP",
  /** Somente números, com DDI e DDD. Ex: 5513991234567 */
  whatsapp: "5513997141174",
  whatsappLabel: "(13) 99714-1174",
  email: "edyprimeimoveis@gmail.com",
  instagram: "https://instagram.com/edy_prime_imoveis",
  instagramHandle: "@edy_prime_imoveis",
  facebook: "https://facebook.com/edy_prime_imoveis",
  facebookHandle: "@edy_prime_imoveis",
  address: "Rua Guimarães Rosa, 492/163 — CEP 11704-160 — Praia Grande/SP",
  hours: "Seg a sáb, 9h às 20h · Domingo com agendamento",
  districts: [
    "Canto do Forte",
    "Boqueirão",
    "Guilhermina",
    "Aviação",
    "Vila Tupi",
    "Ocian",
    "Real",
    "Mirim",
    "Solemar",
  ],
} as const;

export type SiteConfigPatch = Partial<{
  name: string;
  brandSuffix: string;
  broker: string;
  role: string;
  creci: string;
  whatsapp: string;
  phone: string;
  email: string;
  address: string;
  instagram: string;
  facebook: string;
  hours: string;
  city: string;
  state: string;
  districts: string[];
}>;

function phoneLabel(raw: string) {
  const digits = raw.replace(/\D/g, "").replace(/^55/, "");
  if (digits.length < 10) return raw;
  const ddd = digits.slice(0, 2);
  const rest = digits.slice(2);
  const head = rest.slice(0, rest.length - 4);
  return `(${ddd}) ${head}-${rest.slice(-4)}`;
}

function handleOf(url: string) {
  const clean = url.replace(/\/+$/, "");
  const last = clean.split("/").pop() ?? "";
  return last ? `@${last}` : "";
}

/**
 * Aplica os dados publicados no Editor do Site (/admin/editor) sobre os padrões.
 * Só sobrescreve o que vier preenchido: se a API falhar, o site segue igual.
 */
export function configureSite(patch: SiteConfigPatch | null | undefined) {
  if (!patch) return;
  const target = site as unknown as Record<string, unknown>;
  const text = (value: string | undefined) => (value && value.trim() ? value.trim() : null);

  const name = text(patch.name);
  if (name) target.brand = name;
  const suffix = text(patch.brandSuffix);
  if (suffix) target.brandSuffix = suffix;
  const broker = text(patch.broker);
  if (broker) target.broker = broker;
  const role = text(patch.role);
  if (role) target.role = role;
  const creci = text(patch.creci);
  if (creci) target.creci = creci;
  const email = text(patch.email);
  if (email) target.email = email;
  const address = text(patch.address);
  if (address) target.address = address;
  const hours = text(patch.hours);
  if (hours) target.hours = hours;
  const city = text(patch.city);
  if (city) target.city = city;
  const state = text(patch.state);
  if (state) target.state = state;

  const instagram = text(patch.instagram);
  if (instagram) {
    target.instagram = instagram;
    target.instagramHandle = handleOf(instagram);
  }
  const facebook = text(patch.facebook);
  if (facebook) {
    target.facebook = facebook;
    target.facebookHandle = handleOf(facebook);
  }

  const whatsapp = patch.whatsapp?.replace(/\D/g, "");
  if (whatsapp && whatsapp.length >= 12) {
    target.whatsapp = whatsapp;
    target.whatsappLabel = text(patch.phone) ?? phoneLabel(whatsapp);
  } else {
    const phone = text(patch.phone);
    if (phone) target.whatsappLabel = phone;
  }

  if (Array.isArray(patch.districts) && patch.districts.length > 0) {
    target.districts = patch.districts.map((item) => String(item).trim()).filter(Boolean);
  }
}

export function whatsappLink(message: string) {
  return `https://wa.me/${site.whatsapp}?text=${encodeURIComponent(message)}`;
}

/* Imóvel cadastrado sem preço (price = 0) mostra "Sob consulta" em vez de
   "R$ 0" — o valor zero é ausência de dado, não um preço. */
export function formatBRL(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "Sob consulta";
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  });
}

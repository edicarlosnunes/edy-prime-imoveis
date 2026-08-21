/**
 * Dados do negócio — edite aqui e o site inteiro se atualiza.
 */
export const site = {
  brand: "Edy Premi",
  brandSuffix: "Imóveis",
  broker: "Edy Premi",
  role: "Consultor de imóveis · Praia Grande/SP",
  creci: "CRECI 134718",
  city: "Praia Grande",
  state: "SP",
  /** Somente números, com DDI e DDD. Ex: 5513991234567 */
  whatsapp: "5513996922804",
  whatsappLabel: "(13) 99692-2804",
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

export interface SiteConfigPatch {
  broker?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  creci?: string | null;
  address?: string | null;
  instagram?: string | null;
  facebook?: string | null;
}

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
 * Aplica os dados salvos em /admin → Configurações sobre os valores padrão.
 * Só sobrescreve o que vier preenchido: se a API falhar, o site segue igual.
 */
export function configureSite(patch: SiteConfigPatch | null | undefined) {
  if (!patch) return;
  const target = site as unknown as Record<string, unknown>;
  if (patch.broker?.trim()) target.broker = patch.broker.trim();
  if (patch.email?.trim()) target.email = patch.email.trim();
  if (patch.creci?.trim()) target.creci = patch.creci.trim();
  if (patch.address?.trim()) target.address = patch.address.trim();
  if (patch.instagram?.trim()) {
    target.instagram = patch.instagram.trim();
    target.instagramHandle = handleOf(patch.instagram.trim());
  }
  if (patch.facebook?.trim()) {
    target.facebook = patch.facebook.trim();
    target.facebookHandle = handleOf(patch.facebook.trim());
  }
  const whatsapp = patch.whatsapp?.replace(/\D/g, "");
  if (whatsapp && whatsapp.length >= 12) {
    target.whatsapp = whatsapp;
    target.whatsappLabel = phoneLabel(whatsapp);
  }
}

export function whatsappLink(message: string) {
  return `https://wa.me/${site.whatsapp}?text=${encodeURIComponent(message)}`;
}

export function formatBRL(value: number) {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  });
}

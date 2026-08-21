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

/**
 * Dados do negócio — edite aqui e o site inteiro se atualiza.
 * IMPORTANTE: troque o número de WhatsApp, e-mail, CRECI e redes pelos dados reais.
 */
export const site = {
  brand: "Edy Premi",
  brandSuffix: "Imóveis",
  broker: "Edy Premi",
  role: "Consultor de imóveis · Praia Grande/SP",
  creci: "CRECI 000000-F",
  city: "Praia Grande",
  state: "SP",
  /** Somente números, com DDI e DDD. Ex: 5513991234567 */
  whatsapp: "5513999999999",
  whatsappLabel: "(13) 99999-9999",
  email: "contato@edypremiimoveis.com.br",
  instagram: "https://instagram.com/",
  address: "Av. Pres. Costa e Silva, Boqueirão — Praia Grande/SP",
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

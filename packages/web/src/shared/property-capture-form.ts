import { z } from "zod";
export function captureFormPrice(value: string): number | null {
  const clean = value.trim().replace(/^R\$\s*/i, "").replace(/\s/g, "");
  if (!/^(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?$/.test(clean)) return null;
  const amount = Number(clean.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}
const answer = z.string().trim().max(160);
export const propertyCaptureFormSchema = z.object({
  token: z.string().regex(/^[a-f0-9]{64}$/i),
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().max(30).refine(value => /^(?:55)?\d{10,11}$/.test(value.replace(/\D/g, "")), "Informe seu WhatsApp com DDD"),
  email: z.union([z.email(), z.literal("")]).default(""),
  intention: z.enum(["venda", "locacao"]),
  propertyType: z.string().trim().min(2).max(60),
  cep: z.string().max(12), street: z.string().trim().min(2).max(200),
  number: z.string().trim().min(1).max(30), complement: z.string().max(60),
  neighborhood: z.string().trim().min(2).max(120), city: z.string().trim().min(2).max(120),
  state: z.string().regex(/^[A-Z]{2}$/),
  area: answer, bedrooms: answer, bathrooms: answer, suites: answer, parking: answer,
  balcony: answer, view: answer, furnished: answer, amenities: z.string().max(500),
  price: answer, condominium: answer, iptu: answer, negotiation: z.string().max(500),
  occupancy: answer, deed: answer, financing: answer, debts: answer,
  observations: z.string().max(1000),
  consent: z.literal(true, { error: "Confirme o envio dos dados para cadastro e contato" }),
  website: z.string().max(0).default(""),
  extraPhotos: z.array(z.string().max(340_000).regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/)).max(9).default([]),
  photo: z.string().max(2_800_000).regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/),
});
export type PropertyCaptureFormInput = z.infer<typeof propertyCaptureFormSchema>;
export function captureFormNotes(input: PropertyCaptureFormInput) {
  const fields = [
    ["Área útil (m²)", input.area], ["Dormitórios", input.bedrooms], ["Suítes", input.suites],
    ["Banheiros", input.bathrooms], ["Vagas", input.parking], ["Sacada", input.balcony],
    ["Vista livre", input.view], ["Mobiliado", input.furnished], ["Diferenciais", input.amenities],
    ["Finalidade", input.intention], ["Preço informado", input.price], ["Condomínio", input.condominium], ["IPTU", input.iptu],
    ["Negociação", input.negotiation], ["Ocupação", input.occupancy], ["Escritura", input.deed],
    ["Financiamento", input.financing], ["Pendências", input.debts], ["Observações", input.observations],
  ];
  return ["Origem do cadastro: LINK_CAPTACAO", "Formulário de imóvel enviado pelo proprietário.",
    ...fields.filter(([, value]) => value).map(([label, value]) => `${label}: ${value}`),
    "Contato autorizou o uso dos dados para análise do cadastro e retorno. Não é autorização de publicação.",
  ].join("\n");
}

import { z } from "zod";
export const PAYMENT_METHODS = ["À vista", "Financiamento", "Parcelamento direto", "Veículo", "Permuta por imóvel"];
export const negotiationSchema = z.object({
  methods: z.array(z.enum(["À vista", "Financiamento", "Parcelamento direto", "Veículo", "Permuta por imóvel"])).max(5).default([]),
  swapTypes: z.array(z.string().trim().max(80)).max(30).default([]),
  cash: z.string().trim().max(40).default(""),
  details: z.string().trim().max(800).default(""),
  debtAmount: z.string().trim().max(40).default(""),
  debtDetails: z.string().trim().max(400).default(""),
  debtResponsibility: z.enum(["", "Proprietário quita", "Comprador assume", "A negociar"]).default(""),
});
export type Negotiation = z.infer<typeof negotiationSchema>;
export const EMPTY_NEGOTIATION: Negotiation = {methods:[],swapTypes:[],cash:"",details:"",debtAmount:"",debtDetails:"",debtResponsibility:""};
export const NEGOTIATION_PREFIX = "__negotiation:";
export function readNegotiation(raw: string | null | undefined): Negotiation {
  try {
    const list = JSON.parse(raw || "[]") as string[];
    const marker = list.find(item=>item.startsWith(NEGOTIATION_PREFIX));
    return marker ? negotiationSchema.parse(JSON.parse(decodeURIComponent(marker.slice(NEGOTIATION_PREFIX.length)))) : {...EMPTY_NEGOTIATION};
  } catch {return {...EMPTY_NEGOTIATION};}
}
export function negotiationText(value: Negotiation): string {
  const lines: string[] = [];
  if(value.methods.length) lines.push(`Condições aceitas: ${value.methods.join(", ")}.`);
  if(value.methods.includes("Permuta por imóvel") && value.swapTypes.length) lines.push(`Permuta por: ${value.swapTypes.join(", ")}.`);
  if(value.cash) lines.push(`Pagamento ao proprietário: R$ ${value.cash}.`);
  if(value.details) lines.push(value.details);
  if(value.debtAmount) lines.push(`Débitos informados: R$ ${value.debtAmount}.`);
  if(value.debtDetails) lines.push(`Detalhes dos débitos: ${value.debtDetails}`);
  if(value.debtResponsibility) lines.push(`Responsabilidade pelos débitos: ${value.debtResponsibility}.`);
  return lines.length ? `Condições de pagamento e negociação\n${lines.join("\n")}` : "";
}
export function withoutNegotiation(description: string | null | undefined, value: Negotiation): string {
  const text = (description || "").trim(); const block=negotiationText(value);
  return block && text.endsWith(block) ? text.slice(0,-block.length).trim() : text;
}
export function withNegotiation(description: string | null | undefined, value: Negotiation): string {
  return [withoutNegotiation(description,value),negotiationText(value)].filter(Boolean).join("\n\n");
}
// Reserve space for the complete conditions before shortening the descriptive prose.
export function publicationDescription(description: string | null | undefined, features: string | null | undefined, maxProse=900) {
  const value=readNegotiation(features);
  return [negotiationText(value),withoutNegotiation(description,value).slice(0,negotiationText(value) ? Math.min(maxProse,400) : maxProse)].filter(Boolean).join("\n\n");
}

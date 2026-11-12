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
/**
 * Proteção central: repasse, débitos e responsabilidades do proprietário são
 * INTERNOS. Não reescrever nem incluir em anúncios, mesmo em descrições antigas.
 */
const PRIVATE_FINANCIAL_LINE = /^\s*(?:pagamento\s+ao\s+propriet[aá]rio|d[eé]bitos?\s+informad[oa]s?|detalhes?\s+dos?\s+d[eé]bitos?|responsabilidade\s+pelos?\s+d[eé]bitos?|repasse\s+ao\s+propriet[aá]rio|valor\s+l[ií]quido\s+(?:do|ao)\s+propriet[aá]rio|comiss[aã]o\s+(?:do|da)\s+corretor|valor\s+da\s+comiss[aã]o)\s*:/i;
const PRIVATE_FINANCIAL_HEADING = /^\s*(?:condi[cç][oõ]es\s+de\s+pagamento\s+e\s+negocia[cç][aã]o|dados\s+financeiros\s+internos)\s*:?\s*$/i;

/** Sanitização de segurança na saída pública, sem alterar a ficha no CRM. */
export function sanitizePublicPropertyText(description: string | null | undefined): string {
  return (description ?? "")
    .split(/\r?\n/)
    .filter((line) => !PRIVATE_FINANCIAL_LINE.test(line) && !PRIVATE_FINANCIAL_HEADING.test(line))
    .map((line) => line.replace(
      /(?:pagamento\s+ao\s+propriet[aá]rio|d[eé]bitos?\s+informad[oa]s?|detalhes?\s+dos?\s+d[eé]bitos?|responsabilidade\s+pelos?\s+d[eé]bitos?)\s*:\s*[^.;\n]+[.;]?/gi,
      "",
    ))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Permite apenas modalidades gerais, não o valor de repasse, débitos ou outros detalhes. */
export function publicNegotiationSummary(value: Negotiation): string {
  const methods = value.methods.filter((method) => PAYMENT_METHODS.includes(method));
  return methods.length ? "Condições aceitas: " + methods.join(", ") + "." : "";
}

export function publicationDescription(
  description: string | null | undefined,
  features: string | null | undefined,
  maxProse = 900,
): string {
  const value = readNegotiation(features);
  const clean = sanitizePublicPropertyText(withoutNegotiation(description, value));
  const tags = clean.match(/(?:#[\p{L}\p{N}_]+[ \n]*)+$/u)?.[0]?.trim() || "";
  const body = tags ? clean.slice(0, clean.lastIndexOf(tags)).trim() : clean;
  const summary = publicNegotiationSummary(value);
  const limit = Math.max(0, maxProse - (summary ? summary.length + 2 : 0) - (tags ? tags.length + 2 : 0));
  return [summary, body.slice(0, limit).trim(), tags].filter(Boolean).join("\n\n");
}

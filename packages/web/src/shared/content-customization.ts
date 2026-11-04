import { z } from "zod";

export const contentCustomizationSchema = z.object({
  homeOwnership: z.boolean().default(false),
  lifestyle: z.boolean().default(true),
  investment: z.boolean().default(false),
  priceDrop: z.boolean().default(true),
  financing: z.boolean().default(false),
  visit: z.boolean().default(true),
  hashtags: z.boolean().default(true),
  destination: z.enum(["whatsapp", "form"]).default("whatsapp"),
});
export type ContentCustomization = z.infer<typeof contentCustomizationSchema>;
export const DEFAULT_CONTENT_CUSTOMIZATION = contentCustomizationSchema.parse({});
export const CONTENT_CHOICES = [
  ["homeOwnership", "Saia do aluguel / conquiste sua casa própria"],
  ["lifestyle", "Destacar conforto e diferenciais do imóvel"],
  ["investment", "Apelo para investimento, sem prometer retorno"],
  ["priceDrop", "Destacar redução de preço, quando cadastrada"],
  ["financing", "Convidar para simulação de financiamento pelo WhatsApp"],
  ["visit", "Convidar para conhecer o imóvel / agendar visita"],
  ["hashtags", "Incluir 4 ou 5 hashtags relevantes"],
] as const;

export function customizationInstructions(options: ContentCustomization, facts: {
  purpose: string; type: string; price?: number | null; opportunityPrice?: number | null;
  negotiation?: { methods: string[] };
}) {
  const residential = /^(apartamento|casa|sobrado|cobertura|sobreposta|casa_alta|casa_baixa)$/.test(facts.type);
  const price = facts.opportunityPrice || facts.price || 0;
  const sale = facts.purpose !== "locacao";
  const lines = ["PERSONALIZAÇÃO COMERCIAL: varie a abertura e a redação de acordo com este imóvel; não use um texto repetido. As escolhas são orientações de escrita, nunca fatos novos. Preserve o tipo correto do imóvel."];
  lines.push(options.homeOwnership && sale && residential && price >= 250000 && price <= 600000
    ? "Use uma abertura criativa sobre sair do aluguel ou conquistar a casa própria."
    : "Não use o apelo sair do aluguel. Escolha uma abertura adequada à finalidade e ao imóvel.");
  if (options.lifestyle) lines.push("Conecte diferenciais cadastrados a benefícios reais de conforto e uso, sem inventar características.");
  if (options.investment && sale) lines.push("Pode abordar compra para investimento, sem afirmar rentabilidade, valorização ou renda não comprovadas.");
  lines.push(options.priceDrop && sale && facts.price && facts.opportunityPrice && facts.opportunityPrice < facts.price
    ? "Destaque a redução real de preço, de valor do imóvel por valor de oportunidade."
    : "Não anuncie desconto nem redução de preço.");
  const financing = options.financing && sale && facts.negotiation?.methods.includes("Financiamento");
  lines.push(financing
    ? "Inclua convite para solicitar simulação de financiamento pelo WhatsApp, com condições sujeitas à análise de crédito. Não prometa aprovação, análise automática, prazo, entrada ou parcelas não cadastradas."
    : "Não inclua convite de simulação, teste ou análise de financiamento.");
  if (options.visit) lines.push("Inclua um convite natural para conhecer o imóvel ou agendar uma visita.");
  lines.push(options.destination === "form"
    ? "O próximo passo é preencher o cadastro para receber detalhes" + (financing ? " e solicitar a simulação pelo WhatsApp após o cadastro." : ".") + " Não invente nome de botão."
    : "O próximo passo é entrar em contato pelo WhatsApp. Não invente telefone ou botão.");
  lines.push(options.hashtags
    ? "Finalize description e whatsapp com exatamente 4 ou 5 hashtags distintas: marca #ESantosCorretor, cidade, bairro e tipo ou diferencial reais. Sem hashtags nos campos title, highlight, portal ou SEO. Não use hashtag de financiamento se não confirmado."
    : "Não inclua hashtags em nenhum campo.");
  lines.push("Em description use abertura, características organizadas, preço e chamada para ação, em parágrafos curtos, com poucos emojis opcionais. Portal e SEO continuam objetivos e sem emojis ou hashtags. Não use urgência falsa, últimas unidades ou superlativos vazios. Não repita o mesmo chamariz em todas as frases.");
  return lines.join("\n");
}

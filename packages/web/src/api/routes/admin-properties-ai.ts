/**
 * Geração de conteúdo comercial do imóvel com IA.
 *
 * Limites duros (não são opcionais):
 * - o prompt recebe SOMENTE os campos realmente preenchidos no cadastro;
 * - o modelo é proibido de inventar característica, distância da praia, vista,
 *   lazer, mobília, documentação, condição de pagamento, andar, metragem ou
 *   qualquer número que não esteja na ficha;
 * - nada é gravado no banco aqui: a procedure devolve os textos para o
 *   administrador revisar e aprovar na tela.
 */
import { z } from "zod";
import { ORPCError } from "@orpc/server";
import { generateText } from "ai";
import { adminBase } from "../lib/admin-base";
import { gateway, gatewayConfigured } from "../agent/gateway";
import { FALLBACK_MODEL } from "../agent/model";

const purposeEnum = z.enum(["venda", "locacao", "venda_locacao"]);
const typeEnum = z.enum([
  "apartamento",
  "casa",
  "cobertura",
  "sobrado",
  "terreno",
  "sala_comercial",
  "chacara",
  "outro",
]);

const purposeLabel: Record<string, string> = {
  venda: "venda",
  locacao: "locação",
  venda_locacao: "venda e locação",
};

const typeLabel: Record<string, string> = {
  apartamento: "apartamento",
  casa: "casa",
  cobertura: "cobertura",
  sobrado: "sobrado",
  terreno: "terreno",
  sala_comercial: "sala comercial",
  chacara: "chácara",
  outro: "imóvel",
};

const generateInput = z.object({
  purpose: purposeEnum,
  type: typeEnum,
  price: z.number().min(0).max(999_999_999).nullable().optional(),
  condoFee: z.number().min(0).max(999_999).nullable().optional(),
  iptu: z.number().min(0).max(999_999).nullable().optional(),
  district: z.string().max(120).default(""),
  city: z.string().max(120).default(""),
  bedrooms: z.number().int().min(0).max(40).default(0),
  suites: z.number().int().min(0).max(40).default(0),
  bathrooms: z.number().int().min(0).max(40).default(0),
  parking: z.number().int().min(0).max(40).default(0),
  areaUtil: z.number().min(0).max(1_000_000).default(0),
  areaTotal: z.number().min(0).max(1_000_000).nullable().optional(),
  features: z.array(z.string().max(80)).max(60).default([]),
  /** título atual: usado apenas como contexto de tom, nunca como fato novo */
  title: z.string().max(200).default(""),
});

type GenerateInput = z.infer<typeof generateInput>;

const money = (value: number) =>
  value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

/** Ficha textual só com o que existe. Campo vazio simplesmente não aparece. */
function buildSheet(input: GenerateInput) {
  const lines: string[] = [];
  lines.push(`Tipo de imóvel: ${typeLabel[input.type] ?? "imóvel"}`);
  lines.push(`Finalidade: ${purposeLabel[input.purpose] ?? "venda"}`);
  if (input.district.trim()) lines.push(`Bairro: ${input.district.trim()}`);
  if (input.city.trim()) lines.push(`Cidade: ${input.city.trim()}`);
  if (input.price && input.price > 0) lines.push(`Preço: ${money(input.price)}`);
  if (input.condoFee && input.condoFee > 0) lines.push(`Condomínio: ${money(input.condoFee)}`);
  if (input.iptu && input.iptu > 0) lines.push(`IPTU: ${money(input.iptu)}`);
  if (input.bedrooms > 0) lines.push(`Dormitórios: ${input.bedrooms}`);
  if (input.suites > 0) lines.push(`Suítes: ${input.suites}`);
  if (input.bathrooms > 0) lines.push(`Banheiros: ${input.bathrooms}`);
  if (input.parking > 0) lines.push(`Vagas de garagem: ${input.parking}`);
  if (input.areaUtil > 0) lines.push(`Área útil: ${input.areaUtil} m²`);
  if (input.areaTotal && input.areaTotal > 0) lines.push(`Área total: ${input.areaTotal} m²`);

  const features = input.features.map((item) => item.trim()).filter((item) => item.length > 0);
  if (features.length > 0) {
    lines.push(`Características e diferenciais cadastrados: ${features.join("; ")}`);
  } else {
    lines.push(
      "Características e diferenciais cadastrados: NENHUMA. Não mencione nenhum diferencial, lazer, vista, mobília, documentação ou condição de pagamento.",
    );
  }
  return lines.join("\n");
}

const RULES = `REGRAS ABSOLUTAS (quebrar qualquer uma torna o texto inútil):
1. Use SOMENTE os dados da ficha abaixo. Está proibido criar, supor, estimar ou insinuar qualquer informação que não esteja escrita nela.
2. Nunca mencione: distância ou proximidade da praia, do mar, do comércio, de escolas ou de qualquer ponto; vista (mar, livre, panorâmica); lazer do condomínio (piscina, academia, salão, churrasqueira, portaria, elevador); mobília ou armários; documentação, escritura, financiamento, FGTS, permuta, entrada, parcelamento; andar, posição solar, estado de conservação, reforma, ano de construção; nome de edifício, rua ou número — EXCETO se estiver textualmente na ficha.
3. Nunca invente número: não crie metragem, quantidade de dormitórios, suítes, banheiros, vagas, valores ou prazos. Se um número não está na ficha, ele não existe.
4. Não use superlativo vazio nem promessa ("o melhor da cidade", "oportunidade única", "imperdível", "não perca"). Não prometa retorno de investimento nem valorização.
5. Tom: sofisticado, premium e profissional, humano e direto. Português do Brasil. Sem emoji. Sem CAIXA ALTA. Sem hashtag.
6. Se a ficha tiver poucos dados, escreva textos mais curtos — jamais complete com suposição.
7. Não cite o nome da imobiliária, telefone, link, preço em texto de SEO nem chamada para ação com contato inventado.`;

const FORMAT = `Responda SOMENTE com um objeto JSON válido, sem cercas de código e sem comentários, com exatamente estas chaves:
{
  "title": "título profissional do anúncio, 45 a 80 caracteres, sem preço",
  "highlight": "frase curta de destaque para o card do site, 40 a 90 caracteres, sem ponto final obrigatório",
  "description": "descrição comercial completa para a página do imóvel, 2 a 4 parágrafos curtos separados por \\n\\n, entre 500 e 1100 caracteres",
  "whatsapp": "versão curta para enviar no WhatsApp, até 400 caracteres, pode usar quebras de linha e traços simples como marcadores",
  "portal": "descrição para portais imobiliários, texto corrido objetivo, até 700 caracteres, sem contato e sem link",
  "metaTitle": "meta title de SEO, até 60 caracteres",
  "metaDescription": "meta description de SEO, entre 120 e 158 caracteres"
}`;

const outputSchema = z.object({
  title: z.string().min(3).max(300),
  highlight: z.string().min(3).max(300),
  description: z.string().min(20).max(4000),
  whatsapp: z.string().min(10).max(1500),
  portal: z.string().min(20).max(2000),
  metaTitle: z.string().min(3).max(200),
  metaDescription: z.string().min(20).max(400),
});

function parseJson(raw: string) {
  let text = raw.trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```[a-zA-Z]*\s*/, "").replace(/```\s*$/, "").trim();
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start > 0 || end < text.length - 1) {
    if (start === -1 || end === -1) throw new Error("Resposta da IA fora do formato esperado");
    text = text.slice(start, end + 1);
  }
  return JSON.parse(text) as unknown;
}

/** Campos mínimos: sem eles o texto sairia genérico. */
function missingFields(input: GenerateInput) {
  const missing: string[] = [];
  if (!input.district.trim()) missing.push("bairro");
  if (input.areaUtil <= 0) missing.push("área útil");
  const needsBedrooms = !["terreno", "sala_comercial", "outro"].includes(input.type);
  if (needsBedrooms && input.bedrooms <= 0) missing.push("dormitórios");
  return missing;
}

export const adminPropertyContent = {
  /**
   * Gera os textos comerciais do imóvel. Não grava nada: o retorno vai para
   * revisão do administrador, que decide aplicar campo por campo.
   */
  generate: adminBase.input(generateInput).handler(async ({ input }) => {
    const missing = missingFields(input);
    if (missing.length > 0) {
      throw new ORPCError("BAD_REQUEST", {
        message: `Preencha antes: ${missing.join(", ")}. A IA só escreve com dados reais do cadastro.`,
      });
    }
    if (!gatewayConfigured()) {
      throw new ORPCError("BAD_REQUEST", {
        message: "Provedor de IA não configurado no servidor.",
      });
    }

    const sheet = buildSheet(input);
    const prompt = [
      "Você redige anúncios de imóveis para a Edy Prime Imóveis, em Praia Grande (SP), com foco em médio e alto padrão.",
      RULES,
      "FICHA DO IMÓVEL (única fonte de verdade):",
      sheet,
      FORMAT,
    ].join("\n\n");

    let text = "";
    try {
      const result = await generateText({
        model: gateway(FALLBACK_MODEL),
        temperature: 0.6,
        prompt,
      });
      text = result.text;
    } catch (error) {
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: error instanceof Error ? error.message : "Falha ao consultar a IA",
      });
    }

    const parsed = outputSchema.safeParse(
      (() => {
        try {
          return parseJson(text);
        } catch {
          return null;
        }
      })(),
    );
    if (!parsed.success) {
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: "A IA respondeu fora do formato esperado. Tente gerar novamente.",
      });
    }

    return {
      ok: true as const,
      model: FALLBACK_MODEL,
      content: parsed.data,
      /** eco do que foi enviado — ajuda o admin a conferir a origem do texto */
      usedFields: sheet.split("\n"),
    };
  }),
};

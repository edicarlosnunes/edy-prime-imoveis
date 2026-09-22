/**
 * Tratamento do imóvel VENDIDO na vitrine pública.
 *
 * Só apresentação: nada aqui lê ou escreve banco, e nenhum dado cadastrado do
 * imóvel é alterado. O card vendido ganha uma faixa diagonal e troca o CTA
 * "Ver detalhes" por um convite a procurar imóvel semelhante no WhatsApp.
 */
import { whatsappLink } from "./site";

export const SOLD_STATUS = "vendido";

/** Único status que recebe a faixa diagonal. Reservado/alugado seguem normais. */
export function isSold(status: string | null | undefined): boolean {
  return typeof status === "string" && status.trim().toLowerCase() === SOLD_STATUS;
}

/**
 * Bairro vem do cadastro em caixa alta ("GUILHERMINIA"). Numa frase de WhatsApp
 * isso soa como grito, então normaliza para "Guilherminia" preservando as
 * partículas ("Vila do Sol", não "Vila Do Sol"). Nada é gravado: só exibição.
 */
const SMALL_WORDS = new Set(["da", "de", "do", "das", "dos", "e", "em", "no", "na"]);

export function prettyDistrict(raw: string | null | undefined): string {
  const value = (raw ?? "").trim();
  if (value === "") return "";
  /* Texto já digitado com maiúscula e minúscula é respeitado como está. */
  if (value !== value.toUpperCase()) return value;
  return value
    .toLowerCase()
    .split(/\s+/)
    .map((word, index) =>
      index > 0 && SMALL_WORDS.has(word) ? word : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join(" ");
}

/**
 * Mensagem do WhatsApp montada com os dados reais do imóvel clicado.
 * Nada é hardcoded: sem código ou sem bairro, a frase se adapta em vez de
 * sair com buraco ("o imóvel  em  já foi vendido").
 */
export function soldSimilarMessage(property: {
  code?: string | null;
  district?: string | null;
  city?: string | null;
}): string {
  const code = (property.code ?? "").trim();
  const district = prettyDistrict(property.district);
  const city = (property.city ?? "").trim();
  const place = district || city;

  let subject = "um imóvel do site";
  if (code && place) subject = `o imóvel ${code} em ${place}`;
  else if (code) subject = `o imóvel ${code}`;
  else if (place) subject = `um imóvel em ${place}`;

  return `Olá, vi que ${subject} já foi vendido. Quero encontrar um imóvel semelhante. Pode me ajudar?`;
}

/** Reaproveita o WhatsApp oficial de lib/site — nenhum número paralelo. */
export function soldSimilarLink(property: {
  code?: string | null;
  district?: string | null;
  city?: string | null;
}): string {
  return whatsappLink(soldSimilarMessage(property));
}

/** aria-label do CTA: leitor de tela precisa saber de qual imóvel se trata. */
export function soldCtaAriaLabel(property: {
  code?: string | null;
  district?: string | null;
}): string {
  const code = (property.code ?? "").trim();
  const district = prettyDistrict(property.district);
  const detail = [code, district].filter(Boolean).join(" em ");
  return detail
    ? `Falar no WhatsApp para encontrar um imóvel semelhante ao ${detail}, já vendido`
    : "Falar no WhatsApp para encontrar um imóvel semelhante a este, já vendido";
}

/**
 * CPF / CNPJ do PROPRIETÁRIO (V3).
 *
 * Estes dados alimentam a Ficha Técnica e a Autorização de Venda. Eles NÃO
 * identificam imóvel: a unidade continua sendo CEP + número + complementos e o
 * proprietário continua sendo identificado pelo telefone. Aqui só há
 * normalização, validação e formatação — nada de banco.
 *
 * A validação NUNCA bloqueia o cadastro: documento inválido é sinalizado para
 * conferência humana, porque um dígito errado digitado às pressas não pode
 * impedir a equipe de registrar a captação.
 */

export type DocKindPerson = "cpf" | "cnpj" | "desconhecido";

/** Só os dígitos, sem ponto, traço ou barra. */
export const onlyDigits = (value: string | null | undefined): string =>
  String(value ?? "").replace(/\D/g, "");

/** CPF tem 11 dígitos, CNPJ tem 14. Qualquer outro tamanho é desconhecido. */
export function docKind(value: string | null | undefined): DocKindPerson {
  const digits = onlyDigits(value);
  if (digits.length === 11) return "cpf";
  if (digits.length === 14) return "cnpj";
  return "desconhecido";
}

/** Dígitos verificadores do CPF. Sequência repetida (111...) é inválida. */
export function isValidCpf(value: string | null | undefined): boolean {
  const d = onlyDigits(value);
  if (d.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(d)) return false;
  const check = (size: number): number => {
    let sum = 0;
    for (let i = 0; i < size; i++) sum += Number(d[i]) * (size + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return check(9) === Number(d[9]) && check(10) === Number(d[10]);
}

/** Dígitos verificadores do CNPJ. Sequência repetida é inválida. */
export function isValidCnpj(value: string | null | undefined): boolean {
  const d = onlyDigits(value);
  if (d.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(d)) return false;
  const check = (size: number): number => {
    const weights = size === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < size; i++) sum += Number(d[i]) * weights[i];
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  return check(12) === Number(d[12]) && check(13) === Number(d[13]);
}

/** True quando o documento tem tamanho conhecido E dígitos verificadores ok. */
export function isValidDoc(value: string | null | undefined): boolean {
  const kind = docKind(value);
  if (kind === "cpf") return isValidCpf(value);
  if (kind === "cnpj") return isValidCnpj(value);
  return false;
}

/** 000.000.000-00 / 00.000.000/0000-00. Valor irreconhecível volta como veio. */
export function formatDoc(value: string | null | undefined): string {
  const d = onlyDigits(value);
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  if (d.length === 14) {
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  }
  return String(value ?? "").trim();
}

/** Rótulo curto para a tela e para o documento impresso. */
export function docLabel(value: string | null | undefined): string {
  const kind = docKind(value);
  if (kind === "cpf") return "CPF";
  if (kind === "cnpj") return "CNPJ";
  return "CPF/CNPJ";
}

/**
 * Normaliza para guardar. Guardamos SÓ os dígitos quando o tamanho é
 * conhecido; o resto é preservado como texto aparado, para não descartar o que
 * a equipe digitou. String vazia vira null.
 */
export function normalizeDoc(value: string | null | undefined): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const kind = docKind(raw);
  if (kind === "desconhecido") return raw.slice(0, 40);
  return onlyDigits(raw);
}

/** RG/CNH: texto livre aparado (formato varia por estado). Vazio vira null. */
export function normalizeRg(value: string | null | undefined): string | null {
  const raw = String(value ?? "").trim();
  return raw ? raw.slice(0, 40) : null;
}

/** Aviso para a ficha: documento presente mas com dígito verificador errado. */
export function docWarning(value: string | null | undefined): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (isValidDoc(raw)) return null;
  return "Documento não confere — revise antes de imprimir a autorização.";
}

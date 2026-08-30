/**
 * Leitura de valores monetários digitados no padrão brasileiro.
 *
 * `Number("320.000,00")` devolve NaN, e `parseFloat` corta em "320.000" -> 320.
 * Por isso a conversão é feita à mão: separador de milhar `.` é removido e a
 * vírgula decimal vira ponto antes de qualquer aritmética.
 */

/** Erro de digitação em campo monetário. A mensagem é exibida direto ao usuário. */
export class MoneyInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyInputError";
  }
}

const MAX_AMOUNT = 999_999_999;

/**
 * Converte texto em número.
 *
 * Aceita `320000`, `320000,00`, `320.000,00` e `R$ 320.000,00` — todos viram 320000.
 * Campo vazio (ou só espaços) devolve `null`, preservando o opcional.
 * Texto inválido lança `MoneyInputError` com mensagem clara.
 *
 * Convenção brasileira: `.` é sempre milhar e `,` é sempre decimal, então
 * `1.500` é mil e quinhentos, não um e meio.
 */
export function parseMoneyInput(raw: string, fieldLabel = "Valor"): number | null {
  if (typeof raw !== "string") return null;

  const cleaned = raw
    .replace(/ /g, " ")
    .replace(/R\$/gi, "")
    .replace(/\s/g, "");

  if (!cleaned) return null;

  if (!/^[0-9.,]+$/.test(cleaned)) {
    throw new MoneyInputError(`${fieldLabel}: use apenas números, por exemplo 320.000,00`);
  }

  const lastComma = cleaned.lastIndexOf(",");
  let integerPart = cleaned;
  let decimalPart = "";

  if (lastComma !== -1) {
    integerPart = cleaned.slice(0, lastComma);
    decimalPart = cleaned.slice(lastComma + 1);
    if (decimalPart.includes(",") || decimalPart.includes(".")) {
      throw new MoneyInputError(`${fieldLabel}: separador decimal inválido, use 320.000,00`);
    }
    if (decimalPart.length > 2) {
      throw new MoneyInputError(`${fieldLabel}: use no máximo 2 casas decimais`);
    }
  }

  const digits = integerPart.replace(/\./g, "");

  if (digits && !/^\d+$/.test(digits)) {
    throw new MoneyInputError(`${fieldLabel}: valor inválido, use 320.000,00`);
  }
  if (!digits && !decimalPart) {
    throw new MoneyInputError(`${fieldLabel}: valor inválido, use 320.000,00`);
  }

  const normalized = `${digits || "0"}.${decimalPart || "0"}`;
  const parsed = Number(normalized);

  if (!Number.isFinite(parsed)) {
    throw new MoneyInputError(`${fieldLabel}: valor inválido, use 320.000,00`);
  }
  if (parsed < 0) {
    throw new MoneyInputError(`${fieldLabel}: não pode ser negativo`);
  }
  if (parsed > MAX_AMOUNT) {
    throw new MoneyInputError(`${fieldLabel}: valor acima do limite permitido`);
  }

  return Math.round(parsed * 100) / 100;
}

/**
 * Converte texto em percentual (comissão). Mesma leitura decimal do dinheiro,
 * mas limitada a 0–100.
 */
export function parsePercentInput(raw: string, fieldLabel = "Comissão"): number | null {
  const parsed = parseMoneyInput(raw, fieldLabel);
  if (parsed === null) return null;
  if (parsed > 100) {
    throw new MoneyInputError(`${fieldLabel}: informe um percentual entre 0 e 100`);
  }
  return parsed;
}

/** Número persistido -> texto editável em padrão brasileiro, para preencher o formulário. */
export function formatMoneyInput(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "";
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

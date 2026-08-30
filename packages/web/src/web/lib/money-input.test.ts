import { describe, expect, test } from "bun:test";
import {
  MoneyInputError,
  formatMoneyInput,
  parseMoneyInput,
  parsePercentInput,
} from "./money-input";

describe("parseMoneyInput — os 4 formatos exigidos", () => {
  test("320000 -> 320000", () => {
    expect(parseMoneyInput("320000")).toBe(320000);
  });

  test("320000,00 -> 320000", () => {
    expect(parseMoneyInput("320000,00")).toBe(320000);
  });

  test("320.000,00 -> 320000", () => {
    expect(parseMoneyInput("320.000,00")).toBe(320000);
  });

  test("R$ 320.000,00 -> 320000", () => {
    expect(parseMoneyInput("R$ 320.000,00")).toBe(320000);
  });
});

describe("parseMoneyInput — valor proposto do teste real", () => {
  test("300.000,00 -> 300000", () => {
    expect(parseMoneyInput("300.000,00")).toBe(300000);
  });

  test("R$ 300.000,00 -> 300000", () => {
    expect(parseMoneyInput("R$ 300.000,00")).toBe(300000);
  });
});

describe("parseMoneyInput — campo vazio preserva null", () => {
  test("string vazia", () => {
    expect(parseMoneyInput("")).toBeNull();
  });

  test("apenas espaços", () => {
    expect(parseMoneyInput("   ")).toBeNull();
  });

  test("apenas R$ sem número", () => {
    expect(parseMoneyInput("R$ ")).toBeNull();
  });
});

describe("parseMoneyInput — valores inválidos com erro claro", () => {
  test("texto puro", () => {
    expect(() => parseMoneyInput("abc")).toThrow(MoneyInputError);
  });

  test("número com letra", () => {
    expect(() => parseMoneyInput("320.000,00x")).toThrow(MoneyInputError);
  });

  test("mais de 2 casas decimais", () => {
    expect(() => parseMoneyInput("320.000,000")).toThrow(/2 casas decimais/);
  });

  test("duas vírgulas decimais", () => {
    expect(() => parseMoneyInput("320,00,00")).toThrow(MoneyInputError);
  });

  test("acima do limite aceito pela API", () => {
    expect(() => parseMoneyInput("1.000.000.000")).toThrow(/limite/);
  });

  test("mensagem de erro usa o rótulo do campo", () => {
    expect(() => parseMoneyInput("abc", "Valor pedido")).toThrow(/^Valor pedido:/);
  });
});

describe("parseMoneyInput — outros formatos que o corretor pode digitar", () => {
  test("milhar sem decimal: 320.000 -> 320000", () => {
    expect(parseMoneyInput("320.000")).toBe(320000);
  });

  test("milhão completo: R$ 1.250.000,50 -> 1250000.5", () => {
    expect(parseMoneyInput("R$ 1.250.000,50")).toBe(1250000.5);
  });

  test("centavos com uma casa: 1.500,5 -> 1500.5", () => {
    expect(parseMoneyInput("1.500,5")).toBe(1500.5);
  });

  test("espaço não separável antes do número", () => {
    expect(parseMoneyInput("R$ 320.000,00")).toBe(320000);
  });

  test("zero é valor válido, não null", () => {
    expect(parseMoneyInput("0")).toBe(0);
  });
});

describe("parsePercentInput — comissão", () => {
  test("6 -> 6", () => {
    expect(parsePercentInput("6")).toBe(6);
  });

  test("6,5 -> 6.5", () => {
    expect(parsePercentInput("6,5")).toBe(6.5);
  });

  test("vazio -> null", () => {
    expect(parsePercentInput("")).toBeNull();
  });

  test("acima de 100 é rejeitado", () => {
    expect(() => parsePercentInput("120")).toThrow(/entre 0 e 100/);
  });
});

describe("comissão prevista: 300000 x 6% = 18000", () => {
  test("cálculo igual ao da rota admin-deals", () => {
    const offer = parseMoneyInput("300.000,00");
    const rate = parsePercentInput("6");
    expect(offer).not.toBeNull();
    expect(rate).not.toBeNull();
    const commission = ((offer as number) * (rate as number)) / 100;
    expect(commission).toBe(18000);
  });
});

describe("formatMoneyInput — número persistido volta editável em pt-BR", () => {
  test("320000 -> 320.000,00", () => {
    expect(formatMoneyInput(320000)).toBe("320.000,00");
  });

  test("ida e volta preserva o número", () => {
    expect(parseMoneyInput(formatMoneyInput(300000))).toBe(300000);
  });

  test("null -> string vazia", () => {
    expect(formatMoneyInput(null)).toBe("");
  });
});

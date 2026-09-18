/**
 * Formato do CÓDIGO UNIVERSAL EPI.
 *
 * Testa o que o usuário fechou: sequência universal desde 1000 que nunca
 * reinicia, mês/ano da criação no fuso de São Paulo, código imutável.
 */
import { describe, expect, test } from "bun:test";
import {
  EPI_FIRST_SEQUENCE,
  EPI_LEGACY_LABEL,
  buildEpi,
  epiLabel,
  epiPeriod,
  epiSearchTerm,
  formatEpi,
  isEpi,
  normalizeEpiInput,
  parseEpi,
} from "./epi-code";

describe("período MM-AA", () => {
  test("usa o fuso America/Sao_Paulo, não o do servidor", () => {
    /* 30/09/2026 23:30 em Brasília = 01/10/2026 02:30 em UTC. O código tem que
       sair 09-26: quem cadastrou, cadastrou em setembro. */
    expect(epiPeriod(new Date("2026-10-01T02:30:00Z"))).toBe("09-26");
  });

  test("meses e anos comuns", () => {
    expect(epiPeriod(new Date("2026-09-18T12:00:00Z"))).toBe("09-26");
    expect(epiPeriod(new Date("2027-01-05T12:00:00Z"))).toBe("01-27");
    expect(epiPeriod(new Date("2030-12-31T12:00:00Z"))).toBe("12-30");
  });

  test("data inválida não passa silenciosamente", () => {
    expect(() => epiPeriod(new Date("nada"))).toThrow();
  });
});

describe("formato", () => {
  test("o primeiro código é EPI-1000/MM-AA", () => {
    expect(EPI_FIRST_SEQUENCE).toBe(1000);
    expect(buildEpi(1000, new Date("2026-09-18T12:00:00Z"))).toBe("EPI-1000/09-26");
  });

  test("sequência de 5 dígitos continua valendo (não há teto de 4)", () => {
    expect(formatEpi(10042, "03-31")).toBe("EPI-10042/03-31");
  });

  test("sequência abaixo de 1000 é recusada", () => {
    expect(() => formatEpi(999, "09-26")).toThrow();
    expect(() => formatEpi(0, "09-26")).toThrow();
    expect(() => formatEpi(-5, "09-26")).toThrow();
  });

  test("sequência fracionária é recusada", () => {
    expect(() => formatEpi(1000.5, "09-26")).toThrow();
  });

  test("período fora do padrão é recusado", () => {
    expect(() => formatEpi(1000, "13-26")).toThrow();
    expect(() => formatEpi(1000, "00-26")).toThrow();
    expect(() => formatEpi(1000, "9-26")).toThrow();
    expect(() => formatEpi(1000, "09-2026")).toThrow();
  });
});

describe("a sequência é universal e não reinicia", () => {
  test("mês novo NÃO volta para 1000", () => {
    /* Duas fichas seguidas na virada do mês: o número segue, só o período muda. */
    const dezembro = buildEpi(1041, new Date("2026-12-20T12:00:00Z"));
    const janeiro = buildEpi(1042, new Date("2027-01-02T12:00:00Z"));
    expect(dezembro).toBe("EPI-1041/12-26");
    expect(janeiro).toBe("EPI-1042/01-27");
    expect(parseEpi(janeiro)!.sequence).toBe(parseEpi(dezembro)!.sequence + 1);
  });

  test("o período não entra na identidade do número", () => {
    /* Mesmo número em períodos diferentes não pode acontecer na prática, mas o
       formato deixa claro que quem identifica é a sequência. */
    expect(parseEpi("EPI-1042/01-27")!.sequence).toBe(1042);
    expect(parseEpi("EPI-1042/09-26")!.sequence).toBe(1042);
  });
});

describe("parse", () => {
  test("lê as partes", () => {
    const parsed = parseEpi("EPI-1054/09-26");
    expect(parsed).toEqual({
      sequence: 1054,
      period: "09-26",
      month: 9,
      year: 26,
      code: "EPI-1054/09-26",
    });
  });

  test("tolera caixa e espaços", () => {
    expect(parseEpi(" epi-1054/09-26 ")!.code).toBe("EPI-1054/09-26");
  });

  test("recusa o que não é EPI", () => {
    for (const value of [
      null,
      undefined,
      "",
      "1054",
      "EPI-999/09-26",
      "EPI-1054-09-26",
      "EPI/1054/09-26",
      "AP-2026-000124",
      "FC-AP-2026-000124",
      "EPI-1054/09-2026",
      "EPI-1054/13-26",
    ]) {
      expect(parseEpi(value)).toBeNull();
      expect(isEpi(value)).toBe(false);
    }
  });

  test("serial legado e EPI não se confundem", () => {
    expect(isEpi("AP-2026-000124")).toBe(false);
    expect(isEpi("EPI-1000/09-26")).toBe(true);
  });
});

describe("busca do CRM", () => {
  test("aceita o código inteiro", () => {
    expect(epiSearchTerm("EPI-1054/09-26")).toBe("EPI-1054/09-26");
  });

  test("aceita só o número", () => {
    expect(epiSearchTerm("1054")).toBe("EPI-1054");
  });

  test("aceita prefixo parcial", () => {
    expect(epiSearchTerm("EPI-10")).toBe("EPI-10");
    expect(epiSearchTerm("epi")).toBe("EPI-");
  });

  test("texto comum não vira busca de EPI", () => {
    expect(epiSearchTerm("Boqueirão")).toBeNull();
    expect(epiSearchTerm("cobertura frente mar")).toBeNull();
    expect(epiSearchTerm("")).toBeNull();
    expect(epiSearchTerm(null)).toBeNull();
  });

  test("normalização do que foi digitado", () => {
    expect(normalizeEpiInput(" epi 1054/09-26 ")).toBe("EPI-1054/09-26");
    expect(normalizeEpiInput("EPI/1054")).toBe("EPI-1054");
  });
});

describe("exibição", () => {
  test("ficha com EPI mostra o código", () => {
    expect(epiLabel("epi-1000/09-26")).toBe("EPI-1000/09-26");
  });

  test("ficha legada não ganha código inventado", () => {
    expect(epiLabel(null)).toBe(EPI_LEGACY_LABEL);
    expect(epiLabel("")).toBe(EPI_LEGACY_LABEL);
    expect(epiLabel("AP-2026-000124")).toBe(EPI_LEGACY_LABEL);
  });
});

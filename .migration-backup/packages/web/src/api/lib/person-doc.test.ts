import { describe, expect, test } from "bun:test";
import {
  docKind,
  docLabel,
  docWarning,
  formatDoc,
  isValidCnpj,
  isValidCpf,
  isValidDoc,
  normalizeDoc,
  normalizeRg,
  onlyDigits,
} from "./person-doc";

/* CPFs/CNPJs de teste: dígitos verificadores corretos, sem vínculo com pessoa
   real. Não usar em produção. */
const CPF_OK = "529.982.247-25";
const CPF_BAD = "529.982.247-24";
const CNPJ_OK = "04.252.011/0001-10";
const CNPJ_BAD = "04.252.011/0001-11";

describe("tipo do documento", () => {
  test("11 dígitos é CPF, 14 é CNPJ, o resto é desconhecido", () => {
    expect(docKind(CPF_OK)).toBe("cpf");
    expect(docKind(CNPJ_OK)).toBe("cnpj");
    expect(docKind("123")).toBe("desconhecido");
    expect(docKind(null)).toBe("desconhecido");
  });

  test("rótulo acompanha o tipo", () => {
    expect(docLabel(CPF_OK)).toBe("CPF");
    expect(docLabel(CNPJ_OK)).toBe("CNPJ");
    expect(docLabel("")).toBe("CPF/CNPJ");
  });
});

describe("validação", () => {
  test("CPF válido e inválido", () => {
    expect(isValidCpf(CPF_OK)).toBe(true);
    expect(isValidCpf(CPF_BAD)).toBe(false);
    expect(isValidCpf("111.111.111-11")).toBe(false);
    expect(isValidCpf("")).toBe(false);
  });

  test("CNPJ válido e inválido", () => {
    expect(isValidCnpj(CNPJ_OK)).toBe(true);
    expect(isValidCnpj(CNPJ_BAD)).toBe(false);
    expect(isValidCnpj("11.111.111/1111-11")).toBe(false);
  });

  test("isValidDoc cobre os dois e recusa tamanho estranho", () => {
    expect(isValidDoc(CPF_OK)).toBe(true);
    expect(isValidDoc(CNPJ_OK)).toBe(true);
    expect(isValidDoc("12345")).toBe(false);
  });
});

describe("formatação e normalização", () => {
  test("formata CPF e CNPJ", () => {
    expect(formatDoc("52998224725")).toBe("529.982.247-25");
    expect(formatDoc("04252011000110")).toBe("04.252.011/0001-10");
  });

  test("valor irreconhecível volta aparado, sem quebrar", () => {
    expect(formatDoc(" passaporte X1 ")).toBe("passaporte X1");
    expect(formatDoc(null)).toBe("");
  });

  test("normalizeDoc guarda só dígitos quando o tamanho é conhecido", () => {
    expect(normalizeDoc(CPF_OK)).toBe("52998224725");
    expect(normalizeDoc(CNPJ_OK)).toBe("04252011000110");
    expect(normalizeDoc("  ")).toBe(null);
    expect(normalizeDoc("RNE 123")).toBe("RNE 123");
  });

  test("normalizeRg é texto livre aparado", () => {
    expect(normalizeRg(" 12.345.678-9 ")).toBe("12.345.678-9");
    expect(normalizeRg("")).toBe(null);
  });

  test("onlyDigits limpa pontuação", () => {
    expect(onlyDigits(CPF_OK)).toBe("52998224725");
  });
});

describe("aviso de conferência", () => {
  test("documento vazio não avisa nada", () => {
    expect(docWarning(null)).toBe(null);
    expect(docWarning("")).toBe(null);
  });

  test("documento válido não avisa", () => {
    expect(docWarning(CPF_OK)).toBe(null);
    expect(docWarning(CNPJ_OK)).toBe(null);
  });

  test("documento com dígito errado avisa, mas é só aviso", () => {
    expect(docWarning(CPF_BAD)).toContain("revise");
    expect(docWarning("123")).toContain("revise");
  });
});

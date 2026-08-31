import { describe, expect, test } from "bun:test";
import {
  isSold,
  prettyDistrict,
  soldCtaAriaLabel,
  soldSimilarLink,
  soldSimilarMessage,
} from "./property-sold";

describe("isSold — só 'vendido' recebe tratamento especial", () => {
  test("vendido é vendido", () => {
    expect(isSold("vendido")).toBe(true);
    expect(isSold("VENDIDO")).toBe(true);
    expect(isSold(" vendido ")).toBe(true);
  });

  test("os demais status seguem normais", () => {
    expect(isSold("disponivel")).toBe(false);
    expect(isSold("reservado")).toBe(false);
    expect(isSold("alugado")).toBe(false);
    expect(isSold("")).toBe(false);
    expect(isSold(null)).toBe(false);
    expect(isSold(undefined)).toBe(false);
  });
});

describe("prettyDistrict", () => {
  test("caixa alta do cadastro vira texto legível", () => {
    expect(prettyDistrict("GUILHERMINIA")).toBe("Guilherminia");
    expect(prettyDistrict("VILA DO SOL")).toBe("Vila do Sol");
    expect(prettyDistrict("BOQUEIRAO")).toBe("Boqueirao");
  });

  test("texto já formatado é respeitado", () => {
    expect(prettyDistrict("Vila Caiçara")).toBe("Vila Caiçara");
  });

  test("vazio e nulo não quebram", () => {
    expect(prettyDistrict("")).toBe("");
    expect(prettyDistrict("   ")).toBe("");
    expect(prettyDistrict(null)).toBe("");
    expect(prettyDistrict(undefined)).toBe("");
  });
});

describe("soldSimilarMessage — dados reais do imóvel, nada hardcoded", () => {
  test("código e bairro entram na frase", () => {
    expect(soldSimilarMessage({ code: "CS1000", district: "GUILHERMINIA" })).toBe(
      "Olá, vi que o imóvel CS1000 em Guilherminia já foi vendido. Quero encontrar um imóvel semelhante. Pode me ajudar?",
    );
  });

  test("outro imóvel gera outra frase — nada fixo", () => {
    expect(soldSimilarMessage({ code: "AP2045", district: "Vila Caiçara" })).toBe(
      "Olá, vi que o imóvel AP2045 em Vila Caiçara já foi vendido. Quero encontrar um imóvel semelhante. Pode me ajudar?",
    );
  });

  test("sem bairro cai para a cidade", () => {
    expect(soldSimilarMessage({ code: "CS1000", district: "", city: "Praia Grande" })).toBe(
      "Olá, vi que o imóvel CS1000 em Praia Grande já foi vendido. Quero encontrar um imóvel semelhante. Pode me ajudar?",
    );
  });

  test("sem lugar nenhum, cita só o código", () => {
    expect(soldSimilarMessage({ code: "CS1000" })).toBe(
      "Olá, vi que o imóvel CS1000 já foi vendido. Quero encontrar um imóvel semelhante. Pode me ajudar?",
    );
  });

  test("sem código, cita só o lugar", () => {
    expect(soldSimilarMessage({ district: "GUILHERMINIA" })).toBe(
      "Olá, vi que um imóvel em Guilherminia já foi vendido. Quero encontrar um imóvel semelhante. Pode me ajudar?",
    );
  });

  test("sem código e sem lugar, a frase ainda faz sentido", () => {
    expect(soldSimilarMessage({})).toBe(
      "Olá, vi que um imóvel do site já foi vendido. Quero encontrar um imóvel semelhante. Pode me ajudar?",
    );
  });

  test("nunca sai com buraco na frase", () => {
    for (const p of [{}, { code: "" }, { district: "  " }, { code: null, district: null }]) {
      expect(soldSimilarMessage(p)).not.toContain("  ");
      expect(soldSimilarMessage(p)).not.toContain(" em .");
    }
  });
});

describe("soldSimilarLink — WhatsApp oficial do projeto", () => {
  test("usa o número configurado, sem número paralelo", () => {
    const link = soldSimilarLink({ code: "CS1000", district: "GUILHERMINIA" });
    expect(link.startsWith("https://wa.me/5513997141174?text=")).toBe(true);
  });

  test("código e bairro chegam codificados no link", () => {
    const link = soldSimilarLink({ code: "CS1000", district: "GUILHERMINIA" });
    const text = decodeURIComponent(new URL(link).searchParams.get("text") ?? "");
    expect(text).toContain("CS1000");
    expect(text).toContain("Guilherminia");
    expect(text).toContain("Quero encontrar um imóvel semelhante");
  });

  test("imóvel diferente gera link diferente", () => {
    const a = soldSimilarLink({ code: "CS1000", district: "GUILHERMINIA" });
    const b = soldSimilarLink({ code: "AP2045", district: "Vila Caiçara" });
    expect(a).not.toBe(b);
  });
});

describe("acessibilidade", () => {
  test("aria-label descreve o imóvel", () => {
    expect(soldCtaAriaLabel({ code: "CS1000", district: "GUILHERMINIA" })).toBe(
      "Falar no WhatsApp para encontrar um imóvel semelhante ao CS1000 em Guilherminia, já vendido",
    );
  });

  test("aria-label continua útil sem dados", () => {
    expect(soldCtaAriaLabel({})).toBe(
      "Falar no WhatsApp para encontrar um imóvel semelhante a este, já vendido",
    );
  });
});

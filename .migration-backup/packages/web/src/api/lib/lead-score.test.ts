import { describe, expect, test } from "bun:test";
import { WEIGHTS, scoreLead, tierOf } from "./lead-score";

describe("scoreLead", () => {
  test("lead vazio fica frio e não estoura o piso zero", () => {
    const result = scoreLead(null, null);
    expect(result.score).toBe(0);
    expect(result.tier).toBe("frio");
  });

  test("score fica sempre entre 0 e 100", () => {
    const max = scoreLead(
      {
        purpose: "comprar",
        propertyType: "apartamento",
        city: "Praia Grande",
        districts: ["Boqueirão"],
        budgetMin: 400_000,
        budgetMax: 800_000,
        bedrooms: 3,
        suites: 1,
        parking: 2,
        areaMin: 100,
        financing: "sim",
        fgts: "sim",
        tradeIn: "sim",
        timeframe: "imediato",
        contactPreference: "whatsapp",
        contactWindow: "tarde",
      },
      {
        hasPhone: true,
        hasEmail: true,
        hasName: true,
        wantsVisit: true,
        wantsHuman: true,
        cashPayment: true,
        messagesCount: 20,
        contactDays: 9,
      },
    );
    expect(max.score).toBeLessThanOrEqual(100);
    expect(max.score).toBeGreaterThanOrEqual(65);

    const min = scoreLead(null, { justLooking: true, invalidContact: true, budgetBelowCatalog: true });
    expect(min.score).toBe(0);
  });

  test("teto por categoria é respeitado", () => {
    const result = scoreLead(null, {
      hasPhone: true,
      hasEmail: true,
      hasName: true,
      messagesCount: 50,
      contactDays: 30,
    });
    expect(result.breakdown.contato).toBeLessThanOrEqual(WEIGHTS.caps.contato);
    expect(result.breakdown.engajamento).toBeLessThanOrEqual(WEIGHTS.caps.engajamento);
  });

  test("piso: pediu visita e tem telefone nunca fica abaixo de 65", () => {
    const result = scoreLead(null, { hasPhone: true, wantsVisit: true });
    expect(result.score).toBeGreaterThanOrEqual(WEIGHTS.visitFloor);
    expect(result.tier).toBe("quente");
    expect(result.reasons.some((r) => r.includes("Piso aplicado"))).toBe(true);
  });

  test("piso não se aplica sem telefone", () => {
    const result = scoreLead(null, { hasPhone: false, wantsVisit: true });
    expect(result.score).toBeLessThan(WEIGHTS.visitFloor);
  });

  test("penalidades derrubam o score e aparecem nos motivos", () => {
    const base = scoreLead({ purpose: "comprar", budgetMax: 300_000 }, { hasPhone: true, hasName: true });
    const penalized = scoreLead(
      { purpose: "comprar", budgetMax: 300_000 },
      { hasPhone: true, hasName: true, justLooking: true, budgetBelowCatalog: true },
    );
    expect(penalized.score).toBeLessThan(base.score);
    expect(penalized.reasons).toContain("Declarou que está só pesquisando");
    expect(penalized.reasons).toContain("Orçamento abaixo do menor imóvel disponível");
  });

  test("é determinístico: mesma entrada, mesma saída", () => {
    const input = [{ purpose: "comprar", timeframe: "30_dias" }, { hasPhone: true }] as const;
    const a = scoreLead(input[0], input[1]);
    const b = scoreLead(input[0], input[1]);
    expect(a).toEqual(b);
  });

  test("campo não informado não pontua", () => {
    const result = scoreLead({ purpose: null, budgetMax: null }, { hasPhone: true });
    expect(result.breakdown.necessidade).toBe(0);
    expect(result.reasons).not.toContain("Orçamento informado");
  });

  test("tiers seguem a régua", () => {
    expect(tierOf(65)).toBe("quente");
    expect(tierOf(64)).toBe("morno");
    expect(tierOf(35)).toBe("morno");
    expect(tierOf(34)).toBe("frio");
  });
});

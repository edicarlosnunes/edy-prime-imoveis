import { describe, expect, test } from "bun:test";
import {
  effectiveCommercialStatus,
  hiddenByCommercialStatus,
  normalizeCommercialStatus,
  showcaseDecision,
  showcaseVisible,
} from "./commercial-status";

describe("status comercial", () => {
  test("deriva do status antigo quando o campo novo está vazio", () => {
    expect(effectiveCommercialStatus({ status: "disponivel" })).toBe("ATIVO_PARA_VENDA");
    expect(effectiveCommercialStatus({ status: "reservado" })).toBe("RESERVADO");
    expect(effectiveCommercialStatus({ status: "vendido" })).toBe("VENDIDO");
  });

  test("alugado não tem equivalente no eixo de venda", () => {
    expect(effectiveCommercialStatus({ status: "alugado" })).toBeNull();
  });

  test("campo novo tem precedência sobre o antigo", () => {
    expect(
      effectiveCommercialStatus({ status: "disponivel", commercialStatus: "RETIRADO_PELO_PROPRIETARIO" }),
    ).toBe("RETIRADO_PELO_PROPRIETARIO");
  });

  test("valor inválido não vira status", () => {
    expect(normalizeCommercialStatus("qualquer")).toBeNull();
    expect(normalizeCommercialStatus("ativo para venda")).toBe("ATIVO_PARA_VENDA");
  });

  test("vendido e retirado saem da vitrine; reservado continua", () => {
    expect(hiddenByCommercialStatus({ commercialStatus: "VENDIDO" })).toBe(true);
    expect(hiddenByCommercialStatus({ commercialStatus: "RETIRADO_PELO_PROPRIETARIO" })).toBe(true);
    expect(hiddenByCommercialStatus({ commercialStatus: "RESERVADO" })).toBe(false);
    expect(hiddenByCommercialStatus({ commercialStatus: "ATIVO_PARA_VENDA" })).toBe(false);
  });
});

describe("vitrine ativa", () => {
  test("comportamento atual preservado: publicado e disponível aparece", () => {
    expect(showcaseVisible({ published: 1, status: "disponivel" })).toBe(true);
    expect(showcaseVisible({ published: 1, status: "reservado" })).toBe(true);
    expect(showcaseVisible({ published: 1, status: "alugado" })).toBe(true);
  });

  test("não publicado continua fora, como hoje", () => {
    const d = showcaseDecision({ published: 0, status: "disponivel" });
    expect(d.visible).toBe(false);
    expect(d.reason).toContain("não publicado");
  });

  test("vendido sai da vitrine mesmo publicado", () => {
    const d = showcaseDecision({ published: 1, status: "vendido" });
    expect(d.visible).toBe(false);
    expect(d.reason).toContain("Vendido");
  });

  test("retirado pelo proprietário sai da vitrine", () => {
    const d = showcaseDecision({ published: 1, status: "disponivel", commercialStatus: "RETIRADO_PELO_PROPRIETARIO" });
    expect(d.visible).toBe(false);
    expect(d.reason).toContain("Retirado");
  });

  test("pausado (12 meses) sai da vitrine e o registro segue no CRM", () => {
    const d = showcaseDecision({ published: 1, status: "disponivel", pausedAt: new Date("2026-09-01") });
    expect(d.visible).toBe(false);
    expect(d.reason).toContain("histórico preservado");
  });

  test("cadastro pausado ou arquivado sai da vitrine", () => {
    expect(showcaseVisible({ published: 1, status: "disponivel", registrationStatus: "PAUSADO" })).toBe(false);
    expect(showcaseVisible({ published: 1, status: "disponivel", registrationStatus: "ARQUIVADO" })).toBe(false);
    expect(showcaseVisible({ published: 1, status: "disponivel", registrationStatus: "CONCLUIDO" })).toBe(true);
  });

  test("imóvel antigo sem nenhum campo novo não é escondido por engano", () => {
    expect(showcaseVisible({ published: 1, status: "disponivel", commercialStatus: null, registrationStatus: null })).toBe(true);
  });
});

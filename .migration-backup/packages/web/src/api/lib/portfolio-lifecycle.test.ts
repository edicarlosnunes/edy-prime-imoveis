import { describe, expect, test } from "bun:test";
import {
  PAUSE_AFTER_MONTHS,
  PAUSE_REASON_12M,
  addMonths,
  lifecycleBase,
  lifecycleView,
  monthsBetween,
  pauseDueAt,
  pauseEffect,
  resumeFromPause,
} from "./portfolio-lifecycle";

const now = new Date("2026-09-17T12:00:00Z");
const months = (n: number) => addMonths(now, -n);

describe("datas", () => {
  test("soma meses preservando fim de mês", () => {
    expect(addMonths(new Date("2025-10-31T00:00:00Z"), 4).getMonth()).toBe(1);
    expect(pauseDueAt(new Date("2025-09-17T00:00:00Z")).getFullYear()).toBe(2026);
  });

  test("meses completos entre datas", () => {
    expect(monthsBetween(new Date("2025-09-17"), new Date("2026-09-17"))).toBe(12);
    expect(monthsBetween(new Date("2025-09-18"), new Date("2026-09-17"))).toBe(11);
  });

  test("a contagem usa 12 meses", () => {
    expect(PAUSE_AFTER_MONTHS).toBe(12);
  });
});

describe("regra dos 12 meses", () => {
  test("imóvel recente segue em carteira, sem pausa", () => {
    const v = lifecycleView({ portfolioEntryAt: months(3), status: "disponivel" }, now);
    expect(v.state).toBe("em_carteira");
    expect(v.shouldPause).toBe(false);
    expect(v.monthsInPortfolio).toBe(3);
  });

  test("perto de completar 12 meses avisa antes", () => {
    const v = lifecycleView({ portfolioEntryAt: addMonths(now, -12 + 0) , status: "disponivel" }, now);
    expect(v.shouldPause).toBe(true);
    const quase = lifecycleView({ portfolioEntryAt: new Date("2025-10-05T00:00:00Z"), status: "disponivel" }, now);
    expect(quase.state).toBe("pausa_proxima");
    expect(quase.shouldPause).toBe(false);
  });

  test("12 meses sem venda: pausa automática, sem confirmação humana", () => {
    const v = lifecycleView({ portfolioEntryAt: months(13), status: "disponivel" }, now);
    expect(v.state).toBe("pausa_devida");
    expect(v.shouldPause).toBe(true);
    expect(v.label).toContain(PAUSE_REASON_12M);
  });

  test("o efeito da pausa não exclui nada e gera ação para o corretor", () => {
    const effect = pauseEffect(now, 13);
    expect(effect.pausedAt).toEqual(now);
    expect(effect.pauseReason).toBe(PAUSE_REASON_12M);
    expect(effect.registrationStatus).toBe("PAUSADO");
    expect(effect.showcase).toBe(false);
    expect(effect.nextAction).toContain("Revisar imóvel pausado");
    expect(effect.historyNote).toContain("histórico preservado");
    /* `published` não faz parte do efeito: a decisão editorial é do corretor */
    expect(Object.keys(effect)).not.toContain("published");
  });

  test("já pausado não pausa de novo", () => {
    const v = lifecycleView({ portfolioEntryAt: months(20), status: "disponivel", pausedAt: months(1) }, now);
    expect(v.state).toBe("ja_pausado");
    expect(v.shouldPause).toBe(false);
  });

  test("vendido, alugado e retirado ficam fora da regra", () => {
    for (const input of [
      { status: "vendido" },
      { status: "alugado" },
      { status: "disponivel", commercialStatus: "VENDIDO" },
      { status: "disponivel", commercialStatus: "RETIRADO_PELO_PROPRIETARIO" },
    ]) {
      const v = lifecycleView({ portfolioEntryAt: months(30), ...input }, now);
      expect(v.state).toBe("fora_da_regra");
      expect(v.shouldPause).toBe(false);
    }
  });

  test("sem data de entrada não é vencido — é não definido", () => {
    const v = lifecycleView({ portfolioEntryAt: null, status: "disponivel" }, now);
    expect(v.state).toBe("sem_data_de_entrada");
    expect(v.shouldPause).toBe(false);
  });

  test("revalidação recente reinicia a contagem dos 12 meses", () => {
    const input = { portfolioEntryAt: months(20), lastRevalidationAt: months(2), status: "disponivel" };
    expect(lifecycleBase(input)?.getTime()).toBe(months(2).getTime());
    expect(lifecycleView(input, now).shouldPause).toBe(false);
  });

  test("revalidação antiga não reinicia nada", () => {
    const input = { portfolioEntryAt: months(20), lastRevalidationAt: months(25), status: "disponivel" };
    expect(lifecycleBase(input)?.getTime()).toBe(months(20).getTime());
    expect(lifecycleView(input, now).shouldPause).toBe(true);
  });

  test("reativação é humana, limpa a pausa e reinicia a contagem", () => {
    const effect = resumeFromPause(now, "Edy");
    expect(effect.pausedAt).toBeNull();
    expect(effect.pauseReason).toBeNull();
    expect(effect.portfolioEntryAt).toEqual(now);
    expect(effect.historyNote).toContain("Edy");
  });
});

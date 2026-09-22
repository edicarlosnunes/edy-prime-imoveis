import { describe, expect, test } from "bun:test";
import {
  addMonths,
  applyOutcome,
  daysBetween,
  nextRevalidationFrom,
  participatesInRevalidation,
  revalidationView,
  suggestedStatusChange,
  REVALIDATION_CYCLE_MONTHS,
} from "./property-revalidation";

describe("addMonths — soma preservando fim de mês", () => {
  test("caso simples: 10/01 + 4 = 10/05", () => {
    expect(addMonths(new Date(2026, 0, 10), 4)).toEqual(new Date(2026, 4, 10));
  });

  test("31/10 + 4 vira 28/02, não estoura para março", () => {
    expect(addMonths(new Date(2026, 9, 31), 4)).toEqual(new Date(2027, 1, 28));
  });

  test("ano bissexto: 31/10/2023 + 4 = 29/02/2024", () => {
    expect(addMonths(new Date(2023, 9, 31), 4)).toEqual(new Date(2024, 1, 29));
  });

  test("virada de ano", () => {
    expect(addMonths(new Date(2026, 10, 15), 4)).toEqual(new Date(2027, 2, 15));
  });
});

describe("ciclo de 4 meses", () => {
  test("o ciclo é de 4 meses", () => {
    expect(REVALIDATION_CYCLE_MONTHS).toBe(4);
  });

  test("nextRevalidationFrom soma exatamente o ciclo", () => {
    expect(nextRevalidationFrom(new Date(2026, 2, 1))).toEqual(new Date(2026, 6, 1));
  });
});

describe("participação na fila", () => {
  test("só imóvel disponível participa", () => {
    expect(participatesInRevalidation("disponivel")).toBe(true);
  });

  test("vendido, alugado e reservado ficam fora", () => {
    expect(participatesInRevalidation("vendido")).toBe(false);
    expect(participatesInRevalidation("alugado")).toBe(false);
    expect(participatesInRevalidation("reservado")).toBe(false);
  });
});

describe("revalidationView", () => {
  const now = new Date(2026, 8, 3); // 03/09/2026

  test("sem data de entrada na carteira: não definida, não vencida", () => {
    const view = revalidationView(
      {
        status: "disponivel",
        portfolioEntryAt: null,
        lastRevalidationAt: null,
        nextRevalidationAt: null,
        lastOutcome: null,
      },
      now,
    );
    expect(view.state).toBe("nao_definida");
    expect(view.daysUntilDue).toBeNull();
    expect(view.actionRequired).toBe(true);
  });

  test("imóvel não disponível fica fora do ciclo", () => {
    const view = revalidationView(
      {
        status: "vendido",
        portfolioEntryAt: new Date(2026, 0, 1),
        lastRevalidationAt: null,
        nextRevalidationAt: null,
        lastOutcome: null,
      },
      now,
    );
    expect(view.state).toBe("fora_do_ciclo");
    expect(view.actionRequired).toBe(false);
  });

  test("entrada recente fica em dia e a data sai da entrada na carteira", () => {
    const view = revalidationView(
      {
        status: "disponivel",
        portfolioEntryAt: new Date(2026, 7, 1), // 01/08/2026
        lastRevalidationAt: null,
        nextRevalidationAt: null,
        lastOutcome: null,
      },
      now,
    );
    expect(view.state).toBe("em_dia");
    expect(view.dueAt).toEqual(new Date(2026, 11, 1)); // 01/12/2026
  });

  test("passou de 4 meses sem revalidar: vencida", () => {
    const view = revalidationView(
      {
        status: "disponivel",
        portfolioEntryAt: new Date(2026, 0, 1),
        lastRevalidationAt: null,
        nextRevalidationAt: null,
        lastOutcome: null,
      },
      now,
    );
    expect(view.state).toBe("vencida");
    expect(view.daysUntilDue).toBeLessThan(0);
    expect(view.actionRequired).toBe(true);
  });

  test("dentro da janela de alerta avisa antes de vencer", () => {
    const view = revalidationView(
      {
        status: "disponivel",
        portfolioEntryAt: new Date(2026, 0, 1),
        lastRevalidationAt: null,
        nextRevalidationAt: new Date(2026, 8, 10), // vence em 7 dias
        lastOutcome: null,
      },
      now,
    );
    expect(view.state).toBe("vence_em_breve");
    expect(view.daysUntilDue).toBe(7);
  });

  test("já vendeu encerra o ciclo sem apagar histórico", () => {
    const view = revalidationView(
      {
        status: "disponivel",
        portfolioEntryAt: new Date(2026, 0, 1),
        lastRevalidationAt: new Date(2026, 5, 1),
        nextRevalidationAt: null,
        lastOutcome: "vendido",
      },
      now,
    );
    expect(view.state).toBe("encerrada");
    expect(view.actionRequired).toBe(false);
  });

  test("sem resposta vencido fica pendente, não sumindo da fila", () => {
    const view = revalidationView(
      {
        status: "disponivel",
        portfolioEntryAt: new Date(2026, 0, 1),
        lastRevalidationAt: new Date(2026, 7, 1),
        nextRevalidationAt: new Date(2026, 7, 16),
        lastOutcome: "sem_resposta",
      },
      now,
    );
    expect(view.state).toBe("pendente_sem_resposta");
    expect(view.actionRequired).toBe(true);
  });
});

describe("applyOutcome", () => {
  const at = new Date(2026, 8, 3);

  test("ainda disponível reinicia ciclo cheio de 4 meses", () => {
    const result = applyOutcome("disponivel", at);
    expect(result.lastRevalidationAt).toEqual(at);
    expect(result.nextRevalidationAt).toEqual(new Date(2027, 0, 3));
  });

  test("alterou condições também reinicia o ciclo", () => {
    expect(applyOutcome("alterou_condicoes", at).nextRevalidationAt).toEqual(
      new Date(2027, 0, 3),
    );
  });

  test("já vendeu encerra: sem próxima data", () => {
    expect(applyOutcome("vendido", at).nextRevalidationAt).toBeNull();
  });

  test("não deseja vender encerra: sem próxima data", () => {
    expect(applyOutcome("nao_deseja_vender", at).nextRevalidationAt).toBeNull();
  });

  test("retornar depois reagenda curto, sem ciclo cheio", () => {
    expect(applyOutcome("retornar_depois", at).nextRevalidationAt).toEqual(
      new Date(2026, 10, 3),
    );
  });

  test("sem resposta reagenda em 15 dias e não apaga nada", () => {
    const result = applyOutcome("sem_resposta", at);
    expect(result.nextRevalidationAt).not.toBeNull();
    expect(daysBetween(at, result.nextRevalidationAt!)).toBe(15);
  });
});

describe("nenhum desfecho muda properties.status sozinho", () => {
  test("vendido apenas sugere", () => {
    expect(suggestedStatusChange("vendido")).toBe("vendido");
  });

  test("disponível não sugere nada", () => {
    expect(suggestedStatusChange("disponivel")).toBeNull();
  });

  test("sem resposta não sugere nada", () => {
    expect(suggestedStatusChange("sem_resposta")).toBeNull();
  });
});

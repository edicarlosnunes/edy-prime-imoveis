import { describe, expect, test } from "bun:test";
import {
  CHECKLIST_ITEMS,
  DOC_TERMINAL_STATUSES,
  checklistAlerts,
  documentSummary,
  visibleBlocks,
  visibleChecklistItems,
  type BlockConditions,
} from "./property-docs-catalog";

const base: BlockConditions = {
  inCondominium: false,
  heranca: false,
  posse: false,
  financiamento: false,
  aluguel: false,
};

describe("blocos condicionais", () => {
  test("imóvel sem condição alguma mostra apenas a documentação base", () => {
    expect(visibleBlocks(base)).toEqual(["sempre"]);
  });

  test("casa comum fora de condomínio NÃO mostra bloco de condomínio", () => {
    const blocks = visibleBlocks({ ...base, inCondominium: false });
    expect(blocks).not.toContain("condominio");
    const keys = visibleChecklistItems({ ...base, inCondominium: false }).map((i) => i.key);
    expect(keys).not.toContain("condominio_em_dia");
  });

  test("apartamento em condomínio mostra o bloco de condomínio", () => {
    const conditions = { ...base, inCondominium: true };
    expect(visibleBlocks(conditions)).toContain("condominio");
    const keys = visibleChecklistItems(conditions).map((i) => i.key);
    expect(keys).toContain("condominio_documentacao");
    expect(keys).toContain("condominio_em_dia");
  });

  test("cada condição liga só o seu bloco", () => {
    expect(visibleBlocks({ ...base, heranca: true })).toEqual(["sempre", "heranca"]);
    expect(visibleBlocks({ ...base, posse: true })).toEqual(["sempre", "posse"]);
    expect(visibleBlocks({ ...base, financiamento: true })).toEqual([
      "sempre",
      "financiamento",
    ]);
    expect(visibleBlocks({ ...base, aluguel: true })).toEqual(["sempre", "aluguel"]);
  });

  test("todas as condições ligadas mostram os seis blocos", () => {
    const all = {
      inCondominium: true,
      heranca: true,
      posse: true,
      financiamento: true,
      aluguel: true,
    };
    expect(visibleBlocks(all)).toHaveLength(6);
  });
});

describe("catálogo", () => {
  test("as chaves do checklist são únicas", () => {
    const keys = CHECKLIST_ITEMS.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("todo item pertence a um bloco conhecido", () => {
    const blocks = new Set([
      "sempre",
      "heranca",
      "posse",
      "financiamento",
      "aluguel",
      "condominio",
    ]);
    for (const item of CHECKLIST_ITEMS) expect(blocks.has(item.block)).toBe(true);
  });
});

describe("alertas de pendência", () => {
  test("resposta NÃO em item crítico vira alerta", () => {
    const alerts = checklistAlerts(base, { matricula_disponivel: "nao" });
    expect(alerts.map((a) => a.key)).toContain("matricula_disponivel");
  });

  test("NÃO SABE também alerta quando configurado", () => {
    const alerts = checklistAlerts(base, { penhora_onus: "nao_sabe" });
    expect(alerts.map((a) => a.key)).toContain("penhora_onus");
  });

  test("resposta correta não gera alerta", () => {
    expect(checklistAlerts(base, { matricula_disponivel: "sim" })).toHaveLength(0);
  });

  test("item de bloco invisível não alerta mesmo respondido", () => {
    const alerts = checklistAlerts(base, { condominio_em_dia: "nao" });
    expect(alerts).toHaveLength(0);
  });

  test("item sem resposta não alerta", () => {
    expect(checklistAlerts(base, {})).toHaveLength(0);
  });
});

describe("recebido não é regular", () => {
  test("arquivo recebido não conta como regular", () => {
    const summary = documentSummary([{ status: "recebido", hasFile: true }]);
    expect(summary.comArquivo).toBe(1);
    expect(summary.recebidos).toBe(1);
    expect(summary.regulares).toBe(0);
  });

  test("só REGULAR conta como regular", () => {
    const summary = documentSummary([
      { status: "regular", hasFile: true },
      { status: "analisado", hasFile: true },
      { status: "pendencia", hasFile: false },
    ]);
    expect(summary.regulares).toBe(1);
    expect(summary.pendencias).toBe(1);
    expect(summary.emAnalise).toBe(1);
  });

  test("documento sem arquivo é válido (checklist respondido sem anexo)", () => {
    const summary = documentSummary([{ status: "aguardando_analise", hasFile: false }]);
    expect(summary.total).toBe(1);
    expect(summary.comArquivo).toBe(0);
  });

  test("apenas regular e pendência encerram a análise", () => {
    expect(DOC_TERMINAL_STATUSES).toEqual(["regular", "pendencia"]);
  });
});

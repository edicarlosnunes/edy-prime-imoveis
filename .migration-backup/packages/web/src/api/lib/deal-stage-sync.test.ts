import { describe, expect, test } from "bun:test";
import { DEAL_STATUS_TO_STAGE, LEAD_STAGE_ORDER, nextLeadStage } from "./deal-stage-sync";

describe("nextLeadStage", () => {
  test("proposta enviada avanca lead de visita_agendada", () => {
    expect(nextLeadStage("visita_agendada", "enviada")).toBe("proposta_enviada");
  });

  test("proposta enviada avanca lead de novo", () => {
    expect(nextLeadStage("novo", "enviada")).toBe("proposta_enviada");
  });

  test("nao regride quando lead ja esta em negociacao", () => {
    expect(nextLeadStage("negociacao", "enviada")).toBeNull();
  });

  test("nao regride quando lead ja fechou a venda", () => {
    expect(nextLeadStage("venda_fechada", "enviada")).toBeNull();
    expect(nextLeadStage("venda_fechada", "em_negociacao")).toBeNull();
  });

  test("nao mexe quando lead ja esta na etapa alvo", () => {
    expect(nextLeadStage("proposta_enviada", "enviada")).toBeNull();
  });

  test("em_negociacao leva para negociacao", () => {
    expect(nextLeadStage("proposta_enviada", "em_negociacao")).toBe("negociacao");
  });

  test("aceita leva para negociacao (venda ainda nao fechada)", () => {
    expect(nextLeadStage("proposta_enviada", "aceita")).toBe("negociacao");
  });

  test("fechada leva para venda_fechada", () => {
    expect(nextLeadStage("proposta_enviada", "fechada")).toBe("venda_fechada");
    expect(nextLeadStage("negociacao", "fechada")).toBe("venda_fechada");
  });

  test("recusada nunca move o funil", () => {
    for (const stage of LEAD_STAGE_ORDER) {
      expect(nextLeadStage(stage, "recusada")).toBeNull();
    }
  });

  test("status desconhecido nao move o funil", () => {
    expect(nextLeadStage("novo", "qualquer_coisa")).toBeNull();
  });

  test("etapa nula ou desconhecida assume a etapa alvo", () => {
    expect(nextLeadStage(null, "enviada")).toBe("proposta_enviada");
    expect(nextLeadStage(undefined, "enviada")).toBe("proposta_enviada");
    expect(nextLeadStage("etapa_inexistente", "enviada")).toBe("proposta_enviada");
  });

  test("mapa cobre todos os status de proposta", () => {
    expect(Object.keys(DEAL_STATUS_TO_STAGE).sort()).toEqual(
      ["aceita", "em_negociacao", "enviada", "fechada", "recusada"].sort(),
    );
  });

  test("todo alvo do mapa existe no funil", () => {
    for (const target of Object.values(DEAL_STATUS_TO_STAGE)) {
      if (target) expect(LEAD_STAGE_ORDER).toContain(target);
    }
  });
});

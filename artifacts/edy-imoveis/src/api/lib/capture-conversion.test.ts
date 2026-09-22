/**
 * Cadastro de imóvel aberto pela captação (`?capture_id=`).
 *
 * Cobre os testes numerados do pedido:
 *  18 — o serial é o MESMO na ficha e no imóvel (herança, sem renumerar)
 *  20 — o Cadastro Premium V2 é reutilizado a partir da captação
 *  21 — o imóvel criado fica vinculado à captação
 *  24 — imóvel vindo de captação NASCE com Publicado = NÃO
 */
import { describe, expect, test } from "bun:test";
import { planPropertyFromCapture } from "./capture-conversion";

/** Captação apta a virar imóvel: VALIDAÇÃO, documentação fechada, preço validado. */
const ready = {
  id: 4,
  stage: "validacao",
  docStatus: "completo",
  estimatedPrice: 450_000,
  convertedPropertyId: null,
  serial: "AP-2026-000124",
  propertyType: "apartamento",
};

describe("planPropertyFromCapture — liberação", () => {
  test("captação em VALIDAÇÃO com documentação e preço é liberada", () => {
    const plan = planPropertyFromCapture(ready);
    expect(plan.ok).toBe(true);
  });

  test("etapa anterior a VALIDAÇÃO é recusada", () => {
    const plan = planPropertyFromCapture({ ...ready, stage: "documentacao" });
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.code).toBe("FORBIDDEN");
  });

  test("documentação aberta é recusada", () => {
    const plan = planPropertyFromCapture({ ...ready, docStatus: "parcial" });
    expect(plan.ok).toBe(false);
  });

  test("DOCUMENTAÇÃO VALIDADA PELA EQUIPE também libera", () => {
    const plan = planPropertyFromCapture({ ...ready, docStatus: "validado_pela_equipe" });
    expect(plan.ok).toBe(true);
  });

  test("sem preço validado é recusada", () => {
    const plan = planPropertyFromCapture({ ...ready, estimatedPrice: null });
    expect(plan.ok).toBe(false);
  });

  test("captação já convertida não vira um segundo imóvel", () => {
    const plan = planPropertyFromCapture({ ...ready, convertedPropertyId: 9 });
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.code).toBe("CONFLICT");
  });

  test("captação perdida é recusada", () => {
    const plan = planPropertyFromCapture({ ...ready, stage: "perdido" });
    expect(plan.ok).toBe(false);
  });

  test("etapa legada `avaliacao` é lida como DOCUMENTAÇÃO e não libera", () => {
    const plan = planPropertyFromCapture({ ...ready, stage: "avaliacao" });
    expect(plan.ok).toBe(false);
  });
});

/* Teste 18 — o número impresso na Ficha Técnica é o número do imóvel. */
describe("serial herdado (teste 18)", () => {
  test("imóvel HERDA o serial-base da captação", () => {
    const plan = planPropertyFromCapture(ready);
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.serial).toBe("AP-2026-000124");
      expect(plan.writeBackSerial).toBe(false);
    }
  });

  test("captação antiga sem serial pede reserva e grava de volta", () => {
    const plan = planPropertyFromCapture({ ...ready, serial: null });
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.serial).toBeNull();
      expect(plan.writeBackSerial).toBe(true);
    }
  });

  test("serial em branco conta como ausente", () => {
    const plan = planPropertyFromCapture({ ...ready, serial: "   " });
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(plan.writeBackSerial).toBe(true);
  });
});

/* Testes 20 e 21 — o cadastro é o Premium V2, e o imóvel fica vinculado. */
describe("vínculo com a captação (testes 20 e 21)", () => {
  test("o plano devolve a captação a vincular", () => {
    const plan = planPropertyFromCapture(ready);
    if (plan.ok) expect(plan.captureId).toBe(4);
  });

  test("o tipo do imóvel vem da captação, para o prefixo do serial", () => {
    const plan = planPropertyFromCapture(ready);
    if (plan.ok) expect(plan.propertyType).toBe("apartamento");
  });

  test("tipo ausente não impede a conversão", () => {
    const plan = planPropertyFromCapture({ ...ready, propertyType: null });
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(plan.propertyType).toBeNull();
  });
});

/* Teste 24 — nunca publicado direto. */
describe("imóvel nasce fora do ar (teste 24)", () => {
  test("published é sempre 0", () => {
    const plan = planPropertyFromCapture(ready);
    if (plan.ok) expect(plan.published).toBe(0);
  });

  test("published continua 0 mesmo com captação sem serial", () => {
    const plan = planPropertyFromCapture({ ...ready, serial: null });
    if (plan.ok) expect(plan.published).toBe(0);
  });
});

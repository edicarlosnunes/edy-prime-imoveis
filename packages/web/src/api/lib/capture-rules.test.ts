import { describe, expect, test } from "bun:test";
import {
  checkConversion,
  checkStageTransition,
  hasValidAppraisal,
  isDocComplete,
  normalizeDocStatus,
} from "./capture-rules";

const base = { estimatedPrice: null as number | null, convertedPropertyId: null as number | null };

describe("ordem obrigatoria das etapas", () => {
  test("novo_contato -> avaliacao e permitido", () => {
    expect(checkStageTransition({ ...base, from: "novo_contato", to: "avaliacao" }).ok).toBe(true);
  });

  test("novo_contato -> documentacao e bloqueado (pular etapa)", () => {
    const r = checkStageTransition({ ...base, from: "novo_contato", to: "documentacao" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("pular etapas");
  });

  test("avaliacao -> documentacao exige avaliacao registrada", () => {
    const sem = checkStageTransition({ ...base, from: "avaliacao", to: "documentacao" });
    expect(sem.ok).toBe(false);
    if (!sem.ok) expect(sem.message).toContain("Registre a avaliação");

    const com = checkStageTransition({ ...base, from: "avaliacao", to: "documentacao", estimatedPrice: 480000 });
    expect(com.ok).toBe(true);
  });

  test("estimated_price zero ou negativo nao conta como avaliacao", () => {
    expect(checkStageTransition({ ...base, from: "avaliacao", to: "documentacao", estimatedPrice: 0 }).ok).toBe(false);
    expect(checkStageTransition({ ...base, from: "avaliacao", to: "documentacao", estimatedPrice: -1 }).ok).toBe(false);
  });

  test("retroceder e permitido entre etapas ativas", () => {
    expect(checkStageTransition({ ...base, from: "documentacao", to: "avaliacao", estimatedPrice: 480000 }).ok).toBe(true);
    expect(checkStageTransition({ ...base, from: "documentacao", to: "novo_contato", estimatedPrice: 480000 }).ok).toBe(true);
  });

  test("perdido e permitido de qualquer etapa ativa", () => {
    expect(checkStageTransition({ ...base, from: "novo_contato", to: "perdido" }).ok).toBe(true);
    expect(checkStageTransition({ ...base, from: "documentacao", to: "perdido" }).ok).toBe(true);
  });

  test("de perdido so se sai por Reabrir", () => {
    const r = checkStageTransition({ ...base, from: "perdido", to: "avaliacao" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("Reabrir");
  });
});

describe("CAPTADO nunca e manual", () => {
  test("setStage para captado e sempre bloqueado", () => {
    for (const from of ["novo_contato", "avaliacao", "documentacao"]) {
      const r = checkStageTransition({ ...base, from, to: "captado", estimatedPrice: 480000 });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toContain("Vincular imóvel e captar");
    }
  });

  test("captacao ja convertida e terminal", () => {
    const r = checkStageTransition({ from: "captado", to: "documentacao", estimatedPrice: 480000, convertedPropertyId: 12 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("CONFLICT");
  });
});

describe("conversao em imovel", () => {
  const ok = { stage: "documentacao", docStatus: "completo", estimatedPrice: 480000, convertedPropertyId: null, propertyId: 12 };

  test("documentacao completa + avaliacao + etapa correta libera a conversao", () => {
    expect(checkConversion(ok).ok).toBe(true);
  });

  test("doc_status incompleto bloqueia a conversao", () => {
    for (const docStatus of ["nao_iniciado", "solicitado", "parcial", "pendente"]) {
      const r = checkConversion({ ...ok, docStatus });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toContain("documentação");
    }
  });

  test("sem avaliacao bloqueia a conversao", () => {
    const r = checkConversion({ ...ok, estimatedPrice: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("avaliação");
  });

  test("fora de DOCUMENTACAO bloqueia a conversao", () => {
    const r = checkConversion({ ...ok, stage: "avaliacao" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("DOCUMENTAÇÃO");
  });

  test("reentrada com o mesmo imovel e idempotente", () => {
    const r = checkConversion({ ...ok, convertedPropertyId: 12 });
    expect(r).toEqual({ ok: true, already: true });
  });

  test("converter para outro imovel e conflito", () => {
    const r = checkConversion({ ...ok, convertedPropertyId: 99 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("CONFLICT");
  });
});

describe("doc_status mantem compatibilidade com o legado", () => {
  test("pendente antigo e lido como solicitado", () => {
    expect(normalizeDocStatus("pendente")).toBe("solicitado");
    expect(normalizeDocStatus("solicitado")).toBe("solicitado");
  });

  test("demais status passam direto", () => {
    expect(normalizeDocStatus("nao_iniciado")).toBe("nao_iniciado");
    expect(normalizeDocStatus("parcial")).toBe("parcial");
    expect(normalizeDocStatus("completo")).toBe("completo");
  });

  test("valor desconhecido ou nulo cai em nao_iniciado", () => {
    expect(normalizeDocStatus(null)).toBe("nao_iniciado");
    expect(normalizeDocStatus(undefined)).toBe("nao_iniciado");
    expect(normalizeDocStatus("qualquer_coisa")).toBe("nao_iniciado");
  });

  test("so completo libera conversao", () => {
    expect(isDocComplete("completo")).toBe(true);
    expect(isDocComplete("pendente")).toBe(false);
    expect(isDocComplete("parcial")).toBe(false);
  });
});

describe("hasValidAppraisal", () => {
  test("aceita numero positivo", () => {
    expect(hasValidAppraisal({ estimatedPrice: 480000 })).toBe(true);
    expect(hasValidAppraisal({ estimatedPrice: 0.5 })).toBe(true);
  });

  test("rejeita nulo, zero, negativo e nao-finito", () => {
    expect(hasValidAppraisal({ estimatedPrice: null })).toBe(false);
    expect(hasValidAppraisal({ estimatedPrice: undefined })).toBe(false);
    expect(hasValidAppraisal({ estimatedPrice: 0 })).toBe(false);
    expect(hasValidAppraisal({ estimatedPrice: -10 })).toBe(false);
    expect(hasValidAppraisal({ estimatedPrice: Number.NaN })).toBe(false);
  });
});

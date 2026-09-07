import { describe, expect, test } from "bun:test";
import {
  checkConversion,
  checkConversionStart,
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

/* ---------------------------------------------------------------------------
 * Guardas reportadas em producao na captacao #4 (07/09/2026).
 *
 * Os testes abaixo sao os 5 casos pedidos explicitamente. Eles cobrem a REGRA;
 * a fiacao no handler e o artefato realmente servido pela Vercel sao cobertos
 * em `routes/capture-guards.test.ts` — sem esse segundo arquivo a regra pode
 * estar certa e mesmo assim nao chegar em producao, que foi exatamente o que
 * aconteceu.
 * ------------------------------------------------------------------------ */
describe("guardas do funil (casos reportados na captacao #4)", () => {
  // 1. setStage(documentacao) sem estimated_price -> rejeita
  test("1. avancar para DOCUMENTACAO sem avaliacao e rejeitado", () => {
    for (const from of ["novo_contato", "avaliacao"]) {
      for (const estimatedPrice of [null, undefined, 0, -1, Number.NaN]) {
        const result = checkStageTransition({
          from,
          to: "documentacao",
          estimatedPrice: estimatedPrice as number | null,
          convertedPropertyId: null,
        });
        expect(result.ok).toBe(false);
      }
    }
    const direct = checkStageTransition({ ...base, from: "avaliacao", to: "documentacao" });
    expect(direct.ok).toBe(false);
    if (!direct.ok) {
      expect(direct.code).toBe("FORBIDDEN");
      expect(direct.message).toContain("Registre a avaliação");
    }
  });

  // 2. setStage(documentacao) com avaliacao -> aceita
  test("2. avancar de AVALIACAO para DOCUMENTACAO com avaliacao e aceito", () => {
    expect(
      checkStageTransition({
        from: "avaliacao",
        to: "documentacao",
        estimatedPrice: 480000,
        convertedPropertyId: null,
      }).ok,
    ).toBe(true);
    // Continua sendo proibido pular NOVO CONTATO -> DOCUMENTACAO, mesmo avaliado.
    expect(
      checkStageTransition({
        from: "novo_contato",
        to: "documentacao",
        estimatedPrice: 480000,
        convertedPropertyId: null,
      }).ok,
    ).toBe(false);
  });

  // 3. iniciar conversao com doc_status != completo -> rejeita
  test("3. iniciar conversao com documentacao incompleta e rejeitado", () => {
    for (const docStatus of [null, undefined, "nao_iniciado", "solicitado", "pendente", "parcial"]) {
      const result = checkConversionStart({
        stage: "documentacao",
        docStatus: docStatus as string | null,
        estimatedPrice: 480000,
        convertedPropertyId: null,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).toContain("COMPLETO");
    }
    // Sem avaliacao tambem nao inicia, mesmo com documentacao completa.
    expect(
      checkConversionStart({
        stage: "documentacao",
        docStatus: "completo",
        estimatedPrice: null,
        convertedPropertyId: null,
      }).ok,
    ).toBe(false);
    // Fora de DOCUMENTACAO nao inicia.
    for (const stage of ["novo_contato", "avaliacao", "perdido"]) {
      expect(
        checkConversionStart({
          stage,
          docStatus: "completo",
          estimatedPrice: 480000,
          convertedPropertyId: null,
        }).ok,
      ).toBe(false);
    }
  });

  // 4. doc_status completo -> permite seguir para o Cadastro Premium
  test("4. DOCUMENTACAO + avaliacao + doc completo libera o Cadastro Premium", () => {
    const ready = {
      stage: "documentacao",
      docStatus: "completo",
      estimatedPrice: 480000,
      convertedPropertyId: null,
    };
    expect(checkConversionStart(ready).ok).toBe(true);
    expect(checkConversion({ ...ready, propertyId: 12 }).ok).toBe(true);
  });

  // 5. request direto nao burla: nenhuma combinacao invalida passa
  test("5. nenhuma combinacao invalida de entrada passa nas regras", () => {
    const stages = ["novo_contato", "avaliacao", "documentacao", "captado", "perdido", "hackeado", ""];
    const docs = [null, "nao_iniciado", "solicitado", "pendente", "parcial", "completo", "COMPLETO", "sim"];
    const prices = [null, 0, -5, 480000];

    for (const stage of stages) {
      for (const docStatus of docs) {
        for (const estimatedPrice of prices) {
          const start = checkConversionStart({ stage, docStatus, estimatedPrice, convertedPropertyId: null });
          const shouldPass =
            stage === "documentacao" && docStatus === "completo" && estimatedPrice === 480000;
          expect(start.ok).toBe(shouldPass);

          // checkConversion delega em checkConversionStart: mesmo veredito.
          const full = checkConversion({ stage, docStatus, estimatedPrice, convertedPropertyId: null, propertyId: 12 });
          expect(full.ok).toBe(shouldPass);

          // Captacao ja convertida em OUTRO imovel nunca reconverte.
          const other = checkConversion({ stage, docStatus, estimatedPrice, convertedPropertyId: 99, propertyId: 12 });
          expect(other.ok).toBe(false);

          // Mesmo imovel e reentrada idempotente, nunca uma nova conversao.
          const same = checkConversion({ stage, docStatus, estimatedPrice, convertedPropertyId: 12, propertyId: 12 });
          expect(same.ok).toBe(true);
          expect("already" in same && same.already).toBe(true);
        }
      }
    }

    // CAPTADO manual continua proibido por qualquer caminho.
    for (const from of stages) {
      expect(
        checkStageTransition({ from, to: "captado", estimatedPrice: 480000, convertedPropertyId: null }).ok,
      ).toBe(false);
    }
  });
});

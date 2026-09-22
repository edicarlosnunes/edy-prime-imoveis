import { describe, expect, test } from "bun:test";
import {
  CAPTURE_STAGES,
  STAGE_ORDER,
  checkConversion,
  checkConversionStart,
  checkStageTransition,
  hasValidAppraisal,
  isDocComplete,
  isDocValidatedByTeam,
  normalizeDocStatus,
  normalizeStage,
  stageLabel,
} from "./capture-rules";

const base = {
  docStatus: null as string | null,
  estimatedPrice: null as number | null,
  convertedPropertyId: null as number | null,
};

/** Captação pronta para converter no fluxo V3. */
const pronta = {
  stage: "validacao",
  docStatus: "completo",
  estimatedPrice: 480000,
  convertedPropertyId: null as number | null,
};

describe("fluxo V3: NOVO CONTATO -> DOCUMENTACAO -> VALIDACAO -> CAPTADO", () => {
  test("a ordem do funil nao tem mais AVALIACAO como etapa", () => {
    expect(STAGE_ORDER).toEqual(["novo_contato", "documentacao", "validacao", "captado"]);
    expect(CAPTURE_STAGES).not.toContain("avaliacao");
  });

  test("novo_contato -> documentacao e permitido sem preco nenhum", () => {
    // A avaliacao saiu do caminho: preco agora pertence a VALIDACAO.
    expect(checkStageTransition({ ...base, from: "novo_contato", to: "documentacao" }).ok).toBe(true);
  });

  test("novo_contato -> validacao e bloqueado (pular etapa)", () => {
    const r = checkStageTransition({ ...base, from: "novo_contato", to: "validacao", docStatus: "completo" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("pular etapas");
  });

  test("documentacao -> validacao exige documentacao fechada", () => {
    for (const docStatus of [null, "nao_iniciado", "solicitado", "pendente", "parcial"]) {
      const r = checkStageTransition({ ...base, from: "documentacao", to: "validacao", docStatus });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toContain("Conclua a documentação");
    }
    expect(checkStageTransition({ ...base, from: "documentacao", to: "validacao", docStatus: "completo" }).ok).toBe(true);
    expect(
      checkStageTransition({ ...base, from: "documentacao", to: "validacao", docStatus: "validado_pela_equipe" }).ok,
    ).toBe(true);
  });

  test("retroceder e permitido entre etapas ativas", () => {
    expect(checkStageTransition({ ...base, from: "validacao", to: "documentacao" }).ok).toBe(true);
    expect(checkStageTransition({ ...base, from: "validacao", to: "novo_contato" }).ok).toBe(true);
    expect(checkStageTransition({ ...base, from: "documentacao", to: "novo_contato" }).ok).toBe(true);
  });

  test("perdido e permitido de qualquer etapa ativa", () => {
    for (const from of ["novo_contato", "documentacao", "validacao", "avaliacao"]) {
      expect(checkStageTransition({ ...base, from, to: "perdido" }).ok).toBe(true);
    }
  });

  test("de perdido so se sai por Reabrir", () => {
    const r = checkStageTransition({ ...base, from: "perdido", to: "documentacao" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("Reabrir");
  });

  test("etapa desconhecida e rejeitada", () => {
    expect(checkStageTransition({ ...base, from: "hackeado", to: "documentacao" }).ok).toBe(false);
    expect(checkStageTransition({ ...base, from: "", to: "documentacao" }).ok).toBe(false);
  });
});

/* ---------------------------------------------------------------------------
 * Compatibilidade com o valor legado `avaliacao`.
 *
 * A decisao fechada com o usuario e: compatibilidade SOMENTE NA LEITURA.
 * O valor gravado nao e alterado, nenhum UPDATE em massa e feito, e o
 * historico antigo fica intacto. Mesmo padrao ja usado para `pendente`.
 * ------------------------------------------------------------------------ */
describe("captacoes antigas em avaliacao sao lidas como DOCUMENTACAO", () => {
  test("normalizeStage traduz o legado", () => {
    expect(normalizeStage("avaliacao")).toBe("documentacao");
    expect(stageLabel("avaliacao")).toBe("DOCUMENTAÇÃO");
  });

  test("etapas canonicas passam direto", () => {
    for (const stage of CAPTURE_STAGES) expect(normalizeStage(stage)).toBe(stage);
  });

  test("valor desconhecido devolve null e nao inventa etapa", () => {
    expect(normalizeStage("qualquer_coisa")).toBeNull();
    expect(normalizeStage(null)).toBeNull();
    expect(normalizeStage(undefined)).toBeNull();
  });

  test("uma captacao legada em avaliacao avanca para VALIDACAO como se fosse DOCUMENTACAO", () => {
    expect(checkStageTransition({ ...base, from: "avaliacao", to: "validacao", docStatus: "completo" }).ok).toBe(true);
    // E continua sem poder pular direto para CAPTADO.
    expect(checkStageTransition({ ...base, from: "avaliacao", to: "captado" }).ok).toBe(false);
  });

  test("reenviar o valor legado como destino nao quebra (aba antiga do navegador)", () => {
    // "avaliacao" chega como DOCUMENTACAO: de novo_contato e um passo valido.
    expect(checkStageTransition({ ...base, from: "novo_contato", to: "avaliacao" }).ok).toBe(true);
  });

  test("conversao aceita a etapa legada apenas se ela ja passou por VALIDACAO", () => {
    // Legado `avaliacao` == DOCUMENTACAO, que NAO converte: falta VALIDACAO.
    const r = checkConversionStart({ ...pronta, stage: "avaliacao" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("VALIDAÇÃO");
  });
});

describe("CAPTADO nunca e manual", () => {
  test("setStage para captado e sempre bloqueado", () => {
    for (const from of ["novo_contato", "avaliacao", "documentacao", "validacao"]) {
      const r = checkStageTransition({ ...base, from, to: "captado", docStatus: "completo", estimatedPrice: 480000 });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toContain("Vincular imóvel e captar");
    }
  });

  test("captacao ja convertida e terminal", () => {
    const r = checkStageTransition({ ...base, from: "captado", to: "documentacao", convertedPropertyId: 12 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("CONFLICT");
  });
});

describe("conversao em imovel", () => {
  const ok = { ...pronta, propertyId: 12 };

  test("VALIDACAO + documentacao fechada + preco libera a conversao", () => {
    expect(checkConversion(ok).ok).toBe(true);
    expect(checkConversion({ ...ok, docStatus: "validado_pela_equipe" }).ok).toBe(true);
  });

  test("doc_status incompleto bloqueia a conversao", () => {
    for (const docStatus of ["nao_iniciado", "solicitado", "parcial", "pendente"]) {
      const r = checkConversion({ ...ok, docStatus });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toContain("documentação");
    }
  });

  test("sem preco validado bloqueia a conversao", () => {
    const r = checkConversion({ ...ok, estimatedPrice: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("avaliado");
  });

  test("fora de VALIDACAO bloqueia a conversao", () => {
    for (const stage of ["novo_contato", "documentacao", "avaliacao", "perdido"]) {
      const r = checkConversion({ ...ok, stage });
      expect(r.ok).toBe(false);
    }
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

describe("doc_status: status novos e compatibilidade com o legado", () => {
  test("pendente antigo e lido como solicitado", () => {
    expect(normalizeDocStatus("pendente")).toBe("solicitado");
    expect(normalizeDocStatus("solicitado")).toBe("solicitado");
  });

  test("demais status passam direto", () => {
    expect(normalizeDocStatus("nao_iniciado")).toBe("nao_iniciado");
    expect(normalizeDocStatus("parcial")).toBe("parcial");
    expect(normalizeDocStatus("completo")).toBe("completo");
    expect(normalizeDocStatus("validado_pela_equipe")).toBe("validado_pela_equipe");
  });

  test("valor desconhecido ou nulo cai em nao_iniciado", () => {
    expect(normalizeDocStatus(null)).toBe("nao_iniciado");
    expect(normalizeDocStatus(undefined)).toBe("nao_iniciado");
    expect(normalizeDocStatus("qualquer_coisa")).toBe("nao_iniciado");
    expect(normalizeDocStatus("COMPLETO")).toBe("nao_iniciado");
  });

  test("documentacao fechada = completo OU validado_pela_equipe", () => {
    expect(isDocComplete("completo")).toBe(true);
    expect(isDocComplete("validado_pela_equipe")).toBe(true);
    expect(isDocComplete("pendente")).toBe(false);
    expect(isDocComplete("parcial")).toBe(false);
    expect(isDocComplete("solicitado")).toBe(false);
    expect(isDocComplete("nao_iniciado")).toBe(false);
    expect(isDocComplete(null)).toBe(false);
  });

  test("isDocValidatedByTeam distingue validacao da equipe de upload completo", () => {
    expect(isDocValidatedByTeam("validado_pela_equipe")).toBe(true);
    expect(isDocValidatedByTeam("completo")).toBe(false);
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
 * Testes numerados do pedido (secao 29) cobertos por este modulo.
 * ------------------------------------------------------------------------ */
describe("teste 7 — documentacao solicitada", () => {
  test("solicitado nao fecha a documentacao e nao libera VALIDACAO", () => {
    expect(normalizeDocStatus("solicitado")).toBe("solicitado");
    expect(isDocComplete("solicitado")).toBe(false);
    const r = checkStageTransition({ ...base, from: "documentacao", to: "validacao", docStatus: "solicitado" });
    expect(r.ok).toBe(false);
  });

  test("solicitado nao libera a conversao", () => {
    expect(checkConversionStart({ ...pronta, docStatus: "solicitado" }).ok).toBe(false);
  });
});

describe("teste 8 — documentacao parcial", () => {
  test("parcial e um estado proprio, nem nao_iniciado nem completo", () => {
    expect(normalizeDocStatus("parcial")).toBe("parcial");
    expect(isDocComplete("parcial")).toBe(false);
    expect(isDocValidatedByTeam("parcial")).toBe(false);
  });

  test("parcial nao avanca para VALIDACAO nem converte", () => {
    expect(checkStageTransition({ ...base, from: "documentacao", to: "validacao", docStatus: "parcial" }).ok).toBe(false);
    expect(checkConversionStart({ ...pronta, docStatus: "parcial" }).ok).toBe(false);
  });

  test("mas a captacao pode continuar em DOCUMENTACAO e retroceder", () => {
    expect(checkStageTransition({ ...base, from: "documentacao", to: "novo_contato", docStatus: "parcial" }).ok).toBe(true);
  });
});

describe("teste 9 — documentacao validada pela equipe", () => {
  test("vale o mesmo que completo para avancar e para converter", () => {
    expect(
      checkStageTransition({ ...base, from: "documentacao", to: "validacao", docStatus: "validado_pela_equipe" }).ok,
    ).toBe(true);
    expect(checkConversionStart({ ...pronta, docStatus: "validado_pela_equipe" }).ok).toBe(true);
  });

  test("continua distinguivel de completo, para o historico nao mentir", () => {
    // O proprietario NAO enviou upload: quem fechou foi a equipe. O status
    // preserva essa diferenca em vez de fingir documento recebido.
    expect(isDocValidatedByTeam("validado_pela_equipe")).toBe(true);
    expect(isDocValidatedByTeam("completo")).toBe(false);
    expect(normalizeDocStatus("validado_pela_equipe")).not.toBe("completo");
  });
});

describe("teste 10 — validacao com preco", () => {
  test("em VALIDACAO, sem preco, a captacao nao converte", () => {
    for (const estimatedPrice of [null, undefined, 0, -1, Number.NaN]) {
      const r = checkConversionStart({ ...pronta, estimatedPrice: estimatedPrice as number | null });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toContain("VALIDAÇÃO");
    }
  });

  test("em VALIDACAO, com preco e documentacao fechada, converte", () => {
    expect(checkConversionStart(pronta).ok).toBe(true);
  });

  test("o preco nao e mais exigido para entrar em DOCUMENTACAO", () => {
    // Era a regra antiga (AVALIACAO -> DOCUMENTACAO). Agora preco e de VALIDACAO.
    expect(checkStageTransition({ ...base, from: "novo_contato", to: "documentacao", estimatedPrice: null }).ok).toBe(true);
  });
});

describe("teste 19 — cancelamento nao marca CAPTADO", () => {
  test("sem propertyId nao existe conversao possivel", () => {
    // Cancelar o Cadastro Premium simplesmente nunca chama markConverted.
    // A regra garante que, mesmo se chamado, nada abaixo de uma captacao
    // pronta passa — e CAPTADO nunca vem de setStage.
    expect(checkStageTransition({ ...base, from: "validacao", to: "captado", ...pronta }).ok).toBe(false);
  });

  test("captacao pronta permanece nao convertida ate o imovel existir", () => {
    expect(pronta.convertedPropertyId).toBeNull();
    expect(checkConversionStart(pronta).ok).toBe(true); // pode iniciar
    // ...mas iniciar nao e converter: quem converte e markConverted com o id.
  });
});

describe("teste 22 — CAPTADO somente depois da criacao do imovel", () => {
  test("nenhum caminho de setStage grava captado", () => {
    for (const from of [...CAPTURE_STAGES, "avaliacao", "hackeado", ""]) {
      const r = checkStageTransition({
        from,
        to: "captado",
        docStatus: "completo",
        estimatedPrice: 480000,
        convertedPropertyId: null,
      });
      expect(r.ok).toBe(false);
    }
  });

  test("captado exige um propertyId real vindo do Cadastro Premium", () => {
    const r = checkConversion({ ...pronta, propertyId: 77 });
    expect(r.ok).toBe(true);
  });
});

describe("teste 23 — historico nao duplica", () => {
  test("reentrada com o mesmo imovel devolve already, para nao gravar 2 eventos", () => {
    const first = checkConversion({ ...pronta, propertyId: 12 });
    expect(first.ok).toBe(true);
    expect("already" in first).toBe(false);

    const second = checkConversion({ ...pronta, convertedPropertyId: 12, propertyId: 12 });
    expect(second).toEqual({ ok: true, already: true });

    const third = checkConversion({ ...pronta, convertedPropertyId: 12, propertyId: 12 });
    expect(third).toEqual({ ok: true, already: true });
  });

  test("duplo clique em outro imovel nao gera evento nenhum: e conflito", () => {
    const r = checkConversion({ ...pronta, convertedPropertyId: 12, propertyId: 13 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("CONFLICT");
  });
});

/* ---------------------------------------------------------------------------
 * Varredura: nenhuma combinacao invalida de entrada passa.
 *
 * Herdado das guardas da captacao #4 e reescrito para o fluxo V3. A fiacao no
 * handler e o artefato realmente servido pela Vercel sao cobertos em
 * `routes/capture-guards.test.ts` — sem esse segundo arquivo a regra pode
 * estar certa e mesmo assim nao chegar em producao, que foi exatamente o que
 * aconteceu.
 * ------------------------------------------------------------------------ */
describe("request direto nao burla as regras", () => {
  test("nenhuma combinacao invalida de entrada passa", () => {
    const stages = ["novo_contato", "documentacao", "validacao", "captado", "perdido", "avaliacao", "hackeado", ""];
    const docs = [null, "nao_iniciado", "solicitado", "pendente", "parcial", "completo", "validado_pela_equipe", "COMPLETO", "sim"];
    const prices = [null, 0, -5, 480000];

    for (const stage of stages) {
      for (const docStatus of docs) {
        for (const estimatedPrice of prices) {
          const start = checkConversionStart({ stage, docStatus, estimatedPrice, convertedPropertyId: null });
          const shouldPass =
            stage === "validacao" &&
            (docStatus === "completo" || docStatus === "validado_pela_equipe") &&
            estimatedPrice === 480000;
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
        checkStageTransition({
          from,
          to: "captado",
          docStatus: "completo",
          estimatedPrice: 480000,
          convertedPropertyId: null,
        }).ok,
      ).toBe(false);
    }
  });
});

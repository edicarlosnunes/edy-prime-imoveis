import { describe, expect, test } from "bun:test";
import type { CaptureSnapshot } from "./owner-capture";
import {
  OWNER_ENTRY_INTRO,
  applicableLinkSteps,
  classifyOptionalAnswer,
  finalOk,
  linkAnswered,
  linkQuestion,
  missingFacadePhoto,
} from "./link-captacao";

function snapshot(answers: Record<string, string> = {}): CaptureSnapshot {
  return {
    ownerName: "Proprietário Teste",
    answered: ["endereco"],
    propertyType: "casa",
    askingPrice: 890000,
    answers: {
      documentacao: "sim",
      dormitorios: "3",
      suites: "1",
      banheiros: "2",
      vagas: "2",
      metragem: "87,25",
      caracteristicas: "12 x 28",
      condominio: "0",
      custos: "482,10",
      ...answers,
    },
  } as unknown as CaptureSnapshot;
}

function nextOwnerStep(data: CaptureSnapshot) {
  const answered = linkAnswered(data, true);
  return applicableLinkSteps(data.propertyType, true).find((step) => !answered.includes(step.key))?.key ?? null;
}

describe("LINK_CAPTACAO — proprietário exclusivo", () => {
  test("apresentação e pergunta objetiva sobre titularidade", () => {
    expect(OWNER_ENTRY_INTRO).toBe("Vamos iniciar o cadastro do seu imóvel.");
    expect(linkQuestion("documentacao", { ownerExclusive: true })).toContain("O imóvel está registrado em seu nome?");
    expect(linkQuestion("documentacao")).toContain("situação da documentação");
  });

  test("o roteiro do proprietário exige fachada, observação e OK nessa ordem", () => {
    const keys = applicableLinkSteps("casa", true).map((step) => step.key);
    expect(keys.slice(-3)).toEqual(["fotoFrente", "observacaoFinal", "confirmacaoFinal"]);
    expect(nextOwnerStep(snapshot())).toBe("fotoFrente");
    expect(nextOwnerStep(snapshot({ fotoFrente: "PENDENTE: foto não enviada" }))).toBe("observacaoFinal");
    expect(nextOwnerStep(snapshot({ fotoFrente: "Foto recebida", observacaoFinal: "Sem observações adicionais" }))).toBe("confirmacaoFinal");
    expect(nextOwnerStep(snapshot({ fotoFrente: "Foto recebida", observacaoFinal: "Há reforma", confirmacaoFinal: "OK" }))).toBeNull();
  });

  test("OK antigo não substitui a fotografia do proprietário", () => {
    expect(nextOwnerStep(snapshot({ confirmacaoFinal: "OK" }))).toBe("fotoFrente");
    expect(linkAnswered(snapshot({ confirmacaoFinal: "OK" }), true)).not.toContain("fotoFrente");
  });

  test("os outros perfis mantêm a rota anterior, inclusive sem tipo preenchido", () => {
    expect(applicableLinkSteps("casa").map((step) => step.key)).not.toContain("observacaoFinal");
    expect(applicableLinkSteps("casa").map((step) => step.key)).not.toContain("confirmacaoFinal");
    expect(applicableLinkSteps(null).map((step) => step.key)).not.toContain("observacaoFinal");
    expect(applicableLinkSteps(null).map((step) => step.key)).not.toContain("confirmacaoFinal");
  });

  test("respostas negativas naturais e desconhecidas não são confundidas", () => {
    for (const input of ["não tem", "nao tenho", "nenhum", "sem condomínio", "não pago", "zero", "0", "isento", "Não tem."]) {
      expect(classifyOptionalAnswer(input)).toBe("0");
    }
    for (const input of ["não sei", "n sei", "sei lá", "não lembro", "desconheço"]) {
      expect(classifyOptionalAnswer(input)).toBe("não informado");
    }
    expect(classifyOptionalAnswer("não se aplica")).toBe("não se aplica");
    expect(classifyOptionalAnswer("1100,20")).toBeNull();
  });

  test("ausência de foto gera pendência, não confirmação de mídia", () => {
    for (const input of ["não tenho", "não tenho foto", "sem foto", "não consigo enviar agora"]) {
      expect(missingFacadePhoto(input)).toBe(true);
    }
    expect(missingFacadePhoto("[imagem:/api/media/abc]")).toBe(false);
    expect(missingFacadePhoto("OK")).toBe(false);
  });

  test("encerramento somente aceita a confirmação final explícita", () => {
    expect(finalOk("ok")).toBe(true);
    expect(finalOk("OK.")).toBe(true);
    expect(finalOk("não tenho")).toBe(false);
    expect(finalOk("foto")).toBe(false);
  });

  test("tipo apartamento preserva suas dispensas de metragem do terreno, sem dispensar foto", () => {
    const keys = applicableLinkSteps("apartamento", true).map((step) => step.key);
    expect(keys).not.toContain("caracteristicas");
    expect(keys).toContain("fotoFrente");
    expect(keys).toContain("observacaoFinal");
    expect(keys).toContain("confirmacaoFinal");
  });
});

import { describe, expect, test } from "bun:test";
import type { CaptureSnapshot } from "./owner-capture";
import {
  CLOSING_MESSAGE,
  LINK_STEPS,
  OWNER_ENTRY_INTRO,
  applicableLinkSteps,
  brokerAwaitingFacadePhoto,
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
    propertyType: "apartamento",
    askingPrice: 890000,
    answers: {
      documentacao: "sim",
      dormitorios: "3",
      suites: "1",
      banheiros: "2",
      vagas: "2",
      metragem: "87,25",
      caracteristicas: "12 x 28",
      condominioPresenca: "yes",
      nomeCondominio: "Residencial Teste",
      condominio: "R$ 450",
      custos: "482,10",
      fotoFrente: "Foto da fachada recebida",
      observacaoFinal: "Sem observações adicionais",
      ...answers,
    },
  } as unknown as CaptureSnapshot;
}

function nextStep(data: CaptureSnapshot) {
  const answered = linkAnswered(data);
  return applicableLinkSteps(
    data.propertyType,
    false,
    data.answers as Record<string, string | undefined>,
  ).find((step) => !answered.includes(step.key))?.key ?? null;
}

describe("LINK_CAPTACAO — roteiro unificado", () => {
  test("abre com uma única mensagem e espera uma função, sem pergunta sim/não", () => {
    expect(OWNER_ENTRY_INTRO).toBe(
      "Vamos iniciar o cadastro do seu imóvel?\n\nVocê é proprietário, locador ou corretor de imóveis?",
    );
    expect(OWNER_ENTRY_INTRO).not.toMatch(/sim ou não|sim\/não/i);
  });

  test("todos os perfis encerram somente após observação final, sem passo OK", () => {
    expect(LINK_STEPS.map((step) => step.key).slice(-2)).toEqual([
      "fotoFrente",
      "observacaoFinal",
    ]);
    expect(LINK_STEPS.map((step) => step.key)).not.toContain("confirmacaoFinal");
    expect(CLOSING_MESSAGE).toBe(
      "Cadastro concluído com sucesso! Em breve entraremos em contato para dar continuidade ao atendimento.",
    );
    expect(nextStep(snapshot({ observacaoFinal: "" }))).toBe("observacaoFinal");
  });

  test("condomínio vem logo após o endereço e controla perguntas condicionais", () => {
    expect(LINK_STEPS.findIndex((step) => step.key === "condominioPresenca")).toBe(
      LINK_STEPS.findIndex((step) => step.key === "endereco") + 1,
    );
    expect(linkQuestion("condominioPresenca")).toContain("SIM, NÃO ou NÃO SEI");

    const noCondo = applicableLinkSteps("apartamento", false, {
      condominioPresenca: "no",
    }).map((step) => step.key);
    expect(noCondo).not.toContain("nomeCondominio");
    expect(noCondo).not.toContain("condominio");

    const hasCondo = applicableLinkSteps("apartamento", false, {
      condominioPresenca: "yes",
    }).map((step) => step.key);
    expect(hasCondo).toContain("nomeCondominio");
    expect(hasCondo).toContain("condominio");
  });

  test("locador recebe valor mensal e venda mantém o valor pretendido", () => {
    expect(linkQuestion("valor", { intention: "locacao" })).toContain("mensal do aluguel");
    expect(linkQuestion("valor", { intention: "venda" })).toContain("valor pretendido");
  });

  test("foto textual nunca é prova de mídia; NÃO SEI mantém pendência", () => {
    expect(missingFacadePhoto("NÃO SEI")).toBe(true);
    expect(missingFacadePhoto("não tenho foto")).toBe(true);
    expect(missingFacadePhoto("[imagem:/api/media/abc]")).toBe(false);
    expect(missingFacadePhoto("Já enviei a foto")).toBe(false);
    expect(nextStep(snapshot({
      fotoFrente: "PENDENTE: foto não enviada",
      observacaoFinal: "",
    }))).toBe("observacaoFinal");
  });

  test("respostas opcionais distinguem desconhecido, ausência e não aplicável", () => {
    expect(classifyOptionalAnswer("não sei")).toBe("não informado");
    expect(classifyOptionalAnswer("sem condomínio")).toBe("0");
    expect(classifyOptionalAnswer("não se aplica")).toBe("não se aplica");
    expect(classifyOptionalAnswer("1.200,50")).toBeNull();
    expect(finalOk("OK")).toBe(true);
  });

  test("tipo de imóvel mantém dispensa de terreno quando não aplicável", () => {
    const keys = applicableLinkSteps("apartamento", false, { condominioPresenca: "no" })
      .map((step) => step.key);
    expect(keys).not.toContain("caracteristicas");
    expect(keys).not.toContain("condominio");
    expect(keys).toContain("fotoFrente");
    expect(keys).toContain("observacaoFinal");
  });

  test("helper de mídia identifica somente a pergunta pendente de fachada do corretor", () => {
    const turns = [
      { role: "user" as const, content: "Vamos cadastrar seu imóvel?" },
      { role: "user" as const, content: "corretor" },
      { role: "user" as const, content: "CRECI 12345" },
      { role: "user" as const, content: "Corretor Teste" },
      { role: "user" as const, content: "venda" },
      { role: "user" as const, content: "NÃO SEI" },
      { role: "user" as const, content: "Rua A, 10" },
      { role: "user" as const, content: "não" },
      { role: "user" as const, content: "Escritura" },
      { role: "user" as const, content: "apartamento" },
      { role: "user" as const, content: "2" },
      { role: "user" as const, content: "1" },
      { role: "user" as const, content: "2" },
      { role: "user" as const, content: "1" },
      { role: "user" as const, content: "75 m²" },
      { role: "user" as const, content: "R$ 500.000" },
      { role: "user" as const, content: "R$ 300" },
    ];
    expect(brokerAwaitingFacadePhoto(turns)).toBe(true);
    expect(brokerAwaitingFacadePhoto([...turns, { role: "user" as const, content: "NÃO SEI" }])).toBe(false);
  });
});
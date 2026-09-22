import { describe, expect, test } from "bun:test";
import { qualifyText } from "./qualification";

const places = { knownDistricts: ["Boqueirão", "Canto do Forte", "Vila Tupi"], knownCities: ["Praia Grande", "Santos"] };

describe("qualifyText — orçamento", () => {
  test("R$ 450 mil", () => {
    expect(qualifyText("procuro algo até R$ 450 mil").patch.budgetMax).toBe(450_000);
  });

  test("450.000 sem símbolo", () => {
    expect(qualifyText("orçamento de 450.000").patch.budgetMax).toBe(450_000);
  });

  test("1,2 milhão", () => {
    expect(qualifyText("tenho até 1,2 milhão para investir").patch.budgetMax).toBe(1_200_000);
  });

  test("faixa entre X e Y", () => {
    const patch = qualifyText("quero entre 300 mil e 500 mil").patch;
    expect(patch.budgetMin).toBe(300_000);
    expect(patch.budgetMax).toBe(500_000);
  });

  test("a partir de X vira mínimo", () => {
    const patch = qualifyText("a partir de 600 mil").patch;
    expect(patch.budgetMin).toBe(600_000);
    expect(patch.budgetMax).toBeUndefined();
  });

  test("NEGATIVO: não sei quanto posso gastar não preenche orçamento", () => {
    const patch = qualifyText("não sei ainda quanto posso gastar, talvez 300 mil?").patch;
    expect(patch.budgetMax).toBeUndefined();
    expect(patch.budgetMin).toBeUndefined();
  });

  test("NEGATIVO: número solto não é preço", () => {
    expect(qualifyText("moro no bloco 3 apartamento 21").patch.budgetMax).toBeUndefined();
  });
});

describe("qualifyText — requisitos", () => {
  test("dormitórios, suítes e vagas", () => {
    const patch = qualifyText("quero 3 dormitórios, 1 suíte e 2 vagas").patch;
    expect(patch.bedrooms).toBe(3);
    expect(patch.suites).toBe(1);
    expect(patch.parking).toBe(2);
  });

  test("número por extenso", () => {
    expect(qualifyText("apartamento de dois quartos").patch.bedrooms).toBe(2);
  });

  test("área em m2", () => {
    expect(qualifyText("no mínimo 120 m2").patch.areaMin).toBe(120);
  });

  test("NEGATIVO: não decidi quantos quartos", () => {
    expect(qualifyText("ainda não decidi 3 quartos ou 2").patch.bedrooms).toBeUndefined();
  });
});

describe("qualifyText — finalidade, tipo e prazo", () => {
  test("aluguel", () => {
    expect(qualifyText("quero alugar um apartamento").patch.purpose).toBe("alugar");
  });

  test("compra + tipo casa", () => {
    const patch = qualifyText("quero comprar uma casa").patch;
    expect(patch.purpose).toBe("comprar");
    expect(patch.propertyType).toBe("casa");
  });

  test("urgência vira imediato", () => {
    expect(qualifyText("preciso urgente, para já").patch.timeframe).toBe("imediato");
  });

  test("sem pressa", () => {
    expect(qualifyText("estou sem pressa, ano que vem talvez").patch.timeframe).toBe("sem_pressa");
  });
});

describe("qualifyText — pagamento", () => {
  test("financiamento sim", () => {
    expect(qualifyText("pretendo financiar pela caixa").patch.financing).toBe("sim");
  });

  test("à vista marca sinal e financing nao", () => {
    const result = qualifyText("pago à vista");
    expect(result.signals.cashPayment).toBe(true);
    expect(result.patch.financing).toBe("nao");
  });

  test("FGTS positivo e negativo", () => {
    expect(qualifyText("tenho fgts para usar").patch.fgts).toBe("sim");
    expect(qualifyText("não tenho fgts").patch.fgts).toBe("nao");
  });

  test("permuta", () => {
    expect(qualifyText("tenho um apartamento para permuta").patch.tradeIn).toBe("sim");
  });
});

describe("qualifyText — localização do catálogo", () => {
  test("bairro e cidade reais são reconhecidos", () => {
    const patch = qualifyText("quero no Boqueirão em Praia Grande", places).patch;
    expect(patch.districts).toEqual(["Boqueirão"]);
    expect(patch.city).toBe("Praia Grande");
  });

  test("NEGATIVO: bairro inexistente no catálogo não é inventado", () => {
    expect(qualifyText("quero no Jardim Inexistente", places).patch.districts).toBeUndefined();
  });
});

describe("qualifyText — sinais", () => {
  test("pedido de visita", () => {
    expect(qualifyText("posso agendar uma visita amanhã?").signals.wantsVisit).toBe(true);
  });

  test("NEGATIVO: não quero visitar ainda", () => {
    expect(qualifyText("não quero visitar ainda").signals.wantsVisit).toBe(false);
  });

  test("pedido de humano", () => {
    expect(qualifyText("quero falar com o corretor").signals.wantsHuman).toBe(true);
  });

  test("só pesquisando", () => {
    expect(qualifyText("estou só pesquisando por curiosidade").signals.justLooking).toBe(true);
  });

  test("código do imóvel", () => {
    expect(qualifyText("gostei do EP-1042").signals.propertyCode).toBe("EP-1042");
  });

  test("texto vazio não gera nada", () => {
    const result = qualifyText("");
    expect(result.fields).toEqual([]);
    expect(Object.keys(result.patch)).toEqual([]);
  });

  test("fala típica da IA não produz dados do cliente relevantes", () => {
    /* proteção extra: mesmo se alguém passar texto do assistente por engano,
       perguntas não declaram valores */
    const result = qualifyText("Qual é o seu orçamento? Você prefere 2 ou 3 dormitórios?");
    expect(result.patch.budgetMax).toBeUndefined();
  });
});

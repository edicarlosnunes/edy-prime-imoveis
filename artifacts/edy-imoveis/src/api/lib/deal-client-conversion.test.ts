import { describe, expect, test } from "bun:test";
import {
  buildConversionNote,
  districtsToText,
  findExistingClient,
  planClientConversion,
  samePhone,
  type ClientLike,
  type LeadLike,
  type ProfileLike,
} from "./deal-client-conversion";

const lead: LeadLike = {
  id: 15,
  name: "edypg",
  phone: "11399692280",
  email: null,
  interest: "Comprar imóvel para morar",
};

const profile: ProfileLike = {
  districts: '["GUILHERMINIA"]',
  budgetMin: null,
  budgetMax: null,
  bedrooms: 2,
};

const deal = { id: 3, leadId: 15, clientId: null, offerPrice: 300000 };

function plan(over: Partial<Parameters<typeof planClientConversion>[0]> = {}) {
  return planClientConversion({
    dealStatus: "fechada",
    deal,
    lead,
    profile,
    propertyCode: "CS1000",
    existingClients: [],
    ...over,
  });
}

const baseClient: ClientLike = {
  id: 1,
  name: "edypg",
  phone: "11399692280",
  email: null,
  interest: null,
  priceMin: null,
  priceMax: null,
  districts: null,
  bedrooms: null,
  notes: null,
};

describe("venda fechada cria cliente", () => {
  test("lead sem cliente -> cria com os dados reais do lead e do perfil", () => {
    const result = plan();
    expect(result.action).toBe("create");
    if (result.action !== "create") return;
    expect(result.values.name).toBe("edypg");
    expect(result.values.phone).toBe("11399692280");
    expect(result.values.interest).toBe("Comprar imóvel para morar");
    expect(result.values.districts).toBe("GUILHERMINIA");
    expect(result.values.bedrooms).toBe(2);
    expect(result.values.notes).toContain("lead #15");
    expect(result.values.notes).toContain("proposta #3");
    expect(result.values.notes).toContain("CS1000");
  });

  test("nao inventa e-mail quando o lead nao tem", () => {
    const result = plan();
    if (result.action !== "create") throw new Error("esperava create");
    expect(result.values.email).toBeNull();
  });

  test("nao inventa faixa de preco quando o perfil nao tem", () => {
    const result = plan();
    if (result.action !== "create") throw new Error("esperava create");
    expect(result.values.priceMin).toBeNull();
    expect(result.values.priceMax).toBeNull();
  });
});

describe("nao converte fora de venda fechada", () => {
  for (const status of ["enviada", "em_negociacao", "aceita", "recusada"]) {
    test(`status "${status}" nao cria cliente`, () => {
      const result = plan({ dealStatus: status });
      expect(result.action).toBe("none");
    });
  }
});

describe("proposta sem lead", () => {
  test("nao cria cliente e nao quebra", () => {
    const result = plan({ deal: { ...deal, leadId: null }, lead: null });
    expect(result.action).toBe("none");
    if (result.action !== "none") return;
    expect(result.reason).toContain("sem lead");
  });
});

describe("deduplicacao", () => {
  test("reprocessar a mesma venda nao duplica: reaproveita o cliente", () => {
    const created = plan();
    if (created.action !== "create") throw new Error("esperava create");
    const existente: ClientLike = { ...baseClient, ...created.values };
    const again = plan({ existingClients: [existente] });
    expect(again.action).toBe("update");
    if (again.action !== "update") return;
    expect(again.clientId).toBe(1);
    /* nota da venda já está lá: nada de anexar de novo */
    expect(again.patch.notes).toBeUndefined();
  });

  test("cliente existente pelo telefone e reaproveitado", () => {
    const result = plan({ existingClients: [baseClient] });
    expect(result.action).toBe("update");
    if (result.action !== "update") return;
    expect(result.clientId).toBe(1);
  });

  test("telefone formatado diferente ainda deduplica", () => {
    const formatado: ClientLike = { ...baseClient, phone: "+55 (11) 3996-92280" };
    const result = plan({ existingClients: [formatado] });
    expect(result.action).toBe("update");
  });

  test("telefone com 55 na frente deduplica", () => {
    const result = plan({ existingClients: [{ ...baseClient, phone: "5511399692280" }] });
    expect(result.action).toBe("update");
  });

  test("telefone de outra pessoa nao deduplica", () => {
    const outro: ClientLike = { ...baseClient, id: 9, phone: "13991112222" };
    const result = plan({ existingClients: [outro] });
    expect(result.action).toBe("create");
  });

  test("sem telefone utilizavel, deduplica por e-mail", () => {
    const leadEmail: LeadLike = { ...lead, phone: "999", email: "edy@teste.com" };
    const clienteEmail: ClientLike = { ...baseClient, id: 4, phone: "999", email: "EDY@teste.com" };
    const result = plan({ lead: leadEmail, existingClients: [clienteEmail] });
    expect(result.action).toBe("update");
    if (result.action !== "update") return;
    expect(result.clientId).toBe(4);
  });

  test("sem telefone utilizavel e sem e-mail nao cria cliente", () => {
    const ruim: LeadLike = { ...lead, phone: "999", email: null };
    const result = plan({ lead: ruim });
    expect(result.action).toBe("none");
    if (result.action !== "none") return;
    expect(result.reason).toContain("sem telefone utilizável");
  });

  test("vinculo explicito de clientId tem prioridade", () => {
    const outro: ClientLike = { ...baseClient, id: 7, phone: "13991112222" };
    const result = plan({
      deal: { ...deal, clientId: 7 },
      existingClients: [outro],
    });
    expect(result.action).toBe("update");
    if (result.action !== "update") return;
    expect(result.clientId).toBe(7);
  });
});

describe("cliente existente nao perde dados", () => {
  test("dados ja preenchidos nao sao sobrescritos", () => {
    const preenchido: ClientLike = {
      ...baseClient,
      name: "Edy Nome Oficial",
      email: "oficial@teste.com",
      interest: "Investimento",
      priceMin: 100000,
      priceMax: 500000,
      districts: "Boqueirão",
      bedrooms: 3,
      notes: "Anotação antiga do corretor",
    };
    const result = plan({ existingClients: [preenchido] });
    expect(result.action).toBe("update");
    if (result.action !== "update") return;
    expect(result.patch.name).toBeUndefined();
    expect(result.patch.email).toBeUndefined();
    expect(result.patch.interest).toBeUndefined();
    expect(result.patch.priceMin).toBeUndefined();
    expect(result.patch.districts).toBeUndefined();
    expect(result.patch.bedrooms).toBeUndefined();
    /* a nota antiga é preservada, a da venda é anexada */
    expect(result.patch.notes).toContain("Anotação antiga do corretor");
    expect(result.patch.notes).toContain("proposta #3");
  });

  test("campos vazios sao completados com o que o lead tem", () => {
    const result = plan({ existingClients: [baseClient] });
    if (result.action !== "update") throw new Error("esperava update");
    expect(result.patch.interest).toBe("Comprar imóvel para morar");
    expect(result.patch.districts).toBe("GUILHERMINIA");
    expect(result.patch.bedrooms).toBe(2);
  });

  test("nao grava null por cima de dado existente", () => {
    const semPerfil = plan({ profile: null, existingClients: [{ ...baseClient, bedrooms: 3 }] });
    if (semPerfil.action !== "update") throw new Error("esperava update");
    expect(semPerfil.patch.bedrooms).toBeUndefined();
    expect(Object.values(semPerfil.patch).every((v) => v !== null)).toBe(true);
  });
});

describe("helpers", () => {
  test("districtsToText", () => {
    expect(districtsToText('["A","B"]')).toBe("A, B");
    expect(districtsToText("[]")).toBeNull();
    expect(districtsToText(null)).toBeNull();
    expect(districtsToText("texto solto")).toBe("texto solto");
    expect(districtsToText("{ json quebrado")).toBe("{ json quebrado");
  });

  test("samePhone", () => {
    expect(samePhone("11399692280", "+55 11 3996-92280")).toBe(true);
    expect(samePhone("11399692280", "13991112222")).toBe(false);
    expect(samePhone(null, "11399692280")).toBe(false);
    expect(samePhone("999", "999")).toBe(false);
  });

  test("buildConversionNote so cita dado existente", () => {
    expect(buildConversionNote({ leadId: 15, dealId: 3, propertyCode: "CS1000", offerPrice: 300000 })).toBe(
      "Cliente convertido a partir do lead #15 após venda fechada da proposta #3 — imóvel CS1000 — valor R$ 300.000.",
    );
    const semDados = buildConversionNote({ leadId: 1, dealId: 2, propertyCode: null, offerPrice: null });
    expect(semDados).toBe("Cliente convertido a partir do lead #1 após venda fechada da proposta #2.");
  });

  test("findExistingClient sem candidatos", () => {
    expect(findExistingClient([], lead, null)).toBeNull();
  });
});

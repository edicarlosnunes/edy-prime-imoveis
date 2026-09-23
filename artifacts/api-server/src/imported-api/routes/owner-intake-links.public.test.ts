import { describe, expect, test } from "bun:test";
import { buildBrokerPatch, buildPublicSaveInput, deterministicPublicExtract, nextPublicQuestion, parsePublicMoney, publicState, publicTokenPattern, sufficientPublicAddress, type PublicDraft } from "./owner-intake-links";

describe("motor público LINK_CAPTACAO", () => {
  test("interpreta vários campos de uma mensagem sem confundir os números", () => {
    const result = deterministicPublicExtract("Apartamento de 2 quartos, 1 suíte, 2 banheiros, 1 vaga, 78 m² no Canto do Forte");
    expect(result.propertyType).toMatch(/apartamento/i);
    expect(result.bedrooms).toBe(2);
    expect(result.suites).toBe(1);
    expect(result.bathrooms).toBe(2);
    expect(result.parking).toBe(1);
    expect(result.areaUtil).toBe(78);
  });

  test("mantém NÃO SEI distinto de zero e aceita formatos monetários", () => {
    expect(parsePublicMoney("450000")).toBe(450000);
    expect(parsePublicMoney("450.000")).toBe(450000);
    expect(parsePublicMoney("R$ 450.000")).toBe(450000);
    expect(parsePublicMoney("450 mil")).toBe(450000);
    expect(parsePublicMoney("450k")).toBe(450000);
    expect(parsePublicMoney("NÃO SEI")).toBeNull();
    expect(deterministicPublicExtract("0 quartos, 0 vagas").bedrooms).toBe(0);
    expect(deterministicPublicExtract("NÃO SEI").askingPrice).toBeNull();
  });

  test("usa o tipo para escolher a pergunta", () => {
    expect(nextPublicQuestion({ profile: "PROPRIETARIO", ownerName: "Ana", phone: "119", email: "a@b.com", intention: "venda", propertyType: "terreno", address: "Rua A", answers: { complemento: "SEM COMPLEMENTO" } })).toContain("documentação");
  });

  test("proprietário pode declarar venda sem converter para compra", () => {
    const result = deterministicPublicExtract("apartamento para venda");
    expect(result.intention).toBe("venda");
  });

  test("proprietário pode declarar locação", () => {
    expect(deterministicPublicExtract("quero alugar este apartamento").intention).toBe("locacao");
  });

  test("locador tem finalidade automática e pergunta de ocupação", () => {
    expect(nextPublicQuestion({ profile: "LOCADOR" })).toContain("nome completo");
    expect(nextPublicQuestion({ profile: "LOCADOR", ownerName: "O", phone: "11", email: "o@e.com", intention: "locacao", propertyType: "casa", address: "Rua A", answers: { complemento: "SEM COMPLEMENTO", documentacao: "NÃO SEI" }, askingPrice: 1800 })).toContain("condomínio");
  });

  test("locador extrai ocupado e desocupado como valores declarados", () => {
    expect(deterministicPublicExtract("imóvel desocupado").occupancy).toBe("imóvel desocupado");
    expect(deterministicPublicExtract("está ocupado com inquilino").occupancy).toBe("está ocupado com inquilino");
  });

  test("corretor mantém telefone próprio separado do proprietário", () => {
    const draft: PublicDraft = { profile: "CORRETOR", brokerName: "Corretor", brokerPhone: "11999990000", brokerCreci: "12345", ownerName: "Dono", phone: "13988887777" };
    expect(buildBrokerPatch(draft).brokerPhone).toBe("11999990000");
    expect(buildPublicSaveInput(draft).phone).toBe("13988887777");
    expect(buildBrokerPatch(draft).brokerPhone).not.toBe(buildPublicSaveInput(draft).phone);
  });

  test("resposta vazia não cria transcript nem avança", () => {
    const draft: PublicDraft = { profile: "PROPRIETARIO", ownerName: "O" };
    expect(draft.transcript).toBeUndefined();
    expect(nextPublicQuestion(draft)).toContain("telefone");
  });

  test("zero permanece zero e não é desconhecido", () => {
    const result = deterministicPublicExtract("0 quartos e 0 vagas");
    expect(result.bedrooms).toBe(0);
    expect(result.parking).toBe(0);
  });

  test("NÃO SEI permanece nulo/desconhecido", () => {
    expect(deterministicPublicExtract("NÃO SEI").askingPrice).toBeNull();
    expect(nextPublicQuestion({ profile: "PROPRIETARIO", ownerName: "O", phone: "11", email: "NÃO SEI" })).toContain("endereço");
  });

  test("retomada usa próximo dado faltante e transcript persistido", () => {
    const state = publicState({ status: "iniciado" } as never, { profile: "PROPRIETARIO", ownerName: "O", phone: "11", transcript: [{ role: "user", text: "O" }, { role: "assistant", text: "telefone" }] });
    expect(state.draft.transcript).toHaveLength(2);
    expect(state.question).toContain("endereço");
  });

  test("dois drafts públicos permanecem isolados", () => {
    const a = publicState({ status: "iniciado" } as never, { profile: "PROPRIETARIO", ownerName: "A" });
    const b = publicState({ status: "iniciado" } as never, { profile: "LOCADOR", ownerName: "B", intention: "locacao" });
    expect(a.draft.profile).toBe("PROPRIETARIO");
    expect(b.draft.profile).toBe("LOCADOR");
    expect(a.draft.intention).toBeNull();
    expect(b.draft.intention).toBe("locacao");
  });

  test("token público exige exatamente 64 hexadecimais", () => {
    expect(publicTokenPattern.test("a".repeat(64))).toBe(true);
    expect(publicTokenPattern.test("a".repeat(63))).toBe(false);
    expect(publicTokenPattern.test("not-a-token")).toBe(false);
  });

  test("publicState não expõe IDs internos, hash ou telefone", () => {
    const state = publicState({ status: "iniciado", id: 55, tokenHash: "secret", phone: "13999" } as never, { ownerName: "O", profile: "PROPRIETARIO" });
    expect(JSON.stringify(state)).not.toContain("tokenHash");
    expect(JSON.stringify(state)).not.toContain("13999");
    expect(JSON.stringify(state)).not.toContain("\"id\"");
  });

  test("build de persistência usa destino estruturado e origem obrigatória", () => {
    const input = buildPublicSaveInput({ ownerName: "O", phone: "11", propertyType: "apartamento", intention: "venda", askingPrice: 450000, address: "Rua livre", addressParts: { cep: "11700-000", street: "Rua A", number: "10", district: "Centro", city: "Praia Grande", state: "SP" }, answers: { quartos: "2", suites: "1", banheiros: "2", vagas: "1", areaUtil: "78" } });
    expect(input.origem).toBe("LINK_CAPTACAO");
    expect(input.cep).toBe("11700-000");
    expect(input.dormitorios).toBe("2");
    expect(input.vagas).toBe("1");
  });

  test("captação pública não publica automaticamente", () => {
    const input = buildPublicSaveInput({ ownerName: "O", phone: "11", propertyType: "casa" });
    expect(input).not.toHaveProperty("convertedPropertyId");
    expect(input).not.toHaveProperty("published");
  });

  test("valor permanece somente no passo de preço", () => {
    expect(parsePublicMoney("450")).toBe(450);
  });

  test("endereço sem CEP exige cidade distinta e UF", () => {
    expect(sufficientPublicAddress("Rua das Flores, 10, Centro, Praia Grande - SP")).toBe(true);
    expect(sufficientPublicAddress("Rua das Flores, 10 - SP")).toBe(false);
    expect(sufficientPublicAddress("Rua das Flores, 10, 11700-000")).toBe(true);
  });
});
/**
 * Testes 5 e 6 da lista obrigatória:
 *  5. CEP lookup com sucesso
 *  6. fallback manual do CEP
 *
 * Nenhum teste toca a rede: o `fetch` entra por parâmetro.
 */
import { describe, expect, test } from "bun:test";
import { cepEndpoint, lookupCep, parseViaCep, type FetchLike } from "./cep-lookup";

const okFetch = (payload: unknown): FetchLike =>
  async () => ({ ok: true, status: 200, json: async () => payload });

const VIACEP_OK = {
  cep: "11704-000",
  logradouro: "Avenida Presidente Kennedy",
  complemento: "",
  bairro: "Guilhermina",
  localidade: "Praia Grande",
  uf: "SP",
};

describe("5. CEP lookup com sucesso", () => {
  test("preenche logradouro, bairro, cidade e estado", async () => {
    const result = await lookupCep("11704-000", okFetch(VIACEP_OK));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.address).toEqual({
      cep: "11704000",
      street: "Avenida Presidente Kennedy",
      district: "Guilhermina",
      city: "Praia Grande",
      state: "SP",
    });
  });

  test("aceita CEP digitado sem máscara e monta a URL normalizada", async () => {
    const result = await lookupCep("11704000", okFetch(VIACEP_OK));
    expect(result.ok).toBe(true);
    expect(cepEndpoint("11.704-000")).toBe("https://viacep.com.br/ws/11704000/json/");
  });

  test("UF minúscula é normalizada para maiúscula", async () => {
    const result = await lookupCep("11704000", okFetch({ ...VIACEP_OK, uf: "sp" }));
    expect(result.ok && result.address.state).toBe("SP");
  });

  test("logradouro/bairro vazios (CEP geral de cidade) ainda é sucesso", async () => {
    const result = await lookupCep("11700000", okFetch({ ...VIACEP_OK, logradouro: "", bairro: "" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.address.city).toBe("Praia Grande");
    expect(result.address.street).toBe("");
  });
});

describe("6. fallback manual do CEP", () => {
  test("CEP inexistente: ViaCEP responde 200 com erro:true", async () => {
    const result = await lookupCep("99999999", okFetch({ erro: true }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.manual).toBe(true);
    expect(result.reason).toBe("CEP não encontrado");
  });

  test('erro também chega como a string "true"', async () => {
    const result = await lookupCep("99999999", okFetch({ erro: "true" }));
    expect(result.ok).toBe(false);
  });

  test("rede fora: fetch que rejeita não derruba o cadastro", async () => {
    const boom: FetchLike = async () => {
      throw new Error("ECONNREFUSED");
    };
    const result = await lookupCep("11704000", boom);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.manual).toBe(true);
    expect(result.reason).toBe("Não foi possível consultar o CEP agora");
  });

  test("HTTP 500 vira fallback manual com o status no motivo", async () => {
    const result = await lookupCep("11704000", async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("500");
  });

  test("JSON quebrado vira fallback manual", async () => {
    const result = await lookupCep("11704000", async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("Unexpected token");
      },
    }));
    expect(result.ok).toBe(false);
  });

  test("CEP com menos de 8 dígitos nem consulta", async () => {
    let called = 0;
    const spy: FetchLike = async () => {
      called += 1;
      return { ok: true, status: 200, json: async () => VIACEP_OK };
    };
    const result = await lookupCep("1170", spy);
    expect(called).toBe(0);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("CEP deve ter 8 dígitos");
  });

  test("resposta sem cidade/UF não preenche pela metade", () => {
    const result = parseViaCep({ cep: "11704000", logradouro: "Rua X" }, "11704000");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("CEP sem cidade/UF na base consultada");
  });

  test("payload nulo ou não-objeto cai no manual", () => {
    expect(parseViaCep(null, "11704000").ok).toBe(false);
    expect(parseViaCep("<html>", "11704000").ok).toBe(false);
  });
});

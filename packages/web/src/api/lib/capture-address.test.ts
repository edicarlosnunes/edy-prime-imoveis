/**
 * Testes da identidade da unidade imobiliária (seção 29 do escopo).
 *
 * Cobre os testes 1, 2 e 3: um proprietário com dois imóveis, apartamentos
 * diferentes no mesmo prédio, e mesmo CEP/número/bloco com unidades diferentes.
 *
 * A regra que estes testes protegem: dois imóveis NÃO são o mesmo por terem o
 * mesmo dono, o mesmo prédio ou o mesmo preço. O telefone identifica a PESSOA,
 * nunca o imóvel — por isso ele não aparece em nenhuma chave aqui.
 */
import { describe, expect, test } from "bun:test";
import {
  COMPLEMENT_FIELDS,
  IDENTIFYING_COMPLEMENTS,
  formatCep,
  formatUnitAddress,
  isValidCep,
  normalizeCep,
  normalizeComplementValue,
  sameUnit,
  unitKey,
} from "./capture-address";

describe("CEP", () => {
  test("normaliza para 8 dígitos, com ou sem máscara", () => {
    expect(normalizeCep("11700-000")).toBe("11700000");
    expect(normalizeCep("11700000")).toBe("11700000");
    expect(normalizeCep(" 11.700-000 ")).toBe("11700000");
  });

  test("CEP incompleto ou ausente devolve null em vez de valor pela metade", () => {
    expect(normalizeCep("1170")).toBeNull();
    expect(normalizeCep("117000000")).toBeNull();
    expect(normalizeCep("")).toBeNull();
    expect(normalizeCep(null)).toBeNull();
    expect(isValidCep("11700-000")).toBe(true);
    expect(isValidCep("1170")).toBe(false);
  });

  test("formata para exibição e não destrói texto que não dá para formatar", () => {
    expect(formatCep("11700000")).toBe("11700-000");
    expect(formatCep("sem cep")).toBe("sem cep");
  });
});

describe("complementos", () => {
  test("são 14 campos, todos opcionais", () => {
    expect(COMPLEMENT_FIELDS.length).toBe(14);
  });

  test("andar, box e complemento livre NÃO identificam a unidade", () => {
    /* Dois apartamentos podem estar no mesmo andar e a garagem não define a
       unidade: se entrassem na identidade, unidades diferentes pareceriam
       iguais (ou iguais pareceriam diferentes por causa do box). */
    expect(IDENTIFYING_COMPLEMENTS).not.toContain("floor");
    expect(IDENTIFYING_COMPLEMENTS).not.toContain("box");
    expect(IDENTIFYING_COMPLEMENTS).not.toContain("complement");
    expect(IDENTIFYING_COMPLEMENTS).toContain("unit");
    expect(IDENTIFYING_COMPLEMENTS).toContain("block");
  });

  test("'Apto 101', 'APTO101' e '101' são o mesmo identificador", () => {
    const alvo = normalizeComplementValue("101");
    expect(normalizeComplementValue("Apto 101")).toBe(alvo);
    expect(normalizeComplementValue("APTO101")).toBe(alvo);
    expect(normalizeComplementValue("ap. 101")).toBe(alvo);
    expect(normalizeComplementValue("Unidade 101")).toBe(alvo);
  });

  test("valor que é só o rótulo não vira vazio", () => {
    /* "Casa" como complemento (casa dos fundos) precisa continuar valendo
       algo, senão a unidade perderia o que a distinguia. */
    expect(normalizeComplementValue("casa")).not.toBe("");
  });

  test("101 e 102 nunca colidem", () => {
    expect(normalizeComplementValue("Apto 101")).not.toBe(normalizeComplementValue("Apto 102"));
  });
});

/* ----------------------------------------------------------------- teste 1 */
describe("teste 1 — mesmo proprietário com dois imóveis", () => {
  test("dois endereços diferentes do mesmo dono são dois imóveis", () => {
    /* O proprietário não entra na chave: quem decide é o endereço. */
    const imovelA = { address: { cep: "11700-000", number: "500" } };
    const imovelB = { address: { cep: "11702-100", number: "42" } };

    expect(sameUnit(imovelA, imovelB)).toBe(false);
  });

  test("mesmo CEP e números diferentes são dois imóveis", () => {
    const a = { address: { cep: "11700-000", number: "500" } };
    const b = { address: { cep: "11700-000", number: "502" } };

    expect(sameUnit(a, b)).toBe(false);
  });
});

/* ----------------------------------------------------------------- teste 2 */
describe("teste 2 — apartamentos diferentes no mesmo prédio", () => {
  test("mesmo CEP e número, apartamentos diferentes = captações diferentes", () => {
    const apto101 = { address: { cep: "11700-000", number: "500" }, complements: { unit: "101" } };
    const apto102 = { address: { cep: "11700-000", number: "500" }, complements: { unit: "102" } };

    expect(sameUnit(apto101, apto102)).toBe(false);
  });

  test("a mesma unidade escrita de outra forma continua sendo a mesma", () => {
    const digitado = { address: { cep: "11700-000", number: "500" }, complements: { unit: "Apto 101" } };
    const doSite = { address: { cep: "11700000", number: "500" }, complements: { unit: "101" } };

    expect(sameUnit(digitado, doSite)).toBe(true);
  });

  test("andar diferente não cria imóvel novo para a mesma unidade", () => {
    const a = { address: { cep: "11700-000", number: "500" }, complements: { unit: "101", floor: "1" } };
    const b = { address: { cep: "11700-000", number: "500" }, complements: { unit: "101", floor: "10" } };

    expect(sameUnit(a, b)).toBe(true);
  });
});

/* ----------------------------------------------------------------- teste 3 */
describe("teste 3 — mesmo CEP, número e bloco com unidades diferentes", () => {
  test("bloco igual e apartamento diferente = imóveis diferentes", () => {
    const a = {
      address: { cep: "11700-000", number: "500" },
      complements: { block: "B", unit: "12" },
    };
    const b = {
      address: { cep: "11700-000", number: "500" },
      complements: { block: "B", unit: "13" },
    };

    expect(sameUnit(a, b)).toBe(false);
  });

  test("apartamento igual em blocos diferentes = imóveis diferentes", () => {
    const blocoA = {
      address: { cep: "11700-000", number: "500" },
      complements: { block: "A", unit: "12" },
    };
    const blocoB = {
      address: { cep: "11700-000", number: "500" },
      complements: { block: "B", unit: "12" },
    };

    expect(sameUnit(blocoA, blocoB)).toBe(false);
  });

  test("torre também distingue", () => {
    const t1 = { address: { cep: "11700-000", number: "500" }, complements: { tower: "1", unit: "12" } };
    const t2 = { address: { cep: "11700-000", number: "500" }, complements: { tower: "2", unit: "12" } };

    expect(sameUnit(t1, t2)).toBe(false);
  });
});

describe("chave da unidade", () => {
  test("é estável: a mesma entrada gera sempre a mesma chave", () => {
    const address = { cep: "11700-000", number: "500" };
    expect(unitKey(address, { unit: "101" })).toBe(unitKey(address, { unit: "101" }));
  });

  test("sem CEP cai para logradouro + cidade (preenchimento manual)", () => {
    const key = unitKey({ street: "Av. Kennedy", city: "Praia Grande", number: "500" });
    expect(key).toContain("st:");
    expect(key).toContain("ct:");
    expect(key).not.toContain("cep:");
  });

  test("complemento vazio não entra na chave", () => {
    const address = { cep: "11700-000", number: "500" };
    expect(unitKey(address, { unit: "101", block: "" })).toBe(unitKey(address, { unit: "101" }));
    expect(unitKey(address, { unit: "101", block: null })).toBe(unitKey(address, { unit: "101" }));
  });

  test("ordem em que os complementos são informados não muda a chave", () => {
    const address = { cep: "11700-000", number: "500" };
    const a = unitKey(address, { unit: "101", block: "B" });
    const b = unitKey(address, { block: "B", unit: "101" });
    expect(a).toBe(b);
  });
});

describe("endereço em uma linha", () => {
  test("monta o endereço para ficha técnica e autorização", () => {
    const linha = formatUnitAddress(
      {
        cep: "11700-000",
        street: "Av. Presidente Kennedy",
        number: "500",
        district: "Guilhermina",
        city: "Praia Grande",
        state: "SP",
      },
      { unit: "101", block: "B" },
    );

    expect(linha).toContain("Av. Presidente Kennedy, 500");
    expect(linha).toContain("Apartamento / unidade: 101");
    expect(linha).toContain("Bloco: B");
    expect(linha).toContain("Praia Grande/SP");
    expect(linha).toContain("CEP 11700-000");
  });
});

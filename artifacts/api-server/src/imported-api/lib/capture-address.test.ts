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

/* ---------------------------------------------------------------------- */
/* Identidade por endereço escrito (addressKey / buildingKey)             */
/* ---------------------------------------------------------------------- */
import { addressKey, buildingKey, sameBuilding, sameWrittenAddress } from "./capture-address";

describe("identidade por endereço escrito", () => {
  const A = {
    address: { city: "Praia Grande", street: "Rua Guimarães Rosa", number: "492" },
    complements: { unit: "apto 163" },
  };
  const B = {
    address: { city: "Praia Grande", street: "Av. Guimaraes Rosa", number: "492" },
    complements: { unit: "ap 163" },
  };

  test("mesmo endereço com tipo de via diferente é o MESMO imóvel", () => {
    expect(addressKey(A.address, A.complements)).toBe(addressKey(B.address, B.complements));
    expect(sameWrittenAddress(A, B)).toBe(true);
  });

  test("mesmo prédio, unidade diferente é imóvel DIFERENTE", () => {
    const outraUnidade = {
      address: { city: "Praia Grande", street: "R Guimaraes Rosa", number: "492" },
      complements: { unit: "164" },
    };
    expect(sameWrittenAddress(A, outraUnidade)).toBe(false);
    expect(addressKey(A.address, A.complements)).not.toBe(
      addressKey(outraUnidade.address, outraUnidade.complements),
    );
    /* ...mas é o mesmo PRÉDIO: é isso que permite captar o vizinho sem alarme. */
    expect(sameBuilding(A.address, outraUnidade.address)).toBe(true);
    expect(buildingKey(A.address)).toBe(buildingKey(outraUnidade.address));
  });

  test("erro simples de digitação no nome da via não cria endereço novo", () => {
    const comErro = {
      address: { city: "Praia Grande", street: "Rua Guimaraens Rosa", number: "492" },
      complements: { unit: "163" },
    };
    expect(sameWrittenAddress(A, comErro)).toBe(true);
  });

  test("número diferente é imóvel diferente, sem tolerância", () => {
    const outroNumero = {
      address: { city: "Praia Grande", street: "Rua Guimarães Rosa", number: "493" },
      complements: { unit: "163" },
    };
    expect(sameWrittenAddress(A, outroNumero)).toBe(false);
  });

  test("cidade diferente é imóvel diferente, ainda que a via tenha o mesmo nome", () => {
    const outraCidade = {
      address: { city: "Santos", street: "Rua Guimarães Rosa", number: "492" },
      complements: { unit: "163" },
    };
    expect(sameWrittenAddress(A, outraCidade)).toBe(false);
  });

  test("sem logradouro e sem CEP não existe identidade de endereço", () => {
    expect(buildingKey({ city: "Praia Grande", number: "492" })).toBe("");
    expect(addressKey({ city: "Praia Grande", number: "492" }, { unit: "163" })).toBe("");
    expect(
      sameWrittenAddress(
        { address: { city: "Praia Grande", number: "492" } },
        { address: { city: "Praia Grande", number: "492" } },
      ),
    ).toBe(false);
  });

  test("sem logradouro escrito, o CEP sustenta a identidade", () => {
    const porCep = { address: { city: "Praia Grande", cep: "11700-000", number: "492" }, complements: { unit: "163" } };
    const mesmoCep = { address: { city: "Praia Grande", cep: "11700000", number: "492" }, complements: { unit: "apto 163" } };
    expect(sameWrittenAddress(porCep, mesmoCep)).toBe(true);
    expect(buildingKey(porCep.address)).not.toBe("");
  });

  test("unitKey antigo continua intacto — formato não mudou", () => {
    expect(unitKey({ cep: "11700-000", number: "492" }, { unit: "apto 163" })).toBe(
      "cep:11700000|n:492|unit=163",
    );
  });
});

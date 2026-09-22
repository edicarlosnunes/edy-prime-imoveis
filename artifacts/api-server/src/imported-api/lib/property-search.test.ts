/**
 * Testes da busca natural de imóveis do agente.
 * Foco: a pergunta "casa de 2 dormitórios no bairro Guilhermina" precisa achar
 * o CS1000, cujo cadastro traz o bairro escrito "GUILHERMINIA".
 */
import { describe, expect, test } from "bun:test";
import { filterProperties, normalizeText, levenshtein } from "./property-search";
import type { PropertyRow } from "./property-search";

function property(partial: Partial<PropertyRow>): PropertyRow {
  return {
    id: 1,
    code: "EP-0000",
    title: "Imóvel",
    purpose: "venda",
    type: "apartamento",
    price: 0,
    condoFee: null,
    iptu: null,
    district: "",
    city: "Praia Grande",
    address: null,
    bedrooms: 0,
    suites: 0,
    bathrooms: 0,
    parking: 0,
    areaUtil: 0,
    areaTotal: null,
    description: null,
    highlight: null,
    features: null,
    status: "disponivel",
    published: 1,
    featured: 0,
    ownerId: null,
    views: 0,
    slug: null,
    watermarkOff: 0,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...partial,
  } as PropertyRow;
}

/** Espelha o cadastro real de produção (7 imóveis publicados e disponíveis). */
const rows: PropertyRow[] = [
  property({
    id: 1,
    code: "CS1000",
    title: "CASA 2 E 3 DORM COND. GUILHERMINIA 320 MIL",
    type: "casa",
    district: "GUILHERMINIA",
    bedrooms: 2,
    parking: 1,
    price: 0,
  }),
  property({
    id: 2,
    code: "EP-1015",
    title: "Apartamento reformado a uma quadra da praia",
    district: "Guilhermina",
    bedrooms: 2,
    parking: 1,
    price: 780000,
  }),
  property({
    id: 3,
    code: "EP-1042",
    title: "Apartamento frente mar com varanda gourmet",
    district: "Canto do Forte",
    bedrooms: 3,
    parking: 2,
    price: 1450000,
  }),
  property({
    id: 4,
    code: "EP-1063",
    title: "Alto padrão com cozinha integrada e armários",
    district: "Vila Tupi",
    bedrooms: 3,
    parking: 2,
    price: 960000,
  }),
  property({
    id: 5,
    code: "EP-1078",
    title: "Cobertura duplex com piscina privativa",
    type: "cobertura",
    district: "Boqueirão",
    bedrooms: 4,
    parking: 3,
    price: 2390000,
  }),
  property({
    id: 6,
    code: "EP-1087",
    title: "Suíte master com closet em condomínio-clube",
    district: "Ocian",
    bedrooms: 2,
    parking: 1,
    price: 690000,
  }),
  property({
    id: 7,
    code: "EP-1091",
    title: "Lançamento com lazer completo e vista mar",
    district: "Aviação",
    bedrooms: 3,
    parking: 2,
    price: 1120000,
  }),
];

const codes = (input: Parameters<typeof filterProperties>[1]) =>
  filterProperties(rows, input).map((row) => row.code);

describe("normalização", () => {
  test("remove acentos, pontuação e caixa", () => {
    expect(normalizeText("Boqueirão")).toBe("boqueirao");
    expect(normalizeText("GUILHERMINIA")).toBe("guilherminia");
    expect(normalizeText("Condomínio-Clube")).toBe("condominio clube");
  });

  test("distância de edição básica", () => {
    expect(levenshtein("guilhermina", "guilherminia")).toBe(1);
    expect(levenshtein("casa", "casa")).toBe(0);
  });
});

describe("pergunta natural: casa de 2 dormitórios no bairro Guilhermina", () => {
  test("acha o CS1000 apesar da grafia GUILHERMINIA", () => {
    expect(codes({ tipo: "casa", dormitoriosMin: 2, bairro: "Guilhermina" })).toEqual(["CS1000"]);
  });

  test("aceita variações de grafia, caixa e acento no bairro", () => {
    for (const bairro of ["guilherminia", "GUILHERMINA", "guilhermína", "Guilhermina "]) {
      expect(codes({ tipo: "casa", dormitoriosMin: 2, bairro })).toEqual(["CS1000"]);
    }
  });

  test("sem filtro de tipo, o bairro traz casa e apartamento", () => {
    expect(codes({ bairro: "Guilhermina" }).sort()).toEqual(["CS1000", "EP-1015"]);
  });

  test("sinônimo quartos/dormitórios no termo livre", () => {
    expect(codes({ termo: "casa 2 quartos" })).toContain("CS1000");
  });
});

describe("busca por código continua funcionando", () => {
  test("CS1000 e cs1000 pelo termo livre", () => {
    expect(codes({ termo: "CS1000" })).toEqual(["CS1000"]);
    expect(codes({ termo: "cs1000" })).toEqual(["CS1000"]);
  });

  test("código com hífen", () => {
    expect(codes({ termo: "EP-1015" })).toEqual(["EP-1015"]);
  });
});

describe("bairros com acento", () => {
  test("Boqueirao sem acento acha Boqueirão", () => {
    expect(codes({ bairro: "Boqueirao" })).toEqual(["EP-1078"]);
  });

  test("Aviacao sem acento acha Aviação", () => {
    expect(codes({ bairro: "Aviacao" })).toEqual(["EP-1091"]);
  });

  test("cidade sem acento", () => {
    expect(codes({ cidade: "praia grande" }).length).toBe(rows.length);
  });
});

describe("não inventa imóvel", () => {
  test("bairro inexistente", () => {
    expect(codes({ bairro: "Jardim Inexistente" })).toEqual([]);
  });

  test("tipo incompatível com o bairro", () => {
    expect(codes({ bairro: "Guilhermina", tipo: "cobertura" })).toEqual([]);
  });

  test("dormitórios acima do cadastro", () => {
    expect(codes({ tipo: "casa", dormitoriosMin: 4 })).toEqual([]);
  });

  test("termo livre sem correspondência", () => {
    expect(codes({ termo: "heliponto" })).toEqual([]);
  });

  test("ignora não publicado e vendido", () => {
    const hidden = [
      property({ code: "X1", district: "Guilhermina", published: 0 }),
      property({ code: "X2", district: "Guilhermina", status: "vendido" }),
    ];
    expect(filterProperties(hidden, { bairro: "Guilhermina" })).toEqual([]);
  });
});

describe("filtros estruturais", () => {
  test("preço máximo", () => {
    expect(codes({ precoMax: 700000 }).sort()).toEqual(["CS1000", "EP-1087"]);
  });

  test("vagas mínimas", () => {
    expect(codes({ vagasMin: 3 })).toEqual(["EP-1078"]);
  });

  test("finalidade", () => {
    expect(codes({ finalidade: "locacao" })).toEqual([]);
    expect(codes({ finalidade: "venda" }).length).toBe(rows.length);
  });
});

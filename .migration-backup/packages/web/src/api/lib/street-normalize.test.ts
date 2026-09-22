import { describe, expect, test } from "bun:test";
import {
  cityKey,
  matchStreet,
  sameStreet,
  similarity,
  streetDisplayName,
  streetKey,
  suggestStreets,
} from "./street-normalize";

describe("streetKey", () => {
  test("descarta o tipo de via: Rua e Av. do mesmo nome batem", () => {
    expect(streetKey("Rua Guimarães Rosa")).toBe(streetKey("Av. Guimaraes Rosa"));
    expect(streetKey("R. Guimarães Rosa")).toBe(streetKey("Avenida Guimarães Rosa"));
    expect(streetKey("Travessa Guimarães Rosa")).toBe(streetKey("Guimarães Rosa"));
  });

  test("ignora acento, caixa e pontuação", () => {
    expect(streetKey("AVENIDA SÃO PAULO")).toBe(streetKey("av. sao paulo"));
    expect(streetKey("Rua Ipê-Amarelo")).toBe(streetKey("rua ipe amarelo"));
  });

  test("ignora conectivos e títulos abreviados", () => {
    expect(streetKey("Rua Doutor João de Barros")).toBe(streetKey("R. Dr. João Barros"));
    expect(streetKey("Avenida Presidente Costa e Silva")).toBe(streetKey("Av Pres. Costa Silva"));
  });

  test("não corta tipo de via no meio do nome próprio", () => {
    /* "Vila Nova" é nome, não tipo de via: o nome não pode virar só "nova". */
    expect(streetKey("Rua Vila Nova")).toBe("vilanova");
    expect(streetKey("Rua Vila Nova")).not.toBe(streetKey("Rua Nova"));
  });

  test("nunca devolve vazio quando havia texto depois do tipo de via", () => {
    expect(streetKey("Rua de Santo")).not.toBe("");
    expect(streetKey("   ")).toBe("");
    expect(streetKey(null)).toBe("");
  });

  test("logradouros diferentes não colidem", () => {
    expect(streetKey("Rua Brasil")).not.toBe(streetKey("Rua Bahia"));
    expect(streetKey("Avenida Castelo Branco")).not.toBe(streetKey("Avenida Castelo"));
  });
});

describe("cityKey", () => {
  test("cidade comparável sem acento nem espaço", () => {
    expect(cityKey("São Vicente")).toBe(cityKey("sao vicente"));
    expect(cityKey("Mongaguá")).toBe(cityKey("MONGAGUA"));
    expect(cityKey("Praia Grande")).not.toBe(cityKey("Praia"));
  });
});

describe("streetDisplayName", () => {
  test("preserva caixa e acento, normaliza espaços e vírgula final", () => {
    expect(streetDisplayName("  Avenida   Presidente Costa e Silva ,")).toBe(
      "Avenida Presidente Costa e Silva",
    );
  });
});

describe("similaridade e erro de digitação", () => {
  test("um caractere trocado continua sendo o mesmo logradouro", () => {
    expect(sameStreet("Rua Guimaraes Rosa", "Rua Guimaraens Rosa")).toBe(true);
    expect(sameStreet("Avenida Presidente Kennedy", "Av. Presidente Kenedy")).toBe(true);
  });

  test("logradouros distintos não são fundidos pela similaridade", () => {
    expect(sameStreet("Rua Brasil", "Rua Bahia")).toBe(false);
    expect(sameStreet("Rua Paraná", "Rua Parintins")).toBe(false);
  });

  test("texto vazio nunca casa com nada", () => {
    expect(sameStreet("", "Rua Brasil")).toBe(false);
    expect(sameStreet(null, undefined)).toBe(false);
    expect(similarity("", "")).toBe(0);
  });
});

const CANDIDATES = [
  { id: 1, city: "Praia Grande", name: "Avenida Guimarães Rosa" },
  { id: 2, city: "Praia Grande", name: "Rua Brasil", aliases: ["Rua Brazil"] },
  { id: 3, city: "Santos", name: "Rua Guimarães Rosa" },
];

describe("matchStreet", () => {
  test("acha o logradouro ignorando o tipo de via digitado", () => {
    const hit = matchStreet(CANDIDATES, { street: "R. Guimaraes Rosa", city: "Praia Grande" });
    expect(hit?.candidate.id).toBe(1);
    expect(hit?.exact).toBe(true);
  });

  test("cidade é filtro duro: não devolve logradouro de outra cidade", () => {
    const hit = matchStreet(CANDIDATES, { street: "Guimarães Rosa", city: "Itanhaém" });
    expect(hit).toBeNull();
  });

  test("apelido conta como grafia aceita", () => {
    const hit = matchStreet(CANDIDATES, { street: "Rua Brazil", city: "Praia Grande" });
    expect(hit?.candidate.id).toBe(2);
    expect(hit?.exact).toBe(true);
  });

  test("erro de digitação cai como candidato, não como logradouro novo", () => {
    const hit = matchStreet(CANDIDATES, { street: "Rua Guimaraes Roza", city: "Praia Grande" });
    expect(hit?.candidate.id).toBe(1);
  });

  test("logradouro realmente novo devolve null", () => {
    expect(matchStreet(CANDIDATES, { street: "Rua das Palmeiras", city: "Praia Grande" })).toBeNull();
  });
});

describe("suggestStreets", () => {
  test("ordena do mais parecido para o menos, só da cidade pedida", () => {
    const list = suggestStreets(CANDIDATES, { street: "Rua Brasi", city: "Praia Grande" });
    expect(list[0]?.candidate.id).toBe(2);
    expect(list.every((row) => row.candidate.city === "Praia Grande")).toBe(true);
  });

  test("sem logradouro digitado não sugere nada", () => {
    expect(suggestStreets(CANDIDATES, { street: "", city: "Praia Grande" })).toEqual([]);
  });
});

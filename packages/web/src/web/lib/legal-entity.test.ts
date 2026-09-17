import { describe, expect, test } from "bun:test";
import { LEGAL_ENTITY_ABOUT, LEGAL_ENTITY_NOTICE, legalEntity } from "./legal-entity";

/**
 * Identificação jurídica pública da marca. O texto e o CNPJ precisam ficar
 * exatamente como registrado — é o vínculo entre "Edy Prime Imóveis" e a
 * pessoa jurídica que a administra.
 */

describe("identificação jurídica", () => {
  test("razão social e CNPJ conforme registro", () => {
    expect(legalEntity.name).toBe("EDY BOA SORTE LTDA");
    expect(legalEntity.cnpj).toBe("54.312.317/0001-92");
  });

  test("aviso do rodapé traz a marca, a empresa e o CNPJ", () => {
    expect(LEGAL_ENTITY_NOTICE).toBe(
      "Edy Prime Imóveis é uma marca administrada por EDY BOA SORTE LTDA — CNPJ 54.312.317/0001-92.",
    );
  });

  test("texto institucional deixa explícito quem administra a marca", () => {
    expect(LEGAL_ENTITY_ABOUT).toContain("Edy Prime Imóveis");
    expect(LEGAL_ENTITY_ABOUT).toContain("administrada pela empresa EDY BOA SORTE LTDA");
    expect(LEGAL_ENTITY_ABOUT).toContain("54.312.317/0001-92");
  });

  test("nunca usar a forma 'desenvolvido por'", () => {
    for (const text of [LEGAL_ENTITY_NOTICE, LEGAL_ENTITY_ABOUT]) {
      expect(text.toLowerCase()).not.toContain("desenvolvido por");
    }
  });
});

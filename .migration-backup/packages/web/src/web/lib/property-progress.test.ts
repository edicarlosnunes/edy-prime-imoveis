import { describe, expect, test } from "bun:test";
import { propertyProgress, type PropertyProgressInput } from "./property-progress";

const emptyInput: PropertyProgressInput = {
  code: "",
  title: "",
  city: "",
  district: "",
  price: "",
  bedrooms: "0",
  bathrooms: "0",
  areaUtil: "0",
  description: "",
  highlight: "",
  features: [],
  ownerId: "",
  imageCount: 0,
};

const fullInput: PropertyProgressInput = {
  code: "CS1000",
  title: "Casa alto padrão na Guilhermina",
  city: "Praia Grande",
  district: "Guilhermina",
  price: "320.000,00",
  bedrooms: "3",
  bathrooms: "2",
  areaUtil: "120",
  description: "Casa reformada com acabamento premium, a duas quadras da praia da Guilhermina.",
  highlight: "A duas quadras da praia",
  features: ["Piscina"],
  ownerId: "4",
  imageCount: 12,
};

describe("propertyProgress", () => {
  test("cadastro vazio marca 0%", () => {
    expect(propertyProgress(emptyInput).percent).toBe(0);
  });

  test("cadastro completo marca 100%", () => {
    expect(propertyProgress(fullInput).percent).toBe(100);
  });

  test("percentual fica sempre entre 0 e 100", () => {
    const partial = propertyProgress({ ...emptyInput, code: "CS1000", price: "320.000,00" });
    expect(partial.percent).toBeGreaterThan(0);
    expect(partial.percent).toBeLessThan(100);
  });

  test("preço zerado não conta como preenchido", () => {
    expect(propertyProgress({ ...emptyInput, price: "0,00" }).percent).toBe(0);
  });

  test("quantidade zero não conta como preenchida", () => {
    expect(propertyProgress({ ...emptyInput, bedrooms: "0", bathrooms: "0" }).percent).toBe(0);
  });

  test("missing aponta a seção de cada pendência", () => {
    const result = propertyProgress(emptyInput);
    const price = result.missing.find((item) => item.key === "price");
    const photos = result.missing.find((item) => item.key === "photos");
    expect(price?.section).toBe("valores");
    expect(photos?.section).toBe("fotos");
  });

  test("cadastro completo não deixa pendências", () => {
    expect(propertyProgress(fullInput).missing).toHaveLength(0);
  });

  test("descrição muito curta ainda conta como pendente", () => {
    const result = propertyProgress({ ...fullInput, description: "Casa boa" });
    expect(result.missing.some((item) => item.key === "description")).toBe(true);
  });
});

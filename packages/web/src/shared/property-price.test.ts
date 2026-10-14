import { describe, expect, test } from "bun:test";
import { formatPropertyPrice, propertyPrice } from "./property-price";
import { buildFacebookCaption } from "../api/lib/facebook-publishing";
import { buildInstagramCaption } from "../api/lib/instagram-publishing";

describe("Preço de publicação", () => {
  test("apresenta a redução do CRM nas legendas sem alterar o preço original", () => {
    const property = { price: 440000, features: JSON.stringify(["varanda", "__opportunity_price:420000"]) };
    expect(propertyPrice(property)).toEqual({ original: 440000, current: 420000, discounted: true });
    expect(formatPropertyPrice(property).replace(/\u00a0/g, " ")).toBe("De R$ 440.000 por R$ 420.000");
    expect(property.price).toBe(440000);
  });
  test("o retorno do admin e o registro bruto produzem a mesma redução", () => {
    expect(propertyPrice({ price: 440000, opportunityPrice: 420000 })).toEqual(propertyPrice({ price: 440000, features: '["__opportunity_price:420000"]' }));
  });
  test("legendas de Instagram e Facebook preservam os dois preços", () => {
    const property = { code: "CS-2026-000014", title: "Casa", purpose: "venda", price: 440000,
      features: '["__opportunity_price:420000"]', district: "Tude Bastos", city: "Praia Grande",
      bedrooms: 3, suites: 1, parking: 1, areaUtil: 67, link: "https://example.com/imovel/casa", imageUrl: "https://example.com/casa.jpg" };
    for (const caption of [buildFacebookCaption(property), buildInstagramCaption(property)]) {
      expect(caption.replace(/\u00a0/g, " ")).toContain("De R$ 440.000 por R$ 420.000");
    }
  });
  test("não anuncia desconto com preço igual, maior, zero ou inválido", () => {
    for (const opportunityPrice of [440000, 450000, 0, -1, NaN, Infinity]) {
      expect(propertyPrice({ price: 440000, opportunityPrice }).current).toBe(440000);
      expect(propertyPrice({ price: 440000, opportunityPrice }).discounted).toBe(false);
    }
    expect(propertyPrice({ price: 440000, features: "invalid JSON" }).current).toBe(440000);
    expect(formatPropertyPrice({ price: 0 })).toBe("Consulte o valor");
  });
});

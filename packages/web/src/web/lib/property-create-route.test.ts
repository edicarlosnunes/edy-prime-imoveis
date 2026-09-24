import { describe, expect, it } from "bun:test";
import { isPropertyCreateRoute, propertyFormReturnPath } from "./property-create-route";

describe("rota da ficha de imóvel", () => {
  it("abre a ficha diretamente, mesmo sem capture_id", () => {
    expect(isPropertyCreateRoute("/admin/imoveis/novo")).toBe(true);
  });

  it("não confunde a lista de anúncios com a ficha", () => {
    expect(isPropertyCreateRoute("/admin/imoveis")).toBe(false);
  });

  it("volta ao mesmo registro da Captação ao fechar a ficha convertida", () => {
    expect(propertyFormReturnPath(42, false)).toBe("/admin/captacao?capture=42");
  });

  it("volta à Captação quando a equipe abriu a ficha por ela", () => {
    expect(propertyFormReturnPath(null, true)).toBe("/admin/captacao");
    expect(propertyFormReturnPath(null, false)).toBe("/admin/imoveis");
  });
});
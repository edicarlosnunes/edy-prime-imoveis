import { describe, expect, it } from "bun:test";
import { isPropertyCreateRoute } from "./property-create-route";

describe("rota da ficha de imóvel", () => {
  it("abre a ficha diretamente, mesmo sem capture_id", () => {
    expect(isPropertyCreateRoute("/admin/imoveis/novo")).toBe(true);
  });

  it("não confunde a lista de anúncios com a ficha", () => {
    expect(isPropertyCreateRoute("/admin/imoveis")).toBe(false);
  });
});
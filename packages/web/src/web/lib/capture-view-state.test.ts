import { describe, expect, it } from "bun:test";
import { captureIdFromSearch, parseCaptureView } from "./capture-view-state";

describe("posição da Captação", () => {
  it("restaura filtro, busca, ficha aberta e posição válidos", () => {
    expect(parseCaptureView(JSON.stringify({
      source: "link_captacao", search: "Casa", city: "Praia Grande", selected: 42, scrollY: 810,
    }))).toEqual({
      source: "link_captacao", search: "Casa", city: "Praia Grande", selected: 42, scrollY: 810,
    });
  });

  it("ignora estado inválido sem tentar abrir outra ficha", () => {
    expect(parseCaptureView("{")).toEqual({
      source: undefined, search: "", city: "", selected: null, scrollY: 0,
    });
    expect(parseCaptureView(JSON.stringify({ source: "invalida", selected: -1, scrollY: -50 })).selected).toBeNull();
  });

  it("lê apenas um identificador seguro na URL de retorno", () => {
    expect(captureIdFromSearch("?capture=42")).toBe(42);
    expect(captureIdFromSearch("?capture=0")).toBeNull();
    expect(captureIdFromSearch("?capture=42foo")).toBeNull();
  });
});
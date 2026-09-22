import { describe, expect, test } from "bun:test";
import {
  DEFAULT_PRIORITY_CITIES,
  OUTSIDE_PRIORITY_FLAG,
  isPriorityCity,
  normalizePriorityCities,
  outsidePriorityArea,
  parsePriorityCities,
  priorityAreaView,
  serializePriorityCities,
} from "./priority-area";

describe("área prioritária", () => {
  test("as 8 cidades confirmadas estão na lista padrão", () => {
    expect([...DEFAULT_PRIORITY_CITIES]).toEqual([
      "Praia Grande",
      "Mongaguá",
      "Itanhaém",
      "Peruíbe",
      "São Vicente",
      "Santos",
      "Guarujá",
      "Cubatão",
    ]);
  });

  test("Bertioga não é prioritária, mas cadastra normalmente", () => {
    expect(isPriorityCity("Bertioga")).toBe(false);
    expect(outsidePriorityArea("Bertioga")).toBe(true);
  });

  test("cidade prioritária reconhecida sem acento e em caixa qualquer", () => {
    expect(isPriorityCity("praia grande")).toBe(true);
    expect(isPriorityCity("SAO VICENTE")).toBe(true);
    expect(isPriorityCity("Itanhaem")).toBe(true);
    expect(isPriorityCity("  Guaruja  ")).toBe(true);
  });

  test("cidade fora da lista NÃO bloqueia, só marca a flag", () => {
    expect(isPriorityCity("Campinas")).toBe(false);
    expect(outsidePriorityArea("Campinas")).toBe(true);
    const view = priorityAreaView("Campinas");
    expect(view.outside).toBe(true);
    expect(view.flag).toBe(OUTSIDE_PRIORITY_FLAG);
    expect(view.label).toBe("FORA DA ÁREA PRIORITÁRIA");
    expect(view.message).toContain("Campinas");
    expect(view.message).toContain("segue normalmente");
  });

  test("cidade prioritária não gera alerta nenhum", () => {
    const view = priorityAreaView("Santos");
    expect(view.outside).toBe(false);
    expect(view.flag).toBeNull();
    expect(view.message).toBeNull();
  });

  test("cidade vazia não é marcada como fora (cadastro pela metade)", () => {
    expect(outsidePriorityArea("")).toBe(false);
    expect(outsidePriorityArea(null)).toBe(false);
    expect(outsidePriorityArea(undefined)).toBe(false);
  });

  test("lista editável: JSON, vírgula e linha", () => {
    expect(parsePriorityCities('["Santos","Guarujá"]')).toEqual(["Santos", "Guarujá"]);
    expect(parsePriorityCities("Santos, Guarujá ,Cubatão")).toEqual(["Santos", "Guarujá", "Cubatão"]);
    expect(parsePriorityCities("Santos\nGuarujá")).toEqual(["Santos", "Guarujá"]);
  });

  test("configuração vazia ou inválida cai na lista padrão, nunca em lista vazia", () => {
    expect(parsePriorityCities(null)).toEqual([...DEFAULT_PRIORITY_CITIES]);
    expect(parsePriorityCities("")).toEqual([...DEFAULT_PRIORITY_CITIES]);
    expect(parsePriorityCities("[]")).toEqual([...DEFAULT_PRIORITY_CITIES]);
    expect(parsePriorityCities("{nao é json")).toEqual([...DEFAULT_PRIORITY_CITIES]);
  });

  test("normalização remove repetidos ignorando acento e preserva a grafia boa", () => {
    expect(normalizePriorityCities(["Santos", "santos", "SANTOS", " ", null, "São Vicente"])).toEqual([
      "Santos",
      "São Vicente",
    ]);
  });

  test("lista customizada manda: cidade padrão fora dela é marcada", () => {
    const custom = ["Santos", "Guarujá"];
    expect(isPriorityCity("Praia Grande", custom)).toBe(false);
    expect(isPriorityCity("Santos", custom)).toBe(true);
  });

  test("serializa de volta em JSON", () => {
    expect(serializePriorityCities(["Santos", "santos", "Guarujá"])).toBe('["Santos","Guarujá"]');
  });
});

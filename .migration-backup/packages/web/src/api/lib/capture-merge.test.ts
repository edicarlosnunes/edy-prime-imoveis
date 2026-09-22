import { describe, expect, test } from "bun:test";
import { isBlank, mergeCaptureFields, mergeHistoryNote } from "./capture-merge";

describe("vazio para o salvamento progressivo", () => {
  test("null, undefined e string em branco são vazios", () => {
    expect(isBlank(null)).toBe(true);
    expect(isBlank(undefined)).toBe(true);
    expect(isBlank("   ")).toBe(true);
  });

  test("valor pretendido zero ou negativo é vazio, não preço", () => {
    expect(isBlank(0)).toBe(true);
    expect(isBlank(-1)).toBe(true);
    expect(isBlank(350000)).toBe(false);
  });
});

describe("retomada preenche o que falta e nunca apaga o que existe", () => {
  test("campo vazio no banco recebe o valor novo", () => {
    const result = mergeCaptureFields({ city: "Praia Grande", street: null }, { street: "Rua Guimarães Rosa" });
    expect(result.patch).toEqual({ street: "Rua Guimarães Rosa" });
    expect(result.filledNow).toEqual(["street"]);
    expect(result.changed).toBe(true);
  });

  test("ficha que volta pela metade NÃO apaga o que já estava salvo", () => {
    const existing = { city: "Santos", street: "Av. Ana Costa", number: "100", propertyType: "apartamento" };
    const result = mergeCaptureFields(existing, {
      city: "Santos",
      street: null,
      number: "",
      propertyType: undefined,
    });
    expect(result.patch).toEqual({});
    expect(result.changed).toBe(false);
  });

  test("valor divergente é PRESERVADO e reportado para conferência humana", () => {
    const result = mergeCaptureFields({ number: "492" }, { number: "500" });
    expect(result.patch).toEqual({});
    expect(result.kept).toEqual(["number"]);
  });

  test("a edição do corretor pode sobrescrever de propósito", () => {
    const result = mergeCaptureFields({ number: "492" }, { number: "500" }, { overwrite: ["number"] });
    expect(result.patch).toEqual({ number: "500" });
    expect(result.kept).toEqual([]);
  });

  test("mesmo valor com espaços em volta não gera escrita", () => {
    const result = mergeCaptureFields({ city: "Peruíbe" }, { city: "  Peruíbe " });
    expect(result.changed).toBe(false);
    expect(result.kept).toEqual([]);
  });

  test("campo ausente na ficha nova é ignorado, não tratado como vazio", () => {
    const result = mergeCaptureFields({ cep: "11700000" }, { street: "Rua A" });
    expect(result.patch).toEqual({ street: "Rua A" });
  });

  test("cadastro em três etapas acumula, uma etapa por vez", () => {
    let ficha: Record<string, unknown> = {};
    for (const etapa of [
      { city: "Mongaguá" },
      { street: "Rua das Flores", number: "12" },
      { propertyType: "casa", askingPrice: 420000 },
    ]) {
      const result = mergeCaptureFields(ficha, etapa);
      ficha = { ...ficha, ...result.patch };
    }
    expect(ficha).toEqual({
      city: "Mongaguá",
      street: "Rua das Flores",
      number: "12",
      propertyType: "casa",
      askingPrice: 420000,
    });
  });

  test("chaves de endereço também são preenchidas progressivamente", () => {
    const result = mergeCaptureFields(
      { unitKey: "", addressKey: null },
      { unitKey: "cep:11700000|n:12", addressKey: "ct:mongagua|st:flores|n:12" },
    );
    expect(result.filledNow).toEqual(["unitKey", "addressKey"]);
  });
});

describe("histórico da retomada", () => {
  test("registra o que foi preenchido", () => {
    const result = mergeCaptureFields({ street: null }, { street: "Rua A" });
    expect(mergeHistoryNote(result, 7)).toContain("Preenchido agora: street");
    expect(mergeHistoryNote(result, 7)).toContain("#7");
  });

  test("registra divergência como conferir, não como alteração", () => {
    const result = mergeCaptureFields({ number: "492" }, { number: "500" });
    const note = mergeHistoryNote(result, 3);
    expect(note).toContain("PRESERVADO");
  });

  test("retomada que não mudou nada não escreve histórico", () => {
    const result = mergeCaptureFields({ city: "Santos" }, { city: "Santos" });
    expect(mergeHistoryNote(result, 1)).toBeNull();
  });
});

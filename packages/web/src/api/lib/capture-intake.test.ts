/**
 * Ficha única: proprietário + imóvel na mesma entrada.
 *
 * Reforça os testes 1 a 4 da lista obrigatória no nível do payload que
 * realmente vai para o banco (os testes de chave estão em capture-address).
 */
import { describe, expect, test } from "bun:test";
import {
  DEFAULT_CITY,
  buildCapturePayload,
  cleanComplements,
  findDuplicateUnit,
  normalizeSource,
  parseComplements,
  serializeComplements,
} from "./capture-intake";

const base = { ownerName: "Edicarlos", ownerPhone: "13997141174" };

describe("payload da ficha única", () => {
  test("CEP, número e complementos viram endereço estruturado + unit_key", () => {
    const payload = buildCapturePayload({
      ...base,
      cep: "11704-000",
      street: "Avenida Presidente Kennedy",
      number: "1234",
      district: "Guilhermina",
      city: "Praia Grande",
      state: "sp",
      complements: { unit: "APTO 101", block: "B" },
      propertyType: "apartamento",
      askingPrice: 480000,
      source: "site_vender",
    });

    expect(payload.cep).toBe("11704000");
    expect(payload.state).toBe("SP");
    expect(payload.source).toBe("site");
    expect(payload.unitKey).toContain("cep:11704000");
    expect(payload.unitKey).toContain("n:1234");
    expect(payload.unitKey).toContain("unit=101");
    expect(payload.unitKey).toContain("block=b");
    expect(payload.address).toContain("Avenida Presidente Kennedy");
    expect(payload.address).toContain("CEP 11704-000");
  });

  test("ficha sem cidade cai na cidade padrão da imobiliária", () => {
    expect(buildCapturePayload(base).city).toBe(DEFAULT_CITY);
  });

  test("preço zero, negativo ou ausente grava NULL", () => {
    expect(buildCapturePayload({ ...base, askingPrice: 0 }).askingPrice).toBeNull();
    expect(buildCapturePayload({ ...base, askingPrice: -5 }).askingPrice).toBeNull();
    expect(buildCapturePayload(base).askingPrice).toBeNull();
  });

  test("origem desconhecida vira manual; prospecção é preservada", () => {
    expect(normalizeSource("qualquer-coisa")).toBe("manual");
    expect(normalizeSource(null)).toBe("manual");
    expect(normalizeSource("site")).toBe("site");
    expect(normalizeSource("site-proprietario")).toBe("site");
    expect(normalizeSource("prospeccao")).toBe("prospeccao");
  });
});

describe("1. mesmo proprietário com 2 imóveis diferentes", () => {
  test("mesmo telefone, endereços diferentes: unidades diferentes", () => {
    const a = buildCapturePayload({ ...base, cep: "11704000", number: "1234" });
    const b = buildCapturePayload({ ...base, cep: "11702000", number: "50" });
    expect(a.unitKey).not.toBe(b.unitKey);
  });
});

describe("2 e 3. mesmo prédio / mesmo bloco com unidades diferentes", () => {
  test("mesmo CEP e número, apartamentos diferentes", () => {
    const a = buildCapturePayload({ ...base, cep: "11704000", number: "1234", complements: { unit: "101" } });
    const b = buildCapturePayload({ ...base, cep: "11704000", number: "1234", complements: { unit: "102" } });
    expect(a.unitKey).not.toBe(b.unitKey);
  });

  test("mesmo bloco, unidades diferentes", () => {
    const a = buildCapturePayload({ ...base, cep: "11704000", number: "1234", complements: { block: "B", unit: "11" } });
    const b = buildCapturePayload({ ...base, cep: "11704000", number: "1234", complements: { block: "B", unit: "12" } });
    expect(a.unitKey).not.toBe(b.unitKey);
  });

  test("mesma unidade digitada de outro jeito é o MESMO imóvel", () => {
    const a = buildCapturePayload({ ...base, cep: "11704-000", number: "1234", complements: { unit: "Apto 101" } });
    const b = buildCapturePayload({ ...base, cep: "11704000", number: "1234", complements: { unit: "101" } });
    expect(a.unitKey).toBe(b.unitKey);
  });

  test("andar e box não distinguem unidade", () => {
    const a = buildCapturePayload({ ...base, cep: "11704000", number: "1234", complements: { unit: "101", floor: "10" } });
    const b = buildCapturePayload({ ...base, cep: "11704000", number: "1234", complements: { unit: "101", box: "22" } });
    expect(a.unitKey).toBe(b.unitKey);
  });
});

describe("4. telefone reutiliza owner mas não mistura imóvel", () => {
  test("telefone não entra na chave da unidade", () => {
    const a = buildCapturePayload({ ...base, cep: "11704000", number: "1234" });
    const b = buildCapturePayload({ ownerName: "Outro", ownerPhone: "13999990000", cep: "11704000", number: "1234" });
    expect(a.unitKey).toBe(b.unitKey);
    expect(a.unitKey).not.toContain("9714");
  });
});

describe("aviso de unidade duplicada", () => {
  const existing = [
    { id: 7, ownerId: 1, unitKey: "cep:11704000|n:1234|unit=101", stage: "documentacao" },
    { id: 9, ownerId: 2, unitKey: "cep:11702000|n:50", stage: "perdido" },
  ];

  test("mesma unidade e mesmo dono: avisa, não bloqueia", () => {
    const hit = findDuplicateUnit(existing, { unitKey: "cep:11704000|n:1234|unit=101", ownerId: 1 });
    expect(hit).toMatchObject({ duplicate: true, captureId: 7, sameOwner: true });
  });

  test("mesma unidade e dono diferente: POSSÍVEL DUPLICADO", () => {
    const hit = findDuplicateUnit(existing, { unitKey: "cep:11704000|n:1234|unit=101", ownerId: 99 });
    expect(hit.duplicate).toBe(true);
    if (!hit.duplicate) return;
    expect(hit.sameOwner).toBe(false);
    expect(hit.message).toContain("POSSÍVEL DUPLICADO");
  });

  test("captação perdida é reportada como recaptável", () => {
    const hit = findDuplicateUnit(existing, { unitKey: "cep:11702000|n:50", ownerId: 2 });
    expect(hit.duplicate && hit.message).toContain("recaptar é permitido");
  });

  test("unidade nova não gera aviso", () => {
    expect(findDuplicateUnit(existing, { unitKey: "cep:11700000|n:1" }).duplicate).toBe(false);
  });

  test("chave vazia nunca casa com nada", () => {
    expect(findDuplicateUnit(existing, { unitKey: "" }).duplicate).toBe(false);
  });

  test("linhas antigas com unit_key NULL são ignoradas", () => {
    const legacy = [{ id: 1, ownerId: 1, unitKey: null, stage: "documentacao" }];
    expect(findDuplicateUnit(legacy, { unitKey: "cep:11704000|n:1" }).duplicate).toBe(false);
  });
});

describe("complementos na coluna JSON", () => {
  test("só campos conhecidos e preenchidos entram", () => {
    const clean = cleanComplements({ unit: " 101 ", block: "", lixo: "x" } as never);
    expect(clean).toEqual({ unit: "101" });
  });

  test("vazio grava NULL, ida e volta preserva", () => {
    expect(serializeComplements({})).toBeNull();
    expect(parseComplements(serializeComplements({ unit: "101", tower: "2" }))).toEqual({ unit: "101", tower: "2" });
  });

  test("JSON inválido vira objeto vazio", () => {
    expect(parseComplements("nao é json")).toEqual({});
    expect(parseComplements(null)).toEqual({});
  });
});

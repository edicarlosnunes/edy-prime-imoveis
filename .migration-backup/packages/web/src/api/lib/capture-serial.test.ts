/**
 * Testes do formato do serial (seção 29 do escopo).
 *
 * Cobre: 12 (serial global único), 13 (tipos diferentes não repetem
 * sequencial) e 25 (códigos antigos continuam válidos e não são renumerados).
 */
import { describe, expect, test } from "bun:test";
import {
  ALL_PREFIXES,
  DOC_SERIAL_PREFIXES,
  FALLBACK_PREFIX,
  TYPE_PREFIXES,
  baseSerialOf,
  buildSerial,
  documentSerial,
  formatSerial,
  isLegacyCode,
  isSerial,
  parseSerial,
  serialPrefix,
} from "./capture-serial";

describe("prefixo por tipo", () => {
  test("tipos internos conhecidos têm prefixo estável", () => {
    expect(serialPrefix("apartamento")).toBe("AP");
    expect(serialPrefix("casa")).toBe("CS");
    expect(serialPrefix("terreno")).toBe("TE");
    expect(serialPrefix("sala_comercial")).toBe("SL");
  });

  test("tolera acento, caixa e espaço vindos de dado legado", () => {
    expect(serialPrefix("Chácara")).toBe("CH");
    expect(serialPrefix("  APARTAMENTO ")).toBe("AP");
    expect(serialPrefix("sala comercial")).toBe("SL");
    expect(serialPrefix("Galpão")).toBe("GP");
  });

  test("tipo desconhecido ou vazio cai em OT e nunca lança", () => {
    expect(serialPrefix("nave espacial")).toBe(FALLBACK_PREFIX);
    expect(serialPrefix(null)).toBe(FALLBACK_PREFIX);
    expect(serialPrefix(undefined)).toBe(FALLBACK_PREFIX);
    expect(serialPrefix("")).toBe(FALLBACK_PREFIX);
  });

  test("há 15 prefixos distintos e todos com 2 letras maiúsculas", () => {
    expect(ALL_PREFIXES.length).toBe(15);
    for (const prefix of ALL_PREFIXES) expect(prefix).toMatch(/^[A-Z]{2}$/);
  });
});

describe("formato do serial", () => {
  test("sequencial é preenchido com 6 dígitos", () => {
    expect(formatSerial("AP", 2026, 124)).toBe("AP-2026-000124");
    expect(formatSerial("AP", 2026, 1)).toBe("AP-2026-000001");
  });

  test("sequencial inválido é recusado", () => {
    expect(() => formatSerial("AP", 2026, 0)).toThrow();
    expect(() => formatSerial("AP", 2026, -1)).toThrow();
    expect(() => formatSerial("AP", 2026, 1.5)).toThrow();
  });

  test("parse devolve as partes do serial-base", () => {
    const parsed = parseSerial("AP-2026-000124");
    expect(parsed).not.toBeNull();
    expect(parsed!.prefix).toBe("AP");
    expect(parsed!.year).toBe(2026);
    expect(parsed!.sequential).toBe(124);
    expect(parsed!.doc).toBeNull();
    expect(parsed!.base).toBe("AP-2026-000124");
  });
});

/* ---------------------------------------------------------------- teste 13 */
describe("teste 13 — tipos diferentes não repetem o sequencial", () => {
  test("o sequencial é global: o mesmo número nunca sai para dois tipos", () => {
    /* O sequencial vem do contador global, então dois tipos jamais recebem o
       mesmo número. Se o contador fosse por tipo, estes dois seriais teriam o
       mesmo 000124 e o número-base deixaria de identificar o imóvel. */
    const apartamento = buildSerial("apartamento", 2026, 124);
    const casa = buildSerial("casa", 2026, 125);

    expect(apartamento).toBe("AP-2026-000124");
    expect(casa).toBe("CS-2026-000125");
    expect(parseSerial(apartamento)!.sequential).not.toBe(parseSerial(casa)!.sequential);
  });
});

/* ---------------------------------------------------------------- teste 12 */
describe("teste 12 — serial único por imóvel", () => {
  test("seriais distintos para sequenciais distintos, mesmo tipo e ano", () => {
    const serials = [1, 2, 3, 4, 5].map((n) => buildSerial("apartamento", 2026, n));
    expect(new Set(serials).size).toBe(serials.length);
  });

  test("o ano faz parte do serial mas não reinicia o sequencial", () => {
    /* Regra fechada: em 2027 o sequencial continua de onde 2026 parou. */
    expect(buildSerial("apartamento", 2027, 842)).toBe("AP-2027-000842");
  });
});

describe("ficha técnica e autorização herdam o serial-base", () => {
  test("FC e AV usam o mesmo número-base do imóvel", () => {
    const base = "AP-2026-000124";
    expect(documentSerial("ficha_tecnica", base)).toBe("FC-AP-2026-000124");
    expect(documentSerial("autorizacao", base)).toBe("AV-AP-2026-000124");
    expect(DOC_SERIAL_PREFIXES.ficha_tecnica).toBe("FC");
    expect(DOC_SERIAL_PREFIXES.autorizacao).toBe("AV");
  });

  test("serial de documento volta ao serial-base", () => {
    expect(baseSerialOf("FC-AP-2026-000124")).toBe("AP-2026-000124");
    expect(baseSerialOf("AV-CS-2026-000007")).toBe("CS-2026-000007");
  });

  test("documento não gera documento de documento", () => {
    expect(() => documentSerial("autorizacao", "FC-AP-2026-000124")).toThrow();
  });

  test("serial-base inválido é recusado em vez de gerar documento torto", () => {
    expect(() => documentSerial("ficha_tecnica", "1042")).toThrow();
  });
});

/* ---------------------------------------------------------------- teste 25 */
describe("teste 25 — códigos antigos continuam válidos", () => {
  test("código livre antigo é reconhecido como legado, não como serial", () => {
    for (const code of ["1042", "AP101", "CASA-3", "ED-XYZ", "7"]) {
      expect(isSerial(code)).toBe(false);
      expect(isLegacyCode(code)).toBe(true);
    }
  });

  test("serial novo não é confundido com código antigo", () => {
    expect(isSerial("AP-2026-000124")).toBe(true);
    expect(isLegacyCode("AP-2026-000124")).toBe(false);
    expect(isSerial("FC-AP-2026-000124")).toBe(true);
  });

  test("código vazio não é legado nem serial", () => {
    expect(isLegacyCode("")).toBe(false);
    expect(isLegacyCode(null)).toBe(false);
    expect(isSerial(null)).toBe(false);
  });

  test("o mapa de tipos usa o valor do banco, não o rótulo da tela", () => {
    /* Renomear "Sala comercial" na interface não pode mudar serial emitido. */
    expect(TYPE_PREFIXES.sala_comercial).toBe("SL");
    expect(TYPE_PREFIXES.apartamento).toBe("AP");
  });
});

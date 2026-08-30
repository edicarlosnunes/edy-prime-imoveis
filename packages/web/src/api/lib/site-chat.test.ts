import { describe, expect, test } from "bun:test";

import {
  CHAT_FALLBACK_NAME,
  normalizePhone,
  normalizeVisitorToken,
  sanitizeShort,
  toPublicState,
} from "./site-chat";

const conversation = (over: Partial<Parameters<typeof toPublicState>[1]> = {}) => ({
  mode: "ia",
  status: "aberta",
  contactName: null,
  contactPhone: null,
  ...over,
});

describe("normalizePhone", () => {
  test("aceita celular com DDD e máscara", () => {
    expect(normalizePhone("(13) 99999-9999")).toBe("13999999999");
  });

  test("aceita celular só com dígitos", () => {
    expect(normalizePhone("13999999999")).toBe("13999999999");
  });

  test("remove o 55 do começo", () => {
    expect(normalizePhone("+55 13 99999-9999")).toBe("13999999999");
  });

  test("aceita fixo de 8 dígitos com DDD", () => {
    expect(normalizePhone("1333334444")).toBe("1333334444");
  });

  test("rejeita número sem DDD", () => {
    expect(normalizePhone("99999999")).toBeNull();
  });

  test("rejeita DDD inexistente", () => {
    expect(normalizePhone("(09) 99999-9999")).toBeNull();
  });

  test("rejeita número curto", () => {
    expect(normalizePhone("999")).toBeNull();
  });

  test("rejeita número longo demais", () => {
    expect(normalizePhone("139999999999999")).toBeNull();
  });

  test("rejeita texto sem dígitos", () => {
    expect(normalizePhone("meu whats")).toBeNull();
  });

  test("rejeita vazio, null e undefined", () => {
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
  });
});

describe("CHAT_FALLBACK_NAME", () => {
  test("é um nome utilizável para o lead sem nome", () => {
    expect(CHAT_FALLBACK_NAME.length).toBeGreaterThanOrEqual(2);
    expect(sanitizeShort(CHAT_FALLBACK_NAME, 120)).toBe(CHAT_FALLBACK_NAME);
  });
});

describe("normalizeVisitorToken", () => {
  test("mantém token válido e descarta lixo", () => {
    const token = "a".repeat(32);
    expect(normalizeVisitorToken(token)).toBe(token);
    expect(normalizeVisitorToken("curto")).toBeNull();
    expect(normalizeVisitorToken(undefined)).toBeNull();
  });
});

describe("toPublicState — sequência nome → WhatsApp", () => {
  const token = "b".repeat(32);

  test("não pede nada antes da conversa andar", () => {
    const state = toPublicState(token, conversation(), 1);
    expect(state.askName).toBe(false);
    expect(state.askPhone).toBe(false);
  });

  test("pede o nome a partir da segunda mensagem", () => {
    const state = toPublicState(token, conversation(), 2);
    expect(state.askName).toBe(true);
    expect(state.askPhone).toBe(false);
  });

  test("pede o WhatsApp logo depois do nome, sem exigir nova mensagem", () => {
    const state = toPublicState(token, conversation({ contactName: "Ana" }), 2);
    expect(state.askName).toBe(false);
    expect(state.askPhone).toBe(true);
  });

  test("pede o WhatsApp mesmo já transferido para o corretor", () => {
    const state = toPublicState(
      token,
      conversation({ contactName: "Ana", mode: "humano" }),
      2,
    );
    expect(state.mode).toBe("humano");
    expect(state.askPhone).toBe(true);
  });

  test("visitante que deu só o telefone continua sendo perguntado o nome", () => {
    const state = toPublicState(token, conversation({ contactPhone: "13999999999" }), 2);
    expect(state.askName).toBe(true);
    expect(state.askPhone).toBe(false);
    expect(state.identified).toBe(false);
  });

  test("com nome e telefone não pede mais nada", () => {
    const state = toPublicState(
      token,
      conversation({ contactName: "Ana", contactPhone: "13999999999" }),
      9,
    );
    expect(state.askName).toBe(false);
    expect(state.askPhone).toBe(false);
    expect(state.identified).toBe(true);
  });
});

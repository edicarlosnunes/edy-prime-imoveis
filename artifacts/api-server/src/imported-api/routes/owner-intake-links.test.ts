import { describe, expect, test } from "bun:test";
import { randomHex, sha256Hex } from "../lib/auth";
import { normalizeSource } from "../lib/capture-intake";
import { ownerIntakeLinkCreateInput, ownerIntakeSubmitInput } from "./owner-intake-links";

describe("LINK_CAPTACAO backend contract", () => {
  test("gera token opaco de 32 bytes e guarda somente digest SHA-256", async () => {
    const token = randomHex(32);
    const hash = await sha256Hex(token);
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toBe(token);
    expect(hash).toBe(await sha256Hex(token));
  });

  test("preserva a origem canônica LINK_CAPTACAO", () => {
    expect(normalizeSource("LINK_CAPTACAO")).toBe("LINK_CAPTACAO");
    expect(normalizeSource("link_captacao")).toBe("LINK_CAPTACAO");
  });

  test("gera link sem identificação prévia", () => {
    expect(ownerIntakeLinkCreateInput.safeParse({}).success).toBe(true);
  });

  test("recusa intenção de compra e exige vender ou alugar", () => {
    const result = ownerIntakeSubmitInput.safeParse({
      token: "a".repeat(64),
      name: "Proprietário de teste",
      intention: "comprar",
      propertyType: "casa",
    });
    expect(result.success).toBe(false);
  });

  test("aceita a finalidade canônica e nunca expõe campo de token hash", () => {
    const result = ownerIntakeSubmitInput.safeParse({
      token: "a".repeat(64),
      name: "Proprietário de teste",
      intention: "vender",
      propertyType: "casa",
      facadeImage: "data:image/png;base64,aGVsbG8=",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect("tokenHash" in result.data).toBe(false);
      expect(result.data.intention).toBe("vender");
    }
  });
});
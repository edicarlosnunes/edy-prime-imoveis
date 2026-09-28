import { describe, expect, test } from "bun:test";
import { captureShareUrl, isOfficialCaptureHost, PUBLIC_CAPTURE_URL } from "./capture-public-url";

describe("domínio oficial da emissão de links de captação", () => {
  test("reconhece o novo domínio e o legado durante a transição", () => {
    for (const host of [
      "www.esantoscorretor.com.br",
      "esantoscorretor.com.br",
      "www.edyprimeimoveis.com.br",
      "edyprimeimoveis.com.br",
    ]) {
      expect(isOfficialCaptureHost(host)).toBe(true);
    }
  });

  test("não habilita emissão em prévias, localhost ou domínios parecidos", () => {
    for (const host of [
      "edy-prime-imoveis-web.vercel.app",
      "edy-prime-imoveis-mytkelsg5-edy-prime-imoveis.vercel.app",
      "localhost",
      "www.esantoscorretor.com.br.example.com",
      "esantoscorretor.online",
      "",
    ]) {
      expect(isOfficialCaptureHost(host)).toBe(false);
    }
  });

  test("links novos usam sempre a nova URL pública, inclusive no acesso legado", () => {
    expect(PUBLIC_CAPTURE_URL).toBe("https://www.esantoscorretor.com.br/link-captacao");
    expect(captureShareUrl("token-de-teste")).toBe(
      "https://www.esantoscorretor.com.br/link-captacao/token-de-teste",
    );
  });
});

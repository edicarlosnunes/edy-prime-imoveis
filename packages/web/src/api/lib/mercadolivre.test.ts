import { describe, expect, test } from "bun:test";
import { mlAccount, mlToken, mlTokenConfig, validMlState } from "./mercadolivre";

describe("Mercado Livre OAuth", () => {
  test("state requires the initiating session and an unexpired nonce", () => {
    const config = { oauthState: "nonce", oauthSession: "session", oauthExpiresAt: "200" };
    expect(validMlState(config, "nonce", "session", 100)).toBe(true);
    expect(validMlState(config, "nonce", "other", 100)).toBe(false);
    expect(validMlState(config, "other", "session", 100)).toBe(false);
    expect(validMlState(config, "nonce", "session", 200)).toBe(false);
    expect(validMlState({}, "", "", 100)).toBe(false);
  });
  test("token exchange uses form encoding and does not leak provider errors", async () => {
    const fetcher = (async (url, init) => {
      expect(String(url)).toBe("https://api.mercadolibre.com/oauth/token");
      expect(init?.method).toBe("POST");
      expect((init?.body as URLSearchParams).get("client_secret")).toBe("secret&value");
      return Response.json({ error_description: "secret&value code-private" }, { status: 400 });
    }) as typeof fetch;
    await expect(mlToken({ client_secret: "secret&value" }, fetcher)).rejects.toThrow("Mercado Livre recusou a autorização (HTTP 400)");
  });
  test("single-use refresh token is replaced by the new token", () => {
    const config = mlTokenConfig({ refreshToken: "old", clientId: "123" }, { access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600 });
    expect(config.refreshToken).toBe("new-refresh");
    expect(config.clientId).toBe("123");
    expect(Number(config.tokenExpiresAt)).toBeGreaterThan(Date.now());
  });
  test("rejects token payloads without a renewable token", async () => {
    const fetcher = (async () => Response.json({ access_token: "access", expires_in: 3600 })) as typeof fetch;
    await expect(mlToken({}, fetcher)).rejects.toThrow("recusou");
  });
  test("account validation uses bearer auth and requires Brazil", async () => {
    const fetcher = (async (_url, init) => {
      expect((init?.headers as Record<string,string>).authorization).toBe("Bearer access");
      return Response.json({ id: 42, nickname: "K3E", site_id: "MLB" });
    }) as typeof fetch;
    expect(await mlAccount("access", fetcher)).toEqual({ id: "42", name: "K3E" });
    const foreign = (async () => Response.json({ id: 42, site_id: "MLA" })) as typeof fetch;
    await expect(mlAccount("access", foreign)).rejects.toThrow("conta brasileira");
  });
});

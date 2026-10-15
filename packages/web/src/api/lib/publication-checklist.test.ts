import { afterEach, expect, test } from "bun:test";
import type { AdminDb } from "./admin-base";
import { mercadoLivreChecks } from "./publication-checklist";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
function db() {
  const row = { key: "mercadolivre", enabled: 1, status: "conectado", config: JSON.stringify({ accessToken: "test-token", refreshToken: "test-refresh", sellerId: "42", tokenExpiresAt: String(Date.now() + 600000) }) };
  return {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [row] }) }) }),
    update: () => ({ set: () => ({ where: async () => [] }) }),
    insert: () => ({ values: () => ({ onConflictDoUpdate: async () => [] }) }),
  } as unknown as AdminDb;
}
function api(options: { free?: boolean; missingFee?: boolean; fail?: boolean }) {
  const calls: string[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push(String(url));
    expect(init?.method ?? "GET").toBe("GET");
    const path = new URL(String(url)).pathname;
    let body: unknown;
    if (path === "/users/me") body = { id: 42, nickname: "Conta teste", site_id: "MLB" };
    else if (options.fail) return Response.json({ error: "forbidden" }, { status: 403 });
    else if (path === "/sites/MLB/categories") body = [{ id: "MLBROOT", name: "Imóveis" }];
    else if (path === "/categories/MLBROOT") body = { children_categories: [{ id: "MLBAPT", name: "Apartamentos" }] };
    else if (path === "/categories/MLBAPT") body = { children_categories: [{ id: "MLBSALE", name: "Venda" }] };
    else if (path === "/categories/MLBSALE") body = { children_categories: [] };
    else if (path.includes("available_listing_types")) body = { available: [{ id: options.free ? "free" : "silver", name: "Modalidade teste" }] };
    else if (path.includes("listing_prices")) body = [{ listing_type_id: options.free ? "free" : "silver", currency_id: "BRL", listing_fee_amount: options.free ? 0 : 100, ...(!options.missingFee ? { sale_fee_amount: 0 } : {}) }];
    else throw new Error(`Unexpected API request: ${path}`);
    return Response.json(body);
  }) as typeof fetch;
  return calls;
}
test("paid listing is diagnosed without creating an ad or buying a package", async () => {
  const calls = api({});
  const result = await mercadoLivreChecks(db(), 590000, "apartamento", "venda");
  expect(result.find((c) => c.label === "Gratuidade")?.ok).toBe(false);
  expect(result.find((c) => c.label === "Gratuidade")?.detail).toContain("100");
  expect(result.at(-1)?.ok).toBe(false);
  expect(calls.some((url) => url.includes("/items"))).toBe(false);
});
test("free eligibility needs explicit zero fees, not missing fees", async () => {
  api({ free: true, missingFee: true });
  expect((await mercadoLivreChecks(db(), 590000, "apartamento", "venda")).find((c) => c.label === "Gratuidade")?.ok).toBe(false);
  api({ free: true });
  expect((await mercadoLivreChecks(db(), 590000, "apartamento", "venda")).find((c) => c.label === "Gratuidade")?.ok).toBe(true);
});
test("provider failure reports HTTP code without exposing credentials", async () => {
  api({ fail: true });
  const result = await mercadoLivreChecks(db(), 590000, "apartamento", "venda");
  expect(result.find((c) => c.label === "Consulta ao Mercado Livre")?.detail).toContain("403");
  expect(JSON.stringify(result)).not.toContain("test-token");
});

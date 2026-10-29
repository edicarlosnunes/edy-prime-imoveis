import { afterEach, expect, test } from "bun:test";
import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";
import { activeAIProvider, effectiveModel, gateway, gatewayConfigured } from "./gateway";

const keys = ["AI_PROVIDER", "PROPERTY_AI_PROVIDER", "GOOGLE_GENERATIVE_AI_API_KEY", "AI_GATEWAY_BASE_URL", "AI_GATEWAY_API_KEY"];
const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
const originalFetch = globalThis.fetch;
afterEach(() => {
  for (const key of keys) {
    if (previous[key] === undefined) delete process.env[key];
    else process.env[key] = previous[key];
  }
  globalThis.fetch = originalFetch;
});
function configureContent() {
  delete process.env.AI_PROVIDER;
  process.env.PROPERTY_AI_PROVIDER = "google";
  process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test-only";
}
function reply(parts: unknown[]) {
  return Response.json({ candidates: [{ content: { role: "model", parts }, finishReason: "STOP" }],
    usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10, totalTokenCount: 110 } });
}

test("saving a Google key alone does not activate Gemini", () => {
  delete process.env.AI_PROVIDER;
  delete process.env.PROPERTY_AI_PROVIDER;
  process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test-only";
  expect(activeAIProvider()).toBe("gateway");
  expect(activeAIProvider("content")).toBe("gateway");
  expect(effectiveModel("openai/gpt-5.4-mini")).toBe("openai/gpt-5.4-mini");
});
test("enabling property content does not switch the agent", () => {
  configureContent();
  expect(activeAIProvider()).toBe("gateway");
  expect(activeAIProvider("content")).toBe("google");
  expect(effectiveModel("old-model", "content")).toBe("gemini-3.5-flash-lite");
  expect(effectiveModel("old-model")).toBe("old-model");
});
test("missing Google key cannot silently use old gateway credits", () => {
  configureContent();
  delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  process.env.AI_GATEWAY_BASE_URL = "https://unused.invalid";
  process.env.AI_GATEWAY_API_KEY = "test-only";
  expect(gatewayConfigured("content")).toBe(false);
  expect(() => gateway("old-model", "content")).toThrow("chave da Gemini");
});
test("unknown provider fails closed", () => {
  process.env.AI_PROVIDER = "typo";
  expect(() => activeAIProvider()).toThrow("Provedor de IA inválido");
});
test("Google generation uses direct endpoint and exposes token usage", async () => {
  configureContent();
  let calls = 0;
  globalThis.fetch = (async (url: unknown, init: RequestInit) => {
    calls++;
    expect(String(url)).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent");
    expect(new Headers(init.headers).get("x-goog-api-key")).toBe("test-only");
    expect(JSON.parse(String(init.body)).contents[0].parts[0].text).toBe("Olá");
    return reply([{ text: "Olá!" }]);
  }) as typeof fetch;
  const result = await generateText({ model: gateway("old-model", "content"), prompt: "Olá", maxRetries: 0 });
  expect(result.text).toBe("Olá!");
  expect(result.usage.inputTokens).toBe(100);
  expect(calls).toBe(1);
});
test("quota failure never switches to old provider", async () => {
  configureContent();
  let calls = 0;
  globalThis.fetch = (async (url: unknown) => {
    calls++;
    expect(String(url)).toContain("generativelanguage.googleapis.com/");
    return Response.json({ error: { code: 429, message: "Quota exceeded", status: "RESOURCE_EXHAUSTED" } }, { status: 429 });
  }) as typeof fetch;
  await expect(generateText({ model: gateway("old-model", "content"), prompt: "Olá", maxRetries: 0 })).rejects.toThrow();
  expect(calls).toBe(1);
});
test("Google can round-trip an existing property tool before answering", async () => {
  configureContent();
  let calls = 0;
  let executed = 0;
  globalThis.fetch = (async (_url: unknown, init: RequestInit) => {
    calls++;
    const body = JSON.parse(String(init.body));
    if (calls === 1) return reply([{ functionCall: { name: "buscarImovel", args: { codigo: "TE-2026-000011" } }, thoughtSignature: "test-signature" }]);
    expect(JSON.stringify(body.contents)).toContain("280000");
    expect(JSON.stringify(body.contents)).toContain("test-signature");
    return reply([{ text: "TE-2026-000011: R$ 280.000." }]);
  }) as typeof fetch;
  const result = await generateText({
    model: gateway("old-model", "content"), prompt: "Qual o valor do TE-2026-000011?", maxRetries: 0,
    tools: { buscarImovel: tool({ inputSchema: z.object({ codigo: z.string() }), execute: async ({ codigo }) => {
      executed++;
      return { codigo, preco: 280000 };
    } }) }, stopWhen: stepCountIs(3),
  });
  expect(result.text).toContain("280.000");
  expect(calls).toBe(2);
  expect(executed).toBe(1);
});

 test("activating Google switches agent and content without rewriting requested model", async () => {
  delete process.env.PROPERTY_AI_PROVIDER;
  process.env.AI_PROVIDER = "google";
  process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test-only";
  expect(activeAIProvider()).toBe("google");
  expect(activeAIProvider("content")).toBe("google");
  expect(gatewayConfigured()).toBe(true);
  const requested = "openai/gpt-5.4-mini";
  expect(effectiveModel(requested)).toBe("gemini-3.5-flash-lite");
  let calls = 0;
  globalThis.fetch = (async (url: unknown) => {
    calls++;
    expect(String(url)).toContain("models/gemini-3.5-flash-lite:generateContent");
    return reply([{ text: "Olá!" }]);
  }) as typeof fetch;
  const result = await generateText({ model: gateway(requested), prompt: "Olá", maxRetries: 0 });
  expect(result.text).toBe("Olá!");
  expect(calls).toBe(1);
  expect(requested).toBe("openai/gpt-5.4-mini");
});

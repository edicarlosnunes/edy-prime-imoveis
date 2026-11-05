import test from "node:test";
import assert from "node:assert/strict";
import { testLinkedInAds } from "./linkedin-ads.ts";
const config = { accountId: "123", accessToken: "test-secret" };
test("missing credentials or invalid IDs cannot make network requests", async () => {
  const request = (() => { throw new Error("Network must not be used"); }) as typeof fetch;
  assert.equal((await testLinkedInAds({}, request)).status, "aguardando_credencial");
  assert.equal((await testLinkedInAds({...config, accountId:"../accounts"}, request)).ok, false);
});
test("successful read never claims publishing is connected", async () => {
  const request = (async (url: string | URL | Request, init?: RequestInit) => {
    assert.equal(String(url), "https://api.linkedin.com/rest/adAccounts/123");
    assert.equal(init?.method, "GET");
    return Response.json({id:123,status:"ACTIVE",servingStatuses:["RUNNABLE"]});
  }) as typeof fetch;
  const result = await testLinkedInAds(config, request);
  assert.equal(result.ok, true); assert.equal(result.status, "configurando");
});
test("permission errors and account restrictions stay unready without exposing credentials", async () => {
  for (const response of [new Response('test-secret', {status:403}), Response.json({id:123,status:"ACTIVE",servingStatuses:["BILLING_HOLD"]}), Response.json({id:999,status:"ACTIVE"})]) {
    const result = await testLinkedInAds(config, (async () => response) as typeof fetch);
    assert.equal(result.ok, false); assert.ok(!result.message.includes("test-secret"));
  }
});

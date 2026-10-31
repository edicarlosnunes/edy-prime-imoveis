import test from "node:test";
import assert from "node:assert/strict";
import { propertyPublicationLink, withPropertyLink } from "./property-publication-link.ts";
test("opens the exact property, including records without a slug", () => {
 assert.equal(propertyPublicationLink({slug:"sobrado-tupi",code:"SB-2026-000018"},"https://www.esantoscorretor.com.br/"),"https://www.esantoscorretor.com.br/imovel/sobrado-tupi");
 assert.equal(propertyPublicationLink({slug:null,code:"SB-2026-000018"},"https://www.esantoscorretor.com.br"),"https://www.esantoscorretor.com.br/imovel/SB-2026-000018");
});
test("long captions retain a complete property link within the platform limit", () => {
 for (const max of [2100,4900,5000]) {
 const caption=withPropertyLink("Descrição ".repeat(2000),{code:"SB-2026-000018"},"https://www.esantoscorretor.com.br",max);
 assert.ok(caption.length<=max);
 assert.ok(caption.endsWith("https://www.esantoscorretor.com.br/imovel/SB-2026-000018"));
 }
});

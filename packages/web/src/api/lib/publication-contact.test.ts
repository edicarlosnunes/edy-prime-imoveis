import test from "node:test";
import assert from "node:assert/strict";
import { buildFacebookCaption } from "./facebook-publishing.ts";
import { buildInstagramCaption } from "./instagram-publishing.ts";
const property = {
  code: "SB-2026-000018", title: "Sobrado no Tupi", purpose: "venda", price: 640000,
  opportunityPrice: 580000, district: "Tupi", city: "Praia Grande", bedrooms: 2, suites: 2,
  parking: 2, areaUtil: 98, description: "Descrição do imóvel. ".repeat(2000),
  link: "https://www.esantoscorretor.com.br/imovel/um-slug-muito-comprido", imageUrl: "https://example.com/photo.jpg",
};
for (const [name, builder, limit] of [["Facebook", buildFacebookCaption, 5000], ["Instagram", buildInstagramCaption, 2200]] as const) {
  test(`${name} retains price, direct compact link and email for long descriptions`, () => {
    const caption = builder(property);
    assert.ok(caption.length <= limit);
    assert.ok(caption.includes("580.000"));
    assert.ok(caption.includes("https://www.esantoscorretor.com.br/imovel/SB-2026-000018"));
    assert.ok(caption.includes("esantosgestorimobiliario@gmail.com"));
    assert.ok(!caption.includes("um-slug-muito-comprido"));
  });
}

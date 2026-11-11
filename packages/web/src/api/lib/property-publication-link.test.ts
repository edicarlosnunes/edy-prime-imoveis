import { test } from "node:test";
import assert from "node:assert/strict";
import { propertyPublicationLink, withPropertyLink } from "./property-publication-link.ts";

const domain = "https://www.esantoscorretor.com.br";
const property = { code: "AP-104", slug: "apartamento-tupi" };

test("publica o código imutável do imóvel, com ou sem slug", () => {
  assert.equal(propertyPublicationLink(property, domain), domain + "/imovel/AP-104");
  assert.equal(propertyPublicationLink({ code: "SB-2026-000018", slug: null }, domain), domain + "/imovel/SB-2026-000018");
});

test("cada rede recebe link específico, origem e campanha do imóvel", () => {
  for (const channel of ["facebook", "instagram", "youtube", "tiktok"] as const) {
    const caption = withPropertyLink("Converse sobre este apartamento", property, domain, 500, channel);
    assert.ok(caption.includes("Veja o imóvel AP-104:"));
    assert.ok(caption.includes("/imovel/AP-104?utm_source=" + channel));
    assert.ok(caption.includes("utm_medium=social"));
    assert.ok(caption.includes("utm_campaign=imovel-ap-104"));
  }
});

test("publicações antigas permanecem compatíveis e legendas respeitam limite", () => {
  assert.ok(!withPropertyLink("Oi", property, domain, 500).includes("?utm_source="));
  for (const max of [350, 2100, 4900, 5000]) {
    const caption = withPropertyLink("Descrição ".repeat(2000), property, domain, max, "facebook");
    assert.ok(caption.length <= max);
    assert.ok(caption.includes("utm_source=facebook"));
  }
});

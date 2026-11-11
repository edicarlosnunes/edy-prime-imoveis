import { test } from "node:test";
import assert from "node:assert/strict";
import { propertyMessengerLink, propertyPublicationLink, propertyWhatsapp1174Link, propertyContactStartLink, withPropertyLink } from "./property-publication-link.ts";

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


test("Messenger recebe código único do imóvel na referência de conversa", () => {
  assert.equal(propertyMessengerLink(property, "101408975339330"),
    "https://m.me/101408975339330?ref=imovel%3AAP-104");
  assert.throws(() => propertyMessengerLink(property, "not-a-page"), /inválido/);
});

test("WhatsApp 1174 pré-preenche EPI e origem exata sem integrar conversas", () => {
  for (const channel of ["facebook", "instagram", "tiktok", "youtube"] as const) {
    const link = propertyWhatsapp1174Link({code:"EPI-2026-001"},channel);
    const url = new URL(link);
    assert.equal(url.origin + url.pathname, "https://wa.me/5513997141174");
    const message = url.searchParams.get("text") ?? "";
    assert.match(message,/EPI-2026-001/);
    assert.match(message,new RegExp("Origem: " + channel.toUpperCase()));
    const caption = withPropertyLink("Teste", {code:"EPI-2026-001",purpose:"venda"}, domain, 500,channel);
    assert.ok(caption.includes(propertyContactStartLink({code:"EPI-2026-001"},channel,domain)));
    assert.ok(!caption.includes(link));
  }
  assert.match(new URL(propertyWhatsapp1174Link({code:"EPI-2"},"facebook","locacao")).searchParams.get("text") ?? "",/alugar/);
  assert.throws(() => propertyWhatsapp1174Link({code:"  "},"facebook"), /sem código/);
});

test("Sistema Y gera rota no CRM, identificada pelo EPI e origem, sem número pessoal", () => {
  for (const source of ["facebook", "instagram", "tiktok", "youtube"] as const) {
    const link = new URL(propertyContactStartLink({ code: "AP-104" }, source, domain));
    assert.equal(link.pathname, "/w/AP-104/" + ({facebook:"f",instagram:"i",tiktok:"t",youtube:"y"} as const)[source]);
    assert.equal(link.origin, domain);
    assert.ok(!link.href.includes("6767"));
  }
  assert.throws(() => propertyContactStartLink({code:""}, "facebook",domain),/sem código/);
});

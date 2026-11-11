import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyMetaContact, metaPropertyReference, parseMetaContactEvents } from "./meta-contact-events.ts";

test("classifica intenção imobiliária com variações, sem exigir formulário", () => {
  assert.equal(classifyMetaContact("Quero comprar esse apartamento"), "Interesse em compra");
  assert.equal(classifyMetaContact("Qual o valor desse imóvel?"), "Interesse em compra");
  assert.equal(classifyMetaContact("Tenho uma casa para vender"), "Proprietário — vender");
  assert.equal(classifyMetaContact("Quero anunciar meu apartamento para alugar"), "Proprietário — oferecer para locação");
  assert.equal(classifyMetaContact("Procuro uma casa para locação"), "Procura locação");
  assert.equal(classifyMetaContact("Tenho um repasse de financiamento"), "Repasse de imóvel");
  assert.equal(classifyMetaContact("Não quero comprar, não tenho interesse"), "Sem interesse atual");
  assert.equal(classifyMetaContact("Oi, boa tarde"), "Contato — intenção a esclarecer");
});

test("identifica o código do imóvel sem inferir um número qualquer", () => {
  assert.equal(metaPropertyReference("Gostaria do código do imóvel: AP-104", null), "AP-104");
  assert.equal(metaPropertyReference("Gostei", "imovel:CASA-99"), "CASA-99");
  assert.equal(metaPropertyReference("Meu celular é 13999998888", null), null);
});

test("reconhece mensagem Messenger e dados do anúncio sem criar evento por clique", () => {
  const events = parseMetaContactEvents({
    object: "page",
    entry: [{ messaging: [
      { sender: { id: "123" }, message: { mid: "m1", text: "Quero comprar o código AP-104" }, referral: { ref: "imovel:AP-104", ad_id: "554433" } },
      { sender: { id: "123" }, referral: { ref: "imovel:AP-104" } },
      { sender: { id: "456" }, message: { mid: "m2", text: "mensagem do perfil", is_echo: true } },
    ] }],
  });
  assert.equal(events.length, 2);
  assert.equal(events[1]?.text, "");
  assert.equal(events[1]?.referral, "imovel:AP-104");
  assert.deepEqual(events[0], {
    platform: "facebook", senderId: "123", text: "Quero comprar o código AP-104",
    messageId: "m1", referral: "imovel:AP-104", adId: "554433",
  });
});

test("Instagram Direct é classificado separadamente e mantém origem", () => {
  const events = parseMetaContactEvents({ object: "instagram", entry: [{ messaging: [
    { sender: { id: "ig-user" }, message: { mid: "ig-1", text: "Tenho casa para vender" } },
  ] }] });
  assert.equal(events.length, 1);
  assert.equal(events[0]?.platform, "instagram");
  assert.equal(classifyMetaContact(events[0]!.text), "Proprietário — vender");
});

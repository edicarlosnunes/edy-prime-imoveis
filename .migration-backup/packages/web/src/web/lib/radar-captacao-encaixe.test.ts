import { describe, expect, it } from "bun:test";

/* AJUSTE FINAL — RADAR DE CAPTAÇÃO.
   Guard de fonte para os três encaixes pedidos. Nada aqui testa regra nova de
   negócio: serial, funil, documentos e conversão já tinham teste próprio e não
   foram tocados.
     item 1  — menu lateral chama o módulo de RADAR DE CAPTAÇÃO;
     item 8  — botão de saída para o Cadastro Premium V2 já existente;
     item 10 — o Radar exibe o código oficial do imóvel, não o id interno. */

const read = (rel: string) => Bun.file(new URL(rel, import.meta.url).pathname).text();

const layout = await read("../components/admin/layout.tsx");
const captacao = await read("../pages/admin/captacao.tsx");
const capturesRoute = await read("../../api/routes/admin-captures.ts");

describe("item 1 · nome do módulo", () => {
  it("o menu lateral aponta /admin/captacao como Radar de Captação", () => {
    expect(layout).toContain('label: "Radar de Captação"');
    expect(layout).not.toContain('label: "Captação"');
  });

  it("a ficha continua chamando o processo interno de Captação", () => {
    expect(captacao).toContain("Captação #${c.id}");
  });
});

describe("item 8 · enviar para o cadastro definitivo", () => {
  it("usa o rótulo claro pedido", () => {
    expect(captacao).toContain("Enviar para Cadastro de Imóveis");
    expect(captacao).not.toContain("Cadastrar imóvel e captar");
  });

  it("abre o Cadastro Premium V2 existente levando o capture_id", () => {
    expect(captacao).toContain("/admin/imoveis/novo?capture_id=${c.id}");
  });
});

describe("item 10 · código oficial visível no Radar", () => {
  it("o get devolve o serial/code do imóvel convertido", () => {
    expect(capturesRoute).toContain("convertedProperty");
    expect(capturesRoute).toContain("serial: schema.properties.serial");
    expect(capturesRoute).toContain("code: schema.properties.code");
  });

  it("a ficha prefere serial, cai para code legado e só então para o id", () => {
    expect(captacao).toContain('c.convertedProperty?.serial||c.convertedProperty?.code||"#"+c.convertedPropertyId');
  });

  it("o Radar não gera nem altera serial — só lê", () => {
    expect(capturesRoute).not.toContain("allocateSerial");
  });
});

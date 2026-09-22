/**
 * Guarda da tela de revisão da AUTORIZAÇÃO DE VENDA.
 *
 * Antes, clicar em "Gerar Autorização de Venda" disparava quatro `prompt()`
 * do navegador em sequência (comissão, exclusividade, prazo, preço). Cancelar
 * qualquer um abortava em silêncio, e navegador com "impedir diálogos
 * adicionais" marcado simplesmente não mostrava nada.
 *
 * Agora o botão abre UMA tela de revisão já preenchida com os dados da
 * captação; a emissão só acontece no clique em "Gerar Autorização".
 *
 * Estes testes travam isso no fonte de `pages/admin/captacao.tsx`.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(
  join(import.meta.dir, "../pages/admin/captacao.tsx"),
  "utf8",
);

describe("autorizacao sem prompts em sequencia", () => {
  test("askTerms com os quatro prompts nao existe mais", () => {
    expect(source).not.toContain("function askTerms");
    expect(source).not.toContain("Comissão combinada em %");
    expect(source).not.toContain("Exclusividade? responda sim ou nao");
    expect(source).not.toContain("Prazo da autorização em dias");
    expect(source).not.toContain("Preço autorizado de venda (em branco = lacuna)");
  });

  test("o botao abre a revisao em vez de emitir direto", () => {
    expect(source).toContain('if(kind==="autorizacao"){openAuth();return}');
    expect(source).toContain("function openAuth()");
  });

  test("a revisao abre preenchida com o que a captacao ja tem", () => {
    const start = source.indexOf("function openAuth()");
    const body = source.slice(start, start + 220);
    expect(body).toContain("c!.estimatedPrice??c!.askingPrice");
  });

  test("a tela mostra os campos exigidos para conferencia", () => {
    for (const label of [
      "Preço autorizado de venda",
      "Comissão / honorários (%)",
      "Exclusividade",
      "Prazo da autorização (dias)",
    ]) {
      expect(source).toContain(`label="${label}"`);
    }
    /* dados já disponíveis, só para conferir */
    expect(source).toContain("Autorização de Venda · revisão");
  });

  test("emitir so acontece no confirmar, e a emissao continua idempotente", () => {
    expect(source).toContain("Gerar Autorização</Btn>");
    expect(source).toContain('await emitDoc("autorizacao",terms)');
    /* mesma rota de emissão da Ficha Técnica: serial AV e rastreio intactos */
    expect(source).toContain("navigate(`/admin/documento/${doc.id}`)");
  });

  test("estado da revisao fica antes do early return (ordem dos hooks)", () => {
    const hook = source.indexOf("const [auth,setAuth]=useState");
    const earlyReturn = source.indexOf("const c=q.data; if(!c) return");
    expect(hook).toBeGreaterThan(-1);
    expect(earlyReturn).toBeGreaterThan(-1);
    expect(hook).toBeLessThan(earlyReturn);
  });

  test("ficha tecnica continua emitindo direto, sem revisao", () => {
    expect(source).toContain('generateDoc("ficha_tecnica")');
    const start = source.indexOf("function generateDoc(");
    const body = source.slice(start, source.indexOf("\n", start));
    expect(body).toContain("void emitDoc(kind)");
  });
});

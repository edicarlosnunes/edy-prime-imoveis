/**
 * Guarda do LAYOUT DE IMPRESSÃO dos documentos (Ficha Técnica e Autorização).
 *
 * O papel precisa sair limpo: sem barra de trabalho, sem botões de status,
 * em A4 retrato, com rótulo discreto e RESPOSTA escura em negrito. Antes, a
 * tela não tinha nenhuma regra `@media print` e os dados preenchidos saíam
 * em cinza-claro (`text-neutral-500`), quase invisíveis na impressão.
 *
 * Estes testes travam isso no fonte — `styles.css` e `pages/admin/documento.tsx`.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(import.meta.dir, "../styles.css"), "utf8");
const doc = readFileSync(join(import.meta.dir, "../pages/admin/documento.tsx"), "utf8");

/** Trecho entre `@media print {` e o fecho do bloco (último `}` do arquivo). */
const printBlock = (() => {
  const start = css.indexOf("@media print");
  return start < 0 ? "" : css.slice(start);
})();

describe("css de impressao do documento", () => {
  test("existe um bloco @media print", () => {
    expect(printBlock.length).toBeGreaterThan(0);
  });

  test("pagina configurada como A4 retrato com margem", () => {
    expect(printBlock).toContain("@page");
    expect(printBlock).toContain("size: A4 portrait");
    expect(printBlock).toMatch(/margin:\s*12mm 14mm/);
  });

  test("interface some do papel: botoes e elementos marcados", () => {
    expect(printBlock).toContain(".doc-screen button");
    expect(printBlock).toContain('.doc-screen [data-print="hide"]');
    expect(printBlock).toMatch(/display:\s*none\s*!important/);
  });

  test("a folha perde moldura de tela e o fundo fica branco", () => {
    expect(printBlock).toContain(".doc-sheet");
    expect(printBlock).toMatch(/box-shadow:\s*none\s*!important/);
    expect(printBlock).toMatch(/background:\s*#fff\s*!important/);
  });

  test("blocos e assinaturas nao quebram entre paginas", () => {
    expect(printBlock).toContain(".doc-sheet .doc-sign");
    expect(printBlock).toMatch(/break-inside:\s*avoid/);
  });
});

describe("tela do documento usa os ganchos de impressao", () => {
  test("classes que o css de impressao alcanca", () => {
    expect(doc).toContain("doc-screen");
    expect(doc).toContain("doc-sheet");
    expect(doc).toContain("doc-sign");
    expect(doc).toContain('data-print="hide"');
  });

  test("titulo de bloco unificado em um componente", () => {
    expect(doc).toContain("function SectionTitle");
    expect(doc).toContain("<SectionTitle>Proprietário</SectionTitle>");
    expect(doc).toContain("<SectionTitle>Imóvel</SectionTitle>");
    expect(doc).not.toContain("tracking-widest text-neutral-500");
  });

  test("resposta preenchida sai escura e em negrito", () => {
    const start = doc.indexOf("function Row(");
    const body = doc.slice(start, doc.indexOf("function SectionTitle"));
    expect(body).toContain("font-semibold text-neutral-900");
    expect(body).toContain("text-neutral-600");
    expect(body).not.toContain("text-neutral-500");
  });

  test("nenhum texto do papel fica em cinza-claro", () => {
    const sheet = doc.slice(doc.indexOf('className="doc-sheet'), doc.indexOf("<footer"));
    const paper = sheet.slice(sheet.indexOf("<header"));
    expect(paper).not.toContain("text-neutral-500");
    expect(paper).not.toContain("text-neutral-400");
  });
});

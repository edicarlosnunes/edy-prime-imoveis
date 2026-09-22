import { describe, expect, it } from "bun:test";

/* REGRESSAO — FICHA DA CAPTACAO ABRINDO EM TELA BRANCA.
   A ficha (componente Detail de captacao.tsx) retorna "Carregando..." enquanto
   a query da captacao nao resolve. Quando hooks ficam DEPOIS desse early
   return, o primeiro render chama menos hooks que o render seguinte; o React
   aborta com "Rendered more hooks than during the previous render" e derruba a
   arvore inteira — a ficha abre em branco, sem nenhuma ferramenta.
   Este teste le o fonte e garante que nenhum hook seja chamado depois do
   early return. */

const SOURCE = new URL("../pages/admin/captacao.tsx", import.meta.url).pathname;
const src = await Bun.file(SOURCE).text();

const detail = src.slice(src.indexOf("function Detail("));
const guardIndex = detail.indexOf("if(!c) return");
const afterGuard = detail.slice(guardIndex);
const beforeGuard = detail.slice(0, guardIndex);

/* Hooks que o V3 adicionou e que precisam rodar em todo render. */
const V3_HOOKS = [
  "useSetOwnerIdentity",
  "useClearOwnerDuplicate",
  "useCapturePromotedPhotos",
  "usePromoteCapturePhoto",
  "useDemoteCapturePhoto",
  "useCaptureDocuments",
  "useGenerateCaptureDocument",
  "useState",
];

describe("captacao.tsx · Detail respeita as Rules of Hooks", () => {
  it("encontra o componente e o early return de carregamento", () => {
    expect(detail.startsWith("function Detail(")).toBe(true);
    expect(guardIndex).toBeGreaterThan(0);
  });

  it("nao chama nenhum hook depois do early return", () => {
    const found = [...afterGuard.matchAll(/\buse[A-Z][A-Za-z0-9_]*\s*\(/g)].map((m) => m[0].replace(/\s*\($/, ""));
    expect(found).toEqual([]);
  });

  it("chama os hooks do V3 antes do early return", () => {
    for (const hook of V3_HOOKS) expect(beforeGuard).toContain(`${hook}(`);
  });

  it("passa o prop id (nao c.id) para as queries hoistadas", () => {
    expect(beforeGuard).toContain("useCapturePromotedPhotos(id)");
    expect(beforeGuard).toContain("useCaptureDocuments(id)");
  });
});

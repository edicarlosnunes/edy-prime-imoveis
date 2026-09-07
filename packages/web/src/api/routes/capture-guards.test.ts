/**
 * Teste de FIAÇÃO e de ARTEFATO das guardas do Radar de Captação.
 *
 * Por que este arquivo existe:
 * as regras em `lib/capture-rules.ts` já estavam corretas e verdes quando a
 * captação #4 avançou para DOCUMENTAÇÃO sem avaliação em produção. O furo não
 * era a regra — era o pipeline. O backend servido pela Vercel é o bundle
 * VERSIONADO `api/handler.mjs` (+ a cópia `packages/web/api/handler.mjs`),
 * gerado por `bun run build:api`. Ele estava congelado num commit anterior às
 * guardas, então produção rodava um backend sem elas.
 *
 * Nenhum teste de lógica pura pega isso. Estes pegam:
 *  - a fiação: `setStage`/`markConverted` chamam as regras antes de escrever;
 *  - o artefato: os dois bundles contêm as guardas e são idênticos entre si.
 *
 * Se este arquivo falhar, a correção é rodar `bun run build:api` na raiz e
 * commitar os dois `handler.mjs` junto da alteração em `src/api/**`.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const routesDir = import.meta.dir;
const webRoot = join(routesDir, "../../..");
const repoRoot = join(routesDir, "../../../../..");

const routeSource = readFileSync(join(routesDir, "admin-captures.ts"), "utf8");

/** Trecho do arquivo entre o início de um procedure e o próximo. */
function procedureBody(source: string, name: string): string {
  const start = source.indexOf(`\n  ${name}: adminBase`);
  expect(start).toBeGreaterThan(-1);
  const rest = source.slice(start + 3);
  const end = rest.search(/\n {2}[a-zA-Z]+: adminBase/);
  return end === -1 ? rest : rest.slice(0, end);
}

describe("fiacao das guardas nos handlers", () => {
  test("setStage valida a transicao antes de qualquer escrita", () => {
    const body = procedureBody(routeSource, "setStage");
    expect(body).toContain("checkStageTransition");
    expect(body).toContain("estimatedPrice: capture.estimatedPrice");
    // A validação vem antes do primeiro update no banco.
    expect(body.indexOf("checkStageTransition")).toBeLessThan(body.indexOf(".update("));
    expect(body).toContain("throw new ORPCError(allowed.code");
  });

  test("markConverted valida a conversao antes de qualquer escrita", () => {
    const body = procedureBody(routeSource, "markConverted");
    expect(body).toContain("checkConversion");
    expect(body).toContain("docStatus: capture.docStatus");
    expect(body).toContain("estimatedPrice: capture.estimatedPrice");
    expect(body.indexOf("checkConversion")).toBeLessThan(body.indexOf(".update("));
    expect(body).toContain("throw new ORPCError(allowed.code");
  });
});

/* Marcadores: mensagens e ações que SÓ existem se as guardas estiverem no
   bundle. Se alguma mensagem mudar, atualize aqui e rode build:api de novo. */
const BUNDLE_MARKERS = [
  "antes de avançar para DOCUMENTAÇÃO",
  "status COMPLETO",
  "precisa estar em DOCUMENTAÇÃO para ser captada",
  "capture_checklist",
];

const BUNDLES = [
  join(repoRoot, "api/handler.mjs"),
  join(webRoot, "api/handler.mjs"),
];

describe("artefato servido pela Vercel contem as guardas", () => {
  test("os dois bundles existem", () => {
    for (const path of BUNDLES) expect(statSync(path).size).toBeGreaterThan(0);
  });

  test("cada bundle contem as guardas do funil", () => {
    for (const path of BUNDLES) {
      const code = readFileSync(path, "utf8");
      for (const marker of BUNDLE_MARKERS) {
        if (!code.includes(marker)) {
          throw new Error(
            `Bundle desatualizado (${path}): falta "${marker}". Rode "bun run build:api" na raiz e commite os dois api/handler.mjs.`,
          );
        }
      }
    }
  });

  test("os dois bundles sao identicos", () => {
    const [a, b] = BUNDLES.map((path) => readFileSync(path));
    expect(a.length).toBe(b.length);
    expect(a.equals(b)).toBe(true);
  });
});

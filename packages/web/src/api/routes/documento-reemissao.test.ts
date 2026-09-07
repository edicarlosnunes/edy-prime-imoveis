/**
 * Guarda da REEMISSÃO de documento (FICHA TÉCNICA / AUTORIZAÇÃO).
 *
 * Por que este arquivo existe:
 * o serial do documento é determinístico (`FC-`/`AV-` + serial-base) e a coluna
 * `crm_documents.serial` tem índice UNIQUE. O `generate` inseria uma linha nova
 * a cada clique, então o SEGUNDO clique no mesmo documento estourava
 * `SQLITE_CONSTRAINT: UNIQUE constraint failed: crm_documents.serial`, a
 * chamada voltava 500 e a tela não navegava para `/admin/documento/:id` —
 * exatamente o "clico e não acontece nada" relatado.
 *
 * Estes testes travam as duas pontas:
 *  - a FIAÇÃO: `generate` procura o documento pelo serial ANTES de inserir e
 *    devolve a linha existente em vez de duplicar;
 *  - o ARTEFATO: os bundles versionados `api/handler.mjs` (+ a cópia em
 *    `packages/web/api/handler.mjs`) já contêm essa correção. Sem isso o código
 *    existe no fonte e produção continua rodando o backend antigo.
 *
 * Se o artefato falhar, rode `bun run build:api` na raiz e commite os dois
 * `handler.mjs` junto da alteração em `src/api/**`.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const routesDir = import.meta.dir;
const webRoot = join(routesDir, "../../..");
const repoRoot = join(routesDir, "../../../../..");

const routeSource = readFileSync(join(routesDir, "admin-documents.ts"), "utf8");

/** Corpo do procedure `generate`, do início dele até o próximo procedure. */
function generateBody(): string {
  const start = routeSource.indexOf("\n  generate: adminBase");
  expect(start).toBeGreaterThan(-1);
  const rest = routeSource.slice(start + 3);
  const end = rest.search(/\n {2}[a-zA-Z]+: adminBase/);
  return end === -1 ? rest : rest.slice(0, end);
}

describe("fiacao da reemissao em generate", () => {
  const body = generateBody();

  test("procura documento pelo serial antes de inserir", () => {
    const lookup = body.indexOf("eq(schema.crmDocuments.serial, serial)");
    const insert = body.indexOf(".insert(schema.crmDocuments)");
    expect(lookup).toBeGreaterThan(-1);
    expect(insert).toBeGreaterThan(-1);
    expect(lookup).toBeLessThan(insert);
  });

  test("reaproveita a linha existente em vez de duplicar o serial", () => {
    expect(body).toContain("if (existing)");
    /* Precisa devolver o documento encontrado: é o `id` que a tela usa para
       navegar até /admin/documento/:id. */
    expect(body).toMatch(/return \{ \.\.\.current,/);
  });

  test("nao reescreve snapshot de documento que ja saiu da fase gerada", () => {
    expect(body).toContain('existing.status === "gerada"');
  });
});

describe("artefato servido pela vercel", () => {
  const bundles = [join(repoRoot, "api/handler.mjs"), join(webRoot, "api/handler.mjs")];

  for (const file of bundles) {
    test(`${file.replace(repoRoot, ".")} contem a correcao de reemissao`, () => {
      const code = readFileSync(file, "utf8");
      expect(code).toContain("capture_document_generated");
      /* Strings que só existem depois da correção: a busca pelo serial e a
         proteção do snapshot já assinado. Se sumirem, o bundle é antigo. */
      expect(code).toContain("crmDocuments.serial, serial");
      expect(code).toContain('existing.status === "gerada"');
    });
  }
});

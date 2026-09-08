/**
 * Guarda da PONTE RADAR -> CADASTRO PREMIUM.
 *
 * Dois pedidos do corretor entram aqui:
 *
 *  - CÓDIGO AUTOMÁTICO: abrindo `/admin/imoveis/novo?capture_id=<id>`, o campo
 *    CÓDIGO já chega com o serial que a captação emitiu (o mesmo impresso na
 *    Ficha Técnica e na Autorização). Nada é gerado nem renumerado aqui, e o
 *    cadastro manual (sem `capture_id`) continua com o campo em branco.
 *
 *  - FOTOS DO RADAR NA GALERIA: as fotos provisórias entram na galeria do
 *    imóvel na MESMA ordem e com a MESMA capa, reaproveitando a URL — sem novo
 *    upload, sem duplicar arquivo, sem apagar as fotos da captação — e o imóvel
 *    continua nascendo NÃO PUBLICADO.
 *
 * O comportamento puro é testado de verdade em `galleryFromOwnerPhotos`; o que
 * é efeito de tela (prefill do formulário) fica travado por leitura do fonte.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { galleryFromOwnerPhotos } from "./capture-conversion-flow";

const form = readFileSync(join(import.meta.dir, "../pages/admin/property-form.tsx"), "utf8");
const radar = readFileSync(join(import.meta.dir, "../pages/admin/captacao.tsx"), "utf8");

/** JSON como o Radar grava em `captures.owner_photos`. */
function ownerPhotos(...rows: Array<{ url: string; primary?: boolean }>): string {
  return JSON.stringify(
    rows.map((row) => ({
      url: row.url,
      addedAt: "2026-09-08T12:00:00.000Z",
      ...(row.primary === true ? { primary: true } : {}),
    })),
  );
}

describe("fotos do Radar viram a galeria do imovel", () => {
  test("sem fotos provisorias a galeria nasce vazia", () => {
    expect(galleryFromOwnerPhotos(null)).toEqual([]);
    expect(galleryFromOwnerPhotos("[]")).toEqual([]);
    expect(galleryFromOwnerPhotos("lixo")).toEqual([]);
  });

  test("a ordem da captacao é a ordem da galeria", () => {
    const raw = ownerPhotos(
      { url: "https://cdn.exemplo.com/a.jpg" },
      { url: "https://cdn.exemplo.com/b.jpg" },
      { url: "https://cdn.exemplo.com/c.jpg" },
    );
    expect(galleryFromOwnerPhotos(raw).map((image) => image.url)).toEqual([
      "https://cdn.exemplo.com/a.jpg",
      "https://cdn.exemplo.com/b.jpg",
      "https://cdn.exemplo.com/c.jpg",
    ]);
  });

  test("a capa escolhida no Radar continua sendo a capa no cadastro", () => {
    const raw = ownerPhotos(
      { url: "https://cdn.exemplo.com/a.jpg" },
      { url: "https://cdn.exemplo.com/b.jpg", primary: true },
      { url: "https://cdn.exemplo.com/c.jpg" },
    );
    const gallery = galleryFromOwnerPhotos(raw);
    expect(gallery.filter((image) => image.isPrimary).map((image) => image.url)).toEqual([
      "https://cdn.exemplo.com/b.jpg",
    ]);
    /* Trocar a capa não reordena a galeria. */
    expect(gallery.map((image) => image.url)).toEqual([
      "https://cdn.exemplo.com/a.jpg",
      "https://cdn.exemplo.com/b.jpg",
      "https://cdn.exemplo.com/c.jpg",
    ]);
  });

  test("sem capa marcada a capa é a primeira, e é uma só", () => {
    const raw = ownerPhotos(
      { url: "https://cdn.exemplo.com/a.jpg" },
      { url: "https://cdn.exemplo.com/b.jpg" },
    );
    const gallery = galleryFromOwnerPhotos(raw);
    expect(gallery.filter((image) => image.isPrimary)).toHaveLength(1);
    expect(gallery[0]?.isPrimary).toBe(true);
  });

  test("nenhum arquivo é duplicado: a URL da galeria é a URL da captacao", () => {
    const raw = ownerPhotos({ url: "https://cdn.exemplo.com/a.jpg" });
    const gallery = galleryFromOwnerPhotos(raw);
    expect(gallery[0]?.url).toBe("https://cdn.exemplo.com/a.jpg");
    /* Sem original separado: não houve novo upload nem cópia do arquivo. */
    expect(gallery[0]?.originalUrl).toBeNull();
    /* A captação continua com a foto dela — a função não muda a entrada. */
    expect(JSON.parse(raw)).toHaveLength(1);
  });
});

describe("prefill do Cadastro Premium vindo do Radar", () => {
  test("o CODIGO é preenchido com o serial da captacao", () => {
    expect(form).toContain('code: current.code || String(row.serial ?? "").trim()');
  });

  test("o que o corretor ja digitou nao é sobrescrito pelo serial", () => {
    expect(form).toContain("code: current.code ||");
  });

  test("o prefill so roda em cadastro novo vindo de captacao, uma unica vez", () => {
    expect(form).toContain("if (propertyId !== null || captureId === null || prefilled) return;");
  });

  test("a galeria é carregada com as fotos provisorias da captacao", () => {
    expect(form).toContain("galleryFromOwnerPhotos(row.ownerPhotos)");
  });

  test("galeria ja preenchida nao é sobrescrita pelas fotos do Radar", () => {
    expect(form).toContain("setImages((current) => (current.length > 0 ? current : inherited))");
  });

  test("imovel vindo de captacao continua nascendo fora do ar", () => {
    expect(form).toContain("published: false,");
  });
});

describe("escolher a foto principal dentro do Radar", () => {
  test("a ficha da captacao oferece tornar principal", () => {
    expect(radar).toContain("Tornar principal");
  });

  test("a acao chama a rota de capa provisoria, nao a de publicar", () => {
    expect(radar).toContain("setPhotoPrimary");
    expect(radar).toContain("useSetCapturePhotoPrimary");
  });

  test("a ordem das provisorias é ajustavel na propria ficha", () => {
    expect(radar).toContain("movePhoto");
    expect(radar).toContain("useMoveCapturePhoto");
  });
});

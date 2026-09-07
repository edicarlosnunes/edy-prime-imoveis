/**
 * Teste 11 da lista obrigatória: fotos provisórias separadas de fotos oficiais.
 */
import { describe, expect, test } from "bun:test";
import {
  MAX_OWNER_PHOTOS,
  OFFICIAL_LABEL,
  PROVISIONAL_LABEL,
  addOwnerPhotos,
  parseOwnerPhotos,
  photoSummary,
  promoteToOfficial,
  removeOwnerPhoto,
  serializeOwnerPhotos,
} from "./capture-photos";

const now = new Date("2026-09-07T12:00:00.000Z");

describe("11. fotos provisórias separadas de fotos oficiais", () => {
  test("foto do proprietário entra como provisória, nunca como oficial", () => {
    const photos = addOwnerPhotos(null, [{ url: "/api/media/abc", caption: "Sala" }], { now });
    expect(photos).toHaveLength(1);
    expect(photos[0]?.source).toBe("proprietario");
    expect(photos[0]?.addedAt).toBe(now.toISOString());
    // Sem aprovação explícita nada vira oficial.
    expect(promoteToOfficial(serializeOwnerPhotos(photos), [])).toEqual([]);
  });

  test("conversão sem escolha do corretor não promove nada", () => {
    const raw = serializeOwnerPhotos(
      addOwnerPhotos(null, [{ url: "/api/media/1" }, { url: "/api/media/2" }], { now }),
    );
    expect(promoteToOfficial(raw, [])).toHaveLength(0);
    expect(photoSummary(raw, 0)).toMatchObject({ provisional: 2, official: 0, readyToPublish: false });
  });

  test("só a foto escolhida vira oficial, e a primeira aprovada é a capa", () => {
    const raw = serializeOwnerPhotos(
      addOwnerPhotos(null, [{ url: "/api/media/1" }, { url: "/api/media/2" }, { url: "/api/media/3" }], { now }),
    );
    const official = promoteToOfficial(raw, ["/api/media/3", "/api/media/1"]);
    expect(official).toEqual([
      { url: "/api/media/3", sortOrder: 0, isPrimary: 1 },
      { url: "/api/media/1", sortOrder: 1, isPrimary: 0 },
    ]);
  });

  test("capa explícita ganha da ordem", () => {
    const raw = serializeOwnerPhotos(addOwnerPhotos(null, [{ url: "/a.jpg" }, { url: "/b.jpg" }], { now }));
    const official = promoteToOfficial(raw, ["/a.jpg", "/b.jpg"], { primaryUrl: "/b.jpg", startOrder: 5 });
    expect(official).toEqual([
      { url: "/a.jpg", sortOrder: 5, isPrimary: 0 },
      { url: "/b.jpg", sortOrder: 6, isPrimary: 1 },
    ]);
  });

  test("URL que não está entre as provisórias não pode ser promovida", () => {
    const raw = serializeOwnerPhotos(addOwnerPhotos(null, [{ url: "/a.jpg" }], { now }));
    expect(promoteToOfficial(raw, ["/intruso.jpg"])).toEqual([]);
  });

  test("promover não apaga a lista provisória", () => {
    const raw = serializeOwnerPhotos(addOwnerPhotos(null, [{ url: "/a.jpg" }], { now }));
    promoteToOfficial(raw, ["/a.jpg"]);
    expect(parseOwnerPhotos(raw)).toHaveLength(1);
  });

  test("rótulos de tela são fixos e distintos", () => {
    expect(PROVISIONAL_LABEL).toBe("FOTOS DO PROPRIETÁRIO / PROVISÓRIAS");
    expect(OFFICIAL_LABEL).toBe("FOTOS OFICIAIS / APROVADAS PARA PUBLICAÇÃO");
    expect(photoSummary(null, 4)).toMatchObject({ provisional: 0, official: 4, readyToPublish: true });
  });

  test("provisória sozinha não deixa o imóvel pronto para publicar", () => {
    const raw = serializeOwnerPhotos(addOwnerPhotos(null, [{ url: "/a.jpg" }], { now }));
    expect(photoSummary(raw, 0).readyToPublish).toBe(false);
  });
});

describe("armazenamento das fotos provisórias", () => {
  test("lista vazia grava NULL, não string vazia nem []", () => {
    expect(serializeOwnerPhotos([])).toBeNull();
  });

  test("ida e volta pelo JSON preserva os campos", () => {
    const photos = addOwnerPhotos(null, [{ url: "/a.jpg", caption: "Vista" }], { now, source: "equipe" });
    const back = parseOwnerPhotos(serializeOwnerPhotos(photos));
    expect(back).toEqual([{ url: "/a.jpg", caption: "Vista", source: "equipe", addedAt: now.toISOString() }]);
  });

  test("JSON inválido ou tipo errado não derruba a ficha", () => {
    expect(parseOwnerPhotos("{isso não é json")).toEqual([]);
    expect(parseOwnerPhotos("{}")).toEqual([]);
    expect(parseOwnerPhotos(null)).toEqual([]);
    expect(parseOwnerPhotos('[1,2,"x",null]')).toEqual([]);
  });

  test("URL perigosa é descartada", () => {
    const photos = addOwnerPhotos(null, [
      { url: "javascript:alert(1)" },
      { url: "data:image/png;base64,AAA" },
      { url: "https://ok.com/foto.jpg" },
    ], { now });
    expect(photos.map((p) => p.url)).toEqual(["https://ok.com/foto.jpg"]);
  });

  test("URL repetida não duplica", () => {
    const first = addOwnerPhotos(null, [{ url: "/a.jpg" }], { now });
    const second = addOwnerPhotos(serializeOwnerPhotos(first), [{ url: "/a.jpg" }, { url: "/b.jpg" }], { now });
    expect(second.map((p) => p.url)).toEqual(["/a.jpg", "/b.jpg"]);
  });

  test("teto de fotos é respeitado", () => {
    const many = Array.from({ length: MAX_OWNER_PHOTOS + 10 }, (_, i) => ({ url: `/foto-${i}.jpg` }));
    expect(addOwnerPhotos(null, many, { now })).toHaveLength(MAX_OWNER_PHOTOS);
  });

  test("remover apaga só a URL pedida", () => {
    const raw = serializeOwnerPhotos(addOwnerPhotos(null, [{ url: "/a.jpg" }, { url: "/b.jpg" }], { now }));
    expect(removeOwnerPhoto(raw, "/a.jpg").map((p) => p.url)).toEqual(["/b.jpg"]);
  });
});

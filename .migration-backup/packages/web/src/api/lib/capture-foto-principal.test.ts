/**
 * FOTO PRINCIPAL PROVISÓRIA do Radar de Captação.
 *
 * Antes só existia enviar / remover / promover: não havia como dizer QUAL das
 * fotos do proprietário é a capa provável, e reordenar era impossível. Agora a
 * captação guarda a ordem da lista e uma marca `primary`, e essa escolha é o
 * que o Cadastro Premium herda.
 *
 * Regras travadas aqui:
 *  - só UMA foto é principal, mesmo que o JSON venha com duas marcadas;
 *  - sem marca explícita, a capa é a primeira da lista (convenção da galeria);
 *  - trocar a principal não reordena a lista;
 *  - reordenar não troca a principal;
 *  - marcar capa não publica nada: continua tudo provisório.
 */
import { describe, expect, test } from "bun:test";
import {
  addOwnerPhotos,
  moveOwnerPhoto,
  parseOwnerPhotos,
  primaryOwnerPhotoUrl,
  promoteToOfficial,
  removeOwnerPhoto,
  serializeOwnerPhotos,
  setOwnerPhotoPrimary,
} from "./capture-photos";

const now = new Date("2026-09-08T12:00:00.000Z");

/** Três provisórias, na ordem em que o proprietário enviou. */
const raw = serializeOwnerPhotos(
  addOwnerPhotos(
    null,
    [{ url: "/api/media/1" }, { url: "/api/media/2" }, { url: "/api/media/3" }],
    { now },
  ),
);

describe("escolher e trocar a foto principal provisória", () => {
  test("sem marca explícita a capa é a primeira da lista", () => {
    expect(primaryOwnerPhotoUrl(raw)).toBe("/api/media/1");
    expect(parseOwnerPhotos(raw).filter((p) => p.primary)).toHaveLength(0);
  });

  test("marcar a segunda como principal não muda a ordem", () => {
    const photos = setOwnerPhotoPrimary(raw, "/api/media/2");
    expect(photos.map((p) => p.url)).toEqual(["/api/media/1", "/api/media/2", "/api/media/3"]);
    expect(photos.filter((p) => p.primary).map((p) => p.url)).toEqual(["/api/media/2"]);
    expect(primaryOwnerPhotoUrl(serializeOwnerPhotos(photos))).toBe("/api/media/2");
  });

  test("trocar a principal deixa apenas uma capa", () => {
    const first = serializeOwnerPhotos(setOwnerPhotoPrimary(raw, "/api/media/2"));
    const second = setOwnerPhotoPrimary(first, "/api/media/3");
    expect(second.filter((p) => p.primary).map((p) => p.url)).toEqual(["/api/media/3"]);
  });

  test("URL fora da captação não vira capa e não altera a lista", () => {
    const photos = setOwnerPhotoPrimary(raw, "/api/media/999");
    expect(photos.map((p) => p.url)).toEqual(["/api/media/1", "/api/media/2", "/api/media/3"]);
    expect(photos.some((p) => p.primary)).toBe(false);
  });

  test("JSON com duas capas é normalizado para uma só", () => {
    const corrupted = JSON.stringify([
      { url: "/api/media/1", source: "proprietario", addedAt: now.toISOString(), primary: true },
      { url: "/api/media/2", source: "proprietario", addedAt: now.toISOString(), primary: true },
    ]);
    const photos = parseOwnerPhotos(corrupted);
    expect(photos.filter((p) => p.primary).map((p) => p.url)).toEqual(["/api/media/1"]);
  });

  test("remover a capa devolve a capa para a primeira restante", () => {
    const marked = serializeOwnerPhotos(setOwnerPhotoPrimary(raw, "/api/media/1"));
    const left = serializeOwnerPhotos(removeOwnerPhoto(marked, "/api/media/1"));
    expect(primaryOwnerPhotoUrl(left)).toBe("/api/media/2");
  });
});

describe("preservar a ordem das fotos", () => {
  test("subir uma foto troca só com a vizinha", () => {
    const photos = moveOwnerPhoto(raw, "/api/media/3", -1);
    expect(photos.map((p) => p.url)).toEqual(["/api/media/1", "/api/media/3", "/api/media/2"]);
  });

  test("descer uma foto troca só com a vizinha", () => {
    const photos = moveOwnerPhoto(raw, "/api/media/1", 1);
    expect(photos.map((p) => p.url)).toEqual(["/api/media/2", "/api/media/1", "/api/media/3"]);
  });

  test("na ponta da lista nada se move e nada se perde", () => {
    expect(moveOwnerPhoto(raw, "/api/media/1", -1).map((p) => p.url)).toEqual([
      "/api/media/1",
      "/api/media/2",
      "/api/media/3",
    ]);
    expect(moveOwnerPhoto(raw, "/api/media/3", 1)).toHaveLength(3);
  });

  test("reordenar não troca a capa: a marca viaja com a foto", () => {
    const marked = serializeOwnerPhotos(setOwnerPhotoPrimary(raw, "/api/media/3"));
    const moved = moveOwnerPhoto(marked, "/api/media/3", -1);
    expect(moved.map((p) => p.url)).toEqual(["/api/media/1", "/api/media/3", "/api/media/2"]);
    expect(moved.filter((p) => p.primary).map((p) => p.url)).toEqual(["/api/media/3"]);
  });

  test("a ordem sobrevive à gravação e à releitura do JSON", () => {
    const moved = serializeOwnerPhotos(moveOwnerPhoto(raw, "/api/media/3", -1));
    expect(parseOwnerPhotos(moved).map((p) => p.url)).toEqual([
      "/api/media/1",
      "/api/media/3",
      "/api/media/2",
    ]);
  });
});

describe("capa provisória não publica nada", () => {
  test("marcar capa continua sem promover foto nenhuma ao anúncio", () => {
    const marked = serializeOwnerPhotos(setOwnerPhotoPrimary(raw, "/api/media/2"));
    expect(promoteToOfficial(marked, [])).toEqual([]);
  });

  test("promovendo em lote, a capa marcada no Radar é a capa do anúncio", () => {
    const marked = serializeOwnerPhotos(setOwnerPhotoPrimary(raw, "/api/media/2"));
    const official = promoteToOfficial(marked, ["/api/media/1", "/api/media/2", "/api/media/3"]);
    expect(official.find((photo) => photo.isPrimary === 1)?.url).toBe("/api/media/2");
    // ordem preservada: a capa não pula para a frente
    expect(official.map((photo) => photo.url)).toEqual([
      "/api/media/1",
      "/api/media/2",
      "/api/media/3",
    ]);
  });

  test("capa marcada mas não aprovada não rouba a capa de quem entrou", () => {
    const marked = serializeOwnerPhotos(setOwnerPhotoPrimary(raw, "/api/media/3"));
    const official = promoteToOfficial(marked, ["/api/media/1"]);
    expect(official.find((photo) => photo.isPrimary === 1)?.url).toBe("/api/media/1");
  });
});

import test from "node:test";
import assert from "node:assert/strict";
import { drawBookWatermark, loadBookWatermark } from "./book-watermark.ts";

test("black transparent watermark stays inside both vertical footage and square slides", () => {
  const image = { naturalWidth: 1254, naturalHeight: 1254 } as HTMLImageElement;
  for (const contentTop of [0, 420]) {
    let drawn: number[] = [];
    let painted = false;
    const ctx = {
      globalAlpha: 1, filter: "none",
      save() {}, restore() {},
      fillRect() { painted = true; },
      drawImage(_image: unknown, ...bounds: number[]) { drawn = bounds; },
    } as unknown as CanvasRenderingContext2D;
    drawBookWatermark(ctx, image, 1080, contentTop);
    assert.match(ctx.filter, /brightness\(0\)/);
    assert.ok(ctx.globalAlpha > 0 && ctx.globalAlpha < 1);
    assert.equal(painted, false, "no opaque background rectangle");
    assert.ok(drawn[0] >= 0 && drawn[0] + drawn[2] < 1080);
    assert.ok(drawn[1] >= contentTop && drawn[1] + drawn[3] < contentTop + 1080);
  }
});

test("missing brand rejects export instead of silently creating an unmarked video", async () => {
  const previous = globalThis.Image;
  class MissingImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_value: string) { queueMicrotask(() => this.onerror?.()); }
  }
  globalThis.Image = MissingImage as unknown as typeof Image;
  try { await assert.rejects(loadBookWatermark(), /Nenhum vídeo foi gerado/); }
  finally { globalThis.Image = previous; }
});

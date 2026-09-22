import { describe, expect, it } from "bun:test";
import {
  contrastCss,
  contrastRatio,
  parseHex,
  PREMIUM_MUTED,
  readableTheme,
  relativeLuminance,
} from "./theme-contrast";

const base = {
  primary: "#17231f",
  secondary: "#a9834b",
  accent: "#c9a46a",
  background: "#f4f1ea",
  text: "#12140f",
  muted: "#6b6a62",
  surface: "#dcd8cd",
};

/** Tema realmente publicado no CMS: fundo quase preto com texto quase preto. */
const published = {
  ...base,
  background: "#050505",
  surface: "#050505",
  text: "#12140f",
  muted: "#f8b90d",
};

describe("parseHex", () => {
  it("aceita 3, 6 e 8 dígitos", () => {
    expect(parseHex("#fff")).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseHex("#050505")).toEqual({ r: 5, g: 5, b: 5 });
    expect(parseHex("#12140fff")).toEqual({ r: 18, g: 20, b: 15 });
  });

  it("rejeita valores inválidos", () => {
    expect(parseHex("")).toBeNull();
    expect(parseHex("vermelho")).toBeNull();
    expect(parseHex("#12")).toBeNull();
  });
});

describe("contrastRatio", () => {
  it("preto x branco = 21:1", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
  });

  it("mesma cor = 1:1", () => {
    expect(contrastRatio("#17231f", "#17231f")).toBeCloseTo(1, 5);
  });

  it("devolve 0 quando a cor é inválida", () => {
    expect(contrastRatio("nope", "#ffffff")).toBe(0);
  });

  it("luminância inválida é null", () => {
    expect(relativeLuminance("nope")).toBeNull();
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 5);
  });
});

describe("readableTheme", () => {
  it("não altera nada quando o tema já é legível (default do código)", () => {
    const r = readableTheme(base);
    expect(r.adjusted).toBe(false);
    expect(r.heading).toBe(base.primary);
    expect(r.body).toBe(base.text);
    expect(r.muted).toBe(base.muted);
    expect(contrastCss(r)).toBe("");
  });

  it("clareia títulos e textos ilegíveis no tema publicado", () => {
    const r = readableTheme(published);
    expect(r.adjusted).toBe(true);
    expect(r.adjustedHeading).toBe(true);
    expect(r.adjustedBody).toBe(true);
    expect(contrastRatio(r.heading, published.background)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(r.body, published.background)).toBeGreaterThanOrEqual(4.5);
  });

  it("usa o cinza claro premium nos textos secundários em fundo escuro", () => {
    const r = readableTheme(published);
    expect(r.muted).toBe(PREMIUM_MUTED);
    expect(r.muted).toBe("#b8b6ae");
    expect(r.adjustedMuted).toBe(true);
    expect(contrastRatio(r.muted, published.background)).toBeGreaterThanOrEqual(3);
  });

  it("não aplica o cinza claro em tema de fundo claro", () => {
    const r = readableTheme(base);
    expect(r.muted).toBe(base.muted);
    expect(r.adjustedMuted).toBe(false);
  });

  it("não toca no dourado/champanhe do tema", () => {
    const r = readableTheme(published);
    const css = contrastCss(r);
    expect(css).not.toContain(published.secondary);
    expect(css).not.toContain(published.accent);
    expect(css).not.toContain("text-brass");
    expect(css).not.toContain("--color-brass");
  });

  it("mantém texto escuro para as ilhas claras (cards bg-white)", () => {
    const r = readableTheme(published);
    expect(contrastRatio(r.onLight, "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });

  it("hex inválido não quebra o cálculo", () => {
    const r = readableTheme({ ...published, background: "", surface: "", text: "oops" });
    expect(typeof r.heading).toBe("string");
    expect(typeof r.body).toBe("string");
  });

  it("o CSS gerado é escopado em .site-shell e não mexe em fundos", () => {
    const css = contrastCss(readableTheme(published));
    expect(css).toContain(".site-shell .text-deep{color:");
    expect(css.split("\n").every((line) => line.startsWith(".site-shell"))).toBe(true);
    expect(css).not.toContain("background");
    expect(css).not.toContain("--color-deep");
  });
});

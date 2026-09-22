import { describe, expect, test } from "bun:test";
import { mergeSiteContent, resolveLogoUrl } from "./site-content";

/**
 * Regressão: a logo trocada no Editor do Site precisa chegar ao site público.
 *
 * O bug: o Editor grava a logo em `theme.logoUrl` (aba Identidade visual), mas
 * o cabeçalho e o rodapé liam `menu.logoUrl || theme.logoUrl`. Uma logo antiga
 * gravada em `menu.logoUrl` vencia a nova para sempre, mesmo publicando.
 */

describe("logo do site público vem do Editor", () => {
  test("a logo publicada no Editor vence uma logo antiga presa no menu", () => {
    const content = mergeSiteContent({
      theme: { logoUrl: "/api/media/nova" },
      menu: { logoUrl: "/api/media/antiga" },
    });
    expect(resolveLogoUrl(content)).toBe("/api/media/nova");
  });

  test("conteúdo antigo, com logo só no menu, continua funcionando", () => {
    const content = mergeSiteContent({
      theme: { logoUrl: "" },
      menu: { logoUrl: "/api/media/antiga" },
    });
    expect(resolveLogoUrl(content)).toBe("/api/media/antiga");
  });

  test("sem logo nenhuma o site cai no nome escrito", () => {
    const content = mergeSiteContent({ theme: { logoUrl: "" }, menu: { logoUrl: "" } });
    expect(resolveLogoUrl(content)).toBe("");
  });

  test("espaços em volta da URL não quebram a renderização", () => {
    const content = mergeSiteContent({ theme: { logoUrl: "  /api/media/nova  " } });
    expect(resolveLogoUrl(content)).toBe("/api/media/nova");
  });
});

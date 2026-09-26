import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { siteBaseUrl } from "./base-url";
import { previewPublicSiteContent, publicBrandText } from "./public-identity";
import { isPublicSiteHostname, PUBLIC_SITE_URL } from "../../shared/public-site-url";

describe("identidade pública da prévia", () => {
  test("substitui só a apresentação, sem alterar os dados recebidos ou contatos", () => {
    const old = {
      menu: { logoText: "Edy Prime", logoSuffix: "Imóveis" },
      sections: { sobre: { badgeName: "Edy Prime" } },
      company: {
        name: "Edy Prime",
        brandSuffix: "Imóveis",
        broker: "Edy Prime",
        email: "edyprimeimoveis@gmail.com",
        whatsapp: "5513997726767",
      },
      theme: { logoUrl: "/api/media/old", faviconUrl: "/api/media/old" },
      seo: { title: "Edy Prime Imóveis", ogImageUrl: "/og-image.png" },
    };
    const result = previewPublicSiteContent(old) as typeof old;
    expect(result.menu).toMatchObject({ logoText: "E. Santos", logoSuffix: "" });
    expect(result.company).toMatchObject({
      name: "E. Santos",
      brandSuffix: "",
      broker: "E. Santos",
      email: old.company.email,
      whatsapp: old.company.whatsapp,
    });
    expect(result.theme.logoUrl).toBe("/esantos-logo.png");
    expect(result.theme.faviconUrl).toBe("/esantos-logo.png");
    expect(result.seo.ogImageUrl).toBe(`${PUBLIC_SITE_URL}/og-esantos.png`);
    expect(old.company.name).toBe("Edy Prime");
    expect(old.theme.logoUrl).toBe("/api/media/old");
  });

  test("não substitui identificadores e contatos técnicos", () => {
    expect(publicBrandText("Olá, aqui é da Edy Prime Imóveis.")).toBe("Olá, aqui é da E. Santos.");
    expect(publicBrandText("edyprimeimoveis@gmail.com")).toBe("edyprimeimoveis@gmail.com");
    expect(publicBrandText("Veja https://www.edyprimeimoveis.com.br/imovel/123")).toBe(
      `Veja ${PUBLIC_SITE_URL}/imovel/123`,
    );
    expect(publicBrandText("Veja https://esantoscorretor.com.br/imovel/123")).toBe(
      `Veja ${PUBLIC_SITE_URL}/imovel/123`,
    );
    expect(publicBrandText("Veja https://www.edyprimeimoveis.com.br/imovel/123", "https://esantoscorretor.com.br")).toBe(
      "Veja https://esantoscorretor.com.br/imovel/123",
    );
  });

  test("a URL canônica configurada é usada sem proibir o próximo domínio", () => {
    expect(siteBaseUrl(new Headers({ host: "www.edyprimeimoveis.com.br" }))).toBe(PUBLIC_SITE_URL);
    expect(siteBaseUrl(new Headers({ host: "www.edyprimeimoveis.com.br" }), "https://esantoscorretor.com.br"))
      .toBe("https://esantoscorretor.com.br");
    expect(isPublicSiteHostname(new URL(PUBLIC_SITE_URL).hostname)).toBe(true);
  });

  test("fontes públicas não têm URLs absolutas de marca divergentes ou hardcoded", () => {
    const webRoot = fileURLToPath(new URL("../../../", import.meta.url));
    const html = readFileSync(join(webRoot, "index.html"), "utf8");
    expect(html).toContain("__PUBLIC_SITE_URL__");
    const sourceRoot = join(webRoot, "src");
    const visit = (directory: string) => {
      for (const item of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, item.name);
        if (item.isDirectory()) visit(path);
        else if (/\.[cm]?[jt]sx?$/.test(item.name) && !/\.test\.[jt]sx?$/.test(item.name) && item.name !== "public-site-url.ts") {
          expect(readFileSync(path, "utf8"), path)
            .not.toMatch(/https?:\/\/(?:www\.)?(?:edyprimeimoveis|esantoscorretor)\.com\.br/i);
        }
      }
    };
    visit(sourceRoot);
  });
});
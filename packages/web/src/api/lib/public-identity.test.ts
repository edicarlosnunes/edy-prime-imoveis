import { describe, expect, test } from "bun:test";
import { previewPublicSiteContent, publicBrandText } from "./public-identity";

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
    expect(result.seo.ogImageUrl).toBe("https://esantoscorretor.com.br/og-esantos.png");
    expect(old.company.name).toBe("Edy Prime");
    expect(old.theme.logoUrl).toBe("/api/media/old");
  });

  test("não substitui identificadores e contatos técnicos", () => {
    expect(publicBrandText("Olá, aqui é da Edy Prime Imóveis.")).toBe("Olá, aqui é da E. Santos.");
    expect(publicBrandText("edyprimeimoveis@gmail.com")).toBe("edyprimeimoveis@gmail.com");
    expect(publicBrandText("Veja https://www.edyprimeimoveis.com.br/imovel/123")).toBe(
      "Veja https://esantoscorretor.com.br/imovel/123",
    );
  });
});
import { describe, expect, it } from "bun:test";
import { defaultSiteContent, type SiteContent } from "./site-content";
import {
  NEW_HERO_ACCENT,
  NEW_HERO_SUBTITLE,
  NEW_HERO_TITLE,
  NEW_SHOWCASE_SUBTITLE,
  NEW_SHOWCASE_TITLE,
  upgradeSiteCopy,
} from "./site-copy";

function clone(): SiteContent {
  return JSON.parse(JSON.stringify(defaultSiteContent)) as SiteContent;
}

/** Conteúdo publicado no banco em 21/08/2026 (textos legados). */
function legacy(): SiteContent {
  const content = clone();
  content.hero.title = "O imóvel certo\nà beira-mar,";
  content.hero.titleAccent = "sem labirinto.";
  content.hero.subtitle =
    "Curadoria pessoal de apartamentos e coberturas em Praia Grande. Você me diz o que procura, eu filtro o mercado e apresento só o que vale a sua visita — com segurança jurídica e negociação conduzida por quem mora aqui.";
  content.hero.assurances = [
    { id: "a1", text: "Documentação e negociação acompanhadas do início ao fim" },
    { id: "a2", text: "Atuação em toda a orla de Praia Grande e região" },
    { id: "a3", text: "Resposta no mesmo dia, em horário comercial" },
  ];
  content.sections.imoveis.title = "Imóveis que já passaram\npelo meu filtro";
  content.sections.imoveis.subtitle = "";
  return content;
}

describe("upgradeSiteCopy", () => {
  it("troca o título legado do hero pelo texto novo", () => {
    const out = upgradeSiteCopy(legacy());
    expect(out.hero.title).toBe(NEW_HERO_TITLE);
    expect(out.hero.titleAccent).toBe(NEW_HERO_ACCENT);
    expect(out.hero.subtitle).toBe(NEW_HERO_SUBTITLE);
  });

  it("transforma as garantias longas em benefícios curtos, na ordem certa", () => {
    const out = upgradeSiteCopy(legacy());
    expect(out.hero.assurances.map((item) => item.text)).toEqual([
      "Especialista no litoral",
      "Imóveis selecionados",
      "Atendimento humano e ágil",
    ]);
  });

  it("atualiza o cabeçalho da vitrine", () => {
    const out = upgradeSiteCopy(legacy());
    expect(out.sections.imoveis.title).toBe(NEW_SHOWCASE_TITLE);
    expect(out.sections.imoveis.subtitle).toBe(NEW_SHOWCASE_SUBTITLE);
  });

  it("preserva texto editado no painel (nada é sobrescrito)", () => {
    const content = legacy();
    content.hero.title = "Meu título escrito no editor";
    content.hero.titleAccent = "com destaque próprio";
    content.hero.subtitle = "Subtítulo autoral.";
    content.sections.imoveis.title = "Meus destaques";
    const out = upgradeSiteCopy(content);
    expect(out.hero.title).toBe("Meu título escrito no editor");
    expect(out.hero.titleAccent).toBe("com destaque próprio");
    expect(out.hero.subtitle).toBe("Subtítulo autoral.");
    expect(out.sections.imoveis.title).toBe("Meus destaques");
    expect(out.sections.imoveis.subtitle).toBe("");
  });

  it("não mexe no subtítulo da vitrine quando já existe um", () => {
    const content = legacy();
    content.sections.imoveis.subtitle = "Meu subtítulo.";
    const out = upgradeSiteCopy(content);
    expect(out.sections.imoveis.title).toBe(NEW_SHOWCASE_TITLE);
    expect(out.sections.imoveis.subtitle).toBe("Meu subtítulo.");
  });

  it("mantém garantias personalizadas intactas e sem reordenar", () => {
    const content = legacy();
    content.hero.assurances = [
      { id: "a1", text: "Garantia minha 1" },
      { id: "a2", text: "Atuação em toda a orla de Praia Grande e região" },
    ];
    const out = upgradeSiteCopy(content);
    expect(out.hero.assurances.map((item) => item.text)).toEqual([
      "Garantia minha 1",
      "Especialista no litoral",
    ]);
  });

  it("não altera empresa, tema, menu nem demais seções", () => {
    const content = legacy();
    const out = upgradeSiteCopy(content);
    expect(out.company).toEqual(content.company);
    expect(out.theme).toEqual(content.theme);
    expect(out.menu).toEqual(content.menu);
    expect(out.sections.diferenciais).toEqual(content.sections.diferenciais);
    expect(out.sections.contato).toEqual(content.sections.contato);
  });

  it("é idempotente", () => {
    const once = upgradeSiteCopy(legacy());
    const twice = upgradeSiteCopy(once);
    expect(twice).toEqual(once);
  });
});

import type { SiteContent } from "./site-content";

/* ------------------------------------------------------------------ *
 * Atualização dos textos legados da Home.
 *
 * O conteúdo da Home vem do Editor do Site (/admin/editor) e fica salvo
 * no banco: o que está publicado SEMPRE vence os padrões do código. Por
 * isso trocar o padrão em `site-content.ts` não muda o site enquanto o
 * texto antigo continuar publicado.
 *
 * Este módulo faz uma única coisa: quando o texto publicado é EXATAMENTE
 * uma das strings antigas conhecidas, mostra a versão nova aprovada.
 * Qualquer texto diferente (inclusive uma edição futura feita no painel)
 * passa intacto — ou seja, o Editor do Site continua no comando e nada é
 * gravado no banco.
 * ------------------------------------------------------------------ */

/** Título do hero publicado até 21/08/2026. */
const LEGACY_HERO_TITLE = "O imóvel certo\nà beira-mar,";
const LEGACY_HERO_ACCENT = "sem labirinto.";
const LEGACY_HERO_SUBTITLE =
  "Curadoria pessoal de apartamentos e coberturas em Praia Grande. Você me diz o que procura, eu filtro o mercado e apresento só o que vale a sua visita — com segurança jurídica e negociação conduzida por quem mora aqui.";
const LEGACY_SHOWCASE_TITLE = "Imóveis que já passaram\npelo meu filtro";

export const NEW_HERO_TITLE = "Seu próximo imóvel\nno litoral";
export const NEW_HERO_ACCENT = "começa aqui.";
export const NEW_HERO_SUBTITLE =
  "Seleção de imóveis em Praia Grande e região, com atendimento personalizado e segurança em cada negociação.";
export const NEW_SHOWCASE_EYEBROW = "Seleção da semana";
export const NEW_SHOWCASE_TITLE = "Imóveis selecionados para você";
export const NEW_SHOWCASE_SUBTITLE = "Opções escolhidas para facilitar sua busca no litoral.";

/** Benefícios curtos do hero, substituindo as garantias longas antigas. */
const LEGACY_ASSURANCES: Record<string, string> = {
  "Atuação em toda a orla de Praia Grande e região": "Especialista no litoral",
  "Documentação e negociação acompanhadas do início ao fim": "Imóveis selecionados",
  "Resposta no mesmo dia, em horário comercial": "Atendimento humano e ágil",
};

/** Ordem de exibição dos benefícios curtos (o resto mantém a ordem do CMS). */
const BENEFIT_ORDER = [
  "Especialista no litoral",
  "Imóveis selecionados",
  "Atendimento humano e ágil",
];

function swap(current: string, legacy: string, next: string) {
  return current === legacy ? next : current;
}

export function upgradeSiteCopy(content: SiteContent): SiteContent {
  const hero = content.hero;
  const showcase = content.sections.imoveis;

  const heroTitle = swap(hero.title, LEGACY_HERO_TITLE, NEW_HERO_TITLE);
  const heroAccent = swap(hero.titleAccent, LEGACY_HERO_ACCENT, NEW_HERO_ACCENT);
  const heroSubtitle = swap(hero.subtitle, LEGACY_HERO_SUBTITLE, NEW_HERO_SUBTITLE);

  const assurances = hero.assurances.map((item) => {
    const next = LEGACY_ASSURANCES[item.text.trim()];
    return next ? { ...item, text: next } : item;
  });
  const upgradedBenefits = assurances.every((item) => BENEFIT_ORDER.includes(item.text));
  const orderedAssurances = upgradedBenefits
    ? [...assurances].sort((a, b) => BENEFIT_ORDER.indexOf(a.text) - BENEFIT_ORDER.indexOf(b.text))
    : assurances;

  const showcaseUpgraded = showcase.title === LEGACY_SHOWCASE_TITLE;
  const showcaseTitle = showcaseUpgraded ? NEW_SHOWCASE_TITLE : showcase.title;
  /* Só preenche o subtítulo quando o título antigo foi trocado agora: assim
     um subtítulo vazio escolhido no painel continua vazio. */
  const showcaseSubtitle =
    showcaseUpgraded && !showcase.subtitle.trim() ? NEW_SHOWCASE_SUBTITLE : showcase.subtitle;

  return {
    ...content,
    hero: {
      ...hero,
      title: heroTitle,
      titleAccent: heroAccent,
      subtitle: heroSubtitle,
      assurances: orderedAssurances,
    },
    sections: {
      ...content.sections,
      imoveis: {
        ...showcase,
        title: showcaseTitle,
        subtitle: showcaseSubtitle,
      },
    },
  };
}

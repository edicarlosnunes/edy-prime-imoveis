/**
 * Identificação jurídica da marca — informação legal, não editável pelo CMS.
 *
 * Fica fora do Editor do Site de propósito: é o vínculo público entre a marca
 * "Edy Prime Imóveis" e a pessoa jurídica que a administra, e não deve poder
 * ser apagado por engano em uma edição de conteúdo. Mesmo critério das
 * credenciais fixas (`site.creci`, `CNAI`).
 */

export const legalEntity = {
  name: "EDY BOA SORTE LTDA",
  cnpj: "54.312.317/0001-92",
} as const;

/** Frase usada no rodapé de todas as páginas. */
export const LEGAL_ENTITY_NOTICE = `Edy Prime Imóveis é uma marca administrada por ${legalEntity.name} — CNPJ ${legalEntity.cnpj}.`;

/** Versão institucional, usada na seção Sobre. */
export const LEGAL_ENTITY_ABOUT = `A marca Edy Prime Imóveis é administrada pela empresa ${legalEntity.name}, inscrita no CNPJ sob nº ${legalEntity.cnpj}.`;

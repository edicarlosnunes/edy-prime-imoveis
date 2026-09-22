/**
 * Catálogo de documentação inteligente do cadastro de imóveis (V2).
 *
 * PONTO ÚNICO DE EDIÇÃO: alterar as perguntas do checklist ou as categorias
 * de upload aqui — nada de schema, API ou UI precisa mudar junto. As chaves
 * (`key`) são gravadas em `property_checklist.item_key`; mudar uma chave já
 * usada em produção cria um item novo em vez de renomear o antigo.
 */

/* ------------------------------------------------------------- respostas */

export const CHECKLIST_ANSWERS = ["sim", "nao", "nao_sabe", "na"] as const;
export type ChecklistAnswer = (typeof CHECKLIST_ANSWERS)[number];

export const CHECKLIST_ANSWER_LABEL: Record<ChecklistAnswer, string> = {
  sim: "SIM",
  nao: "NÃO",
  nao_sabe: "NÃO SABE",
  na: "N/A",
};

/* --------------------------------------------------------------- blocos */

/**
 * Blocos condicionais. `sempre` aparece para todo imóvel; os demais só quando
 * a condição correspondente estiver ligada (ver `visibleBlocks`).
 */
export const CHECKLIST_BLOCKS = [
  "sempre",
  "heranca",
  "posse",
  "financiamento",
  "aluguel",
  "condominio",
] as const;
export type ChecklistBlock = (typeof CHECKLIST_BLOCKS)[number];

export const CHECKLIST_BLOCK_LABEL: Record<ChecklistBlock, string> = {
  sempre: "Documentação base",
  heranca: "Herança / inventário",
  posse: "Posse / cessão de direitos",
  financiamento: "Financiamento / alienação",
  aluguel: "Ocupação / locação",
  condominio: "Condomínio",
};

/* ------------------------------------------------------------ checklist */

export type ChecklistItem = {
  key: string;
  label: string;
  block: ChecklistBlock;
  /** Texto de apoio para a corretora — aparece abaixo da pergunta. */
  hint?: string;
  /** Resposta que indica pendência documental (destaque visual). */
  alertOn?: ChecklistAnswer[];
};

export const CHECKLIST_ITEMS: ChecklistItem[] = [
  /* ---------------------------------------------------------- base */
  {
    key: "matricula_disponivel",
    label: "Matrícula disponível e atualizada?",
    block: "sempre",
    hint: "Atualizada = emitida há menos de 30 dias.",
    alertOn: ["nao", "nao_sabe"],
  },
  {
    key: "vendedor_e_proprietario",
    label: "O vendedor consta como proprietário na matrícula?",
    block: "sempre",
    alertOn: ["nao", "nao_sabe"],
  },
  {
    key: "multiplos_proprietarios",
    label: "Há múltiplos proprietários?",
    block: "sempre",
    hint: "Se SIM, todos precisam assinar. Cônjuge também.",
  },
  {
    key: "escritura_titulo",
    label: "Possui escritura / título de propriedade?",
    block: "sempre",
    alertOn: ["nao", "nao_sabe"],
  },
  {
    key: "usufruto",
    label: "Existe usufruto sobre o imóvel?",
    block: "sempre",
    alertOn: ["sim"],
  },
  {
    key: "penhora_onus",
    label: "Existe penhora, ônus ou restrição?",
    block: "sempre",
    alertOn: ["sim", "nao_sabe"],
  },
  {
    key: "iptu_regular",
    label: "IPTU está em dia?",
    block: "sempre",
    alertOn: ["nao", "nao_sabe"],
  },
  {
    key: "averbacao_construcao",
    label: "A construção está averbada na matrícula?",
    block: "sempre",
    alertOn: ["nao", "nao_sabe"],
  },
  {
    key: "habite_se",
    label: "Possui habite-se? (quando aplicável)",
    block: "sempre",
  },
  {
    key: "procuracao",
    label: "A venda será feita por procuração?",
    block: "sempre",
    hint: "Se SIM, verificar poderes específicos para alienar.",
  },
  {
    key: "certidoes",
    label: "Certidões e demais documentos foram levantados?",
    block: "sempre",
    alertOn: ["nao"],
  },

  /* ------------------------------------------------------- herança */
  {
    key: "heranca_inventario",
    label: "Há inventário / espólio envolvido?",
    block: "heranca",
    alertOn: ["sim"],
  },
  {
    key: "heranca_inventario_concluido",
    label: "O inventário já foi concluído?",
    block: "heranca",
    alertOn: ["nao", "nao_sabe"],
  },
  {
    key: "heranca_herdeiros_acordo",
    label: "Todos os herdeiros estão de acordo com a venda?",
    block: "heranca",
    alertOn: ["nao", "nao_sabe"],
  },

  /* --------------------------------------------------------- posse */
  {
    key: "posse_cessao_direitos",
    label: "A negociação é de posse / cessão de direitos?",
    block: "posse",
    alertOn: ["sim"],
  },
  {
    key: "posse_contrato_particular",
    label: "Existe contrato particular de compra e venda?",
    block: "posse",
  },

  /* ------------------------------------------------- financiamento */
  {
    key: "financiamento_ativo",
    label: "Existe financiamento ativo sobre o imóvel?",
    block: "financiamento",
    alertOn: ["sim"],
  },
  {
    key: "alienacao_fiduciaria",
    label: "Há alienação fiduciária registrada?",
    block: "financiamento",
    alertOn: ["sim"],
  },
  {
    key: "financiamento_saldo_conhecido",
    label: "O saldo devedor é conhecido?",
    block: "financiamento",
    alertOn: ["nao", "nao_sabe"],
  },

  /* ------------------------------------------------------- aluguel */
  {
    key: "imovel_ocupado",
    label: "O imóvel está ocupado ou alugado?",
    block: "aluguel",
  },
  {
    key: "contrato_locacao",
    label: "Existe contrato de locação vigente?",
    block: "aluguel",
    hint: "Verificar prazo, multa e cláusula de venda.",
  },

  /* ---------------------------------------------------- condomínio */
  {
    key: "condominio_documentacao",
    label: "A documentação condominial está disponível?",
    block: "condominio",
    alertOn: ["nao", "nao_sabe"],
  },
  {
    key: "condominio_em_dia",
    label: "As taxas de condomínio estão em dia?",
    block: "condominio",
    alertOn: ["nao", "nao_sabe"],
  },
];

/* ------------------------------------------------------------ documentos */

export const DOC_CATEGORIES = [
  "matricula",
  "iptu",
  "escritura",
  "condominio",
  "inventario",
  "procuracao",
  "contrato",
  "certidao",
  "planta_habite_se",
  "outros",
] as const;
export type DocCategory = (typeof DOC_CATEGORIES)[number];

export const DOC_CATEGORY_LABEL: Record<DocCategory, string> = {
  matricula: "Matrícula",
  iptu: "IPTU",
  escritura: "Escritura / Título",
  condominio: "Condomínio",
  inventario: "Inventário",
  procuracao: "Procuração",
  contrato: "Contrato",
  certidao: "Certidão",
  planta_habite_se: "Planta / Habite-se",
  outros: "Outros",
};

/**
 * Fluxo do documento. RECEBIDO não significa REGULAR: o arquivo chega,
 * entra na fila de análise e só depois é classificado.
 */
export const DOC_STATUSES = [
  "recebido",
  "aguardando_analise",
  "analisado",
  "regular",
  "pendencia",
] as const;
export type DocStatus = (typeof DOC_STATUSES)[number];

export const DOC_STATUS_LABEL: Record<DocStatus, string> = {
  recebido: "RECEBIDO",
  aguardando_analise: "AGUARDANDO ANÁLISE",
  analisado: "ANALISADO",
  regular: "REGULAR",
  pendencia: "PENDÊNCIA",
};

/** Só estes dois encerram a análise. `regular` é o único desfecho saudável. */
export const DOC_TERMINAL_STATUSES: DocStatus[] = ["regular", "pendencia"];

/* -------------------------------------------------------------- helpers */

export type BlockConditions = {
  /** Pergunta independente: o imóvel pertence a condomínio? */
  inCondominium: boolean;
  heranca: boolean;
  posse: boolean;
  financiamento: boolean;
  aluguel: boolean;
};

/**
 * Blocos visíveis para o imóvel. Casa comum fora de condomínio nunca mostra
 * o bloco de condomínio; a decisão vem SÓ da pergunta independente, nunca
 * inferida do tipo do imóvel.
 */
export function visibleBlocks(conditions: BlockConditions): ChecklistBlock[] {
  const blocks: ChecklistBlock[] = ["sempre"];
  if (conditions.heranca) blocks.push("heranca");
  if (conditions.posse) blocks.push("posse");
  if (conditions.financiamento) blocks.push("financiamento");
  if (conditions.aluguel) blocks.push("aluguel");
  if (conditions.inCondominium) blocks.push("condominio");
  return blocks;
}

/** Itens do checklist que devem aparecer, na ordem do catálogo. */
export function visibleChecklistItems(conditions: BlockConditions): ChecklistItem[] {
  const blocks = new Set(visibleBlocks(conditions));
  return CHECKLIST_ITEMS.filter((item) => blocks.has(item.block));
}

/** Itens visíveis cuja resposta indica pendência documental. */
export function checklistAlerts(
  conditions: BlockConditions,
  answers: Record<string, ChecklistAnswer | undefined>,
): ChecklistItem[] {
  return visibleChecklistItems(conditions).filter((item) => {
    const answer = answers[item.key];
    if (!answer || !item.alertOn) return false;
    return item.alertOn.includes(answer);
  });
}

/**
 * Resumo documental. `recebidos` conta arquivos que chegaram; `regulares`
 * conta os efetivamente aprovados — os dois números são propositalmente
 * separados para não confundir recebido com regular.
 */
export function documentSummary(docs: { status: DocStatus; hasFile: boolean }[]) {
  return {
    total: docs.length,
    comArquivo: docs.filter((d) => d.hasFile).length,
    recebidos: docs.filter((d) => d.status === "recebido").length,
    emAnalise: docs.filter(
      (d) => d.status === "aguardando_analise" || d.status === "analisado",
    ).length,
    regulares: docs.filter((d) => d.status === "regular").length,
    pendencias: docs.filter((d) => d.status === "pendencia").length,
  };
}

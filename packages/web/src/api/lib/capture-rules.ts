/**
 * Regras do funil do Radar de Captação.
 *
 * Módulo puro de propósito: nenhuma dependência de banco, oRPC ou request.
 * Assim as invariantes do funil (ordem das etapas, avaliação obrigatória,
 * CAPTADO só por conversão) são testáveis sem escrever uma linha no banco.
 * Os handlers em `routes/admin-captures.ts` só traduzem o resultado em ORPCError.
 */

/** Etapas do funil, na ordem obrigatória. `perdido` fica fora da ordem. */
export const CAPTURE_STAGES = ["novo_contato", "avaliacao", "documentacao", "captado", "perdido"] as const;
export type CaptureStage = (typeof CAPTURE_STAGES)[number];

/** Sequência obrigatória: NOVO CONTATO -> AVALIAÇÃO -> DOCUMENTAÇÃO -> CAPTADO. */
export const STAGE_ORDER: CaptureStage[] = ["novo_contato", "avaliacao", "documentacao", "captado"];

export const STAGE_LABELS: Record<CaptureStage, string> = {
  novo_contato: "NOVO CONTATO",
  avaliacao: "AVALIAÇÃO",
  documentacao: "DOCUMENTAÇÃO",
  captado: "CAPTADO",
  perdido: "PERDIDO",
};

/**
 * Status de documentação aceitos na entrada.
 *
 * `pendente` é legado: registros antigos foram gravados com ele antes de
 * `solicitado` existir. Continua aceito na leitura e na escrita para não
 * quebrar linha nenhuma, e é tratado como equivalente a `solicitado`.
 * Fluxos novos usam `solicitado`.
 */
export const DOC_STATUSES = ["nao_iniciado", "solicitado", "parcial", "completo", "pendente"] as const;
export type DocStatus = (typeof DOC_STATUSES)[number];

/** Status canônico do legado: `pendente` é lido como `solicitado`. */
export function normalizeDocStatus(raw: string | null | undefined): Exclude<DocStatus, "pendente"> {
  if (raw === "pendente" || raw === "solicitado") return "solicitado";
  if (raw === "parcial") return "parcial";
  if (raw === "completo") return "completo";
  return "nao_iniciado";
}

/** Documentação fechada é o único estado que libera a conversão em imóvel. */
export function isDocComplete(raw: string | null | undefined): boolean {
  return normalizeDocStatus(raw) === "completo";
}

/**
 * Avaliação registrada = valor estimado presente e maior que zero.
 *
 * `appraisalStatus` não entra na conta de propósito: o que trava o avanço para
 * DOCUMENTAÇÃO é o número, e é ele que o usuário digita em "Registrar avaliação".
 */
export function hasValidAppraisal(capture: { estimatedPrice: number | null | undefined }): boolean {
  const value = capture.estimatedPrice;
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

const stageIndex = (stage: string): number => STAGE_ORDER.indexOf(stage as CaptureStage);

export type RuleFailure = { ok: false; code: "BAD_REQUEST" | "FORBIDDEN" | "CONFLICT"; message: string };
export type RuleResult = { ok: true } | RuleFailure;

const deny = (code: RuleFailure["code"], message: string): RuleFailure => ({ ok: false, code, message });

/**
 * Valida uma mudança de etapa pedida pelo painel.
 *
 * Só decide "pode ou não pode" — não sabe nada de banco. Quem chama já tratou
 * o caso `from === to` (reclique), que não é transição e não gera histórico.
 */
export function checkStageTransition(input: {
  from: string;
  to: CaptureStage;
  estimatedPrice: number | null | undefined;
  convertedPropertyId: number | null | undefined;
}): RuleResult {
  const { from, to } = input;

  // CAPTADO nunca é manual: quem grava é a conversão, depois do imóvel existir.
  if (to === "captado") {
    return deny("FORBIDDEN", "CAPTADO não é manual: use \"Vincular imóvel e captar\" para criar o imóvel e concluir a captação");
  }

  // Uma captação convertida é terminal. Voltar atrás exigiria desfazer o vínculo.
  if (from === "captado" || input.convertedPropertyId != null) {
    return deny("CONFLICT", "Esta captação já foi captada e vinculada a um imóvel");
  }

  // De PERDIDO só se sai pelo botão Reabrir, que devolve a captação ao início.
  if (from === "perdido") {
    return deny("CONFLICT", "Captação perdida: use \"Reabrir\" para voltar ao funil");
  }

  // Perder é permitido a partir de qualquer etapa ativa — não é pular o funil.
  if (to === "perdido") return { ok: true };

  const fromIdx = stageIndex(from);
  const toIdx = stageIndex(to);
  if (fromIdx === -1 || toIdx === -1) {
    return deny("BAD_REQUEST", "Etapa inválida");
  }

  // Retroceder é correção de operação, sempre liberado entre etapas ativas.
  if (toIdx < fromIdx) return { ok: true };

  // Avançar é de um em um: nada de NOVO CONTATO direto para DOCUMENTAÇÃO.
  if (toIdx - fromIdx > 1) {
    return deny(
      "FORBIDDEN",
      `Não é possível pular etapas: siga ${STAGE_LABELS[STAGE_ORDER[fromIdx] as CaptureStage]} → ${STAGE_LABELS[STAGE_ORDER[fromIdx + 1] as CaptureStage]}`,
    );
  }

  // DOCUMENTAÇÃO exige avaliação registrada.
  if (to === "documentacao" && !hasValidAppraisal(input)) {
    return deny("FORBIDDEN", "Registre a avaliação (valor estimado) antes de avançar para DOCUMENTAÇÃO");
  }

  return { ok: true };
}

/**
 * Valida a conversão da captação em imóvel.
 *
 * Vale para o momento em que o PropertyForm devolve o id do imóvel criado.
 * `already` sinaliza reentrada idempotente: mesma captação, mesmo imóvel.
 */
export function checkConversion(input: {
  stage: string;
  docStatus: string | null | undefined;
  estimatedPrice: number | null | undefined;
  convertedPropertyId: number | null | undefined;
  propertyId: number;
}): RuleResult | { ok: true; already: true } {
  if (input.convertedPropertyId != null) {
    if (input.convertedPropertyId === input.propertyId) return { ok: true, already: true };
    return deny("CONFLICT", "Esta captação já foi convertida em outro imóvel");
  }
  if (input.stage === "perdido") {
    return deny("CONFLICT", "Captação perdida: use \"Reabrir\" antes de captar");
  }
  if (!hasValidAppraisal(input)) {
    return deny("FORBIDDEN", "Registre a avaliação (valor estimado) antes de captar");
  }
  if (input.stage !== "documentacao") {
    return deny("FORBIDDEN", "A captação precisa estar em DOCUMENTAÇÃO para ser captada");
  }
  if (!isDocComplete(input.docStatus)) {
    return deny("FORBIDDEN", "Conclua a documentação (status COMPLETO) antes de captar");
  }
  return { ok: true };
}

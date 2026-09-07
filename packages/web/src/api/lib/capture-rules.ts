/**
 * Regras do funil do Radar de Captação.
 *
 * Módulo puro de propósito: nenhuma dependência de banco, oRPC ou request.
 * Assim as invariantes do funil (ordem das etapas, documentação obrigatória,
 * preço validado dentro de VALIDAÇÃO, CAPTADO só por conversão) são testáveis
 * sem escrever uma linha no banco. Os handlers em `routes/admin-captures.ts`
 * só traduzem o resultado em ORPCError.
 *
 * FLUXO V3: NOVO CONTATO -> DOCUMENTAÇÃO -> VALIDAÇÃO -> CAPTADO.
 *
 * AVALIAÇÃO deixou de ser etapa independente: o preço/avaliação passou a viver
 * dentro de VALIDAÇÃO. Captações antigas gravadas com `avaliacao` continuam no
 * banco com esse valor — a compatibilidade é SOMENTE NA LEITURA, via
 * `normalizeStage`, que as exibe como DOCUMENTAÇÃO. Nenhum UPDATE em massa é
 * feito, nenhum histórico antigo é reescrito.
 */

/** Etapas canônicas do funil. `perdido` fica fora da ordem. */
export const CAPTURE_STAGES = ["novo_contato", "documentacao", "validacao", "captado", "perdido"] as const;
export type CaptureStage = (typeof CAPTURE_STAGES)[number];

/**
 * Etapa legada aceita na entrada.
 *
 * Não é gravada por fluxo novo nenhum. Fica aceita para que uma aba antiga do
 * navegador (bundle velho em cache) não tome erro de validação, e para que
 * linhas antigas possam ser reenviadas sem quebrar.
 */
export const LEGACY_STAGE = "avaliacao";

/** Valores aceitos na entrada de `setStage`: canônicos + legado. */
export const STAGE_INPUTS = [...CAPTURE_STAGES, LEGACY_STAGE] as const;
export type StageInput = (typeof STAGE_INPUTS)[number];

/** Sequência obrigatória: NOVO CONTATO -> DOCUMENTAÇÃO -> VALIDAÇÃO -> CAPTADO. */
export const STAGE_ORDER: CaptureStage[] = ["novo_contato", "documentacao", "validacao", "captado"];

export const STAGE_LABELS: Record<CaptureStage, string> = {
  novo_contato: "NOVO CONTATO",
  documentacao: "DOCUMENTAÇÃO",
  validacao: "VALIDAÇÃO",
  captado: "CAPTADO",
  perdido: "PERDIDO",
};

/**
 * Etapa canônica de um valor gravado no banco.
 *
 * `avaliacao` (legado) é lido como DOCUMENTAÇÃO. Valor desconhecido devolve
 * null para que quem chama decida — a UI cai em NOVO CONTATO, as regras negam.
 */
export function normalizeStage(raw: string | null | undefined): CaptureStage | null {
  if (raw === LEGACY_STAGE) return "documentacao";
  if (typeof raw === "string" && (CAPTURE_STAGES as readonly string[]).includes(raw)) {
    return raw as CaptureStage;
  }
  return null;
}

/** Rótulo de tela de qualquer valor gravado, inclusive legado. */
export function stageLabel(raw: string | null | undefined): string {
  const stage = normalizeStage(raw);
  return stage ? STAGE_LABELS[stage] : String(raw ?? "—");
}

/**
 * Status de documentação aceitos na entrada.
 *
 * `pendente` é legado: registros antigos foram gravados com ele antes de
 * `solicitado` existir. Continua aceito na leitura e na escrita para não
 * quebrar linha nenhuma, e é tratado como equivalente a `solicitado`.
 * Fluxos novos usam `solicitado`.
 *
 * `validado_pela_equipe` cobre o proprietário que não faz upload: a equipe
 * confere a documentação por WhatsApp/telefone/e-mail e registra a validação
 * com usuário, data e observação — sem criar upload falso de documento
 * inexistente.
 */
export const DOC_STATUSES = [
  "nao_iniciado",
  "solicitado",
  "parcial",
  "completo",
  "validado_pela_equipe",
  "pendente",
] as const;
export type DocStatus = (typeof DOC_STATUSES)[number];
export type CanonicalDocStatus = Exclude<DocStatus, "pendente">;

/** Status canônico do legado: `pendente` é lido como `solicitado`. */
export function normalizeDocStatus(raw: string | null | undefined): CanonicalDocStatus {
  if (raw === "pendente" || raw === "solicitado") return "solicitado";
  if (raw === "parcial") return "parcial";
  if (raw === "completo") return "completo";
  if (raw === "validado_pela_equipe") return "validado_pela_equipe";
  return "nao_iniciado";
}

/** A equipe validou por outro meio, sem upload do proprietário. */
export function isDocValidatedByTeam(raw: string | null | undefined): boolean {
  return normalizeDocStatus(raw) === "validado_pela_equipe";
}

/**
 * Documentação fechada = COMPLETO ou VALIDADA PELA EQUIPE.
 *
 * É o que libera o avanço para VALIDAÇÃO e, mais adiante, a conversão.
 */
export function isDocComplete(raw: string | null | undefined): boolean {
  const status = normalizeDocStatus(raw);
  return status === "completo" || status === "validado_pela_equipe";
}

/**
 * Avaliação registrada = valor estimado presente e maior que zero.
 *
 * `appraisalStatus` não entra na conta de propósito: o que trava a conversão é
 * o número, e é ele que o usuário digita em "Registrar avaliação" — agora
 * dentro de VALIDAÇÃO.
 */
export function hasValidAppraisal(capture: { estimatedPrice: number | null | undefined }): boolean {
  const value = capture.estimatedPrice;
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

const stageIndex = (stage: string | null): number =>
  stage === null ? -1 : STAGE_ORDER.indexOf(stage as CaptureStage);

export type RuleFailure = { ok: false; code: "BAD_REQUEST" | "FORBIDDEN" | "CONFLICT"; message: string };
export type RuleResult = { ok: true } | RuleFailure;

const deny = (code: RuleFailure["code"], message: string): RuleFailure => ({ ok: false, code, message });

/**
 * Valida uma mudança de etapa pedida pelo painel.
 *
 * Só decide "pode ou não pode" — não sabe nada de banco. Quem chama já tratou
 * o caso `from === to` (reclique), que não é transição e não gera histórico.
 * `from` pode chegar como `avaliacao` (legado) e é lido como DOCUMENTAÇÃO.
 */
export function checkStageTransition(input: {
  from: string;
  to: StageInput;
  docStatus?: string | null | undefined;
  estimatedPrice: number | null | undefined;
  convertedPropertyId: number | null | undefined;
}): RuleResult {
  const from = normalizeStage(input.from);
  const to = normalizeStage(input.to);

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

  // Avançar é de um em um: nada de NOVO CONTATO direto para VALIDAÇÃO.
  if (toIdx - fromIdx > 1) {
    return deny(
      "FORBIDDEN",
      `Não é possível pular etapas: siga ${STAGE_LABELS[STAGE_ORDER[fromIdx] as CaptureStage]} → ${STAGE_LABELS[STAGE_ORDER[fromIdx + 1] as CaptureStage]}`,
    );
  }

  // VALIDAÇÃO exige documentação fechada (COMPLETO ou VALIDADA PELA EQUIPE).
  if (to === "validacao" && !isDocComplete(input.docStatus)) {
    return deny(
      "FORBIDDEN",
      "Conclua a documentação (status COMPLETO ou DOCUMENTAÇÃO VALIDADA PELA EQUIPE) antes de avançar para VALIDAÇÃO",
    );
  }

  return { ok: true };
}

/**
 * Valida se a captação PODE INICIAR a conversão — antes de abrir o cadastro
 * do imóvel.
 *
 * Mesmas negativas de `checkConversion`, sem o `propertyId` (que ainda não
 * existe). Serve à UI: o botão "Cadastrar imóvel e captar" só fica habilitado
 * quando isto devolve ok, e o formulário aberto por `?capture_id=` recusa o
 * envio quando não devolve. Sem isso o corretor criava um imóvel real e só
 * então tomava o erro do backend, deixando imóvel órfão no banco.
 */
export function checkConversionStart(input: {
  stage: string;
  docStatus: string | null | undefined;
  estimatedPrice: number | null | undefined;
  convertedPropertyId: number | null | undefined;
}): RuleResult {
  const stage = normalizeStage(input.stage);

  if (input.convertedPropertyId != null) {
    return deny("CONFLICT", "Esta captação já foi convertida em outro imóvel");
  }
  if (stage === "perdido") {
    return deny("CONFLICT", "Captação perdida: use \"Reabrir\" antes de captar");
  }
  if (!isDocComplete(input.docStatus)) {
    return deny("FORBIDDEN", "Conclua a documentação (status COMPLETO ou DOCUMENTAÇÃO VALIDADA PELA EQUIPE) antes de captar");
  }
  if (stage !== "validacao") {
    return deny("FORBIDDEN", "A captação precisa estar em VALIDAÇÃO para ser captada");
  }
  if (!hasValidAppraisal(input)) {
    return deny("FORBIDDEN", "Registre o valor avaliado/validado em VALIDAÇÃO antes de captar");
  }
  return { ok: true };
}

/**
 * Valida a conversão da captação em imóvel.
 *
 * Vale para o momento em que o PropertyForm devolve o id do imóvel criado.
 * `already` sinaliza reentrada idempotente: mesma captação, mesmo imóvel —
 * é o que garante histórico único mesmo com duplo clique.
 * Fora desse caso idempotente, delega em `checkConversionStart` para que a
 * regra exista em um lugar só.
 */
export function checkConversion(input: {
  stage: string;
  docStatus: string | null | undefined;
  estimatedPrice: number | null | undefined;
  convertedPropertyId: number | null | undefined;
  propertyId: number;
}): RuleResult | { ok: true; already: true } {
  if (input.convertedPropertyId != null && input.convertedPropertyId === input.propertyId) {
    return { ok: true, already: true };
  }
  return checkConversionStart(input);
}

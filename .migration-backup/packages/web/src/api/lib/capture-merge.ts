/**
 * Salvamento progressivo da ficha de captação (itens 2 e 3 do pedido).
 *
 * Módulo puro: recebe a ficha como está no banco e a ficha que acabou de
 * chegar, e devolve SÓ o que deve ser escrito.
 *
 * A regra é uma só, e é sempre a mesma:
 *
 *   campo vazio recebe valor; campo já preenchido nunca é apagado.
 *
 * É isso que faz a retomada por telefone ser segura. O proprietário que
 * abandonou o cadastro no meio e volta dois dias depois pelo WhatsApp manda a
 * ficha pela metade; sem esta regra, cada retomada sobrescreveria com `null`
 * o que já havia sido informado antes.
 *
 * Valor novo só substitui valor antigo quando o antigo está vazio. Correção
 * de um campo já preenchido é ato deliberado — passa por `overwrite`, que é o
 * que a tela do corretor usa ao editar a ficha.
 */

/** Campos da captação que o salvamento progressivo controla. */
export const MERGEABLE_FIELDS = [
  "city",
  "district",
  "address",
  "cep",
  "street",
  "number",
  "state",
  "complements",
  "unitKey",
  "addressKey",
  "buildingKey",
  "propertyType",
  "askingPrice",
  "intention",
] as const;

export type MergeableField = (typeof MERGEABLE_FIELDS)[number];

/** Ficha parcial, do banco ou do formulário. */
export type CaptureFields = Partial<Record<MergeableField, unknown>>;

/** Vazio é `null`, `undefined`, string em branco e número não positivo. */
export function isBlank(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (typeof value === "number") return !Number.isFinite(value) || value <= 0;
  return false;
}

export type MergeOptions = {
  /**
   * Campos que PODEM sobrescrever valor já preenchido. Usado pela edição
   * manual no CRM, onde apagar/corrigir é a intenção do corretor.
   */
  overwrite?: readonly MergeableField[];
};

export type MergeResult = {
  /** Só os campos que mudam — pronto para o `set` do update. */
  patch: Partial<Record<MergeableField, unknown>>;
  /** Campos preenchidos agora, que estavam vazios. */
  filledNow: MergeableField[];
  /** Campos que chegaram com valor diferente e foram preservados. */
  kept: MergeableField[];
  /** `true` quando há algo para gravar. */
  changed: boolean;
};

/**
 * Mescla a ficha nova sobre a ficha gravada, campo a campo.
 *
 * Nunca devolve um patch que apaga dado. Campo que chega vazio é simplesmente
 * ignorado; campo que chega diferente de um valor já existente é reportado em
 * `kept` para que a tela possa oferecer a correção ao corretor — decisão
 * humana, nunca automática.
 */
export function mergeCaptureFields(
  existing: CaptureFields,
  incoming: CaptureFields,
  options: MergeOptions = {},
): MergeResult {
  const overwrite = new Set(options.overwrite ?? []);
  const patch: Partial<Record<MergeableField, unknown>> = {};
  const filledNow: MergeableField[] = [];
  const kept: MergeableField[] = [];

  for (const field of MERGEABLE_FIELDS) {
    if (!(field in incoming)) continue;
    const next = incoming[field];
    const current = existing[field];

    if (isBlank(next)) continue;

    if (isBlank(current)) {
      patch[field] = next;
      filledNow.push(field);
      continue;
    }

    if (same(current, next)) continue;

    if (overwrite.has(field)) {
      patch[field] = next;
      filledNow.push(field);
      continue;
    }

    /* Já havia valor e o novo é diferente: preserva e reporta. */
    kept.push(field);
  }

  return { patch, filledNow, kept, changed: Object.keys(patch).length > 0 };
}

function same(a: unknown, b: unknown): boolean {
  if (typeof a === "string" && typeof b === "string") return a.trim() === b.trim();
  return a === b;
}

/** Linha de histórico do que a retomada preencheu — item 13 do pedido. */
export function mergeHistoryNote(result: MergeResult, captureId: number): string | null {
  if (!result.filledNow.length && !result.kept.length) return null;
  const parts = [`Retomada do cadastro #${captureId}.`];
  if (result.filledNow.length) parts.push(`Preenchido agora: ${result.filledNow.join(", ")}.`);
  if (result.kept.length) {
    parts.push(`Valor divergente recebido e PRESERVADO (conferir): ${result.kept.join(", ")}.`);
  }
  return parts.join(" ");
}

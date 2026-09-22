/**
 * Serial único do CRM — TIPO-ANO-SEQUENCIAL.
 *
 * Módulo puro: só formata e interpreta serial. Quem reserva o número é
 * `serial-counter.ts`, que fala com o banco. A separação existe para que a
 * regra de formato seja testável sem escrever uma linha.
 *
 * Regras fechadas com o usuário:
 *  - o sequencial é GLOBAL: nunca reinicia por tipo. Dois tipos diferentes
 *    jamais compartilham o mesmo número-base (AP-2026-000123 e CS-2026-000123
 *    não podem coexistir);
 *  - o número-base é único e não reutilizável;
 *  - códigos antigos do CRM (livres, ex.: "1042", "AP101") continuam válidos e
 *    NÃO são renumerados. `isLegacyCode` os reconhece para a busca;
 *  - Ficha Técnica e Autorização HERDAM o serial-base, com prefixo próprio.
 */

/** Prefixo de documento derivado do serial-base do imóvel/captação. */
export const DOC_SERIAL_PREFIXES = { ficha_tecnica: "FC", autorizacao: "AV" } as const;
export type DocSerialKind = keyof typeof DOC_SERIAL_PREFIXES;

/**
 * Mapa estável tipo interno -> prefixo.
 *
 * A chave é o valor gravado no banco (`properties.type` /
 * `property_captures.property_type`), NUNCA o rótulo exibido na interface:
 * renomear "Sala comercial" na tela não pode mudar serial já emitido.
 */
export const TYPE_PREFIXES: Record<string, string> = {
  casa: "CS",
  apartamento: "AP",
  loja: "LJ",
  comercial: "CL",
  sala_comercial: "SL",
  sala: "SL",
  terreno: "TE",
  chacara: "CH",
  studio: "ST",
  cobertura: "CB",
  sobrado: "SB",
  kitnet: "KT",
  galpao: "GP",
  predio: "PR",
  lote: "LT",
  outro: "OT",
};

/** Prefixo de fallback: tipo desconhecido nunca trava a emissão do serial. */
export const FALLBACK_PREFIX = "OT";

/** Todos os prefixos válidos, sem repetição — usado na validação e na busca. */
export const ALL_PREFIXES: string[] = [...new Set(Object.values(TYPE_PREFIXES))];

/**
 * Prefixo de um tipo de imóvel.
 *
 * Tolerante de propósito: acentos, maiúsculas e espaços do texto legado são
 * normalizados antes da consulta, e o que não casar vira OT. Emitir serial não
 * pode falhar por causa de um tipo escrito de forma diferente.
 */
export function serialPrefix(type: string | null | undefined): string {
  const key = String(type ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036F]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return TYPE_PREFIXES[key] ?? FALLBACK_PREFIX;
}

/** Largura fixa do sequencial. 000001 até 999999 dentro do formato. */
export const SERIAL_PAD = 6;

/** Monta o serial-base a partir das partes já resolvidas. */
export function formatSerial(prefix: string, year: number, sequential: number): string {
  if (!Number.isInteger(sequential) || sequential < 1) {
    throw new Error("Sequencial de serial inválido");
  }
  const safePrefix = ALL_PREFIXES.includes(prefix) ? prefix : FALLBACK_PREFIX;
  return `${safePrefix}-${year}-${String(sequential).padStart(SERIAL_PAD, "0")}`;
}

/** Atalho: tipo do imóvel + ano + sequencial já reservado. */
export function buildSerial(type: string | null | undefined, year: number, sequential: number): string {
  return formatSerial(serialPrefix(type), year, sequential);
}

const SERIAL_RE = /^([A-Z]{2})-(\d{4})-(\d{6})$/;
const DOC_SERIAL_RE = /^(FC|AV)-([A-Z]{2})-(\d{4})-(\d{6})$/;

export interface ParsedSerial {
  prefix: string;
  year: number;
  sequential: number;
  /** presente apenas em serial de documento (FC/AV) */
  doc: "FC" | "AV" | null;
  /** serial-base, sem o prefixo de documento */
  base: string;
}

/** Interpreta serial-base ou serial de documento. `null` se não for do padrão novo. */
export function parseSerial(value: string | null | undefined): ParsedSerial | null {
  const raw = String(value ?? "").trim().toUpperCase();

  const doc = DOC_SERIAL_RE.exec(raw);
  if (doc) {
    const base = `${doc[2]}-${doc[3]}-${doc[4]}`;
    return { prefix: doc[2]!, year: Number(doc[3]), sequential: Number(doc[4]), doc: doc[1] as "FC" | "AV", base };
  }

  const plain = SERIAL_RE.exec(raw);
  if (!plain) return null;
  return {
    prefix: plain[1]!,
    year: Number(plain[2]),
    sequential: Number(plain[3]),
    doc: null,
    base: raw,
  };
}

/** `true` para serial no padrão novo (base ou documento). */
export function isSerial(value: string | null | undefined): boolean {
  return parseSerial(value) !== null;
}

/**
 * `true` para código antigo do CRM: qualquer código preenchido que não siga o
 * padrão novo. Serve para a busca aceitar os dois mundos sem renumerar nada.
 */
export function isLegacyCode(value: string | null | undefined): boolean {
  const raw = String(value ?? "").trim();
  return raw.length > 0 && !isSerial(raw);
}

/**
 * Serial do documento a partir do serial-base.
 *
 * FC-AP-2026-000124 / AV-AP-2026-000124. Herda o número-base para que tudo do
 * mesmo imóvel seja rastreável pelo mesmo número — nunca cria sequência nova.
 */
export function documentSerial(kind: DocSerialKind, baseSerial: string): string {
  const parsed = parseSerial(baseSerial);
  if (!parsed) throw new Error(`Serial-base inválido: ${baseSerial}`);
  if (parsed.doc) throw new Error("Serial de documento não pode gerar outro documento");
  return `${DOC_SERIAL_PREFIXES[kind]}-${parsed.base}`;
}

/** Serial-base de um serial de documento (FC-AP-2026-1 -> AP-2026-1). */
export function baseSerialOf(value: string | null | undefined): string | null {
  return parseSerial(value)?.base ?? null;
}

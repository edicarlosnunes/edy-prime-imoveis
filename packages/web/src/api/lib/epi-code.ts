/**
 * CÓDIGO UNIVERSAL EPI — `EPI-1000/09-26`.
 *
 * Módulo PURO: só formata, interpreta e valida. Quem reserva o número é
 * `epi-counter.ts`, que fala com o banco. Mesma separação do serial legado
 * (`capture-serial.ts` / `serial-counter.ts`) e pelo mesmo motivo: a regra de
 * formato tem que ser testável sem escrever uma linha no banco.
 *
 * REGRAS FECHADAS COM O USUÁRIO (não mude sem ele)
 * ------------------------------------------------
 *  - `EPI` = Edy Prime Imóveis. Prefixo fixo, sem variação por tipo de imóvel:
 *    o EPI identifica a FICHA, não a categoria do imóvel;
 *  - a sequência é UNIVERSAL e começa em 1000. Nunca reinicia por mês, por ano,
 *    por tipo ou por origem. `EPI-1000/12-26` é seguido de `EPI-1001/01-27`;
 *  - `MM-AA` é o mês/ano da criação ORIGINAL da ficha, no fuso
 *    America/Sao_Paulo — não é "mês atual" e não é recalculado depois. Ficha
 *    criada em setembro/2026 morre `09-26`, mesmo reaberta em 2030;
 *  - o código NUNCA muda e NUNCA é reutilizado. Permanece em cadastro
 *    incompleto, abandono, cancelamento, pausa, reabertura, reativação, venda,
 *    encerramento e arquivamento (Arquivo Morto);
 *  - o serial legado (`AP-2026-000001`) e o `code` antigo continuam existindo e
 *    NÃO são renumerados: viraram campo interno/histórico. O EPI é o código
 *    oficial exibido no CRM;
 *  - fichas que já existiam ficam SEM EPI (legado) e não consomem número.
 *
 * O EPI é somente leitura em toda a interface. Não existe função de editar ou
 * de "corrigir" EPI aqui de propósito — se existisse, alguém a usaria.
 */

/** Prefixo fixo do código universal. */
export const EPI_PREFIX = "EPI";

/** Primeiro número da sequência universal. */
export const EPI_FIRST_SEQUENCE = 1000;

/** Fuso do negócio. O mês/ano do código sai daqui, nunca do fuso do servidor. */
export const EPI_TIMEZONE = "America/Sao_Paulo";

/* ------------------------------------------------------------- período */

/**
 * Mês/ano (`MM-AA`) de uma data, no fuso America/Sao_Paulo.
 *
 * Por que `Intl` e não `getMonth()`: o servidor pode rodar em UTC. Uma ficha
 * criada em 30/09 às 22h de Brasília é 01/10 em UTC, e o código sairia com o
 * mês errado — justamente na virada, quando ninguém está olhando.
 */
export function epiPeriod(date: Date = new Date()): string {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new Error("Data inválida para o período do EPI");
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: EPI_TIMEZONE,
    year: "2-digit",
    month: "2-digit",
  }).formatToParts(date);
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  const year = parts.find((part) => part.type === "year")?.value ?? "";
  if (month.length !== 2 || year.length !== 2) {
    throw new Error("Não foi possível resolver o período do EPI");
  }
  return `${month}-${year}`;
}

/* -------------------------------------------------------------- formato */

/** Monta o EPI a partir das partes já resolvidas. */
export function formatEpi(sequence: number, period: string): string {
  if (!Number.isInteger(sequence) || sequence < EPI_FIRST_SEQUENCE) {
    throw new Error(`Sequência de EPI inválida: ${sequence}`);
  }
  if (!/^(0[1-9]|1[0-2])-\d{2}$/.test(String(period))) {
    throw new Error(`Período de EPI inválido: ${period}`);
  }
  return `${EPI_PREFIX}-${sequence}/${period}`;
}

/**
 * EPI de uma ficha: número já reservado + data de criação da ficha.
 *
 * `createdAt` é a data de criação ORIGINAL. Passar `new Date()` numa ficha
 * antiga geraria período errado — quem chama tem que passar a data da ficha.
 */
export function buildEpi(sequence: number, createdAt: Date = new Date()): string {
  return formatEpi(sequence, epiPeriod(createdAt));
}

const EPI_RE = /^EPI-(\d{4,})\/(0[1-9]|1[0-2])-(\d{2})$/;

export interface ParsedEpi {
  sequence: number;
  /** `MM-AA`, como aparece no código */
  period: string;
  month: number;
  /** ano com 2 dígitos, exatamente como no código */
  year: number;
  /** código normalizado (maiúsculas, sem espaços) */
  code: string;
}

/** Interpreta um EPI. `null` quando não é um EPI válido. */
export function parseEpi(value: string | null | undefined): ParsedEpi | null {
  const raw = String(value ?? "").trim().toUpperCase().replace(/\s+/g, "");
  const match = EPI_RE.exec(raw);
  if (!match) return null;
  const sequence = Number(match[1]);
  if (!Number.isInteger(sequence) || sequence < EPI_FIRST_SEQUENCE) return null;
  return {
    sequence,
    period: `${match[2]}-${match[3]}`,
    month: Number(match[2]),
    year: Number(match[3]),
    code: `${EPI_PREFIX}-${sequence}/${match[2]}-${match[3]}`,
  };
}

/** `true` para EPI válido. */
export function isEpi(value: string | null | undefined): boolean {
  return parseEpi(value) !== null;
}

/**
 * Normaliza o que o usuário digitou para comparar com o que está no banco.
 * `epi 1000/09-26`, `EPI-1000/09-26 ` e `1000` são aceitos na BUSCA — mas só o
 * formato completo é considerado um EPI válido por `isEpi`.
 */
export function normalizeEpiInput(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/^EPI[-/]?/, "EPI-");
}

/**
 * Termo de busca do CRM: devolve o pedaço que vale procurar em `epi_code`.
 *
 * Aceita o código inteiro (`EPI-1042/09-26`), só o número (`1042`) e o começo
 * (`EPI-10`). Devolve `null` quando o termo claramente não é busca de EPI, para
 * a busca por título/bairro continuar funcionando como sempre.
 */
export function epiSearchTerm(value: string | null | undefined): string | null {
  const raw = normalizeEpiInput(value);
  if (raw.length === 0) return null;
  if (raw.startsWith("EPI-")) {
    const rest = raw.slice(4);
    return rest.length > 0 ? raw : "EPI-";
  }
  /* Só dígitos: pode ser o número da sequência. */
  if (/^\d{1,}$/.test(raw)) return `EPI-${raw}`;
  return null;
}

/** Rótulo de exibição. Ficha legada (sem EPI) mostra o aviso, nunca um código inventado. */
export const EPI_LEGACY_LABEL = "— (legado sem EPI)";

export function epiLabel(value: string | null | undefined): string {
  return parseEpi(value)?.code ?? EPI_LEGACY_LABEL;
}

/**
 * Reserva atômica da sequência UNIVERSAL do EPI.
 *
 * Mesmo desenho de `serial-counter.ts`, e pelo mesmo motivo: o banco é
 * Turso/libSQL por HTTP, onde não há transação interativa confiável. Entre um
 * `SELECT next` e um `UPDATE next = ?` cabe outra requisição — duas fichas
 * criadas no mesmo instante receberiam o MESMO EPI. O EPI é o código
 * permanente do imóvel, impresso em Ficha Técnica e Autorização de Venda:
 * duplicar é inaceitável.
 *
 * A reserva é UM ÚNICO statement, atômico dentro do próprio SQLite:
 *
 *     UPDATE crm_epi_sequence SET next = next + 1 WHERE id = 1 RETURNING next
 *
 * Cinto e suspensório: `properties.epi_code` e `property_captures.epi_code`
 * têm índice UNIQUE. Mesmo que alguém gere EPI por fora deste módulo, o banco
 * recusa a duplicata.
 *
 * NÚMERO USADO NUNCA VOLTA. Se a ficha for abandonada, cancelada, arquivada no
 * Arquivo Morto ou perdida, o número morre com ela — nunca é reciclado.
 */
import { sql } from "drizzle-orm";
import { EPI_FIRST_SEQUENCE, buildEpi } from "./epi-code";

/**
 * Contrato mínimo do banco usado aqui.
 *
 * Declarado em vez de importar `AdminDb` para o teste poder passar um SQLite
 * local em memória e exercitar concorrência de verdade.
 */
export interface EpiDb {
  run: (query: ReturnType<typeof sql>) => Promise<unknown>;
  all: (query: ReturnType<typeof sql>) => Promise<unknown>;
}

/** Linha única do contador. Não existe contador por mês, ano, tipo ou origem. */
export const EPI_COUNTER_ID = 1;

/**
 * Semente do contador.
 *
 * `next` nasce em `EPI_FIRST_SEQUENCE - 1` (999) para a primeira reserva
 * devolver exatamente 1000, como combinado. `INSERT OR IGNORE` é idempotente:
 * chamar mil vezes não zera nada nem atropela quem está reservando.
 */
export async function ensureEpiCounter(db: EpiDb): Promise<void> {
  await db.run(
    sql`INSERT OR IGNORE INTO crm_epi_sequence (id, next) VALUES (${EPI_COUNTER_ID}, ${EPI_FIRST_SEQUENCE - 1})`,
  );
}

/**
 * Lê o `next` devolvido pelo RETURNING.
 *
 * O driver entrega a linha como objeto (`{ next: 1000 }`) ou como array
 * (`[1000]`) dependendo da versão e de ser SQL cru. Aceitar as duas formas é
 * mais barato que descobrir em produção que apostamos na errada.
 */
function readNext(rows: unknown): number | null {
  const list = Array.isArray(rows) ? rows : (rows as { rows?: unknown[] })?.rows;
  const row = Array.isArray(list) ? list[0] : undefined;
  if (row == null) return null;

  const raw = Array.isArray(row)
    ? row[0]
    : typeof row === "object"
      ? (row as Record<string, unknown>).next
      : row;

  const value = Number(raw);
  return Number.isInteger(value) && value >= EPI_FIRST_SEQUENCE ? value : null;
}

/** Reserva o próximo número da sequência universal e devolve o número reservado. */
export async function allocateEpiSequence(db: EpiDb): Promise<number> {
  await ensureEpiCounter(db);

  const rows = await db.all(
    sql`UPDATE crm_epi_sequence SET next = next + 1 WHERE id = ${EPI_COUNTER_ID} RETURNING next`,
  );

  const next = readNext(rows);
  if (next == null) {
    throw new Error("Não foi possível reservar a sequência do código EPI");
  }
  return next;
}

/**
 * Reserva e monta o EPI de uma ficha nova.
 *
 * `createdAt` é a data de criação da ficha — no fluxo normal, agora. O mês/ano
 * do código sai dela e nunca é recalculado depois.
 */
export async function allocateEpiCode(db: EpiDb, createdAt: Date = new Date()): Promise<string> {
  const sequence = await allocateEpiSequence(db);
  return buildEpi(sequence, createdAt);
}

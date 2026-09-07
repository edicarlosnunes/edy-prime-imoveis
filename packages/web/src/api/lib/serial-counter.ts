/**
 * Reserva atômica do sequencial global do serial.
 *
 * Separado de `capture-serial.ts` de propósito: lá fica o formato (puro,
 * testável sem banco); aqui fica a única parte que precisa falar com o banco.
 *
 * POR QUE NÃO É `SELECT` + `UPDATE`
 * ---------------------------------
 * O banco é Turso/libSQL acessado por HTTP. Não há transação interativa
 * confiável: entre um `SELECT next` e o `UPDATE next = ?` cabe outra requisição,
 * e duas captações criadas no mesmo instante receberiam o MESMO serial. Como o
 * serial vai impresso em Ficha Técnica e Autorização de Venda assinadas pelo
 * proprietário, duplicar é inaceitável.
 *
 * A reserva é feita por UM ÚNICO statement, atômico no próprio SQLite:
 *
 *     UPDATE crm_serials SET next = next + 1 WHERE id = 1 RETURNING next
 *
 * Além disso existe índice UNIQUE nas colunas de serial (`properties.serial`,
 * `property_captures.serial`, `crm_documents.serial`): mesmo que alguém gere
 * serial por fora deste módulo, o banco recusa a duplicata. Cinto e suspensório.
 */
import { sql } from "drizzle-orm";
import { buildSerial } from "./capture-serial";

/**
 * Contrato mínimo do banco usado aqui.
 *
 * Declarado em vez de importar `AdminDb` para que o teste possa passar um SQLite
 * local em memória e exercitar concorrência de verdade.
 */
export interface SerialDb {
  run: (query: ReturnType<typeof sql>) => Promise<unknown>;
  all: (query: ReturnType<typeof sql>) => Promise<unknown>;
}

/** Linha única do contador. Não há contador por tipo: o sequencial é GLOBAL. */
export const SERIAL_COUNTER_ID = 1;

/**
 * Garante a linha-semente do contador.
 *
 * `INSERT OR IGNORE` é idempotente: chamar mil vezes não zera nada nem
 * atrapalha quem está reservando. Semente `next = 0` para que a primeira
 * reserva devolva 1 e o primeiro serial seja `000001`.
 */
export async function ensureSerialCounter(db: SerialDb): Promise<void> {
  await db.run(
    sql`INSERT OR IGNORE INTO crm_serials (id, next) VALUES (${SERIAL_COUNTER_ID}, 0)`,
  );
}

/**
 * Extrai o `next` devolvido pelo RETURNING.
 *
 * O driver pode entregar a linha como objeto (`{ next: 7 }`) ou como array
 * (`[7]`) dependendo de versão e de ser SQL cru. Aceita as duas formas em vez de
 * apostar numa — apostar errado aqui só apareceria em produção.
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
  return Number.isInteger(value) && value > 0 ? value : null;
}

/**
 * Reserva o próximo sequencial global e devolve o número reservado.
 *
 * Um número reservado nunca é reaproveitado, mesmo que a captação seja perdida
 * ou cancelada: o serial identifica o documento emitido, não o negócio fechado.
 */
export async function allocateSequential(db: SerialDb): Promise<number> {
  await ensureSerialCounter(db);

  const rows = await db.all(
    sql`UPDATE crm_serials SET next = next + 1 WHERE id = ${SERIAL_COUNTER_ID} RETURNING next`,
  );

  const next = readNext(rows);
  if (next == null) {
    throw new Error("Não foi possível reservar o sequencial do serial");
  }
  return next;
}

/**
 * Reserva e monta o serial-base do imóvel/captação.
 *
 * O ano faz parte do serial, mas NÃO reinicia o sequencial: em 2027 o próximo
 * serial continua de onde 2026 parou (`AP-2027-000842`). Foi a regra fechada
 * com o usuário — sequencial global, nunca reiniciado por tipo nem por ano.
 */
export async function allocateSerial(
  db: SerialDb,
  propertyType: string | null | undefined,
  year: number = new Date().getFullYear(),
): Promise<string> {
  const sequential = await allocateSequential(db);
  return buildSerial(propertyType, year, sequential);
}

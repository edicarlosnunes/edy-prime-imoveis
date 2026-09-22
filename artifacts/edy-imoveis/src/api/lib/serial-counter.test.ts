/**
 * Teste 16 (seção 29 do escopo): concorrência NÃO duplica serial.
 *
 * Roda contra um SQLite local de verdade, em memória — não contra o banco de
 * produção. É o único jeito honesto de testar atomicidade: uma versão simulada
 * do banco passaria com `SELECT` + `UPDATE`, que é justamente o padrão que
 * duplica serial em Turso/libSQL por HTTP.
 */
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "bun:test";
import { allocateSequential, allocateSerial, ensureSerialCounter } from "./serial-counter";
import { parseSerial } from "./capture-serial";

type Db = ReturnType<typeof drizzle>;

let db: Db;

async function freshDb(): Promise<Db> {
  const client = createClient({ url: ":memory:" });
  const instance = drizzle(client);
  await instance.run(
    sql`CREATE TABLE crm_serials (id INTEGER PRIMARY KEY NOT NULL, next INTEGER NOT NULL DEFAULT 0)`,
  );
  return instance;
}

beforeEach(async () => {
  db = await freshDb();
});

describe("semente do contador", () => {
  test("é criada e é idempotente", async () => {
    await ensureSerialCounter(db);
    await ensureSerialCounter(db);
    await ensureSerialCounter(db);

    const rows = await db.all<{ id: number; next: number }>(
      sql`SELECT id, next FROM crm_serials`,
    );
    expect(rows.length).toBe(1);
  });

  test("chamar de novo NÃO zera um contador já usado", async () => {
    /* Zerar reemitiria seriais já impressos em documentos assinados. */
    await allocateSequential(db);
    await allocateSequential(db);
    await ensureSerialCounter(db);

    expect(await allocateSequential(db)).toBe(3);
  });
});

describe("reserva sequencial", () => {
  test("o primeiro serial é 000001", async () => {
    expect(await allocateSequential(db)).toBe(1);
    expect(await allocateSerial(db, "apartamento", 2026)).toBe("AP-2026-000002");
  });

  test("reservas em série não repetem e não pulam", async () => {
    const numeros: number[] = [];
    for (let i = 0; i < 20; i += 1) numeros.push(await allocateSequential(db));

    expect(numeros).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  test("número reservado nunca é reaproveitado", async () => {
    /* Mesmo que a captação seja perdida ou cancelada: o serial identifica o
       documento emitido, não o negócio fechado. */
    const primeiro = await allocateSequential(db);
    const segundo = await allocateSequential(db);

    expect(segundo).toBe(primeiro + 1);
  });
});

/* ---------------------------------------------------------------- teste 16 */
describe("teste 16 — concorrência não duplica serial", () => {
  test("50 reservas simultâneas geram 50 números distintos", async () => {
    const numeros = await Promise.all(
      Array.from({ length: 50 }, () => allocateSequential(db)),
    );

    expect(new Set(numeros).size).toBe(50);
    expect([...numeros].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 50 }, (_, i) => i + 1),
    );
  });

  test("50 seriais simultâneos, tipos misturados, são todos distintos", async () => {
    const tipos = ["apartamento", "casa", "terreno", "loja", "cobertura"];

    const serials = await Promise.all(
      Array.from({ length: 50 }, (_, i) => allocateSerial(db, tipos[i % tipos.length], 2026)),
    );

    expect(new Set(serials).size).toBe(50);

    /* O sequencial é GLOBAL: tipos diferentes não repetem número-base. */
    const sequenciais = serials.map((s) => parseSerial(s)!.sequential);
    expect(new Set(sequenciais).size).toBe(50);
  });

  test("o contador termina exatamente no total reservado", async () => {
    await Promise.all(Array.from({ length: 30 }, () => allocateSequential(db)));

    const rows = await db.all<{ next: number }>(sql`SELECT next FROM crm_serials WHERE id = 1`);
    const next = Array.isArray(rows[0]) ? Number(rows[0][0]) : Number(rows[0]?.next);
    expect(next).toBe(30);
  });
});

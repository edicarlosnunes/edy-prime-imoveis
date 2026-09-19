/**
 * Concorrência da sequência universal do EPI.
 *
 * Roda contra um SQLite local de verdade, em memória — não contra produção. É o
 * único jeito honesto de testar atomicidade: um banco simulado passaria com
 * `SELECT` + `UPDATE`, que é justamente o padrão que duplica número em
 * Turso/libSQL por HTTP.
 */
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "bun:test";
import { allocateEpiCode, allocateEpiSequence, ensureEpiCounter } from "./epi-counter";
import { parseEpi } from "./epi-code";

type Db = ReturnType<typeof drizzle>;

let db: Db;

async function freshDb(): Promise<Db> {
  const client = createClient({ url: ":memory:" });
  const instance = drizzle(client);
  await instance.run(
    sql`CREATE TABLE crm_epi_sequence (id INTEGER PRIMARY KEY NOT NULL, next INTEGER NOT NULL DEFAULT 999)`,
  );
  return instance;
}

beforeEach(async () => {
  db = await freshDb();
});

describe("semente", () => {
  test("é criada uma única vez e é idempotente", async () => {
    await ensureEpiCounter(db);
    await ensureEpiCounter(db);
    await ensureEpiCounter(db);
    const rows = await db.all<{ id: number; next: number }>(sql`SELECT id, next FROM crm_epi_sequence`);
    expect(rows.length).toBe(1);
  });

  test("chamar de novo NÃO zera um contador já usado", async () => {
    /* Zerar reemitiria EPI já impresso em documento assinado. */
    await allocateEpiSequence(db);
    await allocateEpiSequence(db);
    await ensureEpiCounter(db);
    expect(await allocateEpiSequence(db)).toBe(1002);
  });
});

describe("reserva", () => {
  test("a primeira reserva é 1000", async () => {
    expect(await allocateEpiSequence(db)).toBe(1000);
  });

  test("reservas em série não repetem e não pulam", async () => {
    const numeros: number[] = [];
    for (let i = 0; i < 20; i += 1) numeros.push(await allocateEpiSequence(db));
    expect(numeros).toEqual(Array.from({ length: 20 }, (_, i) => 1000 + i));
  });

  test("número reservado nunca volta para a sequência", async () => {
    /* Ficha abandonada, cancelada ou arquivada não devolve o número. */
    const primeiro = await allocateEpiSequence(db);
    const segundo = await allocateEpiSequence(db);
    expect(segundo).toBe(primeiro + 1);
  });

  test("o código sai com o período da data da ficha", async () => {
    const code = await allocateEpiCode(db, new Date("2026-09-18T12:00:00Z"));
    expect(code).toBe("EPI-1000/09-26");
  });

  test("mês novo não reinicia a sequência", async () => {
    const setembro = await allocateEpiCode(db, new Date("2026-09-30T12:00:00Z"));
    const outubro = await allocateEpiCode(db, new Date("2026-10-01T12:00:00Z"));
    expect(setembro).toBe("EPI-1000/09-26");
    expect(outubro).toBe("EPI-1001/10-26");
  });
});

describe("concorrência não duplica EPI", () => {
  test("50 reservas simultâneas geram 50 números distintos", async () => {
    const numeros = await Promise.all(Array.from({ length: 50 }, () => allocateEpiSequence(db)));
    expect(new Set(numeros).size).toBe(50);
    expect([...numeros].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 50 }, (_, i) => 1000 + i),
    );
  });

  test("50 códigos simultâneos, períodos misturados, são todos distintos", async () => {
    const datas = [
      new Date("2026-09-18T12:00:00Z"),
      new Date("2026-10-18T12:00:00Z"),
      new Date("2027-01-18T12:00:00Z"),
    ];
    const codes = await Promise.all(
      Array.from({ length: 50 }, (_, i) => allocateEpiCode(db, datas[i % datas.length])),
    );
    expect(new Set(codes).size).toBe(50);
    const sequencias = codes.map((code) => parseEpi(code)!.sequence);
    expect(new Set(sequencias).size).toBe(50);
  });

  test("o contador termina exatamente no total reservado", async () => {
    await Promise.all(Array.from({ length: 30 }, () => allocateEpiSequence(db)));
    const rows = await db.all<{ next: number }>(sql`SELECT next FROM crm_epi_sequence WHERE id = 1`);
    const next = Array.isArray(rows[0]) ? Number(rows[0][0]) : Number(rows[0]?.next);
    expect(next).toBe(1029);
  });
});

describe("UNIQUE do banco é o backstop", () => {
  test("gravar o mesmo EPI duas vezes é recusado pelo banco", async () => {
    await db.run(
      sql`CREATE TABLE fake_properties (id INTEGER PRIMARY KEY, epi_code TEXT)`,
    );
    await db.run(sql`CREATE UNIQUE INDEX fake_epi_idx ON fake_properties (epi_code)`);
    await db.run(sql`INSERT INTO fake_properties (epi_code) VALUES ('EPI-1000/09-26')`);
    let failed = false;
    try {
      await db.run(sql`INSERT INTO fake_properties (epi_code) VALUES ('EPI-1000/09-26')`);
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
  });

  test("vários NULL convivem — fichas legadas sem EPI não colidem", async () => {
    await db.run(sql`CREATE TABLE fake2 (id INTEGER PRIMARY KEY, epi_code TEXT)`);
    await db.run(sql`CREATE UNIQUE INDEX fake2_epi_idx ON fake2 (epi_code)`);
    await db.run(sql`INSERT INTO fake2 (epi_code) VALUES (NULL)`);
    await db.run(sql`INSERT INTO fake2 (epi_code) VALUES (NULL)`);
    const rows = await db.all<{ total: number }>(sql`SELECT COUNT(*) as total FROM fake2`);
    const total = Array.isArray(rows[0]) ? Number(rows[0][0]) : Number(rows[0]?.total);
    expect(total).toBe(2);
  });
});

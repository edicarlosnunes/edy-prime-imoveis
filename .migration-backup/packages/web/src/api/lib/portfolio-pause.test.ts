/**
 * Regra dos 12 meses aplicada de verdade ao banco (item 10 do pedido).
 *
 * O módulo puro (`portfolio-lifecycle.test.ts`) já cobre a matemática do
 * prazo. Aqui o que está em jogo é a ESCRITA: o imóvel vencido sai da vitrine
 * sozinho, ganha ação para o corretor e linha de histórico — e, acima de
 * tudo, NADA é excluído e nada acontece duas vezes.
 *
 * Roda contra um SQLite em memória, nunca contra o banco de produção.
 */
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "bun:test";
import * as schema from "../database/schema";
import type { AdminDb } from "./admin-base";
import { PAUSE_REASON_12M } from "./portfolio-lifecycle";
import { applyDuePauses } from "./portfolio-pause";

let db: AdminDb;

/* DDL enxuta: só as colunas que a varredura lê e escreve. */
const DDL = [
  `CREATE TABLE properties (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    code TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    purpose TEXT NOT NULL DEFAULT 'venda',
    type TEXT NOT NULL DEFAULT 'apartamento',
    price REAL NOT NULL DEFAULT 0,
    district TEXT NOT NULL DEFAULT '',
    city TEXT NOT NULL DEFAULT 'Praia Grande',
    bedrooms INTEGER NOT NULL DEFAULT 0,
    suites INTEGER NOT NULL DEFAULT 0,
    bathrooms INTEGER NOT NULL DEFAULT 0,
    parking INTEGER NOT NULL DEFAULT 0,
    area_util REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'disponivel',
    published INTEGER NOT NULL DEFAULT 1,
    featured INTEGER NOT NULL DEFAULT 0,
    views INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    watermark_off INTEGER NOT NULL DEFAULT 0,
    portfolio_entry_at INTEGER,
    last_revalidation_at INTEGER,
    next_revalidation_at INTEGER,
    revalidation_status TEXT,
    commercial_status TEXT,
    commercial_status_at INTEGER,
    paused_at INTEGER,
    pause_reason TEXT,
    outside_priority_area INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    title TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'visita',
    due_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pendente',
    lead_id INTEGER, client_id INTEGER, property_id INTEGER, capture_id INTEGER,
    notes TEXT,
    created_at INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    user_id INTEGER, user_name TEXT,
    action TEXT NOT NULL, entity TEXT, entity_id TEXT, detail TEXT, ip TEXT,
    created_at INTEGER NOT NULL DEFAULT 0)`,
];

const NOW = new Date("2026-09-17T12:00:00Z");

function monthsAgo(months: number): number {
  const date = new Date(NOW.getTime());
  date.setMonth(date.getMonth() - months);
  return Math.floor(date.getTime() / 1000);
}

type Row = {
  code: string;
  status?: string;
  commercialStatus?: string | null;
  entryMonthsAgo?: number | null;
  lastRevalidationMonthsAgo?: number | null;
  pausedMonthsAgo?: number | null;
};

async function seed(row: Row) {
  await db.run(sql`
    INSERT INTO properties (code, title, created_at, updated_at, status, commercial_status,
      portfolio_entry_at, last_revalidation_at, paused_at, pause_reason)
    VALUES (
      ${row.code},
      ${`Imóvel ${row.code}`},
      ${monthsAgo(24)},
      ${monthsAgo(24)},
      ${row.status ?? "disponivel"},
      ${row.commercialStatus ?? null},
      ${row.entryMonthsAgo == null ? null : monthsAgo(row.entryMonthsAgo)},
      ${row.lastRevalidationMonthsAgo == null ? null : monthsAgo(row.lastRevalidationMonthsAgo)},
      ${row.pausedMonthsAgo == null ? null : monthsAgo(row.pausedMonthsAgo)},
      ${row.pausedMonthsAgo == null ? null : PAUSE_REASON_12M}
    )`);
}

async function read(code: string) {
  const rows = await db.all<{
    id: number;
    paused_at: number | null;
    pause_reason: string | null;
    published: number;
    status: string;
  }>(sql`SELECT id, paused_at, pause_reason, published, status FROM properties WHERE code = ${code}`);
  return rows[0]!;
}

async function count(table: "tasks" | "audit_log") {
  const rows = await db.all<{ n: number }>(sql.raw(`SELECT COUNT(*) as n FROM ${table}`));
  return rows[0]?.n ?? 0;
}

beforeEach(async () => {
  const client = createClient({ url: ":memory:" });
  const instance = drizzle(client, { schema });
  for (const statement of DDL) await instance.run(sql.raw(statement));
  db = instance as unknown as AdminDb;
});

describe("pausa automática aos 12 meses", () => {
  test("imóvel vencido é pausado sem ninguém confirmar", async () => {
    await seed({ code: "AP1000", entryMonthsAgo: 14 });

    const result = await applyDuePauses(db, NOW);

    expect(result.checked).toBe(1);
    expect(result.paused.map((p) => p.code)).toEqual(["AP1000"]);

    const row = await read("AP1000");
    expect(row.paused_at).not.toBeNull();
    expect(row.pause_reason).toBe(PAUSE_REASON_12M);
  });

  test("a pausa gera ação para o corretor e linha de histórico", async () => {
    await seed({ code: "AP1000", entryMonthsAgo: 13 });
    await applyDuePauses(db, NOW);

    const row = await read("AP1000");

    const tasks = await db.all<{ title: string; type: string; notes: string; status: string }>(
      sql`SELECT title, type, notes, status FROM tasks`,
    );
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.type).toBe("retorno");
    expect(tasks[0]!.status).toBe("pendente");
    expect(tasks[0]!.title).toContain("AP1000");
    /* O vínculo com o imóvel fica no marcador, para a tela achar a origem. */
    expect(tasks[0]!.notes).toContain(`[property:${row.id}]`);

    const audit = await db.all<{ action: string; entity: string; entity_id: string; detail: string }>(
      sql`SELECT action, entity, entity_id, detail FROM audit_log`,
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]!.action).toBe("property_paused_12m");
    expect(audit[0]!.entity).toBe("property");
    expect(audit[0]!.entity_id).toBe(String(row.id));
    expect(audit[0]!.detail).toContain(PAUSE_REASON_12M);
  });

  test("NADA é excluído: o registro continua no CRM, só sai da vitrine", async () => {
    await seed({ code: "AP1000", entryMonthsAgo: 20 });
    await applyDuePauses(db, NOW);

    const rows = await db.all<{ n: number }>(sql`SELECT COUNT(*) as n FROM properties`);
    expect(rows[0]!.n).toBe(1);

    const row = await read("AP1000");
    /* `published` é decisão editorial do corretor e não é sobrescrita. */
    expect(row.published).toBe(1);
    /* A coluna antiga de status também fica intacta. */
    expect(row.status).toBe("disponivel");
  });

  test("rodar a varredura de novo não pausa nada duas vezes", async () => {
    await seed({ code: "AP1000", entryMonthsAgo: 14 });

    const first = await applyDuePauses(db, NOW);
    expect(first.paused).toHaveLength(1);

    const second = await applyDuePauses(db, NOW);
    expect(second.paused).toHaveLength(0);
    /* Já pausado nem é carregado na segunda passada. */
    expect(second.checked).toBe(0);

    expect(await count("tasks")).toBe(1);
    expect(await count("audit_log")).toBe(1);
  });

  test("imóvel já pausado antes não é tocado", async () => {
    await seed({ code: "AP1000", entryMonthsAgo: 18, pausedMonthsAgo: 2 });

    const result = await applyDuePauses(db, NOW);

    expect(result.checked).toBe(0);
    expect(result.paused).toHaveLength(0);
    expect(await count("tasks")).toBe(0);
  });
});

describe("quem a regra dos 12 meses não alcança", () => {
  test("imóvel dentro do prazo continua na vitrine", async () => {
    await seed({ code: "AP1000", entryMonthsAgo: 5 });

    const result = await applyDuePauses(db, NOW);

    expect(result.paused).toHaveLength(0);
    expect((await read("AP1000")).paused_at).toBeNull();
  });

  test("vendido nunca é pausado", async () => {
    await seed({ code: "AP1000", entryMonthsAgo: 30, status: "vendido" });
    await seed({ code: "AP2000", entryMonthsAgo: 30, commercialStatus: "VENDIDO" });

    const result = await applyDuePauses(db, NOW);

    expect(result.paused).toHaveLength(0);
    expect((await read("AP1000")).paused_at).toBeNull();
    expect((await read("AP2000")).paused_at).toBeNull();
  });

  test("retirado pelo proprietário e alugado também ficam fora", async () => {
    await seed({ code: "AP1000", entryMonthsAgo: 30, commercialStatus: "RETIRADO_PELO_PROPRIETARIO" });
    await seed({ code: "AP2000", entryMonthsAgo: 30, status: "alugado" });

    const result = await applyDuePauses(db, NOW);

    expect(result.paused).toHaveLength(0);
  });

  test("sem data de entrada em carteira não há prazo vencido", async () => {
    await seed({ code: "AP1000", entryMonthsAgo: null });

    const result = await applyDuePauses(db, NOW);

    expect(result.checked).toBe(1);
    expect(result.paused).toHaveLength(0);
    expect((await read("AP1000")).paused_at).toBeNull();
  });

  test("revalidação recente reinicia a contagem e segura a pausa", async () => {
    await seed({ code: "AP1000", entryMonthsAgo: 20, lastRevalidationMonthsAgo: 3 });

    const result = await applyDuePauses(db, NOW);

    expect(result.paused).toHaveLength(0);
    expect((await read("AP1000")).paused_at).toBeNull();
  });

  test("reservado continua sob a regra (reservado ainda vende)", async () => {
    await seed({ code: "AP1000", entryMonthsAgo: 14, commercialStatus: "RESERVADO" });

    const result = await applyDuePauses(db, NOW);

    expect(result.paused.map((p) => p.code)).toEqual(["AP1000"]);
  });
});

describe("varredura com carteira mista", () => {
  test("pausa só os vencidos e devolve quantos foram examinados", async () => {
    await seed({ code: "AP1000", entryMonthsAgo: 14 });
    await seed({ code: "AP2000", entryMonthsAgo: 4 });
    await seed({ code: "AP3000", entryMonthsAgo: 30, status: "vendido" });
    await seed({ code: "AP4000", entryMonthsAgo: 13 });
    await seed({ code: "AP5000", entryMonthsAgo: 26, pausedMonthsAgo: 1 });

    const result = await applyDuePauses(db, NOW);

    expect(result.checked).toBe(4);
    expect(result.paused.map((p) => p.code).sort()).toEqual(["AP1000", "AP4000"]);
    expect(await count("tasks")).toBe(2);
    expect(await count("audit_log")).toBe(2);
    expect((await read("AP2000")).paused_at).toBeNull();
    expect((await read("AP3000")).paused_at).toBeNull();
  });

  test("os meses em carteira aparecem no resultado e no motivo", async () => {
    await seed({ code: "AP1000", entryMonthsAgo: 15 });

    const result = await applyDuePauses(db, NOW);

    expect(result.paused[0]!.monthsInPortfolio).toBe(15);
    const audit = await db.all<{ detail: string }>(sql`SELECT detail FROM audit_log`);
    expect(audit[0]!.detail).toContain("15 meses em carteira");
  });
});

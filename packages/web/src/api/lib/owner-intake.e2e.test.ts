/**
 * Teste de integração do ajuste estrutural do CRM de captação.
 *
 * Os módulos puros já têm seus testes de unidade. O que se verifica aqui é o
 * caminho COMPLETO — `intakeOwner` gravando no banco — nos oito cenários que
 * o pedido exige, na ordem em que foram pedidos:
 *
 *  1. mesmo telefone voltando depois de abandonar o cadastro
 *  2. mesmo telefone cadastrando um segundo imóvel
 *  3. mesmo endereço/unidade tentando duplicar
 *  4. mesmo prédio com unidade diferente
 *  5. endereço com abreviação/erro simples de digitação
 *  6. imóvel dentro da área prioritária
 *  7. imóvel fora da área prioritária
 *  8. pausa depois da regra de 12 meses
 *
 * Roda contra um SQLite em memória, nunca contra o banco de produção. Em todos
 * os cenários o que é checado não é só o retorno da função: é o que ficou
 * gravado — quantos proprietários, quantas fichas, e o que NÃO foi apagado.
 */
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "bun:test";
import * as schema from "../database/schema";
import type { AdminDb } from "./admin-base";
import { intakeOwner, type OwnerIntakeInput } from "./owner-intake";
import { applyDuePauses } from "./portfolio-pause";
import { PAUSE_REASON_12M } from "./portfolio-lifecycle";
import { serializePriorityCities } from "./priority-area";

let db: AdminDb;

/* DDL espelhando scripts/migrate.ts (tabela base + colunas aditivas V3/V4). */
const DDL = [
  `CREATE TABLE owners (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    notes TEXT,
    document TEXT,
    rg TEXT,
    capture_status TEXT NOT NULL DEFAULT 'prospeccao',
    possible_duplicate INTEGER NOT NULL DEFAULT 0,
    duplicate_of_owner_id INTEGER,
    duplicate_note TEXT,
    created_at INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE property_captures (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    owner_id INTEGER NOT NULL,
    city TEXT NOT NULL DEFAULT 'Praia Grande',
    district TEXT,
    address TEXT,
    property_type TEXT,
    serial TEXT,
    cep TEXT,
    street TEXT,
    number TEXT,
    state TEXT,
    complements TEXT,
    unit_key TEXT,
    doc_validated_by TEXT,
    doc_validated_at INTEGER,
    doc_validation_note TEXT,
    owner_photos TEXT,
    asking_price REAL,
    estimated_price REAL,
    source TEXT NOT NULL DEFAULT 'manual',
    stage TEXT NOT NULL DEFAULT 'novo_contato',
    intention TEXT,
    next_action TEXT,
    next_action_at INTEGER,
    appraisal_status TEXT NOT NULL DEFAULT 'pendente',
    appraisal_at INTEGER,
    appraisal_note TEXT,
    doc_status TEXT NOT NULL DEFAULT 'nao_iniciado',
    registration_status TEXT NOT NULL DEFAULT 'NOVO',
    registration_status_at INTEGER,
    completeness INTEGER NOT NULL DEFAULT 0,
    last_field_at INTEGER,
    address_key TEXT,
    building_key TEXT,
    outside_priority_area INTEGER NOT NULL DEFAULT 0,
    duplicate_of_capture_id INTEGER,
    duplicate_note TEXT,
    notes TEXT,
    lost_reason TEXT,
    lost_detail TEXT,
    converted_property_id INTEGER,
    converted_at INTEGER,
    stage_changed_at INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    title TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'visita',
    due_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pendente',
    lead_id INTEGER,
    client_id INTEGER,
    property_id INTEGER,
    capture_id INTEGER,
    notes TEXT,
    created_at INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    company_name TEXT NOT NULL DEFAULT 'Edy Prime Imóveis',
    broker_name TEXT NOT NULL DEFAULT 'Edy Prime',
    whatsapp TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    creci TEXT NOT NULL DEFAULT '',
    cnai TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    instagram TEXT NOT NULL DEFAULT '',
    facebook TEXT NOT NULL DEFAULT '',
    commission_rate REAL NOT NULL DEFAULT 6,
    priority_cities TEXT NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL DEFAULT 0)`,
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
    owner_id INTEGER,
    views INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT 0,
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
  `CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    user_id INTEGER,
    user_name TEXT,
    action TEXT NOT NULL,
    entity TEXT,
    entity_id TEXT,
    detail TEXT,
    ip TEXT,
    created_at INTEGER NOT NULL DEFAULT 0)`,
];

beforeEach(async () => {
  const client = createClient({ url: ":memory:" });
  const instance = drizzle(client, { schema });
  for (const statement of DDL) await instance.run(sql.raw(statement));
  db = instance as unknown as AdminDb;
});

/* ------------------------------------------------------------- utilidades */

const PHONE = "(13) 99714-1174";

/** Ficha do apartamento 163 na Guimarães Rosa, o imóvel base dos cenários. */
const APTO_163: OwnerIntakeInput = {
  name: "Maria Souza",
  phone: PHONE,
  cep: "11701-000",
  city: "Praia Grande",
  street: "Rua Guimarães Rosa",
  number: "492",
  complements: { unit: "163" },
  propertyType: "apartamento",
  source: "site_vender",
};

const submit = (input: OwnerIntakeInput) => intakeOwner(db, input);

async function counts() {
  const [owners] = await db.all<{ n: number }>(sql`SELECT COUNT(*) as n FROM owners`);
  const [captures] = await db.all<{ n: number }>(sql`SELECT COUNT(*) as n FROM property_captures`);
  return { owners: owners?.n ?? 0, captures: captures?.n ?? 0 };
}

async function capture(id: number) {
  const rows = await db.all<{
    id: number;
    owner_id: number;
    city: string;
    street: string | null;
    number: string | null;
    unit_key: string | null;
    address_key: string | null;
    building_key: string | null;
    complements: string | null;
    registration_status: string;
    completeness: number;
    outside_priority_area: number;
    stage: string;
    notes: string | null;
    duplicate_of_capture_id: number | null;
  }>(sql`SELECT * FROM property_captures WHERE id = ${id}`);
  return rows[0]!;
}

/* ------------------------------------------------- 1. abandono e retomada */

describe("1. mesmo telefone voltando após abandonar o cadastro", () => {
  test("continua a MESMA ficha em vez de abrir outra", async () => {
    /* Primeiro contato: só nome e telefone, como chega do site. */
    const primeiro = await submit({ name: "Maria", phone: PHONE });
    expect(primeiro.captureId).not.toBeNull();
    expect(primeiro.duplicated).toBe(false);
    expect(primeiro.registrationStatus).not.toBe("CONCLUIDO");

    /* Volta depois com o endereço: mesma pessoa, mesma ficha. */
    const volta = await submit(APTO_163);

    expect(volta.duplicated).toBe(true);
    expect(volta.resumed).toBe(true);
    expect(volta.captureId).toBe(primeiro.captureId);
    expect(volta.detail).toContain("retomado de onde parou");

    expect(await counts()).toEqual({ owners: 1, captures: 1 });

    /* O endereço que faltava foi preenchido, e as chaves de identidade da
       unidade deixaram de ser as do "nenhum endereço". */
    const ficha = await capture(volta.captureId!);
    expect(ficha.street).toBe("Rua Guimarães Rosa");
    expect(ficha.number).toBe("492");
    expect(ficha.unit_key).toContain("cep:11701000");
    expect(ficha.address_key).toContain("guimaraesrosa");
    expect(ficha.completeness).toBeGreaterThan(primeiro.completeness);
  });

  test("a retomada fica registrada no histórico da ficha", async () => {
    const primeiro = await submit({ name: "Maria", phone: PHONE });
    await submit(APTO_163);

    const ficha = await capture(primeiro.captureId!);
    expect(ficha.notes ?? "").toContain(`Retomada do cadastro #${primeiro.captureId}`);
    expect(ficha.notes ?? "").toContain("Preenchido agora");
  });

  test("nenhum campo já informado é apagado pela retomada", async () => {
    const primeiro = await submit({
      ...APTO_163,
      askingPrice: 450_000,
      neighborhood: "Boqueirão",
    });

    /* Reenvio sem preço e sem bairro: o que já existia continua lá. */
    await submit({ name: "Maria", phone: PHONE });

    const rows = await db.all<{ asking_price: number | null; district: string | null }>(
      sql`SELECT asking_price, district FROM property_captures WHERE id = ${primeiro.captureId}`,
    );
    expect(rows[0]!.asking_price).toBe(450_000);
    expect(rows[0]!.district).toBe("Boqueirão");
  });
});

/* ------------------------------------------------------ 2. segundo imóvel */

describe("2. mesmo telefone cadastrando um segundo imóvel", () => {
  test("o contato é reaproveitado e nasce uma ficha nova", async () => {
    const primeiro = await submit(APTO_163);
    const segundo = await submit({
      ...APTO_163,
      cep: "11702-100",
      street: "Avenida Presidente Kennedy",
      number: "1000",
      complements: { unit: "21" },
    });

    expect(segundo.duplicated).toBe(true); /* proprietário reaproveitado */
    expect(segundo.resumed).toBe(false);
    expect(segundo.captureId).not.toBe(primeiro.captureId);
    expect(segundo.duplicateUnit).toBeNull();

    expect(await counts()).toEqual({ owners: 1, captures: 2 });

    const dono = await capture(segundo.captureId!);
    expect(dono.owner_id).toBe(primeiro.id);
  });

  test("o proprietário não é duplicado nem com o telefone escrito de outro jeito", async () => {
    await submit(APTO_163);
    await submit({ ...APTO_163, phone: "13997141174", number: "500", complements: { unit: "12" } });

    expect((await counts()).owners).toBe(1);
  });
});

/* --------------------------------------------------- 3. duplicar a unidade */

describe("3. mesmo endereço/unidade tentando duplicar", () => {
  test("ficha concluída não duplica: devolve a que já existe com aviso", async () => {
    const primeiro = await submit(APTO_163);
    const repetido = await submit(APTO_163);

    expect(repetido.captureId).toBe(primeiro.captureId);
    expect(repetido.duplicateUnit).toContain(`captação #${primeiro.captureId}`);
    expect(await counts()).toEqual({ owners: 1, captures: 1 });
  });

  test("outro proprietário no mesmo imóvel NÃO é excluído: vai para revisão", async () => {
    const dono = await submit(APTO_163);
    const outro = await submit({ ...APTO_163, name: "João Alves", phone: "(13) 98888-7777" });

    /* Duas pessoas, duas fichas: nada foi sobrescrito nem removido. */
    expect(await counts()).toEqual({ owners: 2, captures: 2 });
    expect(outro.captureId).not.toBe(dono.captureId);
    expect(outro.duplicateUnit).toContain("POSSÍVEL DUPLICADO");

    const ficha = await capture(outro.captureId!);
    expect(ficha.registration_status).toBe("POSSIVEL_DUPLICIDADE");
    expect(ficha.duplicate_of_capture_id).toBe(dono.captureId);
  });
});

/* ----------------------------------------------- 4. mesmo prédio, outra unidade */

describe("4. mesmo prédio com unidade diferente", () => {
  test("é imóvel novo e não acusa duplicidade", async () => {
    const apto163 = await submit(APTO_163);
    const apto164 = await submit({ ...APTO_163, complements: { unit: "164" } });

    expect(apto164.captureId).not.toBe(apto163.captureId);
    expect(apto164.duplicateUnit).toBeNull();
    expect(apto164.resumed).toBe(false);
    expect(await counts()).toEqual({ owners: 1, captures: 2 });

    /* Mesma chave de prédio, chaves de unidade diferentes. */
    const a = await capture(apto163.captureId!);
    const b = await capture(apto164.captureId!);
    expect(b.building_key).toBe(a.building_key);
    expect(b.address_key).not.toBe(a.address_key);
  });
});

/* ------------------------------------------- 5. abreviação / erro de digitação */

describe("5. endereço com abreviação ou erro simples", () => {
  test('"Av. Guimaraes Roza" sem CEP reconhece a ficha da "Rua Guimarães Rosa"', async () => {
    const original = await submit(APTO_163);

    const torto = await submit({
      ...APTO_163,
      cep: null,
      street: "Av. Guimaraes Roza",
      city: "praia grande",
      complements: { unit: "ap 163" },
    });

    expect(torto.captureId).toBe(original.captureId);
    expect(await counts()).toEqual({ owners: 1, captures: 1 });
  });

  test("errar o NÚMERO é outro imóvel, não erro de digitação", async () => {
    const original = await submit(APTO_163);
    const outro = await submit({ ...APTO_163, cep: null, number: "482" });

    expect(outro.captureId).not.toBe(original.captureId);
    expect((await counts()).captures).toBe(2);
  });
});

/* ------------------------------------------------- 6 e 7. área prioritária */

describe("6. imóvel dentro da área prioritária", () => {
  test("nenhuma marcação: segue o fluxo normal", async () => {
    const r = await submit({ ...APTO_163, city: "Santos", cep: "11065-000" });

    expect(r.outsidePriorityArea).toBe(false);
    const ficha = await capture(r.captureId!);
    expect(ficha.outside_priority_area).toBe(0);
    expect(ficha.stage).toBe("novo_contato");
  });

  test("a lista configurada no painel é respeitada", async () => {
    await db.run(sql`
      INSERT INTO settings (id, priority_cities, updated_at)
      VALUES (1, ${serializePriorityCities(["Santos"])}, 0)`);

    const santos = await submit({ ...APTO_163, city: "Santos", cep: "11065-000" });
    const praia = await submit({ ...APTO_163, city: "Praia Grande" });

    expect(santos.outsidePriorityArea).toBe(false);
    /* Praia Grande é padrão, mas saiu da lista configurada: fora da área. */
    expect(praia.outsidePriorityArea).toBe(true);
  });
});

describe("7. imóvel fora da área prioritária", () => {
  test("cadastra igual, sem bloqueio, só marcado", async () => {
    const r = await submit({
      ...APTO_163,
      city: "Campinas",
      cep: "13010-000",
      street: "Rua Treze de Maio",
      number: "70",
    });

    expect(r.outsidePriorityArea).toBe(true);
    expect(r.captureId).not.toBeNull();

    const ficha = await capture(r.captureId!);
    expect(ficha.outside_priority_area).toBe(1);
    /* Fluxo idêntico: mesma etapa inicial e mesma tarefa de retorno. */
    expect(ficha.stage).toBe("novo_contato");
    const [tarefa] = await db.all<{ n: number }>(
      sql`SELECT COUNT(*) as n FROM tasks WHERE type = 'retorno' AND status = 'pendente'`,
    );
    expect(tarefa!.n).toBe(1);
  });
});

/* ----------------------------------------------------- 8. pausa dos 12 meses */

describe("8. pausa depois da regra de 12 meses", () => {
  const NOW = new Date("2026-09-17T12:00:00Z");
  const monthsAgo = (months: number) => {
    const date = new Date(NOW.getTime());
    date.setMonth(date.getMonth() - months);
    return Math.floor(date.getTime() / 1000);
  };

  test("imóvel captado há mais de 12 meses sai da vitrine e gera ação, sem perder nada", async () => {
    /* A captação do proprietário continua no Radar; o imóvel publicado é o
       que sai da vitrine. */
    const captacao = await submit(APTO_163);

    await db.run(sql`
      INSERT INTO properties (code, title, created_at, updated_at, owner_id, portfolio_entry_at)
      VALUES ('AP0001', 'Apto 163 Guimarães Rosa', ${monthsAgo(14)}, ${monthsAgo(14)},
        ${captacao.id}, ${monthsAgo(14)})`);

    const resultado = await applyDuePauses(db, NOW);
    expect(resultado.paused.map((p) => p.code)).toEqual(["AP0001"]);

    const [imovel] = await db.all<{
      paused_at: number | null;
      pause_reason: string | null;
      status: string;
      published: number;
    }>(sql`SELECT paused_at, pause_reason, status, published FROM properties WHERE code = 'AP0001'`);

    expect(imovel!.paused_at).not.toBeNull();
    expect(imovel!.pause_reason).toBe(PAUSE_REASON_12M);
    /* NADA é excluído e o status legado não é reescrito. */
    expect(imovel!.status).toBe("disponivel");

    const [tarefa] = await db.all<{ n: number }>(
      sql`SELECT COUNT(*) as n FROM tasks WHERE type = 'retorno' AND title LIKE '%AP0001%'`,
    );
    expect(tarefa!.n).toBe(1);

    const [historico] = await db.all<{ n: number }>(
      sql`SELECT COUNT(*) as n FROM audit_log WHERE action = 'property_paused_12m'`,
    );
    expect(historico!.n).toBe(1);

    /* A ficha da captação segue intacta no CRM. */
    expect((await counts()).captures).toBe(1);
  });

  test("rodar a varredura de novo não pausa nem avisa duas vezes", async () => {
    await db.run(sql`
      INSERT INTO properties (code, title, created_at, updated_at, portfolio_entry_at)
      VALUES ('AP0002', 'Apto vencido', ${monthsAgo(20)}, ${monthsAgo(20)}, ${monthsAgo(20)})`);

    await applyDuePauses(db, NOW);
    const segunda = await applyDuePauses(db, NOW);

    expect(segunda.paused).toHaveLength(0);
    const [tarefa] = await db.all<{ n: number }>(sql`SELECT COUNT(*) as n FROM tasks`);
    expect(tarefa!.n).toBe(1);
  });
});

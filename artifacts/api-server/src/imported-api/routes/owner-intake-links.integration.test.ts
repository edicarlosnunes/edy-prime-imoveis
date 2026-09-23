import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "bun:test";
import * as schema from "../database/schema";
import { sha256Hex } from "../lib/auth";
import { publicCancel, publicComplete, publicTurn } from "./owner-intake-links";

/*
 * This suite deliberately uses only an in-memory libSQL database.  It is a
 * route integration test: every assertion below reads rows written by the
 * real public-turn/capture/serial code, rather than testing question helpers.
 */
const DDL = [
  `CREATE TABLE owners (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, phone TEXT, email TEXT, notes TEXT, document TEXT, rg TEXT, capture_status TEXT NOT NULL DEFAULT 'prospeccao', possible_duplicate INTEGER NOT NULL DEFAULT 0, duplicate_of_owner_id INTEGER, duplicate_note TEXT, created_at INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE property_captures (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id INTEGER NOT NULL, city TEXT NOT NULL DEFAULT 'Praia Grande', district TEXT, address TEXT, property_type TEXT, serial TEXT, cep TEXT, street TEXT, number TEXT, state TEXT, complements TEXT, unit_key TEXT, doc_validated_by TEXT, doc_validated_at INTEGER, doc_validation_note TEXT, owner_photos TEXT, asking_price REAL, estimated_price REAL, source TEXT NOT NULL DEFAULT 'manual', stage TEXT NOT NULL DEFAULT 'novo_contato', intention TEXT, next_action TEXT, next_action_at INTEGER, appraisal_status TEXT NOT NULL DEFAULT 'pendente', appraisal_at INTEGER, appraisal_note TEXT, doc_status TEXT NOT NULL DEFAULT 'nao_iniciado', registration_status TEXT NOT NULL DEFAULT 'NOVO', registration_status_at INTEGER, completeness INTEGER NOT NULL DEFAULT 0, last_field_at INTEGER, address_key TEXT, building_key TEXT, outside_priority_area INTEGER NOT NULL DEFAULT 0, duplicate_of_capture_id INTEGER, duplicate_note TEXT, notes TEXT, lost_reason TEXT, lost_detail TEXT, converted_property_id INTEGER, converted_at INTEGER, stage_changed_at INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0, broker_name TEXT, broker_phone TEXT, broker_creci TEXT)`,
  `CREATE TABLE tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'visita', due_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pendente', lead_id INTEGER, client_id INTEGER, property_id INTEGER, capture_id INTEGER, notes TEXT, created_at INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE settings (id INTEGER PRIMARY KEY AUTOINCREMENT, company_name TEXT NOT NULL DEFAULT '', broker_name TEXT NOT NULL DEFAULT '', whatsapp TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', creci TEXT NOT NULL DEFAULT '', cnai TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '', instagram TEXT NOT NULL DEFAULT '', facebook TEXT NOT NULL DEFAULT '', commission_rate REAL NOT NULL DEFAULT 6, priority_cities TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE properties (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL, title TEXT NOT NULL, purpose TEXT NOT NULL DEFAULT 'venda', type TEXT NOT NULL DEFAULT 'casa', price REAL NOT NULL DEFAULT 0, district TEXT NOT NULL DEFAULT '', city TEXT NOT NULL DEFAULT 'Praia Grande', published INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE crm_serials (id INTEGER PRIMARY KEY, next INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE owner_intake_links (id INTEGER PRIMARY KEY AUTOINCREMENT, token_hash TEXT NOT NULL UNIQUE, owner_name TEXT NOT NULL, phone TEXT, status TEXT NOT NULL DEFAULT 'aguardando', profile TEXT, draft TEXT, created_at INTEGER NOT NULL DEFAULT 0, started_at INTEGER, completed_at INTEGER, cancellation_reason TEXT, owner_id INTEGER, capture_id INTEGER)`,
];

type TestDb = ReturnType<typeof drizzle<typeof schema>>;
let db: TestDb;
let sequence = 0;

beforeEach(async () => {
  db = drizzle(createClient({ url: ":memory:" }), { schema });
  for (const statement of DDL) await db.run(sql.raw(statement));
  await db.run(sql`INSERT INTO settings (priority_cities) VALUES ('Praia Grande')`);
  sequence = 0;
});

async function link(phone: string | null = null) {
  const token = `${(++sequence).toString(16).padStart(2, "0")}${"a".repeat(62)}`;
  await db.insert(schema.ownerIntakeLinks).values({
    tokenHash: await sha256Hex(token),
    ownerName: "",
    phone,
  });
  return token;
}

async function row<T>(query: ReturnType<typeof sql>) {
  const result = await db.all<T>(query);
  return result[0];
}

async function reachAddress(token: string, name: string, address: string, profile: "PROPRIETARIO" | "LOCADOR" = "LOCADOR") {
  await publicTurn(db as never, { token, text: profile, profile });
  await publicTurn(db as never, { token, text: name });
  await publicTurn(db as never, { token, text: "email@example.com" });
  await publicTurn(db as never, { token, text: "casa" });
  return publicTurn(db as never, { token, text: address });
}

describe("LINK_CAPTACAO progressive DB integration A-J", () => {
  test("A — CRM-known phone remains after abandon", async () => {
    const token = await link("5513997141174");
    await publicTurn(db as never, { token, text: "PROPRIETARIO", profile: "PROPRIETARIO" });
    await publicTurn(db as never, { token, text: "Ana Souza" });
    const saved = await row<{ phone: string }>(sql`SELECT phone FROM owner_intake_links`);
    expect(saved?.phone).toBe("5513997141174");
  });

  test("B — profile and participant name persist immediately", async () => {
    const token = await link();
    await publicTurn(db as never, { token, text: "CORRETOR", profile: "CORRETOR" });
    await publicTurn(db as never, { token, text: "Bruno Corretor" });
    const saved = await row<{ profile: string; draft: string }>(sql`SELECT profile, draft FROM owner_intake_links`);
    expect(saved?.profile).toBe("CORRETOR");
    expect(JSON.parse(saved!.draft).brokerName).toBe("Bruno Corretor");
  });

  test("C — address creates property_capture, atomic serial, owner and link", async () => {
    const token = await link("5513997141174");
    const state = await reachAddress(token, "Ana Souza", "Rua A, 10, Centro, Praia Grande - SP");
    const capture = await row<{ id: number; serial: string; owner_id: number; registration_status: string }>(sql`SELECT id, serial, owner_id, registration_status FROM property_captures`);
    const saved = await row<{ owner_id: number; capture_id: number }>(sql`SELECT owner_id, capture_id FROM owner_intake_links`);
    expect(capture?.serial).toMatch(/^[A-Z]{2}-\d{4}-\d{6}$/);
    expect(capture?.registration_status).toBe("EM_ANDAMENTO");
    expect(saved?.owner_id).toBe(capture?.owner_id);
    expect(saved?.capture_id).toBe(capture?.id);
    expect(state.capture?.serial).toBe(capture?.serial);
  });

  test("D — incomplete capture is queryable as EM_ANDAMENTO with lastFieldAt", async () => {
    const token = await link("5513997141174");
    await reachAddress(token, "Ana Souza", "Rua D, 40, Centro");
    const capture = await row<{ registration_status: string; last_field_at: number }>(sql`SELECT registration_status, last_field_at FROM property_captures`);
    expect(capture?.registration_status).toBe("EM_ANDAMENTO");
    expect(capture?.last_field_at).toBeTruthy();
  });

  test("E — resume same link keeps capture and EPI", async () => {
    const token = await link("5513997141174");
    await reachAddress(token, "Ana Souza", "Rua E, 50, Centro");
    const before = await row<{ id: number; serial: string }>(sql`SELECT id, serial FROM property_captures`);
    await publicTurn(db as never, { token, text: "2 quartos e 1 vaga" });
    const after = await row<{ id: number; serial: string }>(sql`SELECT id, serial FROM property_captures`);
    expect(after).toEqual(before);
  });

  test("F — same owner and second property creates capture/EPI, not owner", async () => {
    const first = await link("5513997141174");
    await reachAddress(first, "Ana Souza", "11701-060 Rua F, 60, Centro");
    const second = await link("5513997141174");
    await db.update(schema.ownerIntakeLinks).set({
      profile: "LOCADOR",
      phone: "5513997141174",
      draft: JSON.stringify({ profile: "LOCADOR", ownerName: "Ana Souza", phone: "5513997141174", email: "email@example.com", intention: "locacao", propertyType: "casa", answers: {} }),
    }).where(sql`token_hash = ${await sha256Hex(second)}`);
    await publicTurn(db as never, { token: second, text: "11701-061 Rua F2, 61, Centro" });
    const counts = await row<{ owners: number; captures: number }>(sql`SELECT (SELECT count(*) FROM owners) owners, (SELECT count(*) FROM property_captures) captures`);
    const serials = await db.all<{ serial: string }>(sql`SELECT serial FROM property_captures ORDER BY id`);
    expect(counts).toEqual({ owners: 1, captures: 2 });
    expect(serials[0]?.serial).not.toBe(serials[1]?.serial);
  });

  test("G — CORRETOR fields remain broker fields", async () => {
    const token = await link();
    await publicTurn(db as never, { token, text: "CORRETOR", profile: "CORRETOR" });
    await publicTurn(db as never, { token, text: "Corretor Silva" });
    await publicTurn(db as never, { token, text: "11988887777" });
    await publicTurn(db as never, { token, text: "12345" });
    await publicTurn(db as never, { token, text: "Ana Souza" });
    await publicTurn(db as never, { token, text: "5513997141174" });
    await publicTurn(db as never, { token, text: "ana@example.com" });
    await publicTurn(db as never, { token, text: "venda" });
    await publicTurn(db as never, { token, text: "casa" });
    await publicTurn(db as never, { token, text: "Rua G, 70, Centro" });
    const capture = await row<{ broker_name: string; broker_phone: string }>(sql`SELECT broker_name, broker_phone FROM property_captures`);
    const owner = await row<{ name: string; phone: string }>(sql`SELECT name, phone FROM owners`);
    expect(capture?.broker_name).toBe("Corretor Silva");
    expect(capture?.broker_phone).toBe("11988887777");
    expect(owner?.name).toBe("Ana Souza");
    expect(owner?.phone).toBe("5513997141174");
  });

  test("H — cancellation persists reason, pauses capture, and never publishes property", async () => {
    const token = await link("5513997141174");
    await reachAddress(token, "Ana Souza", "Rua H, 80, Centro");
    await publicCancel(db as never, { token, reason: "Desistiu" });
    const saved = await row<{ status: string; cancellation_reason: string }>(sql`SELECT status, cancellation_reason FROM owner_intake_links`);
    const capture = await row<{ registration_status: string; lost_reason: string }>(sql`SELECT registration_status, lost_reason FROM property_captures`);
    expect(saved).toEqual({ status: "cancelado", cancellation_reason: "Desistiu" });
    expect(capture?.registration_status).toBe("PAUSADO");
    expect(capture?.lost_reason).toBe("CANCELADO");
    expect(await row<{ n: number }>(sql`SELECT count(*) n FROM properties`)).toEqual({ n: 0 });
  });

  test("I — tokens isolate; same-token concurrent turn has one winner", async () => {
    const a = await link("5513997141174");
    const b = await link("5513997141175");
    await Promise.all([reachAddress(a, "Ana A", "Rua IA, 1, Centro"), reachAddress(b, "Ana B", "Rua IB, 2, Centro")]);
    const captures = await db.all<{ owner_id: number; serial: string }>(sql`SELECT owner_id, serial FROM property_captures ORDER BY id`);
    expect(captures).toHaveLength(2);
    expect(captures[0]?.serial).not.toBe(captures[1]?.serial);
    const c = await link("5513997141176");
    await publicTurn(db as never, { token: c, text: "PROPRIETARIO", profile: "PROPRIETARIO" });
    const results = await Promise.allSettled([publicTurn(db as never, { token: c, text: "Ana C" }), publicTurn(db as never, { token: c, text: "Ana C" })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await row<{ n: number }>(sql`SELECT count(*) n FROM owner_intake_links WHERE token_hash = ${await sha256Hex(c)}`)).toEqual({ n: 1 });
  });

  test("J — confirmation completes the same linked capture", async () => {
    const token = await link("5513997141174");
    await reachAddress(token, "Ana Souza", "Rua J, 90, Centro");
    const before = await row<{ id: number; serial: string }>(sql`SELECT id, serial FROM property_captures`);
    const completed = await publicComplete(db as never, { token, propertyType: "casa", intention: "venda", askingPrice: 450000 });
    const after = await row<{ id: number; serial: string; registration_status: string }>(sql`SELECT id, serial, registration_status FROM property_captures`);
    expect(completed.captureId).toBe(before?.id);
    expect(after?.id).toBe(before?.id);
    expect(after?.serial).toBe(before?.serial);
    expect(after?.registration_status).toBe("CONCLUIDO");
    expect(await row<{ n: number }>(sql`SELECT count(*) n FROM owner_intake_links WHERE status = 'concluido'`)).toEqual({ n: 1 });
  });
});
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import * as schema from "../database/schema";
import { sha256Hex } from "../lib/auth";
import { publicCancel, publicFacade, publicTurn } from "./owner-intake-links";
import {
  isFixedWhatsappCaptureTrigger,
  whatsappCapturePhoto,
  whatsappCaptureSession,
  whatsappCaptureText,
  WHATSAPP_CAPTURE_SUCCESS,
} from "../agent/whatsapp-link-captacao";

const DDL = [
  `CREATE TABLE owners (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, system_key TEXT UNIQUE, phone TEXT, email TEXT, notes TEXT, document TEXT, rg TEXT, capture_status TEXT NOT NULL DEFAULT 'prospeccao', possible_duplicate INTEGER NOT NULL DEFAULT 0, duplicate_of_owner_id INTEGER, duplicate_note TEXT, created_at INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE property_captures (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id INTEGER NOT NULL, city TEXT NOT NULL DEFAULT 'Praia Grande', district TEXT, address TEXT, property_type TEXT, serial TEXT, cep TEXT, street TEXT, number TEXT, state TEXT, complements TEXT, unit_key TEXT, doc_validated_by TEXT, doc_validated_at INTEGER, doc_validation_note TEXT, owner_photos TEXT, asking_price REAL, estimated_price REAL, source TEXT NOT NULL DEFAULT 'manual', stage TEXT NOT NULL DEFAULT 'novo_contato', intention TEXT, next_action TEXT, next_action_at INTEGER, appraisal_status TEXT NOT NULL DEFAULT 'pendente', appraisal_at INTEGER, appraisal_note TEXT, doc_status TEXT NOT NULL DEFAULT 'nao_iniciado', registration_status TEXT NOT NULL DEFAULT 'NOVO', registration_status_at INTEGER, completeness INTEGER NOT NULL DEFAULT 0, last_field_at INTEGER, address_key TEXT, building_key TEXT, outside_priority_area INTEGER NOT NULL DEFAULT 0, duplicate_of_capture_id INTEGER, duplicate_note TEXT, notes TEXT, lost_reason TEXT, lost_detail TEXT, converted_property_id INTEGER, converted_at INTEGER, stage_changed_at INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0, broker_name TEXT, broker_phone TEXT, broker_creci TEXT)`,
  `CREATE TABLE tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'visita', due_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pendente', lead_id INTEGER, client_id INTEGER, property_id INTEGER, capture_id INTEGER, notes TEXT, created_at INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE settings (id INTEGER PRIMARY KEY AUTOINCREMENT, company_name TEXT NOT NULL DEFAULT '', broker_name TEXT NOT NULL DEFAULT '', whatsapp TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', creci TEXT NOT NULL DEFAULT '', cnai TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '', instagram TEXT NOT NULL DEFAULT '', facebook TEXT NOT NULL DEFAULT '', commission_rate REAL NOT NULL DEFAULT 6, priority_cities TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE properties (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL, title TEXT NOT NULL, purpose TEXT NOT NULL DEFAULT 'venda', type TEXT NOT NULL DEFAULT 'casa', price REAL NOT NULL DEFAULT 0, district TEXT NOT NULL DEFAULT '', city TEXT NOT NULL DEFAULT 'Praia Grande', published INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE crm_serials (id INTEGER PRIMARY KEY, next INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE media (id TEXT PRIMARY KEY, mime TEXT NOT NULL, size INTEGER NOT NULL, data TEXT NOT NULL, name TEXT, alt TEXT, original_id TEXT, variant TEXT, created_at INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE owner_intake_links (id INTEGER PRIMARY KEY AUTOINCREMENT, token_hash TEXT NOT NULL UNIQUE, short_code TEXT UNIQUE, owner_name TEXT NOT NULL, phone TEXT, status TEXT NOT NULL DEFAULT 'aguardando', profile TEXT, draft TEXT, created_at INTEGER NOT NULL DEFAULT 0, started_at INTEGER, completed_at INTEGER, cancellation_reason TEXT, owner_id INTEGER, capture_id INTEGER)`,
];
let db: ReturnType<typeof drizzle<typeof schema>>;
let sequence = 0;
let dbPath = "";
let dbCounter = 0;
beforeEach(async () => {
  dbPath = `/tmp/owner-intake-links-${process.pid}-${++dbCounter}.db`;
  db = drizzle(createClient({ url: `file:${dbPath}` }), { schema });
  for (const statement of DDL) await db.run(sql.raw(statement));
  await db.run(sql`INSERT INTO settings (priority_cities) VALUES ('Praia Grande')`);
  sequence = 0;
});
afterEach(() => {
  try { unlinkSync(dbPath); } catch { /* already removed */ }
});
async function link(phone: string | null = null, shortCode?: string) {
  const token = `${(++sequence).toString(16).padStart(2, "0")}${"a".repeat(62)}`;
  await db.insert(schema.ownerIntakeLinks).values({ tokenHash: await sha256Hex(token), shortCode, ownerName: "", phone });
  return token;
}
async function state(token: string) {
  const row = await db.all<{ draft: string }>(sql`SELECT draft FROM owner_intake_links WHERE token_hash = ${await sha256Hex(token)}`);
  return row[0]?.draft ? JSON.parse(row[0].draft) : {};
}
const answerFor = (question: string) => {
  if (/nome completo/i.test(question)) return "Ana Souza";
  if (/CRECI/i.test(question)) return "CRECI 12345";
  if (/telefone|WhatsApp/i.test(question)) return "5513997141174";
  if (/endereço/i.test(question)) return "Rua das Flores, 10, Centro, Praia Grande - SP";
  if (/complemento/i.test(question)) return "SEM COMPLEMENTO";
  if (/valor.*(venda|aluguel)/i.test(question)) return "450 mil";
  if (/sendo cadastrado/i.test(question)) return /VENDA/.test(question) ? "VENDA" : "LOCAÇÃO";
  if (/tipo/i.test(question)) return "apartamento";
  if (/condomínio\\?/i.test(question)) return "NÃO";
  if (/documentação/i.test(question)) return "Documentação regular";
  if (/dormitórios/i.test(question)) return "2";
  if (/suítes/i.test(question)) return "0";
  if (/banheiros/i.test(question)) return "2";
  if (/vagas/i.test(question)) return "1";
  if (/área útil/i.test(question)) return "78 m²";
  if (/área total/i.test(question)) return "500 m²";
  if (/frente/i.test(question)) return "10 x 50";
  if (/condomínio/i.test(question)) return "0";
  if (/IPTU/i.test(question)) return "1200";
  if (/ocupad/i.test(question)) return "desocupado";
  if (/disponível/i.test(question)) return "SIM";
  if (/mobiliado/i.test(question)) return "sem mobília";
  if (/característica|condição|informação/i.test(question)) return "Nenhuma";
  if (/unidade/i.test(question)) return "hectares";
  if (/construções|benfeitorias|água|acesso|energia/i.test(question)) return "não";
  return "NÃO SEI";
};
async function drive(token: string, profile: "PROPRIETARIO" | "LOCADOR" | "CORRETOR", type = "apartamento", purpose?: string) {
  let result = await publicTurn(db as never, { token, text: profile, profile });
  for (let i = 0; i < 40; i++) {
    const draft = await state(token);
    if (draft.step === "photo") return draft;
    const question = (result as any).question as string;
    let answer = answerFor(question);
    if (/tipo/i.test(question)) answer = type;
    if (purpose && /sendo cadastrado/i.test(question)) answer = purpose;
    result = await publicTurn(db as never, { token, text: answer });
  }
  throw new Error("roteiro não chegou à foto");
}

describe("LINK_CAPTACAO — roteiro exato A-U", () => {
  test("WhatsApp usa a frase fixa, isola remetentes e conclui na foto", async () => {
    expect(isFixedWhatsappCaptureTrigger("vamos cadastrar seu imóvel?")).toBe(true);
    expect(isFixedWhatsappCaptureTrigger("Tenho interesse em cadastrar meu imóvel")).toBe(false);
    expect(isFixedWhatsappCaptureTrigger("LINK_CAPTACAO")).toBe(false);

    const first = "5513997726767";
    const second = "5513997726768";
    const opening = await whatsappCaptureText(db as never, first, "Vamos cadastrar seu imóvel?", "Ana");
    expect(opening?.text).toBe("Você é proprietário, locador ou corretor?");
    expect((await whatsappCaptureText(db as never, first, "LOCADOR"))?.text).toBe("Qual é o seu nome completo?");
    expect((await whatsappCaptureText(db as never, second, "Vamos cadastrar seu imóvel?", "Corretor"))?.text)
      .toBe("Você é proprietário, locador ou corretor?");
    expect((await whatsappCaptureText(db as never, second, "CORRETOR"))?.text).toBe("Qual é o seu nome completo?");
    expect((await whatsappCaptureText(db as never, second, "Ana Souza"))?.text).toBe("Qual é o seu CRECI?");
    expect((await whatsappCaptureSession(db as never, first))?.draft.profile).toBe("LOCADOR");
    expect((await whatsappCaptureSession(db as never, second))?.draft.profile).toBe("CORRETOR");

    let reply = await whatsappCaptureText(db as never, first, "Ana Souza");
    for (let i = 0; i < 40 && reply && !reply.text.includes("foto da frente"); i++) {
      const answer = answerFor(reply.text);
      reply = await whatsappCaptureText(db as never, first, answer);
    }
    const waiting = await whatsappCaptureSession(db as never, first);
    expect(waiting?.waitingForPhoto).toBe(true);
    const photo = await whatsappCapturePhoto(db as never, first, "/api/media/test-photo");
    expect(photo?.text).toBe(WHATSAPP_CAPTURE_SUCCESS);
    expect(await whatsappCaptureSession(db as never, first)).toBeNull();
  });

  test("1 owner apartment sale persists progressive answers and price", async () => {
    const token = await link("5513997141174"); const draft = await drive(token, "PROPRIETARIO");
    expect(draft.propertyType).toBe("apartamento"); expect(draft.intention).toBe("venda"); expect(draft.askingPrice).toBe(450000);
    expect(draft.answers.dormitorios).toBe("2");
    expect((await db.all(sql`SELECT count(*) n FROM property_captures`))[0]!.n).toBe(1);
  });
  test("2 owner land skips residential and condominium-name fields without skipping price", async () => { const t = await link("5513997141174"); const d = await drive(t, "PROPRIETARIO", "terreno"); expect(d.answers.dormitorios).toBeUndefined(); expect(d.answers.condominioNome).toBeUndefined(); expect(d.propertyType).toBe("terreno"); expect(d.askingPrice).toBe(450000); });
  test("3 owner rural collects rural fields", async () => { const t = await link("5513997141174"); const d = await drive(t, "PROPRIETARIO", "sitio"); expect(d.answers.areaTotal).toBeDefined(); expect(d.answers.agua).toBeDefined(); });
  test("4 locador apartment collects rent-specific fields", async () => { const t = await link("5513997141174"); const d = await drive(t, "LOCADOR"); expect(d.intention).toBe("locacao"); expect(d.answers.disponibilidade).toBeDefined(); expect(d.answers.mobilia).toBeDefined(); });
  test("5 locador land", async () => { const t = await link("5513997141174"); const d = await drive(t, "LOCADOR", "lote"); expect(d.answers.dormitorios).toBeUndefined(); expect(d.intention).toBe("locacao"); });
  test("6 locador rural", async () => { const t = await link("5513997141174"); const d = await drive(t, "LOCADOR", "fazenda"); expect(d.answers.energia).toBeDefined(); });
  test("7 broker sale reuses the hidden system owner even beyond the ordinary owner scan limit", async () => {
    await db.run(sql.raw(`WITH RECURSIVE seq(n) AS (
      SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 501
    ) INSERT INTO owners (name) SELECT 'Owner ' || n FROM seq`));
    const t = await link();
    const d = await drive(t, "CORRETOR", "casa", "VENDA");
    expect(d.brokerName).toBe("Ana Souza");
    expect(d.brokerCreci).toContain("12345");
    expect(d.ownerName).toBeUndefined();
    const sentinels = await db.all<{ system_key: string; notes: string | null }>(
      sql`SELECT system_key, notes FROM owners WHERE system_key = 'LINK_CAPTACAO_BROKER_UNIDENTIFIED'`,
    );
    expect(sentinels).toHaveLength(1);
    expect(sentinels[0]?.notes ?? "").not.toContain("Ana Souza");
    expect((await db.all<{ n: number }>(sql`SELECT count(*) n FROM owners WHERE name = 'Não informado' AND system_key IS NULL`))[0]!.n).toBe(0);
  });
  test("8 broker rent", async () => { const t = await link(); const d = await drive(t, "CORRETOR", "casa", "LOCAÇÃO"); expect(d.intention).toBe("locacao"); expect(d.ownerName).toBeUndefined(); });
  test("9 known phone, invalid name and insufficient address do not advance", async () => { const t = await link("5513997141174"); await publicTurn(db as never, { token: t, text: "PROPRIETARIO", profile: "PROPRIETARIO" }); await publicTurn(db as never, { token: t, text: "abc" }); expect((await state(t)).step).toBe("name"); await publicTurn(db as never, { token: t, text: "Ana Souza" }); expect((await state(t)).step).toBe("address"); await publicTurn(db as never, { token: t, text: "Rua A" }); expect((await state(t)).step).toBe("address"); expect((await db.all(sql`SELECT count(*) n FROM property_captures`))[0]!.n).toBe(0); });
  test("10 zero and unknown stay distinct and bedroom is not price", async () => { const t = await link("5513997141174"); const d = await drive(t, "PROPRIETARIO"); expect(d.answers.dormitorios).toBe("2"); expect(d.askingPrice).toBe(450000); const t2 = await link("5513997141175"); await drive(t2, "PROPRIETARIO", "terreno"); expect((await state(t2)).askingPrice).not.toBe(2); });
  test("11 facade persists on the same EPI and is terminal/idempotently guarded", async () => {
    const t = await link("5513997141174");
    await drive(t, "PROPRIETARIO");
    const before = (await db.all<{ id: number; serial: string }>(sql`SELECT id,serial FROM property_captures`))[0]!;
    const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    const result = await publicFacade(db as never, { token: t, facadeImage: image });
    expect(result.message).toBe("Cadastro concluído com sucesso! Recebemos as informações do seu imóvel e nossa equipe entrará em contato em breve.");
    const after = (await db.all<{ id: number; serial: string; registration_status: string; owner_photos: string }>(sql`SELECT id,serial,registration_status,owner_photos FROM property_captures`))[0]!;
    expect(after.id).toBe(before.id); expect(after.serial).toBe(before.serial); expect(after.registration_status).toBe("CONCLUIDO"); expect(after.owner_photos).toContain("/api/media/");
    expect((await db.all<{ n: number }>(sql`SELECT count(*) n FROM media`))[0]!.n).toBe(1);
    await expect(publicTurn(db as never, { token: t, text: "qualquer coisa" })).rejects.toThrow();
    await expect(publicFacade(db as never, { token: t, facadeImage: image })).rejects.toThrow();
    expect((await db.all<{ n: number }>(sql`SELECT count(*) n FROM media`))[0]!.n).toBe(1);
    const concurrent = await link("5513997141175", "def456def456def");
    await drive(concurrent, "PROPRIETARIO");
    const results = await Promise.allSettled([
      publicFacade(db as never, { token: concurrent, facadeImage: image }),
      publicFacade(db as never, { token: "def456def456def", facadeImage: image }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await db.all<{ n: number }>(sql`SELECT count(*) n FROM media`))[0]!.n).toBe(2);
  });
  test("12 links isolate and resume same EPI", async () => { const a = await link("5513997141174"); await publicTurn(db as never, { token: a, text: "PROPRIETARIO", profile: "PROPRIETARIO" }); await publicTurn(db as never, { token: a, text: "Ana Souza" }); await publicTurn(db as never, { token: a, text: "Rua A, 1, Centro, Praia Grande - SP" }); const first = await db.all<{ id: number; serial: string }>(sql`SELECT id,serial FROM property_captures`); await publicTurn(db as never, { token: a, text: "SEM COMPLEMENTO" }); const second = await db.all<{ id: number; serial: string }>(sql`SELECT id,serial FROM property_captures`); expect(second).toEqual(first); });
  test("13 short alias and legacy token resolve the same state", async () => { const t = await link("5513997141174", "abc123abc123abc"); await publicTurn(db as never, { token: t, text: "PROPRIETARIO", profile: "PROPRIETARIO" }); const alias = await (await import("./owner-intake-links")).publicTurn(db as never, { token: "abc123abc123abc", text: "Ana Souza" }); expect(alias).toBeDefined(); expect(JSON.stringify(alias)).not.toContain(t); expect(JSON.stringify(alias)).not.toContain("tokenHash"); });
});
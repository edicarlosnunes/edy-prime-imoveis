import { beforeEach, describe, expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { sql } from "drizzle-orm";
import {
  completeCaptureShareToken,
  completeCurrentCaptureShareForSender,
  bindCaptureShareToCapture,
  issueCaptureShareToken,
  latestCaptureShareForSender,
  lookupCurrentCaptureSession,
  redeemCaptureShareToken,
  revokeCaptureShareToken,
  validateCaptureShareToken,
} from "./capture-share-tokens";
import type { getDb } from "./auth";

type Db = Awaited<ReturnType<typeof getDb>>;
let db: Db;

async function freshDb() {
  const instance = drizzle(createClient({ url: ":memory:" }));
  await instance.run(sql`CREATE TABLE capture_share_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'active',
    sender_phone TEXT,
    capture_id INTEGER,
    created_by INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    revoked_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    redeemed_at INTEGER,
    completed_at INTEGER
  )`);
  await instance.run(sql`CREATE TABLE conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    channel TEXT NOT NULL DEFAULT 'site',
    external_id TEXT,
    lead_id INTEGER,
    client_id INTEGER,
    property_id INTEGER,
    agent_id INTEGER,
    contact_name TEXT,
    contact_phone TEXT,
    mode TEXT NOT NULL DEFAULT 'ia',
    assigned_to INTEGER,
    assigned_name TEXT,
    transfer_reason TEXT,
    transferred_at INTEGER,
    status TEXT NOT NULL DEFAULT 'aberta',
    unread INTEGER NOT NULL DEFAULT 0,
    last_message TEXT,
    last_message_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`);
  return instance as unknown as Db;
}

beforeEach(async () => {
  db = await freshDb();
});

describe("links exclusivos de captação", () => {
  test("grava apenas o hash e permite validar enquanto ativo", async () => {
    const token = await issueCaptureShareToken(db, 9);
    const rows = await db.all<{ token_hash: string }>(sql`SELECT token_hash FROM capture_share_tokens`);
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(rows[0]?.token_hash).not.toBe(token);
    expect(await validateCaptureShareToken(db, token)).toMatchObject({ status: "active" });
    expect(await validateCaptureShareToken(db, "invalid")).toBeNull();
  });

  test("token não usado expira em 30 dias e então não pode ser resgatado", async () => {
    const token = await issueCaptureShareToken(db, 9);
    const [row] = await db.all<{ id: number; expires_at: number }>(sql`SELECT id, expires_at FROM capture_share_tokens`);
    const ttlSeconds = Number(row.expires_at) - Math.floor(Date.now() / 1000);
    expect(ttlSeconds).toBeGreaterThan(29 * 24 * 60 * 60);
    expect(ttlSeconds).toBeLessThanOrEqual(30 * 24 * 60 * 60);

    await db.run(sql`UPDATE capture_share_tokens SET expires_at = ${Math.floor(Date.now() / 1000) - 1} WHERE id = ${row.id}`);
    expect(await validateCaptureShareToken(db, token)).toBeNull();
    expect(await redeemCaptureShareToken(db, token, "5513999991111")).toEqual({ ok: false, status: "unavailable" });
  });

  test("admin revoga um link ativo sem precisar expor seu token", async () => {
    const token = await issueCaptureShareToken(db, 9);
    const [row] = await db.all<{ id: number }>(sql`SELECT id FROM capture_share_tokens`);
    expect(await revokeCaptureShareToken(db, row.id)).toBe(true);
    expect(await validateCaptureShareToken(db, token)).toBeNull();
    expect(await redeemCaptureShareToken(db, token, "5513999991111")).toEqual({ ok: false, status: "unavailable" });
    expect(await revokeCaptureShareToken(db, row.id)).toBe(false);
  });

  test("resgate é atômico; só o primeiro remetente vincula o token", async () => {
    const token = await issueCaptureShareToken(db, 1);
    const results = await Promise.all([
      redeemCaptureShareToken(db, token, "+55 (13) 99999-1111"),
      redeemCaptureShareToken(db, token, "+55 (13) 98888-2222"),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    const winner = results.find((result) => result.ok);
    expect(winner).toBeDefined();
    const winnerPhone = results[0].ok ? "5513999991111" : "5513988882222";
    expect(await redeemCaptureShareToken(db, token, winnerPhone)).toEqual({ ok: true, status: "redeemed" });
    expect(await redeemCaptureShareToken(db, token, "5513777773333")).toEqual({ ok: false, status: "unavailable" });
    expect(await validateCaptureShareToken(db, token)).toBeNull();
  });

  test("conclui o link e permite localizar a sessão WhatsApp atual do remetente", async () => {
    const token = await issueCaptureShareToken(db, 1);
    await redeemCaptureShareToken(db, token, "(13) 97777-1234");
    const [row] = await db.all<{ id: number }>(sql`SELECT id FROM capture_share_tokens`);
    expect(await revokeCaptureShareToken(db, row.id)).toBe(false);
    await db.run(sql`UPDATE capture_share_tokens SET expires_at = ${Math.floor(Date.now() / 1000) - 1}`);
    expect(await redeemCaptureShareToken(db, token, "5513977771234")).toEqual({ ok: true, status: "redeemed" });
    await db.run(sql`INSERT INTO conversations (channel, contact_phone, status, created_at)
      VALUES ('whatsapp', '5513977771234', 'aberta', unixepoch())`);

    const session = await lookupCurrentCaptureSession(db, token);
    expect(session?.channel).toBe("whatsapp");
    expect(await completeCaptureShareToken(db, token, "5513977771234")).toBe(true);
    expect(await completeCaptureShareToken(db, token, "5513977771234")).toBe(false);
    expect(await redeemCaptureShareToken(db, token, "5513977771234")).toEqual({ ok: false, status: "completed" });
    expect(await lookupCurrentCaptureSession(db, "not-a-token")).toBeNull();
  });

  test("vincula a captura uma vez e rejeita uma captura diferente", async () => {
    const token = await issueCaptureShareToken(db, 1);
    await redeemCaptureShareToken(db, token, "(13) 96666-4444");

    expect(await bindCaptureShareToCapture(db, "5513966664444", 31)).toEqual({ ok: true, status: "bound" });
    expect(await bindCaptureShareToCapture(db, "(13) 96666-4444", 31)).toEqual({ ok: true, status: "already_bound" });
    expect(await bindCaptureShareToCapture(db, "5513966664444", 32)).toEqual({ ok: false, status: "conflict" });
    expect(await latestCaptureShareForSender(db, "13966664444")).toMatchObject({ captureId: 31, status: "redeemed" });
    expect(await bindCaptureShareToCapture(db, "5513000000000", 99)).toEqual({ ok: false, status: "not_found" });
  });

  test("compare-and-set impede dois cadastros de tomarem a mesma origem", async () => {
    const token = await issueCaptureShareToken(db, 1);
    await redeemCaptureShareToken(db, token, "5513955550000");
    const results = await Promise.all([
      bindCaptureShareToCapture(db, "5513955550000", 101),
      bindCaptureShareToCapture(db, "5513955550000", 202),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    const latest = await latestCaptureShareForSender(db, "5513955550000");
    expect(latest?.captureId).toBe(results[0].ok ? 101 : 202);
  });

  test("consulta e conclui somente o link resgatado mais recente do remetente", async () => {
    const older = await issueCaptureShareToken(db, 1);
    await redeemCaptureShareToken(db, older, "5513944442222");
    await Bun.sleep(3);
    const newer = await issueCaptureShareToken(db, 1);
    await redeemCaptureShareToken(db, newer, "5513944442222");

    const latest = await latestCaptureShareForSender(db, "13944442222");
    expect(latest?.status).toBe("redeemed");
    expect(await completeCurrentCaptureShareForSender(db, "5513944442222")).toBe(true);
    expect(await latestCaptureShareForSender(db, "5513944442222")).toMatchObject({ id: latest?.id, status: "completed" });
    expect(await completeCurrentCaptureShareForSender(db, "5513944442222")).toBe(false);
  });
});
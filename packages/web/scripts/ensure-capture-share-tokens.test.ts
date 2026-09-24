import { afterEach, describe, expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { ensureCaptureShareTokens } from "./ensure-capture-share-tokens";

const clients: ReturnType<typeof createClient>[] = [];

function createMemoryDb() {
  const client = createClient({ url: ":memory:" });
  clients.push(client);
  return client;
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

describe("focused share-token schema migration", () => {
  test("creates only the current table and sender index when absent", async () => {
    const client = createMemoryDb();
    await client.execute("CREATE TABLE leads (id INTEGER PRIMARY KEY, name TEXT)");
    await client.execute("INSERT INTO leads (id, name) VALUES (1, 'preserved lead')");

    await ensureCaptureShareTokens(client);
    await ensureCaptureShareTokens(client);

    const columns = await client.execute("PRAGMA table_info(capture_share_tokens)");
    expect(columns.rows.map((row) => String(row.name))).toEqual([
      "id",
      "token_hash",
      "status",
      "sender_phone",
      "capture_id",
      "created_by",
      "expires_at",
      "revoked_at",
      "created_at",
      "redeemed_at",
      "completed_at",
    ]);
    const index = await client.execute("PRAGMA index_info(capture_share_tokens_sender_idx)");
    expect(index.rows.map((row) => String(row.name))).toEqual(["sender_phone", "status"]);
    const lead = await client.execute("SELECT name FROM leads WHERE id = 1");
    expect(lead.rows).toEqual([{ name: "preserved lead" }]);
    const createdTables = await client.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'capture_share_tokens'",
    );
    expect(createdTables.rows).toHaveLength(1);
  });

  test("adds only the missing old columns, backfills expiry, and preserves token metadata", async () => {
    const client = createMemoryDb();
    await client.execute(`CREATE TABLE capture_share_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'active',
      sender_phone TEXT,
      capture_id INTEGER,
      created_by INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      redeemed_at INTEGER,
      completed_at INTEGER,
      legacy_token_metadata TEXT
    )`);
    await client.execute(`INSERT INTO capture_share_tokens
      (token_hash, status, sender_phone, capture_id, created_by, created_at, redeemed_at,
       completed_at, legacy_token_metadata)
      VALUES ('existing-hash', 'redeemed', '+15551234567', 41, 7, 1000, 1200, 1300, 'keep-me')`);

    await ensureCaptureShareTokens(client);
    await ensureCaptureShareTokens(client);

    const rows = await client.execute(
      `SELECT token_hash, status, sender_phone, capture_id, created_by, created_at,
        redeemed_at, completed_at, legacy_token_metadata, expires_at, revoked_at
       FROM capture_share_tokens`,
    );
    expect(rows.rows).toEqual([{
      token_hash: "existing-hash",
      status: "redeemed",
      sender_phone: "+15551234567",
      capture_id: 41,
      created_by: 7,
      created_at: 1000,
      redeemed_at: 1200,
      completed_at: 1300,
      legacy_token_metadata: "keep-me",
      expires_at: 2593000,
      revoked_at: null,
    }]);
    const index = await client.execute("PRAGMA index_info(capture_share_tokens_sender_idx)");
    expect(index.rows.map((row) => String(row.name))).toEqual(["sender_phone", "status"]);
  });

  test("accepts an already-current table without changing existing values", async () => {
    const client = createMemoryDb();
    await ensureCaptureShareTokens(client);
    await client.execute(`INSERT INTO capture_share_tokens
      (token_hash, created_by, expires_at, created_at) VALUES ('expired-hash', 3, 0, 2000)`);

    await ensureCaptureShareTokens(client);
    await ensureCaptureShareTokens(client);

    const row = await client.execute(
      "SELECT token_hash, created_by, expires_at, created_at FROM capture_share_tokens",
    );
    expect(row.rows).toEqual([{
      token_hash: "expired-hash",
      created_by: 3,
      expires_at: 0,
      created_at: 2000,
    }]);
  });

  test("fails closed on an incompatible pre-existing schema", async () => {
    const client = createMemoryDb();
    await client.execute("CREATE TABLE capture_share_tokens (id INTEGER PRIMARY KEY, token_hash TEXT)");

    await expect(ensureCaptureShareTokens(client)).rejects.toThrow(
      "capture_share_tokens schema is invalid",
    );
  });
});
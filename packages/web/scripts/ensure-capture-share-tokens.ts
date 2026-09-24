import { createClient } from "@libsql/client";

type SqlExecutor = {
  execute: (statement: string) => Promise<{ rows: Array<Record<string, unknown>> }>;
};

const createTableSql = `CREATE TABLE IF NOT EXISTS capture_share_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active',
  sender_phone TEXT,
  capture_id INTEGER,
  created_by INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL,
  redeemed_at INTEGER,
  completed_at INTEGER
)`;

const senderIndexSql =
  "CREATE INDEX IF NOT EXISTS capture_share_tokens_sender_idx ON capture_share_tokens (sender_phone, status)";
const expectedColumns = {
  id: { type: "INTEGER", notnull: 1, pk: 1 },
  token_hash: { type: "TEXT", notnull: 1, pk: 0 },
  status: { type: "TEXT", notnull: 1, pk: 0 },
  sender_phone: { type: "TEXT", notnull: 0, pk: 0 },
  capture_id: { type: "INTEGER", notnull: 0, pk: 0 },
  created_by: { type: "INTEGER", notnull: 1, pk: 0 },
  expires_at: { type: "INTEGER", notnull: 1, pk: 0 },
  revoked_at: { type: "INTEGER", notnull: 0, pk: 0 },
  created_at: { type: "INTEGER", notnull: 1, pk: 0 },
  redeemed_at: { type: "INTEGER", notnull: 0, pk: 0 },
  completed_at: { type: "INTEGER", notnull: 0, pk: 0 },
} as const;

function rowText(row: Record<string, unknown>, key: string) {
  return String(row[key] ?? "");
}

async function tableExists(executor: SqlExecutor) {
  const result = await executor.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'capture_share_tokens'",
  );
  return result.rows.length > 0;
}

async function tableColumns(executor: SqlExecutor) {
  const result = await executor.execute("PRAGMA table_info(capture_share_tokens)");
  return new Map(result.rows.map((row) => [rowText(row, "name"), row]));
}

async function indexColumns(executor: SqlExecutor, indexName: string) {
  const result = await executor.execute(`PRAGMA index_info('${indexName}')`);
  return result.rows.map((row) => rowText(row, "name"));
}

async function assertTokenHashIsUnique(executor: SqlExecutor) {
  const result = await executor.execute("PRAGMA index_list(capture_share_tokens)");
  for (const index of result.rows) {
    if (Number(index.unique) !== 1) continue;
    if ((await indexColumns(executor, rowText(index, "name"))).join(",") === "token_hash") return;
  }
  throw new Error("capture_share_tokens schema is invalid: token_hash must be unique");
}

async function assertSenderIndex(executor: SqlExecutor) {
  const indexList = await executor.execute("PRAGMA index_list(capture_share_tokens)");
  const namedIndex = indexList.rows.find(
    (row) => rowText(row, "name") === "capture_share_tokens_sender_idx",
  );
  if (!namedIndex || Number(namedIndex.unique) !== 0) {
    throw new Error("capture_share_tokens schema is invalid: sender index is missing or unique");
  }
  const columns = await indexColumns(executor, "capture_share_tokens_sender_idx");
  if (columns.join(",") !== "sender_phone,status") {
    throw new Error("capture_share_tokens schema is invalid: sender index columns are incorrect");
  }
}

async function assertTableSchema(executor: SqlExecutor) {
  const columns = await tableColumns(executor);
  for (const [name, expected] of Object.entries(expectedColumns)) {
    const actual = columns.get(name);
    if (!actual) {
      throw new Error(`capture_share_tokens schema is invalid: missing column ${name}`);
    }
    if (
      rowText(actual, "type").toUpperCase() !== expected.type ||
      Number(actual.notnull) !== expected.notnull ||
      Number(actual.pk) !== expected.pk
    ) {
      throw new Error(`capture_share_tokens schema is invalid: column ${name} has an unexpected definition`);
    }
  }
  if (rowText(columns.get("status")!, "dflt_value").replaceAll("'", "") !== "active") {
    throw new Error("capture_share_tokens schema is invalid: status default must be active");
  }
  const definition = await executor.execute(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'capture_share_tokens'",
  );
  if (!rowText(definition.rows[0] ?? {}, "sql").toUpperCase().includes("AUTOINCREMENT")) {
    throw new Error("capture_share_tokens schema is invalid: id must use AUTOINCREMENT");
  }
  await assertTokenHashIsUnique(executor);
}

/**
 * Creates/upgrades only the share-token table and its sender index. Safe to call
 * repeatedly; existing rows and any legacy-only columns are left untouched.
 */
export async function ensureCaptureShareTokens(executor: SqlExecutor) {
  let addedExpiresAt = false;
  if (!(await tableExists(executor))) {
    await executor.execute(createTableSql);
  } else {
    const columns = await tableColumns(executor);
    for (const required of [
      "id",
      "token_hash",
      "status",
      "sender_phone",
      "capture_id",
      "created_by",
      "created_at",
      "redeemed_at",
      "completed_at",
    ]) {
      if (!columns.has(required)) {
        throw new Error(`capture_share_tokens schema is invalid: missing column ${required}`);
      }
    }
    for (const [name, definition] of [
      ["expires_at", "INTEGER NOT NULL DEFAULT 0"],
      ["revoked_at", "INTEGER"],
    ]) {
      if (!columns.has(name)) {
        await executor.execute(`ALTER TABLE capture_share_tokens ADD COLUMN ${name} ${definition}`);
        if (name === "expires_at") addedExpiresAt = true;
      }
    }
    if (addedExpiresAt) {
      await executor.execute(
        "UPDATE capture_share_tokens SET expires_at = created_at + 2592000 WHERE expires_at = 0",
      );
    }
  }

  await assertTableSchema(executor);

  const indexList = await executor.execute("PRAGMA index_list(capture_share_tokens)");
  const sameName = indexList.rows.find(
    (row) => rowText(row, "name") === "capture_share_tokens_sender_idx",
  );
  if (sameName) {
    await assertSenderIndex(executor);
  } else {
    await executor.execute(senderIndexSql);
    await assertSenderIndex(executor);
  }
}

async function runProductionBuildMigration() {
  if (process.env.VERCEL_ENV !== "production") return;

  const url = process.env.DATABASE_URL;
  const authToken = process.env.DATABASE_AUTH_TOKEN;
  if (!url?.trim() || !authToken?.trim()) {
    throw new Error(
      "Production share-token migration requires DATABASE_URL and DATABASE_AUTH_TOKEN.",
    );
  }

  const client = createClient({ url, authToken });
  try {
    await ensureCaptureShareTokens(client);
  } finally {
    await client.close();
  }
}

if (import.meta.main) {
  try {
    await runProductionBuildMigration();
  } catch (error) {
    const message =
      error instanceof Error && error.message.startsWith("capture_share_tokens schema is invalid:")
        ? error.message
        : error instanceof Error &&
            error.message ===
              "Production share-token migration requires DATABASE_URL and DATABASE_AUTH_TOKEN."
          ? error.message
          : "Database connection or share-token migration failed.";
    console.error(
      "Production share-token migration failed; refusing to continue the Vercel build.",
      message,
    );
    process.exitCode = 1;
  }
}
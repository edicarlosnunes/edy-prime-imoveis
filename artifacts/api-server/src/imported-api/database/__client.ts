// TEMPLATE-MANAGED (__ prefix) — do not edit. Define tables in ./schema.ts
// and query via: import { db } from "./database";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "./schema";

const configuredUrl = process.env.DATABASE_URL;
const databaseUrl =
  configuredUrl && /^(?:libsql|https?|file):/.test(configuredUrl)
    ? configuredUrl
    : "file:./data/edy-imoveis.db";

const client = createClient({
  url: databaseUrl,
  authToken: process.env.DATABASE_AUTH_TOKEN,
});

export const db = drizzle(client, { schema });

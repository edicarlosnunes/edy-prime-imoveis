// Drop-in replacement for `@libsql/client` in the serverless bundle.
// The default entry loads a native binary (libsql + @neon-rs/load), which
// cannot be shipped in a Vercel function. The /web entry is pure HTTP, but
// only accepts https:// URLs, so libsql:// is rewritten here.
import { createClient as createWebClient } from "@libsql/client/web";

type Config = Parameters<typeof createWebClient>[0];

export function createClient(config: Config) {
  const url = String(config.url ?? "");
  const client = createWebClient({
    ...config,
    url: url.startsWith("libsql://") ? url.replace("libsql://", "https://") : url,
  });

  /*
   * O Drizzle usa `client.execute()` para `db.all(sql`...`)`.
   * No transporte HTTP da Vercel, UPDATE ... RETURNING precisa preservar
   * explicitamente as linhas devolvidas. Expor executeMultiple/transaction
   * não resolve o contador EPI; o que importa aqui é manter o resultado de
   * execute intacto para o readNext() receber { rows: [...] }.
   */
  return client;
}

export * from "@libsql/client/web";

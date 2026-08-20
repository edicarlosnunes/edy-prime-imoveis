// Drop-in replacement for `@libsql/client` in the serverless bundle.
// The default entry loads a native binary (libsql + @neon-rs/load), which
// cannot be shipped in a Vercel function. The /web entry is pure HTTP, but
// only accepts https:// URLs, so libsql:// is rewritten here.
import { createClient as createWebClient } from "@libsql/client/web";

type Config = Parameters<typeof createWebClient>[0];

export function createClient(config: Config) {
  const url = String(config.url ?? "");
  return createWebClient({
    ...config,
    url: url.startsWith("libsql://") ? url.replace("libsql://", "https://") : url,
  });
}

export * from "@libsql/client/web";

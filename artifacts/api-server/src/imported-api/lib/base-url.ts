/** URL pública do site — usada em feed, sitemap, OG e testes de integração. */
const FALLBACK = "https://www.edyprimeimoveis.com.br";

export function siteBaseUrl(headers?: Headers) {
  const fromEnv = (process.env.WEBSITE_URL ?? "").trim().replace(/\/+$/, "");
  if (fromEnv) return fromEnv;
  const host = headers?.get("x-forwarded-host") ?? headers?.get("host") ?? "";
  if (host) {
    const proto = host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https";
    return `${proto}://${host}`;
  }
  return FALLBACK;
}

export function clientIp(headers?: Headers) {
  return headers?.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
}

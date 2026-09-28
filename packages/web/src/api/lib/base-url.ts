/** URL pública canônica do site — usada em feed, sitemap, OG e testes de integração. */
const FALLBACK = "https://www.esantoscorretor.com.br";
const LEGACY_DOMAIN = /^https?:\/\/(?:www\.)?edyprimeimoveis\.com\.br$/i;
const NEW_DOMAIN = /^https?:\/\/(?:www\.)?esantoscorretor\.com\.br$/i;

export function siteBaseUrl(headers?: Headers) {
  const fromEnv = (process.env.WEBSITE_URL ?? "").trim().replace(/\/+$/, "");
  // Um WEBSITE_URL legado não deve devolver URLs públicas com a marca antiga.
  if (NEW_DOMAIN.test(fromEnv)) return FALLBACK;
  if (fromEnv && !LEGACY_DOMAIN.test(fromEnv)) return fromEnv;
  const host = headers?.get("x-forwarded-host") ?? headers?.get("host") ?? "";
  if (host.startsWith("localhost") || host.startsWith("127.")) return `http://${host}`;
  return FALLBACK;
}

export function clientIp(headers?: Headers) {
  return headers?.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
}

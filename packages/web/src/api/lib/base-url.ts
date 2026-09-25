/** URL pública do site — usada em feed, sitemap, OG e testes de integração. */
const FALLBACK = "https://esantoscorretor.com.br";

export function siteBaseUrl(headers?: Headers) {
  const fromEnv = (process.env.WEBSITE_URL ?? "").trim().replace(/\/+$/, "");
  if (fromEnv && !/^https?:\/\/(?:www\.)?edyprimeimoveis\.com\.br$/i.test(fromEnv)) return fromEnv;
  const host = headers?.get("x-forwarded-host") ?? headers?.get("host") ?? "";
  if (host.startsWith("localhost") || host.startsWith("127.")) return `http://${host}`;
  // Em previews e no domínio antigo, URLs públicas apontam para o novo domínio.
  return FALLBACK;
}

export function clientIp(headers?: Headers) {
  return headers?.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
}

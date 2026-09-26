/** URL pública do site — usada em feed, sitemap, OG e testes de integração. */
import { PUBLIC_SITE_URL } from "../../shared/public-site-url";

export function siteBaseUrl(headers?: Headers, configuredUrl = PUBLIC_SITE_URL) {
  const host = headers?.get("x-forwarded-host") ?? headers?.get("host") ?? "";
  if (host.startsWith("localhost") || host.startsWith("127.")) return `http://${host}`;
  return configuredUrl;
}

export function clientIp(headers?: Headers) {
  return headers?.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
}

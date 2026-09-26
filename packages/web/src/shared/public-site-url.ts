/** URL canônica pública. Trocar aqui quando o novo domínio estiver ativo. */
export const PUBLIC_SITE_URL = "https://www.edyprimeimoveis.com.br";

/** Aceita o domínio configurado com ou sem www nos acessos oficiais. */
export function isPublicSiteHostname(hostname: string) {
  const configured = new URL(PUBLIC_SITE_URL).hostname;
  return hostname === configured ||
    hostname === (configured.startsWith("www.") ? configured.slice(4) : `www.${configured}`);
}
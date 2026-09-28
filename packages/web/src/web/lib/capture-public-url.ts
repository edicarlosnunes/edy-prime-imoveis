/** Domínios de produção reconhecidos durante a transição de marca.
 * Não reconhecer *.vercel.app nem aceitar sufixos parecidos.
 * Os links recém-emitidos sempre usam o endereço oficial novo.
 */
export const PUBLIC_CAPTURE_URL = "https://www.esantoscorretor.com.br/link-captacao";

const PRODUCTION_HOSTS = new Set([
  "www.esantoscorretor.com.br",
  "esantoscorretor.com.br",
  "www.edyprimeimoveis.com.br",
  "edyprimeimoveis.com.br",
]);

export function isOfficialCaptureHost(hostname: string): boolean {
  return PRODUCTION_HOSTS.has(hostname.toLowerCase());
}

export function captureShareUrl(token: string): string {
  return `${PUBLIC_CAPTURE_URL}/${token}`;
}

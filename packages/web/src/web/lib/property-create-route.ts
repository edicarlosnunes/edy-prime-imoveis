/** A ficha também deve abrir quando a URL é acessada diretamente, sem capture_id. */
export function isPropertyCreateRoute(path: string): boolean {
  return path === "/admin/imoveis/novo";
}

/** Não manda a equipe para Anúncios quando a ficha nasceu na Captação. */
export function propertyFormReturnPath(captureId: number | null, fromCaptureHub: boolean): string {
  if (captureId !== null) return `/admin/captacao?capture=${captureId}`;
  return fromCaptureHub ? "/admin/captacao" : "/admin/imoveis";
}
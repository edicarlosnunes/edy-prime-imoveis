/** A ficha também deve abrir quando a URL é acessada diretamente, sem capture_id. */
export function isPropertyCreateRoute(path: string): boolean {
  return path === "/admin/imoveis/novo";
}
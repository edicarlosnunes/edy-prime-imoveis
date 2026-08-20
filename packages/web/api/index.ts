import app from "../src/api/index";

/**
 * Vercel Serverless Function — ponto de entrada da API em produção.
 *
 * Em desenvolvimento o Hono roda dentro do Vite (hono-dev-plugin) e, no servidor
 * Bun, dentro de src/__server.ts. Na Vercel só existe o build estático do Vite,
 * então nenhum desses dois entra em cena: esta função é quem passa a servir
 * /api/* — inclusive as procedures oRPC em /api/rpc/*.
 *
 * O rewrite de /api/(.*) para cá está em vercel.json. O path original da
 * requisição é preservado, então o roteamento do Hono continua igual.
 */
export default async function handler(request: Request): Promise<Response> {
  return app.fetch(request);
}

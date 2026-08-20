import app from "../packages/web/src/api/index";

/**
 * Vercel Serverless Function — fallback para quando o projeto na Vercel usa a
 * raiz do monorepo como Root Directory. Quando o Root Directory é
 * packages/web, quem responde é packages/web/api/index.ts (mesma implementação).
 *
 * Serve /api/* em produção, inclusive as procedures oRPC em /api/rpc/*.
 */
export default async function handler(request: Request): Promise<Response> {
  return app.fetch(request);
}

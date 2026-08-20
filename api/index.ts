import app from "../packages/web/src/api/index";

/**
 * Vercel Function — fallback para quando o projeto na Vercel usa a raiz do
 * monorepo como Root Directory. Quando o Root Directory é packages/web, quem
 * responde é packages/web/api/index.ts (mesma implementação).
 *
 * runtime "edge" é obrigatório: no runtime Node o @libsql/client resolve para o
 * build nativo (libsql + @neon-rs/load) e quebra no bundle serverless.
 */
export const config = { runtime: "edge" };

export default async function handler(request: Request): Promise<Response> {
  try {
    return await app.fetch(request);
  } catch (error) {
    return Response.json(
      { error: "api_failure", message: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

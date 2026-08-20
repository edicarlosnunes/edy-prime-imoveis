import app from "../src/api/index";

/**
 * Vercel Function — ponto de entrada da API em produção.
 *
 * Em desenvolvimento o Hono roda dentro do Vite (hono-dev-plugin) e, no servidor
 * Bun, dentro de src/__server.ts. Na Vercel só existe o build estático do Vite,
 * então esta função é quem serve /api/* — inclusive as procedures oRPC em
 * /api/rpc/*. O rewrite está em vercel.json.
 *
 * runtime "edge" é obrigatório aqui: no runtime Node o @libsql/client resolve
 * para o build nativo (libsql + @neon-rs/load), que quebra no bundle serverless
 * com "Dynamic require of path is not supported". No edge ele resolve para o
 * cliente HTTP do Turso, que funciona sem binário nativo.
 */
export const config = { runtime: "edge" };

export default async function handler(request: Request): Promise<Response> {
  try {
    return await app.fetch(request);
  } catch (error) {
    // Sem isto a Vercel devolve um FUNCTION_INVOCATION_FAILED opaco.
    return Response.json(
      { error: "api_failure", message: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

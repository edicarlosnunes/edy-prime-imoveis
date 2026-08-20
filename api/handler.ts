import type { IncomingMessage, ServerResponse } from "node:http";
import app from "../packages/web/src/api/index.ts";

/**
 * Vercel Function (runtime Node) que serve toda a API em produção.
 *
 * O rewrite em vercel.json manda /api/* para cá e repassa o caminho original
 * na query __path, porque a rota física é fixa (/api/handler). Sem isso o Hono
 * receberia sempre "/api/handler" e não acharia as procedures oRPC.
 *
 * Em desenvolvimento o mesmo app Hono roda dentro do Vite (hono-dev-plugin) e,
 * no servidor Bun, dentro de src/__server.ts. Na Vercel só existe o build
 * estático do Vite, então sem esta função /api/* não existiria.
 */
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    const method = req.method ?? "GET";
    const proto = (req.headers["x-forwarded-proto"] as string | undefined) ?? "https";
    const host = req.headers.host ?? "localhost";
    const incoming = new URL(req.url ?? "/", `${proto}://${host}`);

    // Reconstrói o caminho original (/api/rpc/properties/list) a partir do rewrite.
    const original = incoming.searchParams.get("__path");
    const url = new URL(incoming);
    if (original) {
      url.pathname = original;
      url.searchParams.delete("__path");
    }

    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === "string") headers.set(key, value);
      else if (Array.isArray(value)) for (const item of value) headers.append(key, item);
    }

    let body: Buffer | undefined;
    if (method !== "GET" && method !== "HEAD") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
    }

    const response = await app.fetch(new Request(url, { method, headers, body }));

    res.statusCode = response.status;
    response.headers.forEach((value, key) => {
      if (key !== "content-encoding" && key !== "content-length") res.setHeader(key, value);
    });
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(
      JSON.stringify({
        error: "api_failure",
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack?.split("\n").slice(0, 4) : undefined,
      }),
    );
  }
}

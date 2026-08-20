import type { IncomingMessage, ServerResponse } from "node:http";
import app from "../src/api/index";

/**
 * Vercel Function (runtime Node) que serve toda a API em produção.
 *
 * O nome do arquivo é um catch-all: /api/health e /api/rpc/properties/list caem
 * aqui com o caminho original preservado, que é o que o roteador do Hono espera.
 *
 * Em desenvolvimento o mesmo app Hono roda dentro do Vite (hono-dev-plugin) e,
 * no servidor Bun, dentro de src/__server.ts. Na Vercel só existe o build
 * estático do Vite, então sem esta função /api/* não existiria.
 *
 * O handler é escrito no formato (req, res) do Node de propósito: é o formato
 * que a Vercel sempre reconhece, sem depender de detecção de handler Web.
 */
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    const method = req.method ?? "GET";
    const proto = (req.headers["x-forwarded-proto"] as string | undefined) ?? "https";
    const host = req.headers.host ?? "localhost";
    const url = new URL(req.url ?? "/", `${proto}://${host}`);

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
    // Sem isto a Vercel devolve um FUNCTION_INVOCATION_FAILED opaco.
    res.statusCode = 500;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(
      JSON.stringify({
        error: "api_failure",
        message: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

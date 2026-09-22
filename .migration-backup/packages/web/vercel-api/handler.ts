// Vercel serverless entry for the API.
// Bundled by ./build.ts into api/handler.mjs (repo root and packages/web),
// so Vercel never has to resolve monorepo-hoisted dependencies at runtime.
// The physical route is fixed at /api/handler; the real request path arrives
// in the ?__path= query param via the rewrite in vercel.json.
import type { IncomingMessage, ServerResponse } from "node:http";
import app from "../src/api";

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
) {
  try {
    const host = req.headers.host ?? "localhost";
    const proto =
      (req.headers["x-forwarded-proto"] as string | undefined) ?? "https";
    const incoming = new URL(req.url ?? "/", `${proto}://${host}`);
    const realPath = incoming.searchParams.get("__path");
    const target = new URL(
      realPath ?? incoming.pathname + incoming.search,
      `${proto}://${host}`,
    );
    if (realPath) {
      for (const [key, value] of incoming.searchParams) {
        if (key !== "__path") target.searchParams.append(key, value);
      }
    }

    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value === undefined) continue;
      if (Array.isArray(value)) for (const v of value) headers.append(key, v);
      else headers.set(key, value);
    }

    const method = req.method ?? "GET";
    let body: Buffer | undefined;
    if (method !== "GET" && method !== "HEAD") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
    }

    const response = await app.fetch(
      new Request(target.toString(), { method, headers, body }),
    );

    res.statusCode = response.status;
    response.headers.forEach((value, key) => {
      if (key !== "content-encoding" && key !== "content-length") {
        res.setHeader(key, value);
      }
    });
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
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

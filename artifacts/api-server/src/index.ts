import { mkdir } from "node:fs/promises";
import { serve } from "@hono/node-server";
import { logger } from "./lib/logger";

await mkdir("data", { recursive: true });
await import("./imported-migrate");
const { default: app } = await import("./imported-api");

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

serve({ fetch: app.fetch, port }, () => {
  logger.info({ port }, "Server listening");
});

// Bundles the Vercel serverless API entry into a dependency-free ESM file.
// Run with: bun run packages/web/vercel-api/build.ts
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const webRoot = resolve(import.meta.dir, "..");
const repoRoot = resolve(webRoot, "../..");

const result = await Bun.build({
  entrypoints: [resolve(import.meta.dir, "handler.ts")],
  target: "node",
  format: "esm",
  minify: false,
  external: [],
  plugins: [
    {
      name: "libsql-http-alias",
      setup(build) {
        build.onResolve({ filter: /^@libsql\/client$/ }, () => ({
          path: resolve(import.meta.dir, "libsql-http.ts"),
        }));
      },
    },
  ],
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

const code = await result.outputs[0]!.text();

const targets = [
  resolve(webRoot, "api/handler.mjs"),
  resolve(repoRoot, "api/handler.mjs"),
];

for (const target of targets) {
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, code, "utf8");
  console.log(`wrote ${target} (${(code.length / 1024).toFixed(0)} KB)`);
}

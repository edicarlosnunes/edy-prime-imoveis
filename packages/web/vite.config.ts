import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite"
import path from "path";
import runableAnalyticsPlugin from "./vite/__plugins/runable-analytics-plugin";
import honoDevPlugin from "./vite/__plugins/hono-dev-plugin";
import assetOptimizerPlugin from "./vite/__plugins/asset-optimizer-plugin";
import { PUBLIC_SITE_URL } from "./src/shared/public-site-url";

const root = path.resolve(__dirname, "../..");

export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, root, '');
	Object.assign(process.env, env);

	return {
		// All env files live at the repo root — keep Vite's own env loading there too,
		// so packages/web/.env* files can never shadow the root .env.
		envDir: root,
plugins: [
  {
    name: "public-site-url-in-html",
    transformIndexHtml(html) {
      if (!html.includes("__PUBLIC_SITE_URL__")) {
        throw new Error("index.html precisa usar __PUBLIC_SITE_URL__ para URLs públicas.");
      }
      return html.replaceAll("__PUBLIC_SITE_URL__", PUBLIC_SITE_URL);
    },
  },
  honoDevPlugin(), react(), runableAnalyticsPlugin(), tailwind(), assetOptimizerPlugin(),
],
		resolve: {
			alias: {
				"@": path.resolve(__dirname, "./src/web"),
			},
		},
		server: {
			allowedHosts: true,
			hmr: { overlay: false, },
			cors: false
		}
	};
});

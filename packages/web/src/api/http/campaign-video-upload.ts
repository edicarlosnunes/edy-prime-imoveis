import type { Hono } from "hono";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { resolveSession } from "../lib/auth";

export function registerCampaignVideoUpload(app: Hono) {
  app.post("/api/admin/campaigns/video-upload", async (c) => {
    if (!(await resolveSession(c.req.raw.headers))) {
      return c.json({ error: "Não autorizado" }, 401);
    }
    try {
      const body = await c.req.json<HandleUploadBody>();
      const result = await handleUpload({
        body,
        request: c.req.raw,
        onBeforeGenerateToken: async (pathname) => {
          if (pathname !== "campaigns/campaign.mp4") throw new Error("Destino inválido.");
          return {
            allowedContentTypes: ["video/mp4"],
            maximumSizeInBytes: 150 * 1024 * 1024,
            addRandomSuffix: true,
          };
        },
      });
      return c.json(result);
    } catch {
      return c.json({ error: "Falha ao iniciar o envio do vídeo. Confira o armazenamento do CRM." }, 400);
    }
  });
}

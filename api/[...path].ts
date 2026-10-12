import app from "../artifacts/edy-imoveis/src/api/index";

/**
 * Catch-all Vercel Function para servir a API Hono do CRM em previews.
 * Mantém exatamente as mesmas rotas /api/* já usadas pelo frontend.
 */
export default {
  fetch(request: Parameters<typeof app.fetch>[0]) {
    return app.fetch(request);
  },
};

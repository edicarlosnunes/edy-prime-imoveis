/**
 * Base de procedures protegidas: exige sessão administrativa válida.
 * Handlers derivados veem `context.user` garantido e `context.db` pronto.
 */
import { ORPCError } from "@orpc/server";
import { base } from "../__core/app";
import { getDb, resolveSession } from "./auth";

export const adminBase = base.use(async ({ context, next }) => {
  const user = await resolveSession(context.headers);
  if (!user) throw new ORPCError("UNAUTHORIZED", { message: "Sessão expirada" });
  const db = await getDb();
  return next({ context: { user, db } });
});

export type AdminDb = Awaited<ReturnType<typeof getDb>>;

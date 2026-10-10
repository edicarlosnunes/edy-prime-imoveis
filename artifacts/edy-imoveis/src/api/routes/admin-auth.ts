import { z } from "zod";
import { eq } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { base } from "../__core/app";
import { adminBase } from "../lib/admin-base";
import * as schema from "../database/schema";
import { hashPassword, resolveSession, verifyPassword } from "../lib/auth";
import { audit } from "../lib/audit";
import {
  ADMIN_LOGIN_PATTERN,
  getAdminLogin,
  normalizeAdminLogin,
  setAdminLogin,
} from "../lib/admin-login";

/**
 * Sessão do painel. O login/logout ficam em rotas HTTP simples
 * (src/api/index.ts) porque precisam gravar/limpar o cookie de sessão.
 */
export const adminAuth = {
  /** Usuário logado, ou null — usado pelo guard das rotas /admin. */
  me: base.handler(async ({ context }) => {
    const user = await resolveSession(context.headers);
    return { user };
  }),

  /** Login curto configurado para o administrador atual. */
  loginInfo: adminBase.handler(async ({ context }) => {
    return {
      login: await getAdminLogin(context.db, context.user.id),
      email: context.user.email,
    };
  }),

  changeLogin: adminBase
    .input(
      z.object({
        newLogin: z.string().min(3).max(32),
        repeatLogin: z.string().min(3).max(32),
      }),
    )
    .handler(async ({ input, context }) => {
      const [row] = await context.db
        .select()
        .from(schema.adminUsers)
        .where(eq(schema.adminUsers.id, context.user.id))
        .limit(1);
      if (!row) throw new ORPCError("NOT_FOUND", { message: "Usuário não encontrado" });

      const newLogin = normalizeAdminLogin(input.newLogin);
      const repeatLogin = normalizeAdminLogin(input.repeatLogin);
      if (newLogin !== repeatLogin) {
        throw new ORPCError("BAD_REQUEST", { message: "Os logins não conferem" });
      }
      if (!ADMIN_LOGIN_PATTERN.test(newLogin)) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Use de 3 a 32 caracteres: letras minúsculas, números, ponto, hífen ou _",
        });
      }

      await setAdminLogin(context.db, row.id, newLogin);
      await audit(context.db, context.user, "admin.login_alterado", {
        entity: "admin_user",
        entityId: row.id,
        detail: `novo login: ${newLogin}`,
      });

      // exige novo login em todos os dispositivos depois de trocar a credencial
      await context.db
        .delete(schema.adminSessions)
        .where(eq(schema.adminSessions.userId, row.id));

      return { ok: true, login: newLogin };
    }),

  changePassword: adminBase
    .input(
      z.object({
        currentPassword: z.string().min(1),
        newPassword: z.string().min(10).max(200),
      }),
    )
    .handler(async ({ input, context }) => {
      const [row] = await context.db
        .select()
        .from(schema.adminUsers)
        .where(eq(schema.adminUsers.id, context.user.id))
        .limit(1);
      if (!row) throw new ORPCError("NOT_FOUND", { message: "Usuário não encontrado" });

      const ok = await verifyPassword(input.currentPassword, row.passwordHash, row.passwordSalt);
      if (!ok) throw new ORPCError("BAD_REQUEST", { message: "Senha atual incorreta" });

      const { hash, salt } = await hashPassword(input.newPassword);
      await context.db
        .update(schema.adminUsers)
        .set({ passwordHash: hash, passwordSalt: salt })
        .where(eq(schema.adminUsers.id, row.id));

      // invalida todas as outras sessões do usuário
      await context.db
        .delete(schema.adminSessions)
        .where(eq(schema.adminSessions.userId, row.id));

      return { ok: true };
    }),
};

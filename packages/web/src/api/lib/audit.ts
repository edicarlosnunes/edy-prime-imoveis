/**
 * Auditoria: histórico das ações importantes do painel.
 * Nunca guarda token/senha — só o nome do campo alterado.
 */
import { desc } from "drizzle-orm";
import * as schema from "../database/schema";
import type { AdminDb } from "./admin-base";

export interface AuditActor {
  id?: number | null;
  name?: string | null;
}

export async function audit(
  db: AdminDb,
  actor: AuditActor | null,
  action: string,
  options: { entity?: string; entityId?: string | number; detail?: string; ip?: string } = {},
) {
  try {
    await db.insert(schema.auditLog).values({
      userId: actor?.id ?? null,
      userName: actor?.name ?? null,
      action,
      entity: options.entity ?? null,
      entityId: options.entityId === undefined ? null : String(options.entityId),
      detail: options.detail ? options.detail.slice(0, 500) : null,
      ip: options.ip ?? null,
    });
  } catch {
    // auditoria nunca deve derrubar a operação principal
  }
}

export async function recentAudit(db: AdminDb, limit = 100) {
  return db
    .select()
    .from(schema.auditLog)
    .orderBy(desc(schema.auditLog.createdAt))
    .limit(Math.min(limit, 300));
}

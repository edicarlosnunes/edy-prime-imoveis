/**
 * Aplicação da regra dos 12 meses na carteira (item 10 do pedido).
 *
 * A decisão é AUTOMÁTICA: passados 12 meses da entrada em carteira sem venda,
 * o imóvel SAI DA VITRINE sozinho e a ação de revisão já nasce para o
 * corretor. Nada é excluído — `paused_at` e `pause_reason` são marcações
 * aditivas, e o imóvel, suas fotos, seus documentos e seu histórico continuam
 * inteiros no CRM.
 *
 * O ciclo de 4 meses (`web/lib/property-revalidation.ts`) NÃO foi alterado e
 * segue funcionando como antes: ele é revisão periódica, isto aqui é fim de
 * prazo. Uma revalidação recente reinicia a contagem dos 12 meses, porque o
 * imóvel acabou de ser confirmado com o proprietário.
 *
 * A varredura roda de forma preguiçosa, quando a lista de imóveis do CRM é
 * carregada. Sem cron, sem processo em segundo plano: o efeito é idempotente,
 * então rodar de novo não pausa nada duas vezes.
 */
import { eq, isNull } from "drizzle-orm";
import * as schema from "../database/schema";
import type { AdminDb } from "./admin-base";
import { lifecycleView, pauseEffect } from "./portfolio-lifecycle";

export type PausedRow = {
  id: number;
  code: string;
  title: string;
  reason: string;
  monthsInPortfolio: number | null;
};

export type SweepResult = {
  /** Imóveis pausados nesta varredura. */
  paused: PausedRow[];
  /** Quantos imóveis foram examinados. */
  checked: number;
};

/**
 * Pausa os imóveis cujo prazo de 12 meses venceu.
 *
 * Só toca em imóvel que: tem data de entrada em carteira, ainda não está
 * pausado e não está vendido/alugado/retirado. Qualquer um desses casos sai
 * pela regra do próprio `lifecycleView`.
 */
export async function applyDuePauses(db: AdminDb, now: Date = new Date()): Promise<SweepResult> {
  /* Já pausado não entra na varredura — o filtro no banco evita carregar a
     carteira inteira só para descartar. */
  const rows = await db
    .select({
      id: schema.properties.id,
      code: schema.properties.code,
      title: schema.properties.title,
      status: schema.properties.status,
      commercialStatus: schema.properties.commercialStatus,
      pausedAt: schema.properties.pausedAt,
      portfolioEntryAt: schema.properties.portfolioEntryAt,
      lastRevalidationAt: schema.properties.lastRevalidationAt,
    })
    .from(schema.properties)
    .where(isNull(schema.properties.pausedAt))
    .limit(1000);

  const paused: PausedRow[] = [];

  for (const row of rows) {
    const view = lifecycleView(row, now);
    if (!view.shouldPause) continue;

    const effect = pauseEffect(now, view.monthsInPortfolio);

    /* Compare-and-set: se duas telas carregarem juntas, só a primeira
       encontra `paused_at` nulo e grava. A segunda não duplica a tarefa. */
    const changed = await db
      .update(schema.properties)
      .set({
        pausedAt: effect.pausedAt,
        pauseReason: effect.pauseReason,
        /* `published` NÃO é mexido: publicar é decisão editorial do corretor.
           Quem tira da vitrine é `paused_at`, lido por
           `commercial-status.ts#showcaseDecision`. */
        updatedAt: now,
      })
      .where(eq(schema.properties.id, row.id))
      .returning({ id: schema.properties.id });

    if (!changed.length) continue;

    await db.insert(schema.tasks).values({
      title: `Revisar imóvel pausado — ${row.code}`,
      type: "retorno",
      dueAt: effect.nextActionAt,
      status: "pendente",
      notes: [`[property:${row.id}]`, effect.historyNote, effect.nextAction].join("\n"),
    });

    await db.insert(schema.auditLog).values({
      entity: "property",
      entityId: String(row.id),
      action: "property_paused_12m",
      detail: effect.historyNote,
      createdAt: now,
    });

    paused.push({
      id: row.id,
      code: row.code,
      title: row.title,
      reason: effect.pauseReason,
      monthsInPortfolio: view.monthsInPortfolio,
    });
  }

  return { paused, checked: rows.length };
}

/**
 * Documentação inteligente + revalidação de 4 meses (V2).
 *
 * Regras que este arquivo protege:
 * - documento RECEBIDO não vira REGULAR sozinho — status é sempre explícito;
 * - checklist e documento são independentes: dá para responder tudo sem anexo;
 * - revalidação NUNCA altera `properties.status` (isso tiraria o imóvel do
 *   site público e mexeria em dado existente) — só grava datas e histórico;
 * - o ciclo nasce de `portfolio_entry_at`, nunca do Radar ou pré-captação.
 */
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { adminBase } from "../lib/admin-base";
import { audit } from "../lib/audit";
import * as schema from "../database/schema";

const CHECKLIST_ANSWERS = ["sim", "nao", "nao_sabe", "na"] as const;

const DOC_CATEGORIES = [
  "matricula",
  "iptu",
  "escritura",
  "condominio",
  "inventario",
  "procuracao",
  "contrato",
  "certidao",
  "planta_habite_se",
  "outros",
] as const;

const DOC_STATUSES = [
  "recebido",
  "aguardando_analise",
  "analisado",
  "regular",
  "pendencia",
] as const;

const OUTCOMES = [
  "disponivel",
  "vendido",
  "nao_deseja_vender",
  "alterou_condicoes",
  "retornar_depois",
  "sem_resposta",
] as const;

type Outcome = (typeof OUTCOMES)[number];

const CYCLE_MONTHS = 4;
const CLOSING: Outcome[] = ["vendido", "nao_deseja_vender"];

/** Soma meses preservando o fim de mês (31/10 + 4 = 28/02). */
function addMonths(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  const targetDay = result.getDate();
  result.setDate(1);
  result.setMonth(result.getMonth() + months);
  const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(targetDay, lastDay));
  return result;
}

/** Mesma regra da lib do front (web/lib/property-revalidation.ts). */
function nextDueFor(outcome: Outcome, at: Date): Date | null {
  if (CLOSING.includes(outcome)) return null;
  if (outcome === "retornar_depois") return addMonths(at, 2);
  if (outcome === "sem_resposta") return new Date(at.getTime() + 15 * 86_400_000);
  return addMonths(at, CYCLE_MONTHS);
}

async function ensureProperty(
  db: Awaited<ReturnType<typeof import("../lib/auth").getDb>>,
  propertyId: number,
) {
  const [row] = await db
    .select({ id: schema.properties.id, code: schema.properties.code })
    .from(schema.properties)
    .where(eq(schema.properties.id, propertyId))
    .limit(1);
  if (!row) throw new ORPCError("NOT_FOUND", { message: "Imóvel não encontrado" });
  return row;
}

export const adminPropertyDocs = {
  /* ------------------------------------------------------------ leitura */

  /** Checklist + documentos + revalidação de um imóvel. */
  get: adminBase
    .input(z.object({ propertyId: z.number().int().positive() }))
    .handler(async ({ input, context }) => {
      const [property] = await context.db
        .select()
        .from(schema.properties)
        .where(eq(schema.properties.id, input.propertyId))
        .limit(1);
      if (!property) throw new ORPCError("NOT_FOUND", { message: "Imóvel não encontrado" });

      const checklist = await context.db
        .select()
        .from(schema.propertyChecklist)
        .where(eq(schema.propertyChecklist.propertyId, input.propertyId));

      const documents = await context.db
        .select({
          id: schema.propertyDocuments.id,
          category: schema.propertyDocuments.category,
          status: schema.propertyDocuments.status,
          title: schema.propertyDocuments.title,
          fileId: schema.propertyDocuments.fileId,
          fileName: schema.propertyDocuments.fileName,
          note: schema.propertyDocuments.note,
          receivedAt: schema.propertyDocuments.receivedAt,
          analyzedAt: schema.propertyDocuments.analyzedAt,
          createdAt: schema.propertyDocuments.createdAt,
        })
        .from(schema.propertyDocuments)
        .where(eq(schema.propertyDocuments.propertyId, input.propertyId))
        .orderBy(desc(schema.propertyDocuments.createdAt));

      const revalidations = await context.db
        .select()
        .from(schema.propertyRevalidations)
        .where(eq(schema.propertyRevalidations.propertyId, input.propertyId))
        .orderBy(desc(schema.propertyRevalidations.revalidatedAt))
        .limit(50);

      return {
        conditions: {
          inCondominium: property.inCondominium,
          hasHeranca: property.hasHeranca,
          hasPosse: property.hasPosse,
          hasFinanciamento: property.hasFinanciamento,
          hasAluguel: property.hasAluguel,
        },
        revalidation: {
          status: property.status,
          portfolioEntryAt: property.portfolioEntryAt,
          lastRevalidationAt: property.lastRevalidationAt,
          nextRevalidationAt: property.nextRevalidationAt,
          revalidationStatus: property.revalidationStatus,
        },
        checklist,
        documents,
        revalidations,
      };
    }),

  /* ---------------------------------------------------------- condições */

  /**
   * Perguntas que ligam os blocos condicionais. `inCondominium` é
   * independente do tipo do imóvel — casa fora de condomínio responde 0.
   */
  saveConditions: adminBase
    .input(
      z.object({
        propertyId: z.number().int().positive(),
        inCondominium: z.boolean().nullable(),
        hasHeranca: z.boolean().nullable(),
        hasPosse: z.boolean().nullable(),
        hasFinanciamento: z.boolean().nullable(),
        hasAluguel: z.boolean().nullable(),
      }),
    )
    .handler(async ({ input, context }) => {
      const property = await ensureProperty(context.db, input.propertyId);
      const bit = (value: boolean | null) => (value === null ? null : value ? 1 : 0);

      await context.db
        .update(schema.properties)
        .set({
          inCondominium: bit(input.inCondominium),
          hasHeranca: bit(input.hasHeranca),
          hasPosse: bit(input.hasPosse),
          hasFinanciamento: bit(input.hasFinanciamento),
          hasAluguel: bit(input.hasAluguel),
          updatedAt: new Date(),
        })
        .where(eq(schema.properties.id, input.propertyId));

      await audit(context.db, context.user, "documentacao.condicoes", {
        entity: "property",
        entityId: input.propertyId,
        detail: `Condições de documentação atualizadas (${property.code})`,
      });

      return { ok: true };
    }),

  /* --------------------------------------------------------- checklist */

  /** Grava uma resposta do checklist (upsert por item). */
  saveChecklistItem: adminBase
    .input(
      z.object({
        propertyId: z.number().int().positive(),
        itemKey: z.string().min(1).max(60),
        answer: z.enum(CHECKLIST_ANSWERS),
        note: z.string().max(1000).nullable().optional(),
      }),
    )
    .handler(async ({ input, context }) => {
      const property = await ensureProperty(context.db, input.propertyId);

      const [existing] = await context.db
        .select({ id: schema.propertyChecklist.id, answer: schema.propertyChecklist.answer })
        .from(schema.propertyChecklist)
        .where(
          and(
            eq(schema.propertyChecklist.propertyId, input.propertyId),
            eq(schema.propertyChecklist.itemKey, input.itemKey),
          ),
        )
        .limit(1);

      const note = input.note?.trim() || null;

      if (existing) {
        await context.db
          .update(schema.propertyChecklist)
          .set({ answer: input.answer, note, updatedAt: new Date() })
          .where(eq(schema.propertyChecklist.id, existing.id));
      } else {
        await context.db.insert(schema.propertyChecklist).values({
          propertyId: input.propertyId,
          itemKey: input.itemKey,
          answer: input.answer,
          note,
        });
      }

      if (!existing || existing.answer !== input.answer) {
        await audit(context.db, context.user, "documentacao.checklist", {
          entity: "property",
          entityId: input.propertyId,
          detail: `${property.code}: ${input.itemKey} = ${input.answer}${
            existing ? ` (antes: ${existing.answer})` : ""
          }`,
        });
      }

      return { ok: true };
    }),

  /* -------------------------------------------------------- documentos */

  /**
   * Cria o registro do documento. `fileId` é opcional: documento pode existir
   * só como status, e checklist pode ser respondido sem nenhum anexo.
   */
  createDocument: adminBase
    .input(
      z.object({
        propertyId: z.number().int().positive(),
        category: z.enum(DOC_CATEGORIES),
        title: z.string().max(160).nullable().optional(),
        fileId: z.string().max(64).nullable().optional(),
        fileName: z.string().max(200).nullable().optional(),
        note: z.string().max(1000).nullable().optional(),
        status: z.enum(DOC_STATUSES).default("recebido"),
      }),
    )
    .handler(async ({ input, context }) => {
      const property = await ensureProperty(context.db, input.propertyId);
      const now = new Date();

      const [created] = await context.db
        .insert(schema.propertyDocuments)
        .values({
          propertyId: input.propertyId,
          category: input.category,
          status: input.status,
          title: input.title?.trim() || null,
          fileId: input.fileId || null,
          fileName: input.fileName?.trim() || null,
          note: input.note?.trim() || null,
          // só marca recebimento quando existe arquivo de fato
          receivedAt: input.fileId ? now : null,
        })
        .returning({ id: schema.propertyDocuments.id });

      await audit(context.db, context.user, "documentacao.documento.criado", {
        entity: "property",
        entityId: input.propertyId,
        detail: `${property.code}: ${input.category} (${input.status})${
          input.fileId ? " com arquivo" : " sem arquivo"
        }`,
      });

      return { id: created?.id ?? 0 };
    }),

  /** Move o documento no fluxo de análise. */
  updateDocumentStatus: adminBase
    .input(
      z.object({
        id: z.number().int().positive(),
        status: z.enum(DOC_STATUSES),
        note: z.string().max(1000).nullable().optional(),
      }),
    )
    .handler(async ({ input, context }) => {
      const [document] = await context.db
        .select()
        .from(schema.propertyDocuments)
        .where(eq(schema.propertyDocuments.id, input.id))
        .limit(1);
      if (!document) throw new ORPCError("NOT_FOUND", { message: "Documento não encontrado" });

      const terminal = input.status === "regular" || input.status === "pendencia";

      await context.db
        .update(schema.propertyDocuments)
        .set({
          status: input.status,
          note: input.note?.trim() ?? document.note,
          analyzedAt: terminal ? new Date() : document.analyzedAt,
          updatedAt: new Date(),
        })
        .where(eq(schema.propertyDocuments.id, input.id));

      await audit(context.db, context.user, "documentacao.documento.status", {
        entity: "property",
        entityId: document.propertyId,
        detail: `${document.category}: ${document.status} -> ${input.status}`,
      });

      return { ok: true };
    }),

  /** Remove o registro do documento e o arquivo privado associado. */
  deleteDocument: adminBase
    .input(z.object({ id: z.number().int().positive() }))
    .handler(async ({ input, context }) => {
      const [document] = await context.db
        .select()
        .from(schema.propertyDocuments)
        .where(eq(schema.propertyDocuments.id, input.id))
        .limit(1);
      if (!document) throw new ORPCError("NOT_FOUND", { message: "Documento não encontrado" });

      await context.db
        .delete(schema.propertyDocuments)
        .where(eq(schema.propertyDocuments.id, input.id));

      if (document.fileId) {
        await context.db
          .delete(schema.documentFiles)
          .where(eq(schema.documentFiles.id, document.fileId));
      }

      await audit(context.db, context.user, "documentacao.documento.removido", {
        entity: "property",
        entityId: document.propertyId,
        detail: `${document.category} removido`,
      });

      return { ok: true };
    }),

  /* -------------------------------------------------------- carteira */

  /** Define a entrada na carteira — origem do ciclo de 4 meses. */
  setPortfolioEntry: adminBase
    .input(
      z.object({
        propertyId: z.number().int().positive(),
        /** ISO date (yyyy-mm-dd). null limpa a data. */
        date: z.string().max(30).nullable(),
      }),
    )
    .handler(async ({ input, context }) => {
      const property = await ensureProperty(context.db, input.propertyId);

      if (input.date === null) {
        await context.db
          .update(schema.properties)
          .set({ portfolioEntryAt: null, nextRevalidationAt: null, updatedAt: new Date() })
          .where(eq(schema.properties.id, input.propertyId));
        await audit(context.db, context.user, "carteira.entrada.removida", {
          entity: "property",
          entityId: input.propertyId,
          detail: property.code,
        });
        return { ok: true, nextRevalidationAt: null };
      }

      const entry = new Date(`${input.date}T12:00:00`);
      if (Number.isNaN(entry.getTime())) {
        throw new ORPCError("BAD_REQUEST", { message: "Data inválida" });
      }

      const next = addMonths(entry, CYCLE_MONTHS);
      await context.db
        .update(schema.properties)
        .set({ portfolioEntryAt: entry, nextRevalidationAt: next, updatedAt: new Date() })
        .where(eq(schema.properties.id, input.propertyId));

      await audit(context.db, context.user, "carteira.entrada", {
        entity: "property",
        entityId: input.propertyId,
        detail: `${property.code}: entrada ${input.date}, revalidar em ${next.toISOString().slice(0, 10)}`,
      });

      return { ok: true, nextRevalidationAt: next };
    }),

  /**
   * Registra o desfecho da revalidação. NÃO altera `properties.status`:
   * devolve `suggestedStatus` para decisão humana.
   */
  registerRevalidation: adminBase
    .input(
      z.object({
        propertyId: z.number().int().positive(),
        outcome: z.enum(OUTCOMES),
        note: z.string().max(1000).nullable().optional(),
      }),
    )
    .handler(async ({ input, context }) => {
      const property = await ensureProperty(context.db, input.propertyId);
      const now = new Date();
      const nextDue = nextDueFor(input.outcome, now);

      await context.db.insert(schema.propertyRevalidations).values({
        propertyId: input.propertyId,
        outcome: input.outcome,
        note: input.note?.trim() || null,
        revalidatedAt: now,
        nextDueAt: nextDue,
        userName: context.user.name ?? null,
      });

      // Só datas e último desfecho. `status` do imóvel fica intocado.
      await context.db
        .update(schema.properties)
        .set({
          lastRevalidationAt: now,
          nextRevalidationAt: nextDue,
          revalidationStatus: input.outcome,
          updatedAt: now,
        })
        .where(eq(schema.properties.id, input.propertyId));

      await audit(context.db, context.user, "carteira.revalidacao", {
        entity: "property",
        entityId: input.propertyId,
        detail: `${property.code}: ${input.outcome}${
          nextDue ? `, próxima ${nextDue.toISOString().slice(0, 10)}` : " (ciclo encerrado)"
        }`,
      });

      return {
        ok: true,
        nextRevalidationAt: nextDue,
        suggestedStatus: input.outcome === "vendido" ? "vendido" : null,
      };
    }),
};

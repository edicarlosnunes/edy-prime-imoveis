import { z } from "zod";
import { and, asc, desc, eq, isNotNull, isNull, like, or } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { adminBase, type AdminDb } from "../lib/admin-base";
import { allocateEpiCode } from "../lib/epi-counter";
import { epiSearchTerm } from "../lib/epi-code";
import { archiveEffect, isArchived, restoreEffect } from "../lib/archive-rules";
import { propertySlug } from "../lib/slug";
import * as schema from "../database/schema";
import { COMMERCIAL_STATUSES, effectiveCommercialStatus, showcaseDecision } from "../lib/commercial-status";
import { lifecycleView, resumeFromPause } from "../lib/portfolio-lifecycle";
import { applyDuePauses } from "../lib/portfolio-pause";
import { allocateSerial } from "../lib/serial-counter";
import { planPropertyFromCapture } from "../lib/capture-conversion";

const statusEnum = z.enum(["disponivel", "reservado", "vendido", "alugado"]);
const purposeEnum = z.enum(["venda", "locacao", "venda_locacao"]);
const typeEnum = z.enum([
  "apartamento",
  "casa",
  "cobertura",
  "sobrado",
  "terreno",
  "sala_comercial",
  "chacara",
  "outro",
]);

const imageInput = z.object({
  url: z.string().min(1).max(2000),
  /** foto sem marca d'água — nunca é sobrescrita */
  originalUrl: z.string().max(2000).nullable().optional(),
  isPrimary: z.boolean().optional(),
});

const propertyInput = z.object({
  code: z.string().max(40).default(""),
  title: z.string().min(3).max(200),
  purpose: purposeEnum.default("venda"),
  type: typeEnum.default("apartamento"),
  price: z.number().min(0).max(999_999_999),
  condoFee: z.number().min(0).max(999_999).nullable().optional(),
  iptu: z.number().min(0).max(999_999).nullable().optional(),
  district: z.string().max(120).default(""),
  city: z.string().max(120).default("Praia Grande"),
  address: z.string().max(300).nullable().optional(),
  bedrooms: z.number().int().min(0).max(40).default(0),
  suites: z.number().int().min(0).max(40).default(0),
  bathrooms: z.number().int().min(0).max(40).default(0),
  parking: z.number().int().min(0).max(40).default(0),
  areaUtil: z.number().min(0).max(1_000_000).default(0),
  areaTotal: z.number().min(0).max(1_000_000).nullable().optional(),
  description: z.string().max(6000).nullable().optional(),
  highlight: z.string().max(200).nullable().optional(),
  features: z.array(z.string().max(80)).max(60).default([]),
  status: statusEnum.default("disponivel"),
  published: z.boolean().default(true),
  featured: z.boolean().default(false),
  ownerId: z.number().int().nullable().optional(),
  /** desliga a marca d'água só neste imóvel */
  watermarkOff: z.boolean().default(false),
  /** vídeo do imóvel no YouTube (opcional) */
  youtubeUrl: z.string().max(300).nullable().optional(),
  images: z.array(imageInput).max(40).default([]),
});

function toRow(input: z.infer<typeof propertyInput>) {
  return {
    code: input.code.trim().toUpperCase(),
    title: input.title.trim(),
    purpose: input.purpose,
    type: input.type,
    price: input.price,
    condoFee: input.condoFee ?? null,
    iptu: input.iptu ?? null,
    district: input.district.trim(),
    city: input.city.trim(),
    address: input.address?.trim() || null,
    bedrooms: input.bedrooms,
    suites: input.suites,
    bathrooms: input.bathrooms,
    parking: input.parking,
    areaUtil: input.areaUtil,
    areaTotal: input.areaTotal ?? null,
    description: input.description?.trim() || null,
    highlight: input.highlight?.trim() || null,
    features: JSON.stringify(input.features.filter((f) => f.trim().length > 0)),
    status: input.status,
    published: input.published ? 1 : 0,
    featured: input.featured ? 1 : 0,
    ownerId: input.ownerId ?? null,
    watermarkOff: input.watermarkOff ? 1 : 0,
    youtubeUrl: input.youtubeUrl?.trim() || null,
    slug: propertySlug({
      code: input.code.trim().toUpperCase(),
      title: input.title.trim(),
      type: input.type,
      district: input.district,
      city: input.city,
    }),
    updatedAt: new Date(),
  };
}

async function syncImages(
  db: AdminDb,
  propertyId: number,
  images: z.infer<typeof imageInput>[],
) {
  await db.delete(schema.propertyImages).where(eq(schema.propertyImages.propertyId, propertyId));
  if (images.length === 0) return;
  const primaryIndex = Math.max(
    0,
    images.findIndex((image) => image.isPrimary),
  );
  await db.insert(schema.propertyImages).values(
    images.map((image, index) => ({
      propertyId,
      url: image.url.trim(),
      originalUrl: image.originalUrl?.trim() || null,
      sortOrder: index,
      isPrimary: index === primaryIndex ? 1 : 0,
    })),
  );
}

async function loadImages(db: AdminDb, propertyId: number) {
  return db
    .select()
    .from(schema.propertyImages)
    .where(eq(schema.propertyImages.propertyId, propertyId))
    .orderBy(asc(schema.propertyImages.sortOrder), asc(schema.propertyImages.id));
}

export const adminProperties = {
  list: adminBase
    .input(
      z
        .object({
          search: z.string().max(120).optional(),
          status: statusEnum.optional(),
          published: z.boolean().optional(),
          /**
           * ARQUIVO MORTO. Ausente/false = listagem operacional, que NÃO
           * mostra arquivados. `true` = só o Arquivo Morto. Não existe modo
           * "tudo junto" de propósito: arquivado misturado na operação é
           * exatamente o que o arquivamento veio resolver.
           */
          archived: z.boolean().optional(),
        })
        .optional(),
    )
    .handler(async ({ input, context }) => {
      const filters = [];
      filters.push(
        input?.archived
          ? isNotNull(schema.properties.archivedAt)
          : isNull(schema.properties.archivedAt),
      );
      if (input?.status) filters.push(eq(schema.properties.status, input.status));
      if (input?.published !== undefined) {
        filters.push(eq(schema.properties.published, input.published ? 1 : 0));
      }
      if (input?.search) {
        const raw = input.search.trim();
        const term = `%${raw}%`;
        /* Busca por CÓDIGO UNIVERSAL: `EPI-1042/09-26`, `EPI-104` ou só
           `1042`. Quando o termo não parece EPI, `epiSearchTerm` devolve null
           e a busca por título/código legado/bairro segue idêntica. */
        const epiTerm = epiSearchTerm(raw);
        filters.push(
          or(
            like(schema.properties.title, term),
            like(schema.properties.code, term),
            like(schema.properties.district, term),
            like(schema.properties.epiCode, term),
            ...(epiTerm ? [like(schema.properties.epiCode, `${epiTerm}%`)] : []),
          )!,
        );
      }

      /* Item 10 — regra dos 12 meses, automática. A varredura roda aqui, ao
         abrir a lista: idempotente, sem cron e sem processo paralelo. Nenhum
         imóvel é excluído; o vencido só sai da vitrine e ganha a ação de
         revisão para o corretor. */
      await applyDuePauses(context.db);

      const rows = await context.db
        .select()
        .from(schema.properties)
        .where(filters.length > 0 ? and(...filters) : undefined)
        .orderBy(desc(schema.properties.updatedAt))
        .limit(400);

      const images = await context.db
        .select()
        .from(schema.propertyImages)
        .orderBy(asc(schema.propertyImages.sortOrder), asc(schema.propertyImages.id));

      const now = new Date();
      return rows.map((row) => {
        const own = images.filter((image) => image.propertyId === row.id);
        const showcase = showcaseDecision(row);
        return {
          ...row,
          imageCount: own.length,
          cover: (own.find((image) => image.isPrimary === 1) ?? own[0])?.url ?? null,
          /* Eixos novos, informativos para a tela — o `status` antigo segue
             existindo e não foi migrado nem substituído. */
          commercialStatus: effectiveCommercialStatus(row),
          showcaseVisible: showcase.visible,
          showcaseReason: showcase.reason,
          lifecycle: lifecycleView(row, now),
        };
      });
    }),

  get: adminBase
    .input(z.object({ id: z.number().int() }))
    .handler(async ({ input, context }) => {
      const [row] = await context.db
        .select()
        .from(schema.properties)
        .where(eq(schema.properties.id, input.id))
        .limit(1);
      if (!row) throw new ORPCError("NOT_FOUND", { message: "Imóvel não encontrado" });
      return { ...row, images: await loadImages(context.db, row.id) };
    }),

  create: adminBase
    .input(propertyInput.extend({ captureId: z.number().int().positive().nullable().optional() }))
    .handler(async ({ input, context }) => {
    const row = toRow(input);

    /* Cadastro aberto pela captação (`/admin/imoveis/novo?capture_id=`).
       As mesmas regras do Radar valem aqui: sem documentação fechada e sem
       preço validado o imóvel nem chega a ser criado, para não sobrar imóvel
       órfão no banco. */
    let capture: typeof schema.propertyCaptures.$inferSelect | null = null;
    let inherited: string | null = null;
    let inheritedEpi: string | null = null;
    let writeBackEpi = true;
    if (input.captureId) {
      const [found] = await context.db
        .select()
        .from(schema.propertyCaptures)
        .where(eq(schema.propertyCaptures.id, input.captureId))
        .limit(1);
      if (!found) throw new ORPCError("NOT_FOUND", { message: "Captação não encontrada" });
      /* A REGRA vive em lib/capture-conversion.ts (pura e testada). Aqui só a
         execução: liberar, herdar serial e nascer fora do ar. */
      const plan = planPropertyFromCapture(found);
      if (!plan.ok) throw new ORPCError(plan.code, { message: plan.message });
      capture = found;
      inherited = plan.serial;
      inheritedEpi = plan.epiCode;
      writeBackEpi = plan.writeBackEpi;
      row.published = plan.published;
    }

    /* Serial global: herdado da ficha quando existe, senão reservado agora.
       O sequencial é global e nunca reiniciado. */
    const serial = inherited ?? (await allocateSerial(context.db, input.type));

    /* CÓDIGO UNIVERSAL EPI.
       Promoção de captação: HERDA o código da ficha — um imóvel promovido
       nunca ganha um segundo EPI. Ficha legada sem EPI e cadastro direto (sem
       captação) reservam o código agora, na sequência universal atômica. */
    const epiCode = inheritedEpi ?? (await allocateEpiCode(context.db, new Date()));

    /**
     * O código legado/técnico não é mais digitado pelo usuário.
     * Para cadastro novo ele é preenchido automaticamente com o serial interno;
     * o Código Universal visível para a operação continua sendo o EPI.
     */
    if (!row.code) {
      row.code = serial;
      row.slug = propertySlug({
        code: row.code,
        title: row.title,
        type: row.type,
        district: row.district,
        city: row.city,
      });
    }

    const [existing] = await context.db
      .select({ id: schema.properties.id })
      .from(schema.properties)
      .where(eq(schema.properties.code, row.code))
      .limit(1);
    if (existing) throw new ORPCError("CONFLICT", { message: "Já existe um imóvel com esse código técnico" });

    /* Data de entrada na carteira: todo imóvel novo nasce com ela preenchida,
       no momento da criação, para a revalidação de 4 meses e a regra dos 12
       meses passarem a contar desde já. Ajuste manual posterior (seção de
       revalidação da ficha) continua mandando: aqui só se define na criação. */
    const [created] = await context.db
      .insert(schema.properties)
      .values({ ...row, serial, epiCode, portfolioEntryAt: new Date() })
      .returning();
    if (!created) throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Falha ao criar" });
    await syncImages(context.db, created.id, input.images);

    if (capture) {
      const now = new Date();
      /* Grava o serial de volta na captação quando ela ainda não tinha, para
         ficha e imóvel mostrarem o MESMO número. */
      await context.db
        .update(schema.propertyCaptures)
        .set({
          serial,
          /* Ficha legada sem EPI recebe de volta o código emitido agora, para
             ficha e imóvel mostrarem o MESMO EPI. Ficha que já tinha código
             não é tocada: o EPI nunca é reescrito. */
          ...(writeBackEpi ? { epiCode } : {}),
          convertedPropertyId: created.id,
          convertedAt: now,
          stage: "captado",
          stageChangedAt: now,
          nextAction: null,
          nextActionAt: null,
          updatedAt: now,
        })
        .where(eq(schema.propertyCaptures.id, capture.id));
      await context.db.insert(schema.auditLog).values({
        userId: context.user.id,
        userName: context.user.name,
        action: "capture_converted",
        entity: "capture",
        entityId: String(capture.id),
        detail: `property:${created.id} serial:${serial}`,
      });
    }

    return { id: created.id, serial };
  }),

  update: adminBase
    .input(propertyInput.extend({ id: z.number().int() }))
    .handler(async ({ input, context }) => {
      const { id, ...rest } = input;
      const row = toRow(rest as z.infer<typeof propertyInput>);
      /* ARQUIVO MORTO — ficha arquivada não se edita e, principalmente, não
         volta ao ar por tabela: `published` tem default `true` no input, então
         salvar um imóvel arquivado o republicaria no site público ainda
         arquivado. Restaurar primeiro é decisão explícita de quem restaura. */
      const [existing] = await context.db
        .select()
        .from(schema.properties)
        .where(eq(schema.properties.id, id))
        .limit(1);
      if (!existing) throw new ORPCError("NOT_FOUND", { message: "Imóvel não encontrado" });
      /* Código antigo é somente leitura. Edição nunca apaga nem troca o código. */
      if (!row.code) {
        row.code = existing.code;
        row.slug = propertySlug({
          code: row.code,
          title: row.title,
          type: row.type,
          district: row.district,
          city: row.city,
        });
      }
      if (isArchived(existing)) {
        throw new ORPCError("CONFLICT", {
          message: "Imóvel está no Arquivo Morto. Restaure antes de editar.",
        });
      }
      const [clash] = await context.db
        .select({ id: schema.properties.id })
        .from(schema.properties)
        .where(eq(schema.properties.code, row.code))
        .limit(1);
      if (clash && clash.id !== id) {
        throw new ORPCError("CONFLICT", { message: "Já existe um imóvel com esse código" });
      }
      await context.db.update(schema.properties).set(row).where(eq(schema.properties.id, id));
      await syncImages(context.db, id, input.images);
      return { id };
    }),

  /**
   * ARQUIVO MORTO — o antigo "Excluir".
   *
   * Continua chamado `remove` porque é o que a tela chama, mas NÃO apaga mais
   * nada: arquiva. Nenhuma linha de `properties` nem de `property_images` é
   * removida do banco. O imóvel sai das listagens operacionais, sai do ar
   * (`published = 0`, então o site público deixa de mostrá-lo) e mantém EPI,
   * proprietário, fotos, documentos, origem, datas e histórico.
   *
   * Restauração: `restore`, com o MESMO EPI.
   */
  remove: adminBase
    .input(z.object({
      id: z.number().int(),
      reason: z.string().max(400).nullable().optional(),
    }))
    .handler(async ({ input, context }) => {
      const [row] = await context.db
        .select()
        .from(schema.properties)
        .where(eq(schema.properties.id, input.id))
        .limit(1);
      if (!row) throw new ORPCError("NOT_FOUND", { message: "Imóvel não encontrado" });
      /* Idempotente: rearquivar sobrescreveria a data do arquivamento
         original, que é informação de histórico. */
      if (isArchived(row)) {
        return { ok: true, archived: true, changed: false, epiCode: row.epiCode ?? null };
      }

      const effect = archiveEffect({
        now: new Date(),
        userName: context.user.name,
        reason: input.reason,
        epiCode: row.epiCode,
      });
      await context.db
        .update(schema.properties)
        .set(effect.patch)
        .where(eq(schema.properties.id, input.id));
      await context.db.insert(schema.auditLog).values({
        userId: context.user.id,
        userName: context.user.name,
        action: "property_archived",
        entity: "property",
        entityId: String(input.id),
        detail: effect.historyNote,
      });
      return { ok: true, archived: true, changed: true, epiCode: row.epiCode ?? null };
    }),

  /**
   * ARQUIVO MORTO — restaurar imóvel.
   *
   * Volta ao CRM com exatamente o MESMO EPI e todo o histórico. Volta FORA DO
   * AR de propósito: republicar é decisão editorial de quem restaurou.
   */
  restore: adminBase
    .input(z.object({
      id: z.number().int(),
      note: z.string().max(400).nullable().optional(),
    }))
    .handler(async ({ input, context }) => {
      const [row] = await context.db
        .select()
        .from(schema.properties)
        .where(eq(schema.properties.id, input.id))
        .limit(1);
      if (!row) throw new ORPCError("NOT_FOUND", { message: "Imóvel não encontrado" });
      if (!isArchived(row)) {
        return { ok: true, changed: false, epiCode: row.epiCode ?? null };
      }

      const effect = restoreEffect({
        now: new Date(),
        userName: context.user.name,
        epiCode: row.epiCode,
        note: input.note,
      });
      await context.db
        .update(schema.properties)
        .set(effect.patch)
        .where(eq(schema.properties.id, input.id));
      await context.db.insert(schema.auditLog).values({
        userId: context.user.id,
        userName: context.user.name,
        action: "property_restored",
        entity: "property",
        entityId: String(input.id),
        detail: effect.historyNote,
      });
      return { ok: true, changed: true, epiCode: row.epiCode ?? null };
    }),

  /** Publicar/despublicar, destacar e mudar status sem abrir o formulário. */
  patch: adminBase
    .input(
      z.object({
        id: z.number().int(),
        published: z.boolean().optional(),
        featured: z.boolean().optional(),
        status: statusEnum.optional(),
      }),
    )
    .handler(async ({ input, context }) => {
      const [existing] = await context.db
        .select({ id: schema.properties.id, archivedAt: schema.properties.archivedAt })
        .from(schema.properties)
        .where(eq(schema.properties.id, input.id))
        .limit(1);
      if (!existing) throw new ORPCError("NOT_FOUND", { message: "Imóvel não encontrado" });
      if (isArchived(existing)) {
        throw new ORPCError("CONFLICT", {
          message: "Imóvel está no Arquivo Morto. Restaure antes de alterar publicação, destaque ou status.",
        });
      }

      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (input.published !== undefined) patch.published = input.published ? 1 : 0;
      if (input.featured !== undefined) patch.featured = input.featured ? 1 : 0;
      if (input.status) patch.status = input.status;
      await context.db.update(schema.properties).set(patch).where(eq(schema.properties.id, input.id));
      return { ok: true };
    }),

  /**
   * Item 9 — STATUS COMERCIAL, eixo próprio.
   *
   * Não substitui o `status` antigo (disponivel/reservado/vendido/alugado):
   * grava o eixo novo ao lado dele. Quando o corretor marca VENDIDO ou
   * RETIRADO_PELO_PROPRIETARIO o imóvel sai da vitrine ativa por decisão de
   * `commercial-status.ts#showcaseDecision` — sem excluir nada e sem mexer em
   * `published`, que continua sendo a decisão editorial dele.
   */
  setCommercialStatus: adminBase
    .input(
      z.object({
        id: z.number().int(),
        status: z.enum(COMMERCIAL_STATUSES),
        note: z.string().max(400).optional(),
      }),
    )
    .handler(async ({ input, context }) => {
      const [row] = await context.db
        .select({
          id: schema.properties.id,
          code: schema.properties.code,
          status: schema.properties.status,
          commercialStatus: schema.properties.commercialStatus,
        })
        .from(schema.properties)
        .where(eq(schema.properties.id, input.id))
        .limit(1);
      if (!row) throw new ORPCError("NOT_FOUND", { message: "Imóvel não encontrado" });

      const before = effectiveCommercialStatus(row);
      const now = new Date();
      await context.db
        .update(schema.properties)
        .set({ commercialStatus: input.status, commercialStatusAt: now, updatedAt: now })
        .where(eq(schema.properties.id, input.id));

      await context.db.insert(schema.auditLog).values({
        userId: context.user.id,
        userName: context.user.name,
        action: "property_commercial_status_changed",
        entity: "property",
        entityId: String(input.id),
        detail: [
          `${before ?? "(sem status)"} -> ${input.status}`,
          input.note?.trim() ? `Observação: ${input.note.trim()}` : null,
        ]
          .filter(Boolean)
          .join(" | "),
      });

      return { ok: true, commercialStatus: input.status };
    }),

  /**
   * Item 10 — reativação depois da pausa de 12 meses. SEMPRE humana.
   *
   * A pausa é automática, a volta não: aqui a contagem é reiniciada para o
   * imóvel não ser pausado de novo no dia seguinte. O histórico da pausa
   * anterior fica no `audit_log`, nada é apagado.
   */
  resumePause: adminBase
    .input(z.object({ id: z.number().int(), note: z.string().max(400).optional() }))
    .handler(async ({ input, context }) => {
      const [row] = await context.db
        .select({ id: schema.properties.id, pausedAt: schema.properties.pausedAt })
        .from(schema.properties)
        .where(eq(schema.properties.id, input.id))
        .limit(1);
      if (!row) throw new ORPCError("NOT_FOUND", { message: "Imóvel não encontrado" });
      if (!row.pausedAt) return { ok: true, alreadyActive: true as const };

      const now = new Date();
      const effect = resumeFromPause(now, context.user.name);
      await context.db
        .update(schema.properties)
        .set({
          pausedAt: effect.pausedAt,
          pauseReason: effect.pauseReason,
          portfolioEntryAt: effect.portfolioEntryAt,
          updatedAt: now,
        })
        .where(eq(schema.properties.id, input.id));

      await context.db.insert(schema.auditLog).values({
        userId: context.user.id,
        userName: context.user.name,
        action: "property_pause_resumed",
        entity: "property",
        entityId: String(input.id),
        detail: [effect.historyNote, input.note?.trim() ? `Observação: ${input.note.trim()}` : null]
          .filter(Boolean)
          .join(" | "),
      });

      return { ok: true, alreadyActive: false as const };
    }),

  /** Lista enxuta para os selects de leads, tarefas e propostas. */
  options: adminBase.handler(async ({ context }) => {
    return context.db
      .select({
        id: schema.properties.id,
        code: schema.properties.code,
        title: schema.properties.title,
        price: schema.properties.price,
        district: schema.properties.district,
      })
      .from(schema.properties)
      .where(isNull(schema.properties.archivedAt))
      .orderBy(asc(schema.properties.code))
      .limit(500);
  }),
};

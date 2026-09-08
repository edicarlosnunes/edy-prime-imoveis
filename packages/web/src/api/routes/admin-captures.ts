import { z } from "zod";
import { and, asc, desc, eq, isNull, like, or } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { adminBase } from "../lib/admin-base";
import * as schema from "../database/schema";
import {
  type CaptureStage,
  DOC_STATUSES,
  STAGE_INPUTS,
  checkConversion,
  checkStageTransition,
  isDocValidatedByTeam,
  normalizeDocStatus,
  normalizeStage,
} from "../lib/capture-rules";
import { CHECKLIST_ITEMS, isChecklistKey, toggleChecklistItem } from "../lib/capture-checklist";
import { COMPLEMENT_FIELDS } from "../lib/capture-address";
import { buildCapturePayload, findDuplicateUnit } from "../lib/capture-intake";
import {
  MAX_OWNER_PHOTOS,
  addOwnerPhotos,
  moveOwnerPhoto,
  parseOwnerPhotos,
  removeOwnerPhoto,
  serializeOwnerPhotos,
  setOwnerPhotoPrimary,
} from "../lib/capture-photos";

/** Complementos da unidade: todos opcionais e curtos. */
const complementsInput = z
  .object(
    Object.fromEntries(
      COMPLEMENT_FIELDS.map((field) => [field.key, z.string().max(60).optional()]),
    ) as Record<string, z.ZodOptional<z.ZodString>>,
  )
  .partial()
  .nullable()
  .optional();

/**
 * Etapas aceitas na ENTRADA.
 *
 * Inclui o valor legado `avaliacao` de propósito: uma aba antiga do navegador
 * (bundle em cache) ainda manda esse valor, e recusar com erro de validação
 * seria pior que traduzir para DOCUMENTAÇÃO, que é o que ele significa no
 * fluxo V3. A tradução é `normalizeStage`, e nenhuma linha antiga é reescrita.
 */
const STAGES = STAGE_INPUTS;
const digits = (value: string | null | undefined) => String(value ?? "").replace(/\D/g, "");

async function audit(context: any, action: string, id: number, detail?: string) {
  await context.db.insert(schema.auditLog).values({
    userId: context.user.id,
    userName: context.user.name,
    action,
    entity: "capture",
    entityId: String(id),
    detail: detail ?? null,
  });
}

async function syncOwnerStatus(context: any, ownerId: number) {
  const rows = await context.db
    .select({ stage: schema.propertyCaptures.stage })
    .from(schema.propertyCaptures)
    .where(eq(schema.propertyCaptures.ownerId, ownerId));

  /* Etapa canônica: `avaliacao` (legado) conta como DOCUMENTAÇÃO. Sem isso um
     proprietário com captação antiga voltaria para `prospeccao` sem motivo. */
  const stages: (CaptureStage | null)[] = rows.map((row: any) => normalizeStage(row.stage));

  let next: "prospeccao" | "em_negociacao" | "captado" | "perdido" = "prospeccao";
  if (stages.some((stage) => stage === "captado")) next = "captado";
  else if (stages.some((stage) => stage === "documentacao" || stage === "validacao")) next = "em_negociacao";
  else if (stages.length > 0 && stages.every((stage) => stage === "perdido")) next = "perdido";

  await context.db.update(schema.owners).set({ captureStatus: next }).where(eq(schema.owners.id, ownerId));
}

async function pendingTasksFor(context: any, captureId: number) {
  return context.db
    .select()
    .from(schema.tasks)
    .where(
      and(
        eq(schema.tasks.status, "pendente"),
        or(
          eq(schema.tasks.captureId, captureId),
          like(schema.tasks.notes, `%[capture:${captureId}]%`),
        ),
      ),
    )
    .orderBy(asc(schema.tasks.dueAt));
}

async function closePendingTasks(context: any, captureId: number) {
  const rows = await pendingTasksFor(context, captureId);
  for (const row of rows) {
    await context.db.update(schema.tasks).set({ status: "cancelada" }).where(eq(schema.tasks.id, row.id));
  }
}

const createInput = z.object({
  ownerName: z.string().min(2).max(120),
  ownerPhone: z.string().min(8).max(30),
  ownerEmail: z.string().max(160).nullable().optional(),
  city: z.string().min(2).max(80).default("Praia Grande"),
  district: z.string().max(120).nullable().optional(),
  address: z.string().max(240).nullable().optional(),
  propertyType: z.string().max(80).nullable().optional(),
  askingPrice: z.number().nonnegative().nullable().optional(),
  source: z.string().max(80).default("manual"),
  intention: z.string().max(80).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
  /* V3 — endereço estruturado. Tudo opcional: uma captação por telefone, sem
     endereço ainda, continua sendo aceita. */
  cep: z.string().max(12).nullable().optional(),
  street: z.string().max(200).nullable().optional(),
  number: z.string().max(30).nullable().optional(),
  state: z.string().max(2).nullable().optional(),
  complements: complementsInput,
});

export const adminCaptures = {
  list: adminBase
    .input(
      z.object({
        search: z.string().optional(),
        city: z.string().optional(),
        stage: z.enum(STAGES).optional(),
        source: z.string().optional(),
      }).optional(),
    )
    .handler(async ({ input, context }) => {
      const captures = await context.db.select().from(schema.propertyCaptures).orderBy(desc(schema.propertyCaptures.updatedAt)).limit(500);
      const owners = await context.db.select().from(schema.owners).limit(1000);
      const ownerById = new Map(owners.map((owner) => [owner.id, owner]));
      const q = input?.search?.trim().toLowerCase();
      return captures
        .map((capture) => ({ ...capture, owner: ownerById.get(capture.ownerId) ?? null }))
        .filter((row) => {
          if (input?.city && row.city !== input.city) return false;
          /* Compara etapa CANÔNICA: filtrar por DOCUMENTAÇÃO tem que trazer
             também as captações antigas gravadas como `avaliacao`. */
          if (input?.stage && normalizeStage(row.stage) !== normalizeStage(input.stage)) return false;
          if (input?.source && row.source !== input.source) return false;
          if (q) {
            const hay = [row.owner?.name, row.owner?.phone, row.city, row.district, row.address, row.propertyType]
              .filter(Boolean)
              .join(" ")
              .toLowerCase();
            if (!hay.includes(q)) return false;
          }
          return true;
        });
    }),

  get: adminBase.input(z.object({ id: z.number().int().positive() })).handler(async ({ input, context }) => {
    const [capture] = await context.db.select().from(schema.propertyCaptures).where(eq(schema.propertyCaptures.id, input.id)).limit(1);
    if (!capture) throw new ORPCError("NOT_FOUND", { message: "Captação não encontrada" });
    const [owner] = await context.db.select().from(schema.owners).where(eq(schema.owners.id, capture.ownerId)).limit(1);
    const tasks = await context.db
      .select()
      .from(schema.tasks)
      .where(or(eq(schema.tasks.captureId, input.id), like(schema.tasks.notes, `%[capture:${input.id}]%`)))
      .orderBy(desc(schema.tasks.dueAt));
    const history = await context.db
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.entity, "capture"), eq(schema.auditLog.entityId, String(input.id))))
      .orderBy(desc(schema.auditLog.createdAt))
      .limit(100);
    /* O Radar mostra o código OFICIAL que nasceu no Cadastro Premium: serial
       novo (TIPO-ANO-SEQUENCIAL) ou o `code` legado de imóvel antigo. Leitura
       pura — nada aqui gera, altera ou renumera serial. */
    const [convertedProperty] = capture.convertedPropertyId
      ? await context.db
          .select({ id: schema.properties.id, serial: schema.properties.serial, code: schema.properties.code })
          .from(schema.properties)
          .where(eq(schema.properties.id, capture.convertedPropertyId))
          .limit(1)
      : [];
    return { ...capture, owner: owner ?? null, convertedProperty: convertedProperty ?? null, tasks, history };
  }),

  create: adminBase.input(createInput).handler(async ({ input, context }) => {
    const phoneDigits = digits(input.ownerPhone);
    const owners = await context.db.select().from(schema.owners).limit(1000);
    let owner = owners.find((row) => digits(row.phone) === phoneDigits);
    let ownerCreated = false;
    if (!owner) {
      const [created] = await context.db.insert(schema.owners).values({
        name: input.ownerName.trim(),
        phone: input.ownerPhone.trim(),
        email: input.ownerEmail?.trim() || null,
        captureStatus: "prospeccao",
      }).returning();
      owner = created;
      ownerCreated = true;
    }
    if (!owner) throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Não foi possível criar proprietário" });

    /* V3 — ficha única: o endereço vira estrutura (CEP + número + complementos)
       e a identidade da unidade (`unitKey`) é calculada uma única vez, pelo
       mesmo módulo que o formulário público usa. */
    const payload = buildCapturePayload({
      ownerName: input.ownerName,
      ownerPhone: input.ownerPhone,
      ownerEmail: input.ownerEmail ?? null,
      cep: input.cep ?? null,
      street: input.street ?? null,
      number: input.number ?? null,
      district: input.district ?? null,
      city: input.city,
      state: input.state ?? null,
      complements: input.complements ?? null,
      propertyType: input.propertyType ?? null,
      askingPrice: input.askingPrice ?? null,
      intention: input.intention ?? null,
      notes: input.notes ?? null,
      source: input.source,
    });

    /* Aviso de unidade repetida. Só informa — recaptar é decisão humana. */
    const existing = await context.db
      .select({
        id: schema.propertyCaptures.id,
        ownerId: schema.propertyCaptures.ownerId,
        unitKey: schema.propertyCaptures.unitKey,
        stage: schema.propertyCaptures.stage,
      })
      .from(schema.propertyCaptures)
      .limit(1000);
    const duplicateUnit = findDuplicateUnit(existing, {
      unitKey: payload.unitKey,
      ownerId: owner.id,
    });

    const now = new Date();
    const due = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    const [capture] = await context.db.insert(schema.propertyCaptures).values({
      ownerId: owner.id,
      city: payload.city,
      district: payload.district,
      /* `address` (texto livre) segue preenchido: telas e documentos antigos
         continuam lendo essa coluna. O digitado à mão tem prioridade. */
      address: input.address?.trim() || payload.address,
      cep: payload.cep,
      street: payload.street,
      number: payload.number,
      state: payload.state,
      complements: payload.complements,
      unitKey: payload.unitKey || null,
      propertyType: payload.propertyType,
      askingPrice: payload.askingPrice,
      source: payload.source,
      intention: payload.intention,
      notes: duplicateUnit.duplicate
        ? [payload.notes, duplicateUnit.message].filter(Boolean).join("\n")
        : payload.notes,
      stage: "novo_contato",
      nextAction: `Retornar proprietário — ${owner.name}`,
      nextActionAt: due,
      stageChangedAt: now,
      updatedAt: now,
    }).returning();
    if (!capture) throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Não foi possível criar captação" });

    await context.db.insert(schema.tasks).values({
      title: `Retornar proprietário — ${owner.name}`,
      type: "retorno",
      dueAt: due,
      status: "pendente",
      captureId: capture.id,
      notes: `[capture:${capture.id}] Retorno automático criado pelo Radar de Captação`,
    });
    await audit(context, "capture_created", capture.id, ownerCreated ? "Proprietário novo" : "Proprietário existente reutilizado");
    if (duplicateUnit.duplicate) {
      await audit(context, "capture_duplicate_unit", capture.id, duplicateUnit.message);
    }
    return {
      id: capture.id,
      ownerId: owner.id,
      ownerCreated,
      /* Aviso, não bloqueio: a tela mostra e o corretor decide. */
      duplicateUnit: duplicateUnit.duplicate ? duplicateUnit.message : null,
    };
  }),

  setStage: adminBase.input(z.object({ id: z.number().int().positive(), stage: z.enum(STAGES) })).handler(async ({ input, context }) => {
    const [capture] = await context.db.select().from(schema.propertyCaptures).where(eq(schema.propertyCaptures.id, input.id)).limit(1);
    if (!capture) throw new ORPCError("NOT_FOUND", { message: "Captação não encontrada" });
    /* Idempotente: reclique na etapa atual nao gera novo evento de historico.
       Compara a etapa CANONICA, entao uma captacao antiga gravada como
       `avaliacao` que receba `documentacao` e reclique, nao alteracao — o valor
       legado fica no banco exatamente como esta, sem UPDATE e sem historico. */
    if (normalizeStage(capture.stage) === normalizeStage(input.stage)) return { ok: true, changed: false };
    const allowed = checkStageTransition({
      from: capture.stage,
      to: input.stage,
      docStatus: capture.docStatus,
      estimatedPrice: capture.estimatedPrice,
      convertedPropertyId: capture.convertedPropertyId,
    });
    if (!allowed.ok) throw new ORPCError(allowed.code, { message: allowed.message });
    const now = new Date();
    // Compare-and-set: se dois cliques chegarem juntos, so o primeiro encontra
    // a etapa anterior e devolve linha; o segundo nao audita nada.
    const changed = await context.db
      .update(schema.propertyCaptures)
      .set({ stage: input.stage, stageChangedAt: now, updatedAt: now })
      .where(and(eq(schema.propertyCaptures.id, input.id), eq(schema.propertyCaptures.stage, capture.stage)))
      .returning({ id: schema.propertyCaptures.id });
    if (changed.length === 0) return { ok: true, changed: false };
    if (input.stage === "captado" || input.stage === "perdido") await closePendingTasks(context, input.id);
    await syncOwnerStatus(context, capture.ownerId);
    await audit(context, "capture_stage_changed", input.id, input.stage);
    return { ok: true, changed: true };
  }),

  setNextAction: adminBase.input(z.object({ id: z.number().int().positive(), title: z.string().max(200).nullable(), dueAt: z.string().max(40).nullable() })).handler(async ({ input, context }) => {
    const [capture] = await context.db.select().from(schema.propertyCaptures).where(eq(schema.propertyCaptures.id, input.id)).limit(1);
    if (!capture) throw new ORPCError("NOT_FOUND", { message: "Captação não encontrada" });
    await closePendingTasks(context, input.id);
    const now = new Date();
    if (!input.title || !input.dueAt) {
      await context.db.update(schema.propertyCaptures).set({ nextAction: null, nextActionAt: null, updatedAt: now }).where(eq(schema.propertyCaptures.id, input.id));
      await audit(context, "capture_next_action_cleared", input.id);
      return { ok: true };
    }
    const due = new Date(input.dueAt);
    await context.db.insert(schema.tasks).values({
      title: input.title.trim(), type: "retorno", dueAt: due, status: "pendente", captureId: input.id,
      notes: `[capture:${input.id}] Próxima ação do Radar`,
    });
    await context.db.update(schema.propertyCaptures).set({ nextAction: input.title.trim(), nextActionAt: due, updatedAt: now }).where(eq(schema.propertyCaptures.id, input.id));
    await audit(context, "capture_next_action_set", input.id, `${input.title} @ ${input.dueAt}`);
    return { ok: true };
  }),

  saveAppraisal: adminBase.input(z.object({ id: z.number().int().positive(), estimatedPrice: z.number().nonnegative().nullable(), note: z.string().max(4000).nullable().optional() })).handler(async ({ input, context }) => {
    const [capture] = await context.db.select().from(schema.propertyCaptures).where(eq(schema.propertyCaptures.id, input.id)).limit(1);
    if (!capture) throw new ORPCError("NOT_FOUND", { message: "Captação não encontrada" });
    const note = input.note?.trim() || null;
    // Idempotente: salvar a mesma avaliacao de novo (reclique/duplo clique) nao
    // gera segundo capture_appraisal_saved.
    if (capture.estimatedPrice === input.estimatedPrice && capture.appraisalNote === note) {
      return { ok: true, changed: false };
    }
    const now = new Date();
    // Compare-and-set no valor anterior: de dois requests simultaneos, so o
    // primeiro encontra o estado antigo e audita.
    const previousPrice = capture.estimatedPrice === null
      ? isNull(schema.propertyCaptures.estimatedPrice)
      : eq(schema.propertyCaptures.estimatedPrice, capture.estimatedPrice);
    const changed = await context.db.update(schema.propertyCaptures).set({
      estimatedPrice: input.estimatedPrice,
      appraisalStatus: input.estimatedPrice === null ? "pendente" : "concluida",
      appraisalAt: input.estimatedPrice === null ? null : now,
      appraisalNote: note,
      updatedAt: now,
    }).where(and(eq(schema.propertyCaptures.id, input.id), previousPrice)).returning({ id: schema.propertyCaptures.id });
    if (changed.length === 0) return { ok: true, changed: false };
    await audit(context, "capture_appraisal_saved", input.id, input.estimatedPrice === null ? "pendente" : String(input.estimatedPrice));
    return { ok: true, changed: true };
  }),

  /**
   * Status da documentação.
   *
   * `validado_pela_equipe` cobre o proprietário que não faz upload: a equipe
   * confere por WhatsApp/telefone/e-mail e registra a validação. Nesse caso a
   * observação é OBRIGATÓRIA e ficam gravados usuário responsável e data/hora
   * — é o que substitui o documento, então precisa ter autor. Nenhum upload
   * falso é criado: `property_docs` não é tocado aqui.
   */
  setDocStatus: adminBase.input(z.object({
    id: z.number().int().positive(),
    docStatus: z.enum(DOC_STATUSES),
    note: z.string().max(2000).nullable().optional(),
  })).handler(async ({ input, context }) => {
    const [capture] = await context.db.select().from(schema.propertyCaptures).where(eq(schema.propertyCaptures.id, input.id)).limit(1);
    if (!capture) throw new ORPCError("NOT_FOUND", { message: "Captação não encontrada" });
    const note = input.note?.trim() || null;
    const validatedByTeam = isDocValidatedByTeam(input.docStatus);
    if (validatedByTeam && !note) {
      throw new ORPCError("BAD_REQUEST", {
        message: "Informe a observação de quem conferiu a documentação para marcar DOCUMENTAÇÃO VALIDADA PELA EQUIPE",
      });
    }
    // `pendente` legado e `solicitado` sao o mesmo estado: trocar um pelo outro
    // nao e alteracao relevante e nao gera historico (nem reescreve o dado antigo).
    if (normalizeDocStatus(capture.docStatus) === normalizeDocStatus(input.docStatus)) {
      return { ok: true, changed: false };
    }
    const now = new Date();
    /* Sair de `validado_pela_equipe` limpa o selo para a ficha nao exibir uma
       validacao que nao vale mais. O evento original continua no audit_log. */
    const changed = await context.db
      .update(schema.propertyCaptures)
      .set({
        docStatus: input.docStatus,
        docValidatedBy: validatedByTeam ? context.user.name : null,
        docValidatedAt: validatedByTeam ? now : null,
        docValidationNote: validatedByTeam ? note : null,
        updatedAt: now,
      })
      .where(and(eq(schema.propertyCaptures.id, input.id), eq(schema.propertyCaptures.docStatus, capture.docStatus)))
      .returning({ id: schema.propertyCaptures.id });
    if (changed.length === 0) return { ok: true, changed: false };
    await audit(
      context,
      validatedByTeam ? "capture_doc_validated_by_team" : "capture_doc_status",
      input.id,
      validatedByTeam ? `DOCUMENTAÇÃO VALIDADA PELA EQUIPE — ${note}` : input.docStatus,
    );
    return { ok: true, changed: true };
  }),

  /**
   * Checklist de pré-captação item a item.
   *
   * Sem tabela nova: grava um bloco estruturado no fim de `notes` e preserva o
   * texto livre do corretor. `doc_status` continua sendo a persistência
   * principal do estágio e NÃO é alterado aqui — quem decide o status é o
   * corretor no Select, porque recebido e conferido não são a mesma coisa.
   */
  setChecklist: adminBase.input(z.object({ id: z.number().int().positive(), key: z.string().min(1).max(40), value: z.boolean() })).handler(async ({ input, context }) => {
    if (!isChecklistKey(input.key)) throw new ORPCError("BAD_REQUEST", { message: "Item de checklist desconhecido" });
    const [capture] = await context.db.select().from(schema.propertyCaptures).where(eq(schema.propertyCaptures.id, input.id)).limit(1);
    if (!capture) throw new ORPCError("NOT_FOUND", { message: "Captação não encontrada" });
    const notes = toggleChecklistItem(capture.notes, input.key, input.value);
    /* Nada mudou (duplo clique no mesmo item): sem UPDATE e sem histórico. */
    if (notes === (capture.notes ?? null)) return { ok: true, changed: false };
    const changed = await context.db
      .update(schema.propertyCaptures)
      .set({ notes, updatedAt: new Date() })
      .where(and(eq(schema.propertyCaptures.id, input.id), capture.notes === null ? isNull(schema.propertyCaptures.notes) : eq(schema.propertyCaptures.notes, capture.notes)))
      .returning({ id: schema.propertyCaptures.id });
    if (changed.length === 0) return { ok: true, changed: false };
    const label = CHECKLIST_ITEMS.find((item) => item.key === input.key)?.label ?? input.key;
    await audit(context, "capture_checklist", input.id, `${input.value ? "recebido" : "removido"}: ${label}`);
    return { ok: true, changed: true };
  }),

  /**
   * Fotos PROVISÓRIAS do proprietário.
   *
   * Vivem em `property_captures.owner_photos` (JSON) e NUNCA em
   * `property_images`: o que está em `property_images` é o que o site publica,
   * e foto tirada pelo dono não pode vazar para o anúncio. A promoção a foto
   * oficial é ato explícito do corretor, no cadastro do imóvel.
   */
  addPhotos: adminBase
    .input(z.object({
      id: z.number().int().positive(),
      photos: z.array(z.object({ url: z.string().min(4).max(1000), caption: z.string().max(200).nullable().optional() })).min(1).max(MAX_OWNER_PHOTOS),
    }))
    .handler(async ({ input, context }) => {
      const [capture] = await context.db.select().from(schema.propertyCaptures).where(eq(schema.propertyCaptures.id, input.id)).limit(1);
      if (!capture) throw new ORPCError("NOT_FOUND", { message: "Captação não encontrada" });
      /* Anexada pelo CRM: a origem é a equipe, mas a foto continua PROVISÓRIA. */
      const photos = addOwnerPhotos(capture.ownerPhotos, input.photos, { source: "equipe" });
      const before = parseOwnerPhotos(capture.ownerPhotos).length;
      if (photos.length === before) return { ok: true, changed: false, total: before };
      await context.db
        .update(schema.propertyCaptures)
        .set({ ownerPhotos: serializeOwnerPhotos(photos), updatedAt: new Date() })
        .where(eq(schema.propertyCaptures.id, input.id));
      await audit(context, "capture_photos_added", input.id, `${photos.length - before} foto(s) provisória(s)`);
      return { ok: true, changed: true, total: photos.length };
    }),

  removePhoto: adminBase
    .input(z.object({ id: z.number().int().positive(), url: z.string().min(4).max(1000) }))
    .handler(async ({ input, context }) => {
      const [capture] = await context.db.select().from(schema.propertyCaptures).where(eq(schema.propertyCaptures.id, input.id)).limit(1);
      if (!capture) throw new ORPCError("NOT_FOUND", { message: "Captação não encontrada" });
      const photos = removeOwnerPhoto(capture.ownerPhotos, input.url);
      if (photos.length === parseOwnerPhotos(capture.ownerPhotos).length) return { ok: true, changed: false };
      await context.db
        .update(schema.propertyCaptures)
        .set({ ownerPhotos: serializeOwnerPhotos(photos), updatedAt: new Date() })
        .where(eq(schema.propertyCaptures.id, input.id));
      await audit(context, "capture_photo_removed", input.id, input.url.slice(0, 200));
      return { ok: true, changed: true };
    }),

  /**
   * FOTO PRINCIPAL PROVISÓRIA (capa provável).
   *
   * Continua sendo foto provisória: marcar capa aqui NÃO publica nada e não
   * toca em `property_images`. Serve para o Cadastro Premium herdar a capa
   * certa quando a captação virar imóvel.
   */
  setPhotoPrimary: adminBase
    .input(z.object({ id: z.number().int().positive(), url: z.string().min(4).max(1000) }))
    .handler(async ({ input, context }) => {
      const [capture] = await context.db.select().from(schema.propertyCaptures).where(eq(schema.propertyCaptures.id, input.id)).limit(1);
      if (!capture) throw new ORPCError("NOT_FOUND", { message: "Captação não encontrada" });
      const photos = setOwnerPhotoPrimary(capture.ownerPhotos, input.url);
      if (!photos.some((photo) => photo.url === input.url && photo.primary)) {
        throw new ORPCError("BAD_REQUEST", { message: "Foto não encontrada entre as provisórias desta captação" });
      }
      await context.db
        .update(schema.propertyCaptures)
        .set({ ownerPhotos: serializeOwnerPhotos(photos), updatedAt: new Date() })
        .where(eq(schema.propertyCaptures.id, input.id));
      await audit(context, "capture_photo_primary", input.id, input.url.slice(0, 200));
      return { ok: true, changed: true };
    }),

  /** Reordena a lista provisória. A marca de capa viaja junto com a foto. */
  movePhoto: adminBase
    .input(z.object({
      id: z.number().int().positive(),
      url: z.string().min(4).max(1000),
      direction: z.union([z.literal(-1), z.literal(1)]),
    }))
    .handler(async ({ input, context }) => {
      const [capture] = await context.db.select().from(schema.propertyCaptures).where(eq(schema.propertyCaptures.id, input.id)).limit(1);
      if (!capture) throw new ORPCError("NOT_FOUND", { message: "Captação não encontrada" });
      const before = parseOwnerPhotos(capture.ownerPhotos);
      const photos = moveOwnerPhoto(capture.ownerPhotos, input.url, input.direction);
      /* Já está na ponta da lista: nada a fazer, sem erro na cara do corretor. */
      if (photos.map((p) => p.url).join("|") === before.map((p) => p.url).join("|")) {
        return { ok: true, changed: false };
      }
      await context.db
        .update(schema.propertyCaptures)
        .set({ ownerPhotos: serializeOwnerPhotos(photos), updatedAt: new Date() })
        .where(eq(schema.propertyCaptures.id, input.id));
      return { ok: true, changed: true };
    }),

  markLost: adminBase.input(z.object({ id: z.number().int().positive(), reason: z.string().min(2).max(120), detail: z.string().max(1000).nullable().optional() })).handler(async ({ input, context }) => {
    const [capture] = await context.db.select().from(schema.propertyCaptures).where(eq(schema.propertyCaptures.id, input.id)).limit(1);
    if (!capture) throw new ORPCError("NOT_FOUND", { message: "Captação não encontrada" });
    const now = new Date();
    await closePendingTasks(context, input.id);
    await context.db.update(schema.propertyCaptures).set({ stage: "perdido", lostReason: input.reason, lostDetail: input.detail?.trim() || null, nextAction: null, nextActionAt: null, stageChangedAt: now, updatedAt: now }).where(eq(schema.propertyCaptures.id, input.id));
    await syncOwnerStatus(context, capture.ownerId);
    await audit(context, "capture_lost", input.id, `${input.reason}${input.detail ? ` — ${input.detail}` : ""}`);
    return { ok: true };
  }),

  reopen: adminBase.input(z.object({ id: z.number().int().positive() })).handler(async ({ input, context }) => {
    const [capture] = await context.db.select().from(schema.propertyCaptures).where(eq(schema.propertyCaptures.id, input.id)).limit(1);
    if (!capture) throw new ORPCError("NOT_FOUND", { message: "Captação não encontrada" });
    const now = new Date();
    const due = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    const title = `Retornar proprietário — ${capture.ownerId}`;
    await context.db.update(schema.propertyCaptures).set({ stage: "novo_contato", lostReason: null, lostDetail: null, nextAction: title, nextActionAt: due, stageChangedAt: now, updatedAt: now }).where(eq(schema.propertyCaptures.id, input.id));
    await context.db.insert(schema.tasks).values({ title, type: "retorno", dueAt: due, status: "pendente", captureId: input.id, notes: `[capture:${input.id}] Captação reaberta` });
    await syncOwnerStatus(context, capture.ownerId);
    await audit(context, "capture_reopened", input.id);
    return { ok: true };
  }),

  markConverted: adminBase.input(z.object({ id: z.number().int().positive(), propertyId: z.number().int().positive() })).handler(async ({ input, context }) => {
    const [capture] = await context.db.select().from(schema.propertyCaptures).where(eq(schema.propertyCaptures.id, input.id)).limit(1);
    if (!capture) throw new ORPCError("NOT_FOUND", { message: "Captação não encontrada" });
    const allowed = checkConversion({
      stage: capture.stage,
      docStatus: capture.docStatus,
      estimatedPrice: capture.estimatedPrice,
      convertedPropertyId: capture.convertedPropertyId,
      propertyId: input.propertyId,
    });
    if (!allowed.ok) throw new ORPCError(allowed.code, { message: allowed.message });
    if ("already" in allowed) return { ok: true, already: true };
    const [property] = await context.db.select({ id: schema.properties.id }).from(schema.properties).where(eq(schema.properties.id, input.propertyId)).limit(1);
    if (!property) throw new ORPCError("NOT_FOUND", { message: "Imóvel não encontrado" });
    const now = new Date();
    const updated = await context.db.update(schema.propertyCaptures).set({
      convertedPropertyId: input.propertyId,
      convertedAt: now,
      stage: "captado",
      stageChangedAt: now,
      nextAction: null,
      nextActionAt: null,
      updatedAt: now,
    }).where(and(eq(schema.propertyCaptures.id, input.id), isNull(schema.propertyCaptures.convertedPropertyId))).returning({ id: schema.propertyCaptures.id });
    if (updated.length === 0) {
      const [fresh] = await context.db.select().from(schema.propertyCaptures).where(eq(schema.propertyCaptures.id, input.id)).limit(1);
      if (fresh?.convertedPropertyId === input.propertyId) return { ok: true, already: true };
      throw new ORPCError("CONFLICT", { message: "Captação já convertida" });
    }
    await closePendingTasks(context, input.id);
    await syncOwnerStatus(context, capture.ownerId);
    await audit(context, "capture_converted", input.id, `property:${input.propertyId}`);
    return { ok: true, already: false };
  }),
};

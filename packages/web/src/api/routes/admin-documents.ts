/**
 * Documentos impressos da captação: FICHA TÉCNICA (FC) e AUTORIZAÇÃO (AV).
 *
 * Arquivo separado de `admin-captures.ts` de propósito: aquele já está perto do
 * limite de 500 linhas que o lint impõe, e documento é um assunto próprio
 * (emissão, snapshot congelado e rastreio do papel).
 *
 * Toda a REGRA vive em `lib/capture-documents.ts` (puro e testado). Aqui fica
 * só a persistência: reservar serial, gravar o snapshot e registrar evento.
 */
import { z } from "zod";
import { asc, desc, eq } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { adminBase } from "../lib/admin-base";
import * as schema from "../database/schema";
import {
  type AuthorizationTerms,
  type DocKind,
  DOC_KINDS,
  DOC_TRACK_STATUSES,
  buildSnapshot,
  canFinalize,
  checkDocTransition,
  qrTarget,
  serialFor,
} from "../lib/capture-documents";
import { parseChecklist } from "../lib/capture-checklist";
import { parseComplements } from "../lib/capture-intake";
import { parseOwnerPhotos } from "../lib/capture-photos";
import { allocateSerial } from "../lib/serial-counter";

/* Dados da imobiliária usados no cabeçalho do documento.

   A FONTE é /admin → Configurações (tabela `settings`): nome, CRECI, CNAI,
   telefone e e-mail são editáveis lá. Os valores abaixo são apenas rede de
   segurança para uma base ainda não configurada — e quando algum deles é
   usado, o documento sai marcado como CONFIGURAÇÃO PENDENTE, para ninguém
   assinar um papel com dado jurídico vindo de fallback escondido. */
const BROKER_FALLBACK = {
  name: "Edy Prime Imóveis",
  creci: "CRECI 134718-F",
  cnai: "PERITO CNAI 55.918",
  phone: "(13) 99714-1174",
  email: "edyprimeimoveis@gmail.com",
};

export interface BrokerHeader {
  name: string;
  creci: string;
  phone: string | null;
  email: string | null;
  /** campos que vieram do fallback porque Configurações está incompleto */
  missing: string[];
}

async function brokerOf(context: any): Promise<BrokerHeader> {
  const [row] = await context.db.select().from(schema.settings).limit(1);
  const missing: string[] = [];
  const pick = (value: unknown, fallback: string, label: string) => {
    const text = String(value ?? "").trim();
    if (text) return text;
    missing.push(label);
    return fallback;
  };
  const name = pick(row?.companyName, BROKER_FALLBACK.name, "nome da imobiliária");
  const creci = pick(row?.creci, BROKER_FALLBACK.creci, "CRECI");
  /* CNAI NÃO é dado obrigatório da imobiliária: pertence ao profissional
     avaliador/perito e será tratado à parte. Sai impresso quando existe, mas
     nunca entra em `missing` — não vira pendência nem bloqueia emissão. */
  const cnai = String(row?.cnai ?? "").trim() || BROKER_FALLBACK.cnai;
  const phone = pick(row?.whatsapp, BROKER_FALLBACK.phone, "telefone");
  const email = pick(row?.email, BROKER_FALLBACK.email, "e-mail");
  return { name, creci: cnai ? `${creci} · ${cnai}` : creci, phone, email, missing };
}

async function documentEvent(
  context: any,
  documentId: number,
  status: string,
  note: string | null,
) {
  await context.db.insert(schema.crmDocumentEvents).values({
    documentId,
    status,
    note,
    userId: context.user.id,
    userName: context.user.name,
  });
}

async function audit(context: any, action: string, id: number, detail?: string) {
  await context.db.insert(schema.auditLog).values({
    userId: context.user.id,
    userName: context.user.name,
    action,
    entity: "capture_document",
    entityId: String(id),
    detail: detail ?? null,
  });
}

async function loadCapture(context: any, captureId: number) {
  const [capture] = await context.db
    .select()
    .from(schema.propertyCaptures)
    .where(eq(schema.propertyCaptures.id, captureId))
    .limit(1);
  if (!capture) throw new ORPCError("NOT_FOUND", { message: "Captação não encontrada" });
  const [owner] = await context.db
    .select()
    .from(schema.owners)
    .where(eq(schema.owners.id, capture.ownerId))
    .limit(1);
  return { capture, owner: owner ?? null };
}

/** Conta fotos OFICIAIS já publicadas no imóvel convertido, se houver. */
async function officialPhotoCount(context: any, propertyId: number | null) {
  if (!propertyId) return 0;
  const rows = await context.db
    .select({ id: schema.propertyImages.id })
    .from(schema.propertyImages)
    .where(eq(schema.propertyImages.propertyId, propertyId))
    .limit(200);
  return rows.length;
}

/**
 * Garante o serial-base da captação.
 *
 * Só reserva sequencial quando a captação ainda não tem serial. Se já tem, o
 * documento HERDA — nunca existe segundo serial para o mesmo imóvel, e nada é
 * renumerado. A reserva é atômica (ver lib/serial-counter.ts).
 */
async function ensureBaseSerial(context: any, capture: any): Promise<string> {
  const current = String(capture.serial ?? "").trim();
  if (current) return current;
  const serial = await allocateSerial(context.db, capture.propertyType);
  await context.db
    .update(schema.propertyCaptures)
    .set({ serial, updatedAt: new Date() })
    .where(eq(schema.propertyCaptures.id, capture.id));
  await audit(context, "capture_serial_allocated", capture.id, serial);
  return serial;
}

const termsInput = z
  .object({
    commissionPercent: z.number().min(0).max(100).nullable().optional(),
    exclusive: z.boolean().nullable().optional(),
    termDays: z.number().int().min(0).max(3650).nullable().optional(),
    authorizedPrice: z.number().min(0).nullable().optional(),
  })
  .optional();

export const adminDocuments = {
  /** Documentos de uma captação, mais recente primeiro. */
  list: adminBase
    .input(z.object({ captureId: z.number().int().positive() }))
    .handler(async ({ input, context }) => {
      const rows = await context.db
        .select()
        .from(schema.crmDocuments)
        .where(eq(schema.crmDocuments.captureId, input.captureId))
        .orderBy(desc(schema.crmDocuments.createdAt))
        .limit(100);
      return rows;
    }),

  /** Documento único com o histórico completo de rastreio. */
  get: adminBase
    .input(z.object({ id: z.number().int().positive() }))
    .handler(async ({ input, context }) => {
      const [doc] = await context.db
        .select()
        .from(schema.crmDocuments)
        .where(eq(schema.crmDocuments.id, input.id))
        .limit(1);
      if (!doc) throw new ORPCError("NOT_FOUND", { message: "Documento não encontrado" });
      const events = await context.db
        .select()
        .from(schema.crmDocumentEvents)
        .where(eq(schema.crmDocumentEvents.documentId, input.id))
        .orderBy(asc(schema.crmDocumentEvents.createdAt))
        .limit(200);
      /* O snapshot é congelado na emissão: devolvemos o JSON já decodificado
         para a tela de impressão não precisar reinterpretar nada. */
      let snapshot: unknown = null;
      try {
        snapshot = doc.snapshot ? JSON.parse(doc.snapshot) : null;
      } catch {
        snapshot = null;
      }
      return { ...doc, snapshot, events };
    }),

  /**
   * Emite um documento. Congela os dados no snapshot e abre o rastreio em
   * `gerada`. Emitir de novo é permitido (2ª via / dados corrigidos): cada
   * emissão é uma linha, e nenhuma emissão anterior é apagada.
   */
  generate: adminBase
    .input(
      z.object({
        captureId: z.number().int().positive(),
        kind: z.enum(DOC_KINDS),
        terms: termsInput,
      }),
    )
    .handler(async ({ input, context }) => {
      const { capture, owner } = await loadCapture(context, input.captureId);
      const baseSerial = await ensureBaseSerial(context, capture);
      const checklist = parseChecklist(capture.notes);
      const broker = await brokerOf(context);
      const official = await officialPhotoCount(context, capture.convertedPropertyId ?? null);

      const snapshot = buildSnapshot(
        input.kind as DocKind,
        {
          captureId: capture.id,
          serial: baseSerial,
          owner: {
            name: owner?.name ?? null,
            phone: owner?.phone ?? null,
            email: owner?.email ?? null,
            /* CPF/CNPJ e RG entram no documento impresso. Ficam congelados no
               snapshot: corrigir o cadastro depois NÃO altera papel emitido. */
            document: owner?.document ?? null,
            rg: owner?.rg ?? null,
          },
          address: {
            cep: capture.cep,
            street: capture.street,
            number: capture.number,
            district: capture.district,
            city: capture.city,
            state: capture.state,
          },
          complements: parseComplements(capture.complements),
          propertyType: capture.propertyType,
          askingPrice: capture.askingPrice,
          estimatedPrice: capture.estimatedPrice,
          docStatus: capture.docStatus,
          checklistDone: checklist.done,
          ownerPhotoCount: parseOwnerPhotos(capture.ownerPhotos).length,
          officialPhotoCount: official,
          broker,
          source: capture.source,
          notes: checklist.text || null,
          intention: capture.intention,
          hasSignedAuthorization: await hasSignedAuthorization(context, capture.id),
        },
        { terms: (input.terms ?? undefined) as AuthorizationTerms | undefined },
      );

      const serial = serialFor(input.kind as DocKind, baseSerial);

      /* O serial do documento é determinístico (FC-/AV- + serial-base) e a
         coluna tem índice UNIQUE. Clicar em "gerar" outra vez no mesmo
         documento estourava a constraint e derrubava a emissão com erro 500.
         Reemitir agora reaproveita a MESMA linha: o papel continua único e
         rastreável, e o botão sempre abre o documento.

         Documento já assinado/arquivado/cancelado não é reescrito: o snapshot
         precisa continuar igual ao papel que saiu na impressora. */
      const [existing] = await context.db
        .select()
        .from(schema.crmDocuments)
        .where(eq(schema.crmDocuments.serial, serial))
        .limit(1);
      if (existing) {
        let current = existing;
        if (existing.status === "gerada") {
          const [refreshed] = await context.db
            .update(schema.crmDocuments)
            .set({ snapshot: JSON.stringify(snapshot), updatedAt: new Date() })
            .where(eq(schema.crmDocuments.id, existing.id))
            .returning();
          if (refreshed) current = refreshed;
        }
        const events = await context.db
          .select()
          .from(schema.crmDocumentEvents)
          .where(eq(schema.crmDocumentEvents.documentId, current.id))
          .orderBy(asc(schema.crmDocumentEvents.createdAt))
          .limit(200);
        let frozen: unknown = snapshot;
        if (current.status !== "gerada") {
          try {
            frozen = current.snapshot ? JSON.parse(current.snapshot) : null;
          } catch {
            frozen = null;
          }
        }
        return { ...current, snapshot: frozen, events: events as unknown[] };
      }

      const [created] = await context.db
        .insert(schema.crmDocuments)
        .values({
          kind: input.kind,
          serial,
          baseSerial,
          captureId: capture.id,
          propertyId: capture.convertedPropertyId ?? null,
          ownerId: capture.ownerId,
          status: "gerada",
          snapshot: JSON.stringify(snapshot),
        })
        .returning();
      if (!created) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Não foi possível emitir o documento" });
      }

      await documentEvent(context, created.id, "gerada", null);
      await audit(context, "capture_document_generated", capture.id, serial);
      return { ...created, snapshot, events: [] as unknown[] };
    }),

  /** Rastreio do papel. Toda mudança gera evento com autor e data. */
  setStatus: adminBase
    .input(
      z.object({
        id: z.number().int().positive(),
        status: z.enum(DOC_TRACK_STATUSES),
        note: z.string().max(400).nullable().optional(),
      }),
    )
    .handler(async ({ input, context }) => {
      const [doc] = await context.db
        .select()
        .from(schema.crmDocuments)
        .where(eq(schema.crmDocuments.id, input.id))
        .limit(1);
      if (!doc) throw new ORPCError("NOT_FOUND", { message: "Documento não encontrado" });

      const check = checkDocTransition(doc.status, input.status);
      if (!check.ok) throw new ORPCError("BAD_REQUEST", { message: check.message });

      const note = input.note?.trim() || null;
      await context.db
        .update(schema.crmDocuments)
        .set({ status: input.status, note, updatedAt: new Date() })
        .where(eq(schema.crmDocuments.id, input.id));
      await documentEvent(context, input.id, input.status, note);
      await audit(
        context,
        "capture_document_status",
        doc.captureId ?? input.id,
        `${doc.serial}: ${doc.status} → ${input.status}`,
      );
      return { ok: true, status: input.status };
    }),

  /**
   * Painel de documentos da ficha: pendências, liberação do FINALIZAR e o
   * destino do QR. Leitura pura — não grava nada.
   */
  status: adminBase
    .input(z.object({ captureId: z.number().int().positive(), baseUrl: z.string().max(200).optional() }))
    .handler(async ({ input, context }) => {
      const { capture, owner } = await loadCapture(context, input.captureId);
      const checklist = parseChecklist(capture.notes);
      const official = await officialPhotoCount(context, capture.convertedPropertyId ?? null);
      const signed = await hasSignedAuthorization(context, capture.id);
      const finalize = canFinalize({
        docStatus: capture.docStatus,
        checklistDone: checklist.done,
        estimatedPrice: capture.estimatedPrice,
        askingPrice: capture.askingPrice,
        ownerPhotoCount: parseOwnerPhotos(capture.ownerPhotos).length,
        officialPhotoCount: official,
        hasSignedAuthorization: signed,
        hasAddress: Boolean(capture.cep && capture.number),
        hasOwnerPhone: Boolean(owner?.phone),
      });
      return {
        serial: capture.serial ?? null,
        pending: finalize.pending,
        canFinalize: finalize.ok,
        finalizeMessage: finalize.message,
        signedAuthorization: signed,
        qr: qrTarget(input.baseUrl?.trim() || "https://www.edyprimeimoveis.com.br", capture.id),
      };
    }),
};

/** Existe autorização ASSINADA (ou devolvida assinada) para esta captação? */
async function hasSignedAuthorization(context: any, captureId: number): Promise<boolean> {
  const rows = await context.db
    .select({ kind: schema.crmDocuments.kind, status: schema.crmDocuments.status })
    .from(schema.crmDocuments)
    .where(eq(schema.crmDocuments.captureId, captureId))
    .limit(100);
  return rows.some(
    (row: { kind: string; status: string }) =>
      row.kind === "autorizacao" && (row.status === "assinada" || row.status === "devolvida" || row.status === "arquivada"),
  );
}

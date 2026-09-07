/**
 * Entrada única de proprietários (captação).
 *
 * Espelha o que lib/lead-intake.ts faz com compradores, mas na tabela que já
 * existe: `owners`. Não existe CRM paralelo e nenhuma tabela nova.
 *
 * Regras:
 *  - proprietário repetido NÃO cria linha nova: vira histórico no campo notes;
 *  - todo contato novo gera uma tarefa de retorno na agenda que já existe;
 *  - telefone é comparado por dígitos, então "(13) 99714-1174" e "13997141174"
 *    são reconhecidos como a mesma pessoa (linhas antigas foram salvas
 *    formatadas pelo painel).
 */
import { and, eq } from "drizzle-orm";
import * as schema from "../database/schema";
import type { AdminDb } from "./admin-base";
import { duplicateAlertText, resolveOwnerIdentity } from "./owner-identity";
import type { Complements } from "./capture-address";
import { buildCapturePayload, findDuplicateUnit } from "./capture-intake";

export interface OwnerIntakeInput {
  name: string;
  phone: string;
  email?: string | null;
  /** tipo do imóvel informado no site (apartamento, casa, terreno...) */
  propertyType?: string | null;
  /** bairro/região informada no site */
  neighborhood?: string | null;
  message?: string | null;
  /** de onde veio: site_vender, etc. */
  source?: string | null;
  /* V3 — ficha única: o imóvel vem junto com o proprietário. Todos opcionais,
     porque o formulário público não pode exigir CEP para aceitar um contato. */
  cep?: string | null;
  street?: string | null;
  number?: string | null;
  city?: string | null;
  state?: string | null;
  complements?: Complements | null;
  askingPrice?: number | null;
}

export interface OwnerIntakeResult {
  id: number;
  duplicated: boolean;
  detail: string;
  /**
   * Captação criada para ESTE imóvel.
   *
   * O formulário público alimentava só `owners` + `tasks` e o Radar de
   * Captação nunca via o contato do site. Agora todo envio cria também a
   * `property_capture` com `source = site`.
   */
  captureId: number | null;
  /** Aviso de unidade repetida. Informativo: nada é bloqueado. */
  duplicateUnit: string | null;
}

const onlyDigits = (value: string) => value.replace(/\D/g, "");

/** Marcador estável para amarrar a tarefa ao proprietário sem coluna nova. */
export const ownerTaskMarker = (ownerId: number) => `[owner:${ownerId}]`;

function buildHistoryLine(input: OwnerIntakeInput, when: Date) {
  const stamp = when.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const parts = [
    `— ${stamp} · contato via ${input.source || "site"}`,
    input.propertyType ? `Tipo: ${input.propertyType}` : "",
    input.neighborhood ? `Bairro/região: ${input.neighborhood}` : "",
    input.email ? `E-mail: ${input.email}` : "",
    input.message ? `Mensagem: ${input.message}` : "",
  ].filter(Boolean);
  return parts.join("\n");
}

/**
 * Cria a tarefa de retorno, a menos que já exista uma pendente para o mesmo
 * proprietário — evita fila de tarefas duplicadas quando a pessoa reenvia.
 */
async function ensureFollowUpTask(
  db: AdminDb,
  ownerId: number,
  input: OwnerIntakeInput,
  captureId: number | null = null,
) {
  const marker = ownerTaskMarker(ownerId);

  const pending = await db
    .select({ id: schema.tasks.id, notes: schema.tasks.notes })
    .from(schema.tasks)
    .where(and(eq(schema.tasks.status, "pendente"), eq(schema.tasks.type, "retorno")))
    .limit(200);

  if (pending.some((task) => (task.notes ?? "").includes(marker))) return false;

  const dueAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const notes = [
    marker,
    /* Marcador do Radar: é por ele que a ficha da captação encontra a tarefa
       criada pelo site (mesmo padrão usado em routes/admin-captures.ts). */
    captureId ? `[capture:${captureId}]` : "",
    `Proprietário quer avaliação de imóvel.`,
    `WhatsApp: ${input.phone}`,
    input.propertyType ? `Tipo: ${input.propertyType}` : "",
    input.neighborhood ? `Bairro/região: ${input.neighborhood}` : "",
    input.email ? `E-mail: ${input.email}` : "",
    input.message ? `Mensagem: ${input.message}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  await db.insert(schema.tasks).values({
    title: `Avaliação: ${input.name.trim().slice(0, 80)}`,
    type: "retorno",
    dueAt,
    status: "pendente",
    captureId: captureId ?? null,
    notes,
  });

  return true;
}

/**
 * Cria a captação do imóvel que veio na ficha.
 *
 * Antes do V3 o formulário público gravava só `owners` + `tasks`, e o Radar de
 * Captação nunca via o contato do site — o funil começava vazio. Agora todo
 * envio cria a `property_capture` correspondente, com origem `site`.
 *
 * O mesmo proprietário pode mandar vários imóveis: cada envio com unidade
 * diferente vira uma captação nova. Unidade repetida AVISA e reaproveita a
 * captação existente em vez de duplicar a ficha.
 */
async function ensureCapture(
  db: AdminDb,
  ownerId: number,
  ownerName: string,
  input: OwnerIntakeInput,
  now: Date,
): Promise<{ captureId: number | null; duplicateUnit: string | null }> {
  const payload = buildCapturePayload({
    ownerName: input.name,
    ownerPhone: input.phone,
    ownerEmail: input.email ?? null,
    cep: input.cep ?? null,
    street: input.street ?? null,
    number: input.number ?? null,
    district: input.neighborhood ?? null,
    city: input.city ?? null,
    state: input.state ?? null,
    complements: input.complements ?? null,
    propertyType: input.propertyType ?? null,
    askingPrice: input.askingPrice ?? null,
    notes: input.message ?? null,
    source: input.source ?? "site",
  });

  const existing = await db
    .select({
      id: schema.propertyCaptures.id,
      ownerId: schema.propertyCaptures.ownerId,
      unitKey: schema.propertyCaptures.unitKey,
      stage: schema.propertyCaptures.stage,
    })
    .from(schema.propertyCaptures)
    .limit(1000);

  const duplicate = findDuplicateUnit(existing, { unitKey: payload.unitKey, ownerId });

  /* Reenvio do MESMO imóvel pelo MESMO dono não cria ficha nova: o Radar
     ficaria com duas fichas idênticas a cada vez que a pessoa clica de novo. */
  if (duplicate.duplicate && duplicate.sameOwner) {
    return { captureId: duplicate.captureId, duplicateUnit: duplicate.message };
  }

  const due = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const [capture] = await db
    .insert(schema.propertyCaptures)
    .values({
      ownerId,
      city: payload.city,
      district: payload.district,
      address: payload.address,
      cep: payload.cep,
      street: payload.street,
      number: payload.number,
      state: payload.state,
      complements: payload.complements,
      unitKey: payload.unitKey,
      propertyType: payload.propertyType,
      askingPrice: payload.askingPrice,
      intention: payload.intention,
      /* Aviso de duplicidade fica registrado na ficha, sem travar nada. */
      notes: [payload.notes, duplicate.duplicate ? duplicate.message : ""].filter(Boolean).join("\n\n") || null,
      source: payload.source,
      stage: "novo_contato",
      nextAction: `Retornar proprietário — ${ownerName}`,
      nextActionAt: due,
      stageChangedAt: now,
      updatedAt: now,
    })
    .returning();

  return {
    captureId: capture?.id ?? null,
    duplicateUnit: duplicate.duplicate ? duplicate.message : null,
  };
}

/** Grava (ou funde) um proprietário. Sempre retorna o id no CRM. */
export async function intakeOwner(
  db: AdminDb,
  input: OwnerIntakeInput,
): Promise<OwnerIntakeResult> {
  const phoneDigits = onlyDigits(input.phone).slice(0, 20);
  const email = input.email?.trim().toLowerCase() || null;
  const now = new Date();

  /* Candidatos: a tabela de proprietários é pequena, então a comparação por
     dígitos é feita em memória para also casar telefones salvos formatados. */
  const candidates = await db
    .select()
    .from(schema.owners)
    .limit(500);

  /* Identidade V3: o TELEFONE reutiliza o proprietário; o e-mail NÃO mescla
     mais. E-mail repetido cria o proprietário normalmente e só marca POSSÍVEL
     DUPLICADO para revisão humana — ver lib/owner-identity.ts. */
  const decision = resolveOwnerIdentity(candidates, { phone: phoneDigits, email });

  const existing =
    decision.action === "reuse"
      ? candidates.find((owner) => owner.id === decision.ownerId)
      : undefined;

  if (existing) {
    const history = [existing.notes?.trim(), buildHistoryLine(input, now)]
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 4000);

    await db
      .update(schema.owners)
      .set({
        /* nunca sobrescreve o que já existe; só preenche o que estava vazio */
        email: existing.email ?? email,
        phone: existing.phone ?? (phoneDigits || null),
        notes: history,
      })
      .where(eq(schema.owners.id, existing.id));

    /* Proprietário reaproveitado NÃO significa imóvel reaproveitado: o mesmo
       dono pode mandar o segundo, o terceiro imóvel. Cada unidade diferente
       gera a sua própria captação. */
    const capture = await ensureCapture(db, existing.id, existing.name ?? input.name, input, now);
    const taskCreated = await ensureFollowUpTask(db, existing.id, input, capture.captureId);

    return {
      id: existing.id,
      duplicated: true,
      captureId: capture.captureId,
      duplicateUnit: capture.duplicateUnit,
      detail: [
        taskCreated
          ? `Contato somado ao proprietário #${existing.id} e tarefa de retorno criada.`
          : `Contato somado ao proprietário #${existing.id}; já havia retorno pendente.`,
        capture.captureId ? `Captação #${capture.captureId} no Radar.` : "",
        capture.duplicateUnit ?? "",
      ]
        .filter(Boolean)
        .join(" "),
    };
  }

  /* Proprietário novo. Um e-mail já usado por outra pessoa NÃO impede o
     cadastro: apenas levanta o alerta de revisão, porque e-mail compartilhado
     (cônjuge, contato@, síndico) fundia pessoas diferentes num único owner. */
  const duplicateOfOwnerId = decision.action === "create" ? decision.duplicateOfOwnerId : null;
  const duplicateNote = duplicateAlertText(duplicateOfOwnerId);

  const [created] = await db
    .insert(schema.owners)
    .values({
      name: input.name.trim().slice(0, 120) || "Proprietário sem nome",
      phone: phoneDigits || null,
      email,
      notes: buildHistoryLine(input, now).slice(0, 4000),
      captureStatus: "prospeccao",
      possibleDuplicate: duplicateOfOwnerId == null ? 0 : 1,
      duplicateOfOwnerId,
      duplicateNote,
    })
    .returning();

  let capture: { captureId: number | null; duplicateUnit: string | null } = {
    captureId: null,
    duplicateUnit: null,
  };
  if (created) {
    capture = await ensureCapture(db, created.id, created.name ?? input.name, input, now);
    await ensureFollowUpTask(db, created.id, input, capture.captureId);
  }

  return {
    id: created?.id ?? 0,
    duplicated: false,
    captureId: capture.captureId,
    duplicateUnit: capture.duplicateUnit,
    detail: [
      "Proprietário criado no CRM com tarefa de retorno.",
      capture.captureId ? `Captação #${capture.captureId} no Radar.` : "",
      duplicateNote ?? "",
      capture.duplicateUnit ?? "",
    ]
      .filter(Boolean)
      .join(" "),
  };
}

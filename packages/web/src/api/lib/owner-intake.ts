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
import { buildCapturePayload, findDuplicateUnit, parseComplements } from "./capture-intake";
import { mergeCaptureFields, mergeHistoryNote } from "./capture-merge";
import { deriveRegistrationStatus, hasAddressIdentity, resolveResume } from "./capture-registration";
import { outsidePriorityArea, parsePriorityCities } from "./priority-area";

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
  /* V4 — eixo de status do cadastro, retomada e área prioritária. */
  /** `true` quando o cadastro pendente do proprietário foi continuado. */
  resumed: boolean;
  /** Status do cadastro (NOVO, EM_ANDAMENTO, INCOMPLETO, CONCLUIDO...). */
  registrationStatus: string | null;
  /** Percentual da ficha preenchido. */
  completeness: number;
  /** `true` quando a cidade está fora da área prioritária — sinaliza, não barra. */
  outsidePriorityArea: boolean;
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
/** Resultado interno da captação, já com o eixo de status do cadastro. */
type CaptureOutcome = {
  captureId: number | null;
  duplicateUnit: string | null;
  resumed: boolean;
  registrationStatus: string | null;
  completeness: number;
  outsidePriorityArea: boolean;
};

const EMPTY_OUTCOME: CaptureOutcome = {
  captureId: null,
  duplicateUnit: null,
  resumed: false,
  registrationStatus: null,
  completeness: 0,
  outsidePriorityArea: false,
};

/**
 * Cidades prioritárias configuradas no painel.
 *
 * Configuração ausente ou inválida cai na lista padrão — a área prioritária
 * nunca fica vazia, senão TODO imóvel apareceria como fora da área.
 */
async function loadPriorityCities(db: AdminDb): Promise<string[]> {
  const [row] = await db
    .select({ priorityCities: schema.settings.priorityCities })
    .from(schema.settings)
    .limit(1);
  return parsePriorityCities(row?.priorityCities);
}

async function ensureCapture(
  db: AdminDb,
  ownerId: number,
  ownerName: string,
  input: OwnerIntakeInput,
  now: Date,
): Promise<CaptureOutcome> {
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

  const priorityCities = await loadPriorityCities(db);
  const outside = outsidePriorityArea(payload.city, priorityCities);

  const rows = await db.select().from(schema.propertyCaptures).limit(1000);

  /* Ficha como o módulo de status a enxerga — é o que mede a completude. */
  const ficha = {
    ownerName: input.name,
    ownerPhone: input.phone,
    ownerEmail: input.email ?? null,
    city: payload.city,
    street: payload.street,
    number: payload.number,
    district: payload.district,
    cep: payload.cep,
    propertyType: payload.propertyType,
    askingPrice: payload.askingPrice,
    intention: payload.intention,
  };

  const written = { city: payload.city, street: payload.street, number: payload.number, cep: payload.cep };
  const complements = parseComplements(payload.complements);

  const duplicate = findDuplicateUnit(
    rows.map((row) => ({
      id: row.id,
      ownerId: row.ownerId,
      unitKey: row.unitKey,
      stage: row.stage,
      addressKey: row.addressKey,
      buildingKey: row.buildingKey,
      address: { city: row.city, street: row.street, number: row.number, cep: row.cep },
      complements: parseComplements(row.complements),
    })),
    {
      unitKey: payload.unitKey,
      addressKey: payload.addressKey,
      address: written,
      complements,
      ownerId,
    },
  );

  /* MESMO imóvel do MESMO dono: nunca cria ficha nova. Se o cadastro ainda
     está pendente, ele é CONTINUADO campo a campo; se já foi concluído, só
     devolve a ficha existente. Duas fichas idênticas no Radar a cada clique
     era o que acontecia antes. */
  if (duplicate.duplicate && duplicate.sameOwner) {
    const target = rows.find((row) => row.id === duplicate.captureId);
    if (target) {
      return await resumeCapture(db, target, { payload, ficha, outside, now, duplicateUnit: duplicate.message });
    }
    return { ...EMPTY_OUTCOME, captureId: duplicate.captureId, duplicateUnit: duplicate.message };
  }

  /* Retomada por telefone (item 3): o proprietário abandonou o cadastro e
     voltou. Sem endereço informado, continua o pendente mais recente; com
     endereço de OUTRO imóvel, `resolveResume` devolve `new` e o segundo
     imóvel nasce reaproveitando o mesmo contato (item 4). */
  const resume = resolveResume(
    rows
      .filter((row) => row.ownerId === ownerId)
      .map((row) => ({
        id: row.id,
        ownerId: row.ownerId,
        registrationStatus: row.registrationStatus,
        stage: row.stage,
        unitKey: row.unitKey,
        addressKey: row.addressKey,
        updatedAt: row.updatedAt,
        createdAt: row.createdAt,
      })),
    { unitKey: payload.unitKey, addressKey: payload.addressKey },
  );

  if (resume.action === "resume") {
    const target = rows.find((row) => row.id === resume.captureId);
    if (target) {
      return await resumeCapture(db, target, {
        payload,
        ficha,
        outside,
        now,
        duplicateUnit: duplicate.duplicate ? duplicate.message : null,
        resumeNote: resume.message,
      });
    }
  }

  /* Endereço de outro proprietário: a ficha nasce marcada para revisão
     humana. Item 5 do pedido — NUNCA excluir automaticamente. */
  const foreignDuplicate = duplicate.duplicate && !duplicate.sameOwner;
  const decision = deriveRegistrationStatus(
    ficha,
    { lastActivityAt: now, possibleDuplicate: foreignDuplicate },
    now,
  );

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
      addressKey: payload.addressKey || null,
      buildingKey: payload.buildingKey || null,
      propertyType: payload.propertyType,
      askingPrice: payload.askingPrice,
      intention: payload.intention,
      /* Aviso de duplicidade fica registrado na ficha, sem travar nada. */
      notes: [payload.notes, duplicate.duplicate ? duplicate.message : ""].filter(Boolean).join("\n\n") || null,
      source: payload.source,
      stage: "novo_contato",
      registrationStatus: decision.status,
      registrationStatusAt: now,
      completeness: decision.completeness.percent,
      lastFieldAt: now,
      outsidePriorityArea: outside ? 1 : 0,
      duplicateOfCaptureId: foreignDuplicate ? duplicate.captureId : null,
      duplicateNote: foreignDuplicate ? duplicate.message : null,
      nextAction: `Retornar proprietário — ${ownerName}`,
      nextActionAt: due,
      stageChangedAt: now,
      updatedAt: now,
    })
    .returning();

  return {
    captureId: capture?.id ?? null,
    duplicateUnit: duplicate.duplicate ? duplicate.message : null,
    resumed: false,
    registrationStatus: decision.status,
    completeness: decision.completeness.percent,
    outsidePriorityArea: outside,
  };
}

/**
 * Continua um cadastro que já existe, campo a campo.
 *
 * Nada do que o proprietário já informou é perdido: `mergeCaptureFields` só
 * preenche o que está vazio. Valor divergente é preservado e anotado para
 * conferência humana — ver lib/capture-merge.ts.
 */
async function resumeCapture(
  db: AdminDb,
  target: typeof schema.propertyCaptures.$inferSelect,
  context: {
    payload: ReturnType<typeof buildCapturePayload>;
    ficha: Parameters<typeof deriveRegistrationStatus>[0];
    outside: boolean;
    now: Date;
    duplicateUnit: string | null;
    resumeNote?: string;
  },
): Promise<CaptureOutcome> {
  const { payload, outside, now } = context;

  /**
   * Ficha aberta sem endereço: as chaves de identidade gravadas nela são
   * degeneradas (só cidade), e a linha de endereço livre também. Quando o
   * endereço finalmente chega, essas chaves PODEM ser reescritas — sem isso a
   * ficha ficaria com a chave do "nenhum endereço" e a duplicidade da unidade
   * nunca seria reconhecida depois. Nenhum dado informado pelo proprietário
   * entra nesta lista: `overwrite` cobre só as chaves derivadas e a linha
   * formatada que elas geram.
   */
  const semEndereco = !hasAddressIdentity(target);

  const merged = mergeCaptureFields(
    {
      city: target.city,
      district: target.district,
      address: target.address,
      cep: target.cep,
      street: target.street,
      number: target.number,
      state: target.state,
      complements: target.complements,
      unitKey: target.unitKey,
      addressKey: target.addressKey,
      buildingKey: target.buildingKey,
      propertyType: target.propertyType,
      askingPrice: target.askingPrice,
      intention: target.intention,
    },
    {
      city: payload.city,
      district: payload.district,
      address: payload.address,
      cep: payload.cep,
      street: payload.street,
      number: payload.number,
      state: payload.state,
      complements: payload.complements,
      unitKey: payload.unitKey,
      addressKey: payload.addressKey,
      buildingKey: payload.buildingKey,
      propertyType: payload.propertyType,
      askingPrice: payload.askingPrice,
      intention: payload.intention,
    },
    semEndereco ? { overwrite: ["unitKey", "addressKey", "buildingKey", "address"] } : {},
  );

  /* A completude é medida sobre a ficha DEPOIS da mesclagem: é o estado real
     do cadastro, não só o que veio neste envio. */
  const after = { ...context.ficha, ...merged.patch } as typeof context.ficha;
  const decision = deriveRegistrationStatus(
    after,
    { current: target.registrationStatus, lastActivityAt: now, possibleDuplicate: false },
    now,
  );

  const history = [
    target.notes?.trim(),
    context.resumeNote ?? "",
    mergeHistoryNote(merged, target.id) ?? "",
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 4000) || null;

  await db
    .update(schema.propertyCaptures)
    .set({
      /* `capture-merge` é módulo puro e devolve os valores como `unknown`
         (ele não conhece o schema); aqui eles voltam ao tipo da tabela. */
      ...(merged.patch as Partial<typeof schema.propertyCaptures.$inferInsert>),
      notes: history,
      registrationStatus: decision.status,
      registrationStatusAt: now,
      completeness: decision.completeness.percent,
      lastFieldAt: now,
      outsidePriorityArea: outside ? 1 : 0,
      updatedAt: now,
    })
    .where(eq(schema.propertyCaptures.id, target.id));

  return {
    captureId: target.id,
    duplicateUnit: context.duplicateUnit,
    resumed: true,
    registrationStatus: decision.status,
    completeness: decision.completeness.percent,
    outsidePriorityArea: outside,
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
      resumed: capture.resumed,
      registrationStatus: capture.registrationStatus,
      completeness: capture.completeness,
      outsidePriorityArea: capture.outsidePriorityArea,
      detail: [
        taskCreated
          ? `Contato somado ao proprietário #${existing.id} e tarefa de retorno criada.`
          : `Contato somado ao proprietário #${existing.id}; já havia retorno pendente.`,
        capture.resumed && capture.captureId
          ? `Cadastro #${capture.captureId} retomado de onde parou.`
          : capture.captureId
            ? `Captação #${capture.captureId} no Radar.`
            : "",
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

  let capture: CaptureOutcome = EMPTY_OUTCOME;
  if (created) {
    capture = await ensureCapture(db, created.id, created.name ?? input.name, input, now);
    await ensureFollowUpTask(db, created.id, input, capture.captureId);
  }

  return {
    id: created?.id ?? 0,
    duplicated: false,
    captureId: capture.captureId,
    duplicateUnit: capture.duplicateUnit,
    resumed: capture.resumed,
    registrationStatus: capture.registrationStatus,
    completeness: capture.completeness,
    outsidePriorityArea: capture.outsidePriorityArea,
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

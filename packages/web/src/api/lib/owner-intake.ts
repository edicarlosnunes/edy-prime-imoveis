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
}

export interface OwnerIntakeResult {
  id: number;
  duplicated: boolean;
  detail: string;
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
async function ensureFollowUpTask(db: AdminDb, ownerId: number, input: OwnerIntakeInput) {
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
    notes,
  });

  return true;
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

  const existing = candidates.find((owner) => {
    const ownerPhone = onlyDigits(owner.phone ?? "");
    if (phoneDigits && ownerPhone && ownerPhone === phoneDigits) return true;
    const ownerEmail = owner.email?.trim().toLowerCase() || null;
    return Boolean(email && ownerEmail && ownerEmail === email);
  });

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

    const taskCreated = await ensureFollowUpTask(db, existing.id, input);

    return {
      id: existing.id,
      duplicated: true,
      detail: taskCreated
        ? `Contato somado ao proprietário #${existing.id} e tarefa de retorno criada.`
        : `Contato somado ao proprietário #${existing.id}; já havia retorno pendente.`,
    };
  }

  const [created] = await db
    .insert(schema.owners)
    .values({
      name: input.name.trim().slice(0, 120) || "Proprietário sem nome",
      phone: phoneDigits || null,
      email,
      notes: buildHistoryLine(input, now).slice(0, 4000),
      captureStatus: "prospeccao",
    })
    .returning();

  if (created) await ensureFollowUpTask(db, created.id, input);

  return {
    id: created?.id ?? 0,
    duplicated: false,
    detail: "Proprietário criado no CRM com tarefa de retorno.",
  };
}

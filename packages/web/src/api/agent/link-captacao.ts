/**
 * LINK_CAPTACAO V2 — proprietário residencial/comercial.
 *
 * Entrada reaproveitada do PR17; corpo reconstruído no PR18.
 * Fluxo desta etapa: proprietário -> nome -> endereço -> condomínio ->
 * documentação -> tipo -> dormitórios -> suítes -> banheiros -> vagas ->
 * área -> valor -> condomínio -> IPTU -> conclusão.
 */
import { eq, desc } from "drizzle-orm";
import type { AdminDb } from "../lib/admin-base";
import * as schema from "../database/schema";
import { ownerPhoneKey } from "../lib/owner-identity";
import { saveCaptureAnswer, parseCaptureBlock } from "./owner-capture";
import type { AgentReply, AgentRow, AgentTurn } from "./broker";

export const LINK_CAPTACAO_ORIGIN = "LINK_CAPTACAO";
export const LINK_CAPTACAO_TOKEN = "LINK_CAPTACAO";
export const LINK_CAPTACAO_OWNER_TOKEN = "LINK_CAPTACAO_PROPRIETARIO";
export const LINK_CAPTACAO_BROKER_TOKEN = "LINK_CAPTACAO_CORRETOR";
export const LINK_CAPTACAO_MESSAGE = "Vamos cadastrar seu imóvel?";

const ROLE_QUESTION = "Você é o proprietário do imóvel ou corretor?";
const NAME_QUESTION = "Qual é o seu nome completo?";
const ROLE_REJECTED =
  "Nos desculpe, este cadastro precisa ser realizado pelo proprietário do imóvel ou corretor, pois teremos algumas informações que somente eles poderão confirmar.";
export const CLOSING_MESSAGE =
  "Cadastro concluído com sucesso! Em breve entraremos em contato para dar continuidade ao atendimento.";

const QUESTIONS = {
  endereco: "Qual é o endereço completo do imóvel?",
  emCondominio: "Este imóvel fica em condomínio? Responda SIM ou NÃO.",
  documentacao: "Qual é a situação da documentação do imóvel? Se não souber, digite NÃO SEI.",
  tipo: "Qual é o tipo do imóvel? Ex.: apartamento, casa, kitnet, sala, living, sobrado ou outro.",
  dormitorios: "Quantos dormitórios? Se não se aplicar, digite 0.",
  suites: "Quantas suítes? Se não se aplicar, digite 0.",
  banheiros: "Quantos banheiros? Se não se aplicar, digite 0.",
  vagas: "Quantas vagas de garagem? Se não se aplicar, digite 0.",
  metragem: "Qual é a área útil ou construída? Ex.: 75 m². Se não souber, digite NÃO SEI.",
  valor: "Qual é o valor pretendido do imóvel? Se não souber, digite NÃO SEI.",
  condominio: "Qual é o valor do condomínio? Se não houver, digite 0. Se não souber, digite NÃO SEI.",
  iptu: "Qual é o valor do IPTU? Se não houver ou for isento, digite 0. Se não souber, digite NÃO SEI.",
} as const;
type Step = "nome" | keyof typeof QUESTIONS | "concluido";

const fold = (value: string | null | undefined) =>
  String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

const isGenericLinkStart = (text: string | null | undefined) => {
  const value = fold(text);
  const start = fold(LINK_CAPTACAO_MESSAGE);
  if (!value || !start || !value.includes(start)) return false;
  return value.split(start).join("").trim() === "";
};

export function linkCaptacaoUrl(whatsapp: string): string {
  const digits = String(whatsapp ?? "").replace(/\D/g, "");
  const phone = digits.startsWith("55") ? digits : `55${digits}`;
  return `https://wa.me/${phone}?text=${encodeURIComponent(LINK_CAPTACAO_MESSAGE)}`;
}
export const hasLinkToken = (text: string | null | undefined) => isGenericLinkStart(text);

const sessionKey = (phone: string, entryIndex: number, turns: readonly AgentTurn[]) => {
  const before = turns.slice(0, entryIndex + 1).filter((t) => t.role === "user").length;
  return `link:${ownerPhoneKey(phone) ?? phone}:${before}`;
};

async function sessionByKey(db: AdminDb, key: string) {
  return (await db.select().from(schema.linkCaptacaoSessions)
    .where(eq(schema.linkCaptacaoSessions.sessionKey, key)).limit(1))[0] ?? null;
}
async function captureById(db: AdminDb, id: number | null) {
  if (!id) return null;
  return (await db.select().from(schema.propertyCaptures)
    .where(eq(schema.propertyCaptures.id, id)).limit(1))[0] ?? null;
}

export interface LinkCaptacaoState {
  active: true;
  presenter: "pendente" | "proprietario" | "corretor";
  entryIndex: number;
  roleIndex: number | null;
  sessionKey: string;
  sessionId: number | null;
  captureId: number | null;
  nextStep: Step;
  nextQuestion: string;
}

function latestEntryIndex(turns: readonly AgentTurn[]) {
  let index = -1;
  turns.forEach((turn, i) => {
    if (turn.role === "user" && isGenericLinkStart(turn.content)) index = i;
  });
  return index;
}

async function ensureSession(db: AdminDb, key: string, phone: string, profile: string, step: string) {
  let row = await sessionByKey(db, key);
  if (row) return row;
  const now = new Date();
  const [created] = await db.insert(schema.linkCaptacaoSessions).values({
    sessionKey: key, contactPhone: phone, profile, currentStep: step,
    status: "ativa", createdAt: now, updatedAt: now,
  }).returning();
  return created ?? null;
}

async function stepFromDb(db: AdminDb, captureId: number | null): Promise<Step> {
  const capture = await captureById(db, captureId);
  if (!capture) return "nome";
  const answers = parseCaptureBlock(capture.notes).answers as Record<string,string|undefined>;
  if (!capture.address) return "endereco";
  if (!answers.emCondominio) return "emCondominio";
  if (!answers.documentacao) return "documentacao";
  if (!capture.propertyType) return "tipo";
  if (!answers.dormitorios) return "dormitorios";
  if (!answers.suites) return "suites";
  if (!answers.banheiros) return "banheiros";
  if (!answers.vagas) return "vagas";
  if (!answers.metragem) return "metragem";
  if (!(capture.askingPrice && capture.askingPrice > 0) && !answers.valorPretendidoStatus) return "valor";
  if (!answers.condominio) return "condominio";
  if (!answers.custos) return "iptu";
  return "concluido";
}

const questionFor = (step: Step) =>
  step === "nome" ? NAME_QUESTION :
  step === "concluido" ? CLOSING_MESSAGE :
  QUESTIONS[step];

export async function linkCaptacaoState(
  db: AdminDb, phone: string | null, turns: readonly AgentTurn[],
): Promise<LinkCaptacaoState | null> {
  const phoneKey = ownerPhoneKey(phone);
  if (!phoneKey || !phone) return null;
  const entryIndex = latestEntryIndex(turns);
  if (entryIndex < 0) return null;

  const key = sessionKey(phone, entryIndex, turns);
  const afterEntry = turns.slice(entryIndex + 1);
  const validRoleOffset = afterEntry.findIndex((turn) =>
    turn.role === "user" && /^(proprietario|proprietaria|corretor|corretora)$/.test(fold(turn.content)));
  if (validRoleOffset < 0) {
    return { active:true, presenter:"pendente", entryIndex, roleIndex:null, sessionKey:key,
      sessionId:null, captureId:null, nextStep:"nome", nextQuestion:ROLE_QUESTION };
  }
  const roleIndex = entryIndex + 1 + validRoleOffset;
  const role = fold(turns[roleIndex]?.content);
  const presenter = /^proprietari[oa]$/.test(role) ? "proprietario" : "corretor";
  if (presenter === "corretor") {
    return { active:true, presenter, entryIndex, roleIndex, sessionKey:key,
      sessionId:null, captureId:null, nextStep:"nome", nextQuestion:ROLE_QUESTION };
  }

  const session = await ensureSession(db, key, phoneKey, "proprietario", "nome");
  const nextStep = await stepFromDb(db, session?.captureId ?? null);
  return { active:true, presenter, entryIndex, roleIndex, sessionKey:key,
    sessionId:session?.id ?? null, captureId:session?.captureId ?? null,
    nextStep, nextQuestion:questionFor(nextStep) };
}

const afterRoleUserReplies = (turns: readonly AgentTurn[], roleIndex: number) =>
  turns.slice(roleIndex + 1).filter((t) => t.role === "user").map((t) => t.content.trim()).filter(Boolean);

const numberValue = (text: string) => {
  const raw = text.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
};
const isUnknown = (text: string) => /^(nao sei|não sei)$/i.test(text.trim());
const isZero = (text: string) => /^(0|zero|nao tem|não tem|nenhum|nenhuma|isento|isenta)$/i.test(text.trim());

async function bindNewCapture(db: AdminDb, state: LinkCaptacaoState, phone: string, name: string) {
  const saved = await saveCaptureAnswer(db, {
    phone, nome:name, negociacao:"venda", origem:LINK_CAPTACAO_ORIGIN, novaSessaoLink:true,
  });
  if (!saved.saved || !saved.captureId || !state.sessionId) return saved;
  const now = new Date();
  await db.update(schema.linkCaptacaoSessions).set({
    ownerId:saved.snapshot.ownerId, captureId:saved.captureId, currentStep:"endereco", updatedAt:now,
  }).where(eq(schema.linkCaptacaoSessions.id, state.sessionId));
  return saved;
}

async function saveBlockDirect(db: AdminDb, captureId: number, key: string, value: string) {
  const capture = await captureById(db, captureId);
  if (!capture) return false;
  const parsed = parseCaptureBlock(capture.notes);
  const answers = { ...(parsed.answers as Record<string,string>), [key]: value };
  const labels: Record<string,string> = {
    emCondominio:"Imóvel em condomínio", documentacao:"Documentação", dormitorios:"Dormitórios",
    suites:"Suítes", banheiros:"Banheiros", vagas:"Vagas de garagem", metragem:"Metragem",
    condominio:"Condomínio e unidade", custos:"Custos",
  };
  const knownOrder = ["origem","emCondominio","documentacao","dormitorios","suites","banheiros","vagas","metragem","condominio","custos"];
  const lines = knownOrder.filter(k=>answers[k]).map(k=>`- ${labels[k] ?? "Origem do cadastro"}: ${answers[k]}`);
  const notes = [parsed.text, "[captacao-ia]", ...lines, "[/captacao-ia]"].filter(Boolean).join("\n");
  await db.update(schema.propertyCaptures).set({notes,updatedAt:new Date(),lastFieldAt:new Date()})
    .where(eq(schema.propertyCaptures.id,captureId));
  return true;
}

async function advanceSession(db: AdminDb, state: LinkCaptacaoState, step: Step) {
  if (!state.sessionId) return;
  const now=new Date();
  await db.update(schema.linkCaptacaoSessions).set({
    currentStep:step, status:step==="concluido"?"concluida":"ativa",
    completedAt:step==="concluido"?now:null, updatedAt:now,
  }).where(eq(schema.linkCaptacaoSessions.id,state.sessionId));
}

export async function linkCaptacaoReply(
  db: AdminDb, _agent: AgentRow, turns: readonly AgentTurn[], phone: string,
  state: LinkCaptacaoState, _configuredModel: string | null = null,
): Promise<AgentReply> {
  const reply=(text:string):AgentReply=>({text,handoff:false,handoffReason:null,usedProperties:[],toolCalls:[]});

  if (state.presenter==="pendente") {
    const replies=turns.slice(state.entryIndex+1).filter(t=>t.role==="user");
    return reply(replies.length ? ROLE_REJECTED : ROLE_QUESTION);
  }
  if (state.presenter!=="proprietario") return reply(ROLE_QUESTION);

  const responses=afterRoleUserReplies(turns,state.roleIndex!);
  const last=responses.at(-1) ?? "";

  if (state.nextStep==="nome") {
    if (!last) return reply(NAME_QUESTION);
    const saved=await bindNewCapture(db,state,phone,last.slice(0,120));
    if (!saved.saved) return reply(NAME_QUESTION);
    return reply(QUESTIONS.endereco);
  }
  if (state.nextStep==="concluido") return reply(CLOSING_MESSAGE);
  if (!state.captureId || !last) return reply(state.nextQuestion);

  let ok=false;
  if (state.nextStep==="endereco") {
    const saved=await saveCaptureAnswer(db,{phone,nome:undefined,rua:last,negociacao:"venda",origem:LINK_CAPTACAO_ORIGIN});
    ok=saved.saved;
  } else if (state.nextStep==="emCondominio") {
    const v=fold(last); if (/^(sim|s|nao|não|n)$/.test(v)) ok=await saveBlockDirect(db,state.captureId,"emCondominio",/^s/.test(v)?"SIM":"NÃO");
  } else if (state.nextStep==="documentacao") {
    ok=await saveBlockDirect(db,state.captureId,"documentacao",isUnknown(last)?"não informado":last.slice(0,300));
  } else if (state.nextStep==="tipo") {
    const saved=await saveCaptureAnswer(db,{phone,tipoImovel:last.slice(0,60),negociacao:"venda",origem:LINK_CAPTACAO_ORIGIN}); ok=saved.saved;
  } else if (["dormitorios","suites","banheiros","vagas"].includes(state.nextStep)) {
    if (/^\d+$/.test(last.trim())) ok=await saveBlockDirect(db,state.captureId,state.nextStep,last.trim());
  } else if (state.nextStep==="metragem") {
    ok=await saveBlockDirect(db,state.captureId,"metragem",isUnknown(last)?"não informado":last.slice(0,300));
  } else if (state.nextStep==="valor") {
    if (isUnknown(last)) {
      const saved=await saveCaptureAnswer(db,{phone,valorPretendidoStatus:"não informado",origem:LINK_CAPTACAO_ORIGIN}); ok=saved.saved;
    } else {
      const value=numberValue(last); if(value){const saved=await saveCaptureAnswer(db,{phone,valorPretendido:value,origem:LINK_CAPTACAO_ORIGIN});ok=saved.saved;}
    }
  } else if (state.nextStep==="condominio") {
    ok=await saveBlockDirect(db,state.captureId,"condominio",isZero(last)?"0":isUnknown(last)?"não informado":last.slice(0,300));
  } else if (state.nextStep==="iptu") {
    ok=await saveBlockDirect(db,state.captureId,"custos",isZero(last)?"IPTU: 0":isUnknown(last)?"IPTU: não informado":`IPTU: ${last.slice(0,280)}`);
  }
  if (!ok) return reply(state.nextQuestion);

  const next=await stepFromDb(db,state.captureId);
  await advanceSession(db,state,next);
  return reply(questionFor(next));
}

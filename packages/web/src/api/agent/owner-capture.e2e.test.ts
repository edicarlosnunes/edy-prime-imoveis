/**
 * Captação pelo Agente IA — os TRÊS cenários pedidos, ponta a ponta.
 *
 *  1. cadastro novo (roteiro na ordem, textos exatos, gravação a cada resposta)
 *  2. abandono e retomada pelo MESMO telefone (sem repetir pergunta, sem
 *     duplicar proprietário nem ficha)
 *  3. transferência para humano (a IA para na hora e nada é perdido)
 *
 * Como roda: SQLite em memória + o caminho real de produção
 * (`inbox#aiTurn` → `agent/broker#agentReply` → ferramentas de captação →
 * `owner-intake`/`property_captures`). Só o modelo é simulado: `generateText`
 * é trocado por um dublê que recebe o system prompt e as ferramentas reais e
 * age como o modelo agiria — chamando `salvarCadastroImovel` a cada resposta e
 * devolvendo como texto a próxima pergunta que a ferramenta retornou.
 *
 * Nenhuma chamada sai para o gateway de IA, nenhuma credencial real é usada, o
 * banco de produção nunca é tocado.
 */
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import * as schema from "../database/schema";
import type { AdminDb } from "../lib/admin-base";
import { captureQuestion } from "./owner-capture";
import { INTENT_QUESTION, messageIntent } from "./capture-intent";

/* O broker só chama o modelo quando o gateway parece configurado. */
process.env.AI_GATEWAY_BASE_URL ||= "https://gateway.test";
process.env.AI_GATEWAY_API_KEY ||= "test-key";

/* ----------------------------------------------- dublê do modelo de IA */

interface FakeTool {
  execute: (input: unknown, options: unknown) => Promise<unknown>;
}
interface FakeCall {
  system: string;
  tools: Record<string, FakeTool>;
  messages: { role: string; content: string }[];
}
interface FakeStep {
  toolCalls: { toolName: string; input: unknown }[];
}
type Behavior = (call: FakeCall) => Promise<{ text: string; steps: FakeStep[] }>;

let behavior: Behavior = async () => ({ text: "ok", steps: [] });
let modelCalls = 0;
let lastSystem = "";
let lastTools: string[] = [];

/* `tool`, `stepCountIs` e o resto continuam reais: só `generateText` é dublê. */
const aiReal = { ...(await import("ai")) };
mock.module("ai", () => ({
  ...aiReal,
  generateText: async (options: FakeCall) => {
    modelCalls++;
    lastSystem = options.system;
    lastTools = Object.keys(options.tools ?? {});
    return behavior(options);
  },
}));

/* Importado DEPOIS do mock para que o broker receba o `generateText` dublê. */
const { addMessage, aiTurn, ensureConversation } = await import("../lib/inbox");

/* ------------------------------------------------------------------ DDL */

/* Espelha scripts/migrate.ts nas tabelas que este fluxo toca. */
const DDL = [
  `CREATE TABLE owners (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    notes TEXT,
    document TEXT,
    rg TEXT,
    capture_status TEXT NOT NULL DEFAULT 'prospeccao',
    possible_duplicate INTEGER NOT NULL DEFAULT 0,
    duplicate_of_owner_id INTEGER,
    duplicate_note TEXT,
    created_at INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE property_captures (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    owner_id INTEGER NOT NULL,
    city TEXT NOT NULL DEFAULT 'Praia Grande',
    district TEXT,
    address TEXT,
    property_type TEXT,
    serial TEXT,
    cep TEXT,
    street TEXT,
    number TEXT,
    state TEXT,
    complements TEXT,
    unit_key TEXT,
    doc_validated_by TEXT,
    doc_validated_at INTEGER,
    doc_validation_note TEXT,
    owner_photos TEXT,
    asking_price REAL,
    estimated_price REAL,
    source TEXT NOT NULL DEFAULT 'manual',
    stage TEXT NOT NULL DEFAULT 'novo_contato',
    intention TEXT,
    next_action TEXT,
    next_action_at INTEGER,
    appraisal_status TEXT NOT NULL DEFAULT 'pendente',
    appraisal_at INTEGER,
    appraisal_note TEXT,
    doc_status TEXT NOT NULL DEFAULT 'nao_iniciado',
    registration_status TEXT NOT NULL DEFAULT 'NOVO',
    registration_status_at INTEGER,
    completeness INTEGER NOT NULL DEFAULT 0,
    last_field_at INTEGER,
    address_key TEXT,
    building_key TEXT,
    outside_priority_area INTEGER NOT NULL DEFAULT 0,
    duplicate_of_capture_id INTEGER,
    duplicate_note TEXT,
    notes TEXT,
    lost_reason TEXT,
    lost_detail TEXT,
    converted_property_id INTEGER,
    converted_at INTEGER,
    stage_changed_at INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    title TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'visita',
    due_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pendente',
    lead_id INTEGER,
    client_id INTEGER,
    property_id INTEGER,
    capture_id INTEGER,
    notes TEXT,
    created_at INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    company_name TEXT NOT NULL DEFAULT 'Edy Prime Imóveis',
    broker_name TEXT NOT NULL DEFAULT 'Edy Prime',
    whatsapp TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    creci TEXT NOT NULL DEFAULT '',
    cnai TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    instagram TEXT NOT NULL DEFAULT '',
    facebook TEXT NOT NULL DEFAULT '',
    commission_rate REAL NOT NULL DEFAULT 6,
    priority_cities TEXT NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    channel TEXT NOT NULL DEFAULT 'site',
    external_id TEXT,
    lead_id INTEGER,
    client_id INTEGER,
    property_id INTEGER,
    agent_id INTEGER,
    contact_name TEXT,
    contact_phone TEXT,
    mode TEXT NOT NULL DEFAULT 'ia',
    assigned_to INTEGER,
    assigned_name TEXT,
    transfer_reason TEXT,
    transferred_at INTEGER,
    status TEXT NOT NULL DEFAULT 'aberta',
    unread INTEGER NOT NULL DEFAULT 0,
    last_message TEXT,
    last_message_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    conversation_id INTEGER NOT NULL,
    direction TEXT NOT NULL DEFAULT 'in',
    author TEXT NOT NULL DEFAULT 'cliente',
    author_name TEXT,
    body TEXT NOT NULL,
    external_id TEXT,
    created_at INTEGER NOT NULL DEFAULT 0)`,
  `CREATE UNIQUE INDEX messages_conversation_external_uk ON messages (conversation_id, external_id)`,
  `CREATE TABLE ai_agents (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    name TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 0,
    provider TEXT NOT NULL DEFAULT 'gateway',
    model TEXT NOT NULL DEFAULT 'openai/gpt-5.4-mini',
    greeting TEXT NOT NULL DEFAULT '',
    instructions TEXT NOT NULL DEFAULT '',
    tone TEXT NOT NULL DEFAULT '',
    hours_start TEXT NOT NULL DEFAULT '08:00',
    hours_end TEXT NOT NULL DEFAULT '20:00',
    channels TEXT NOT NULL DEFAULT '["site"]',
    qualification TEXT NOT NULL DEFAULT '',
    transfer_rules TEXT NOT NULL DEFAULT '',
    transfer_message TEXT NOT NULL DEFAULT '',
    idle_minutes INTEGER NOT NULL DEFAULT 30,
    human_conditions TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE automations (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    name TEXT NOT NULL,
    trigger TEXT NOT NULL,
    conditions TEXT NOT NULL DEFAULT '{}',
    actions TEXT NOT NULL DEFAULT '[]',
    active INTEGER NOT NULL DEFAULT 0,
    run_count INTEGER NOT NULL DEFAULT 0,
    error_count INTEGER NOT NULL DEFAULT 0,
    last_run_at INTEGER,
    last_error TEXT,
    created_at INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE automation_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    automation_id INTEGER NOT NULL,
    ok INTEGER NOT NULL DEFAULT 1,
    message TEXT,
    created_at INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE integrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    key TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'nao_configurado',
    enabled INTEGER NOT NULL DEFAULT 0,
    config TEXT,
    last_sync_at INTEGER,
    last_test_at INTEGER,
    last_error TEXT,
    updated_at INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE properties (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    code TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    purpose TEXT NOT NULL DEFAULT 'venda',
    type TEXT NOT NULL DEFAULT 'apartamento',
    price REAL NOT NULL DEFAULT 0,
    district TEXT NOT NULL DEFAULT '',
    city TEXT NOT NULL DEFAULT 'Praia Grande',
    bedrooms INTEGER NOT NULL DEFAULT 0,
    suites INTEGER NOT NULL DEFAULT 0,
    bathrooms INTEGER NOT NULL DEFAULT 0,
    parking INTEGER NOT NULL DEFAULT 0,
    area_util REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'disponivel',
    published INTEGER NOT NULL DEFAULT 1,
    featured INTEGER NOT NULL DEFAULT 0,
    owner_id INTEGER,
    views INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT 0,
    watermark_off INTEGER NOT NULL DEFAULT 0,
    portfolio_entry_at INTEGER,
    last_revalidation_at INTEGER,
    next_revalidation_at INTEGER,
    revalidation_status TEXT,
    commercial_status TEXT,
    commercial_status_at INTEGER,
    paused_at INTEGER,
    pause_reason TEXT,
    outside_priority_area INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    user_id INTEGER,
    user_name TEXT,
    action TEXT NOT NULL,
    entity TEXT,
    entity_id TEXT,
    detail TEXT,
    ip TEXT,
    created_at INTEGER NOT NULL DEFAULT 0)`,
];

let db: AdminDb;

/** Telefone do WhatsApp: identidade do proprietário, nunca perguntado. */
const PHONE = "(13) 99714-1174";
const BASE_URL = "https://teste.local";

beforeEach(async () => {
  const client = createClient({ url: ":memory:" });
  const instance = drizzle(client, { schema });
  for (const statement of DDL) await instance.run(sql.raw(statement));
  db = instance as unknown as AdminDb;
  /* O agente que já existe em produção: um só, ativo no site e no WhatsApp. */
  await db.run(sql`INSERT INTO ai_agents (name, active, channels, transfer_message, created_at, updated_at)
    VALUES ('Atendimento Edy Prime', 1, '["site","whatsapp"]', 'Vou chamar um corretor.', 0, 0)`);
  behavior = async () => ({ text: "ok", steps: [] });
  modelCalls = 0;
  lastSystem = "";
  lastTools = [];
});

/* ------------------------------------------------------------ utilidades */

const conversation = async (externalId: string) =>
  ensureConversation(db, {
    channel: "whatsapp",
    externalId,
    contactPhone: PHONE,
    contactName: null,
  });

const toolOptions = { toolCallId: "call-1", messages: [] };

interface SaveResult {
  salvo?: boolean;
  motivo?: string;
  cadastroId?: number | null;
  aviso?: string | null;
  retomado?: boolean;
  respondido?: string[];
  proximaPergunta?: string | null;
  roteiroConcluido?: boolean;
}

/**
 * Um turno do proprietário.
 *
 * Quando `save` é passado, o dublê age como o modelo: chama
 * `salvarCadastroImovel` com o que a pessoa acabou de responder e usa a
 * `proximaPergunta` devolvida pela ferramenta como resposta ao cliente.
 */
async function ownerTurn(
  conversationId: number,
  body: string,
  save?: Record<string, unknown>,
): Promise<{ reply: string | undefined; saved: SaveResult | null; skipped?: string }> {
  let saved: SaveResult | null = null;
  behavior = async (call) => {
    if (!save) return { text: captureQuestion("nome"), steps: [] };
    saved = (await call.tools.salvarCadastroImovel!.execute(save, toolOptions)) as SaveResult;
    return {
      text: saved.proximaPergunta ?? "Cadastro concluído. Deseja cadastrar outro imóvel?",
      steps: [{ toolCalls: [{ toolName: "salvarCadastroImovel", input: save }] }],
    };
  };
  await addMessage(db, conversationId, { direction: "in", author: "cliente", body });
  const result = await aiTurn(db, conversationId, BASE_URL);
  return { reply: result.text, saved, skipped: result.skipped };
}

/**
 * Primeiro turno de qualquer proprietário.
 *
 * O telefone só identifica o contato — é a intenção declarada que abre a
 * captação. Toda conversa nova começa por aqui, como no WhatsApp real.
 */
const DECLARACAO = "Olá, quero cadastrar meu apartamento para venda";
const declararProprietario = (conversationId: number) => ownerTurn(conversationId, DECLARACAO);

/** Turno em que o proprietário pede uma pessoa. */
async function askForHuman(conversationId: number, body: string) {
  behavior = async (call) => {
    const motivo = "proprietário pediu para falar com um corretor";
    await call.tools.pedirAtendimentoHumano!.execute({ motivo }, toolOptions);
    return {
      text: "Claro, vou chamar um corretor para continuar com você.",
      steps: [{ toolCalls: [{ toolName: "pedirAtendimentoHumano", input: { motivo } }] }],
    };
  };
  await addMessage(db, conversationId, { direction: "in", author: "cliente", body });
  return aiTurn(db, conversationId, BASE_URL);
}

async function counts() {
  const [owners] = await db.all<{ n: number }>(sql`SELECT COUNT(*) as n FROM owners`);
  const [captures] = await db.all<{ n: number }>(sql`SELECT COUNT(*) as n FROM property_captures`);
  return { owners: owners?.n ?? 0, captures: captures?.n ?? 0 };
}

async function onlyCapture() {
  const rows = await db.all<{
    id: number;
    owner_id: number;
    city: string;
    street: string | null;
    number: string | null;
    district: string | null;
    property_type: string | null;
    intention: string | null;
    asking_price: number | null;
    complements: string | null;
    registration_status: string;
    completeness: number;
    notes: string | null;
    source: string;
  }>(sql`SELECT * FROM property_captures ORDER BY id LIMIT 1`);
  return rows[0]!;
}

async function outbound(conversationId: number) {
  const rows = await db.all<{ body: string; author: string }>(
    sql`SELECT body, author FROM messages WHERE conversation_id = ${conversationId} AND direction = 'out' ORDER BY id`,
  );
  return rows;
}

/** As respostas do roteiro, na ordem, como chegam no WhatsApp. */
const SCRIPT: { step: string; body: string; save: Record<string, unknown> }[] = [
  { step: "nome", body: "Maria Souza", save: { nome: "Maria Souza" } },
  {
    step: "endereco",
    body: "Rua Guimarães Rosa, 492, apto 163, Boqueirão, Praia Grande - SP",
    save: {
      rua: "Rua Guimarães Rosa",
      numero: "492",
      unidade: "163",
      bairro: "Boqueirão",
      cidade: "Praia Grande",
      estado: "SP",
      cep: "11701-000",
    },
  },
  {
    step: "documentacao",
    body: "Sim, está registrado no meu nome",
    save: { documentacao: "Sim, registrado no nome do proprietário" },
  },
  { step: "tipo", body: "É um apartamento", save: { tipoImovel: "apartamento" } },
  { step: "negociacao", body: "Quero vender", save: { negociacao: "venda" } },
  { step: "dormitorios", body: "3 dormitórios", save: { dormitorios: "3" } },
  { step: "suites", body: "1 suíte", save: { suites: "1" } },
  { step: "banheiros", body: "2 banheiros", save: { banheiros: "2" } },
  { step: "vagas", body: "1 vaga", save: { vagas: "1" } },
  { step: "metragem", body: "92 m² úteis", save: { metragem: "92 m²" } },
  {
    step: "custos",
    body: "Condomínio 850 e IPTU 1200 por ano",
    save: { custos: "Condomínio R$ 850, IPTU R$ 1.200/ano" },
  },
  { step: "valor", body: "Quero 780 mil", save: { valorPretendido: 780000 } },
  {
    step: "caracteristicas",
    body: "Vista para o mar e varanda gourmet",
    save: { caracteristicas: "Vista para o mar, varanda gourmet" },
  },
  { step: "ocupacao", body: "Está vago", save: { ocupacao: "Vago" } },
  { step: "fotos", body: "Tenho fotos, envio hoje", save: { fotos: "Sim, envia hoje" } },
  {
    step: "disponibilidade",
    body: "Sábado às 10h",
    save: { disponibilidade: "Sábado às 10h" },
  },
];

/* ------------------------------------------------------ 1. cadastro novo */

describe("1. cadastro novo pelo WhatsApp", () => {
  test("abre com a pergunta exata do nome e nunca pede telefone", async () => {
    const conversa = await conversation("5513997141174");

    const primeiro = await ownerTurn(conversa.id, "Olá, quero cadastrar meu apartamento para venda");

    expect(primeiro.reply).toBe(
      "Olá! Seja bem-vindo à Edy Prime Imóveis. Para começarmos, qual é o seu nome completo?",
    );
    /* A pergunta exata e a proibição do telefone estão no prompt do turno. */
    expect(lastSystem).toContain(
      "Olá! Seja bem-vindo à Edy Prime Imóveis. Para começarmos, qual é o seu nome completo?",
    );
    expect(lastSystem).toContain("NUNCA pergunte telefone");
    /* Nada respondido ainda: nenhuma ficha criada. */
    expect(await counts()).toEqual({ owners: 0, captures: 0 });
  });

  test("percorre o roteiro na ordem, com os textos exigidos, salvando resposta por resposta", async () => {
    const conversa = await conversation("5513997141174");
    await declararProprietario(conversa.id);
    const perguntas: (string | null | undefined)[] = [];

    for (const item of SCRIPT) {
      const turn = await ownerTurn(conversa.id, item.body, item.save);
      expect(turn.saved?.salvo, `passo ${item.step}`).toBe(true);
      perguntas.push(turn.saved?.proximaPergunta);
      /* Gravação progressiva: a ficha já existe desde a primeira resposta. */
      expect((await counts()).owners).toBe(1);
    }

    /* A ordem das perguntas é a exigida, com os três textos fixos verbatim. */
    expect(perguntas).toEqual([
      "Qual é o endereço completo do imóvel que você deseja cadastrar?",
      "O imóvel está registrado em seu nome?\n\nEssa informação nos ajuda a entender a situação documental e direcionar corretamente o atendimento.",
      captureQuestion("tipo"),
      captureQuestion("negociacao"),
      captureQuestion("dormitorios"),
      captureQuestion("suites"),
      captureQuestion("banheiros"),
      captureQuestion("vagas"),
      captureQuestion("metragem"),
      captureQuestion("custos", "apartamento"),
      captureQuestion("valor"),
      captureQuestion("caracteristicas"),
      captureQuestion("ocupacao"),
      captureQuestion("fotos"),
      captureQuestion("disponibilidade"),
      null,
    ]);

    /* Um proprietário, uma ficha — nada duplicado no caminho. */
    expect(await counts()).toEqual({ owners: 1, captures: 1 });

    const ficha = await onlyCapture();
    expect(ficha.street).toBe("Rua Guimarães Rosa");
    expect(ficha.number).toBe("492");
    expect(ficha.district).toBe("Boqueirão");
    expect(ficha.city).toBe("Praia Grande");
    expect(ficha.property_type).toBe("apartamento");
    expect(ficha.intention).toBe("venda");
    expect(ficha.asking_price).toBe(780000);
    expect(ficha.complements).toContain("163");
    expect(ficha.completeness).toBeGreaterThan(50);
    expect(ficha.registration_status).not.toBe("NOVO");

    /* Qualificação sem coluna própria: bloco estruturado nas observações. */
    expect(ficha.notes).toContain("[captacao-ia]");
    expect(ficha.notes).toContain("Dormitórios: 3");
    expect(ficha.notes).toContain("Suítes: 1");
    expect(ficha.notes).toContain("Vagas de garagem: 1");
    expect(ficha.notes).toContain("Metragem: 92 m²");
    expect(ficha.notes).toContain("Ocupação: Vago");
    expect(ficha.notes).toContain("Fotos: Sim, envia hoje");
    expect(ficha.notes).toContain("Disponibilidade para visita: Sábado às 10h");
    expect(ficha.notes).toContain("Imóvel registrado em nome do proprietário: Sim");

    /* O telefone veio do canal: gravado sem nunca ter sido perguntado. */
    const [owner] = await db.all<{ name: string; phone: string | null }>(
      sql`SELECT name, phone FROM owners LIMIT 1`,
    );
    expect(owner?.name).toBe("Maria Souza");
    /* Gravado como o CRM normaliza telefone (só dígitos), sem nunca ter sido perguntado. */
    expect(owner?.phone?.replace(/\D/g, "")).toBe(PHONE.replace(/\D/g, ""));
    for (const message of await outbound(conversa.id)) {
      expect(message.body).not.toMatch(/telefone|celular|whatsapp/i);
    }
  });

  test("não abre um segundo imóvel enquanto o atual está incompleto", async () => {
    const conversa = await conversation("5513997141174");
    await declararProprietario(conversa.id);
    await ownerTurn(conversa.id, SCRIPT[0]!.body, SCRIPT[0]!.save);
    await ownerTurn(conversa.id, SCRIPT[1]!.body, SCRIPT[1]!.save);

    const tentativa = await ownerTurn(conversa.id, "Tenho outro imóvel para cadastrar", {
      novoImovel: true,
      rua: "Avenida Presidente Costa e Silva",
      numero: "1000",
      cidade: "Praia Grande",
    });

    expect(tentativa.saved?.salvo).toBe(false);
    expect(tentativa.saved?.motivo).toContain("ainda está incompleto");
    expect(await counts()).toEqual({ owners: 1, captures: 1 });
  });
});

/* ------------------------------------------------- 2. abandono e retomada */

describe("2. abandono e retomada pelo mesmo telefone", () => {
  test("retoma exatamente de onde parou, sem repetir o que já foi informado", async () => {
    /* Primeira conversa: responde nome e endereço e desaparece. */
    const primeira = await conversation("5513997141174");
    await declararProprietario(primeira.id);
    await ownerTurn(primeira.id, SCRIPT[0]!.body, SCRIPT[0]!.save);
    await ownerTurn(primeira.id, SCRIPT[1]!.body, SCRIPT[1]!.save);

    /* Volta dias depois em outra thread do WhatsApp — mesmo telefone. Nada é
       lido do histórico da conversa: o estado vem da ficha. */
    const volta = await conversation("5513997141174:retorno");
    const retomada = await ownerTurn(volta.id, "Oi, voltei para continuar o cadastro");

    expect(retomada.skipped).toBeUndefined();
    expect(lastSystem).toContain("1. [x] Nome completo");
    expect(lastSystem).toContain("2. [x] Endereço completo");
    expect(lastSystem).toContain("3. [ ] Imóvel registrado em nome do proprietário");
    expect(lastSystem).toContain("- Nome: Maria Souza");
    expect(lastSystem).toContain("- Endereço: Rua Guimarães Rosa, 492");
    expect(lastSystem).toContain("já tinha cadastro em andamento");
    /* A pergunta pendente é a da documentação, não o nome de novo. */
    expect(lastSystem).toContain("PRÓXIMA PERGUNTA");
    expect(lastSystem).toContain(captureQuestion("documentacao"));

    /* Continua o roteiro do ponto pendente até o fim. */
    for (const item of SCRIPT.slice(2)) {
      const turn = await ownerTurn(volta.id, item.body, item.save);
      expect(turn.saved?.salvo, `passo ${item.step}`).toBe(true);
    }

    /* Retomada não duplica proprietário nem ficha. */
    expect(await counts()).toEqual({ owners: 1, captures: 1 });
    const ficha = await onlyCapture();
    expect(ficha.notes).toContain("Disponibilidade para visita: Sábado às 10h");
    expect(ficha.street).toBe("Rua Guimarães Rosa");
  });

  test("informação espontânea vai para as observações e a pergunta pendente volta", async () => {
    const conversa = await conversation("5513997141174");
    await declararProprietario(conversa.id);
    await ownerTurn(conversa.id, SCRIPT[0]!.body, SCRIPT[0]!.save);
    await ownerTurn(conversa.id, SCRIPT[1]!.body, SCRIPT[1]!.save);

    const espontanea = await ownerTurn(conversa.id, "Ah, e o condomínio tem piscina aquecida", {
      observacao: "Condomínio com piscina aquecida",
    });

    expect(espontanea.saved?.salvo).toBe(true);
    /* A pergunta pendente continua sendo a da documentação. */
    expect(espontanea.saved?.proximaPergunta).toBe(captureQuestion("documentacao"));
    const ficha = await onlyCapture();
    expect(ficha.notes).toContain("piscina aquecida");
  });
});

/* ------------------------------------------- 3. transferência para humano */

describe("3. transferência para atendimento humano", () => {
  test("pedido de corretor para a IA na hora e nada do cadastro é perdido", async () => {
    const conversa = await conversation("5513997141174");
    await declararProprietario(conversa.id);
    await ownerTurn(conversa.id, SCRIPT[0]!.body, SCRIPT[0]!.save);
    await ownerTurn(conversa.id, SCRIPT[1]!.body, SCRIPT[1]!.save);

    const transferencia = await askForHuman(conversa.id, "Prefiro falar com um corretor agora");
    expect(transferencia.replied).toBe(true);
    expect(transferencia.handoff).toBe(true);

    const [row] = await db.all<{ mode: string; transfer_reason: string | null }>(
      sql`SELECT mode, transfer_reason FROM conversations WHERE id = ${conversa.id}`,
    );
    expect(row?.mode).toBe("humano");
    expect(row?.transfer_reason).toContain("corretor");
    const sistema = (await outbound(conversa.id)).filter((m) => m.author === "sistema");
    expect(sistema.length).toBe(1);

    /* A partir daqui a IA não fala mais: o modelo nem é chamado. */
    const antes = modelCalls;
    const depois = await ownerTurn(conversa.id, "Então me manda o contrato", {
      documentacao: "não deveria ser gravado",
    });
    expect(depois.skipped).toBe("humano no controle");
    expect(modelCalls).toBe(antes);
    expect(depois.saved).toBeNull();

    /* O que já havia sido respondido continua na ficha. */
    const ficha = await onlyCapture();
    expect(ficha.street).toBe("Rua Guimarães Rosa");
    expect(ficha.notes ?? "").not.toContain("não deveria ser gravado");
  });

  test("corretor assumiu a conversa: a IA não responde nem grava", async () => {
    const conversa = await conversation("5513997141174");
    await declararProprietario(conversa.id);
    await ownerTurn(conversa.id, SCRIPT[0]!.body, SCRIPT[0]!.save);

    await db.run(sql`UPDATE conversations SET mode = 'humano' WHERE id = ${conversa.id}`);
    const antes = modelCalls;

    const turn = await ownerTurn(conversa.id, "O imóvel é meu sim", {
      documentacao: "Sim",
    });

    expect(turn.skipped).toBe("humano no controle");
    expect(modelCalls).toBe(antes);
    const ficha = await onlyCapture();
    expect(ficha.notes ?? "").not.toContain("Imóvel registrado em nome do proprietário");
  });
});

/* ------------------------------------------------- 4. intenção do contato */

/**
 * O telefone identifica o contato; ele NÃO liga a captação.
 *
 * Aqui entram os três casos exigidos: comprador no WhatsApp não cai em
 * captação, proprietário cai, e cadastro interrompido retoma — inclusive
 * quando a pessoa muda de assunto no meio do roteiro.
 */

/** Um turno em que o modelo responde sem chamar ferramenta nenhuma. */
async function plainTurn(conversationId: number, body: string, text = "Claro, posso ajudar.") {
  behavior = async () => ({ text, steps: [] });
  await addMessage(db, conversationId, { direction: "in", author: "cliente", body });
  return aiTurn(db, conversationId, BASE_URL);
}

const capturePromptOn = () => lastSystem.includes("CAPTAÇÃO DE IMÓVEL");

describe("4. intenção do contato decide a captação", () => {
  test("comprador no WhatsApp não recebe prompt nem ferramenta de captação", async () => {
    const conversa = await conversation("5513997141174");

    const turn = await plainTurn(
      conversa.id,
      "Procuro um apartamento de 3 dormitórios para comprar em Praia Grande",
    );

    expect(turn.skipped).toBeUndefined();
    expect(modelCalls).toBe(1);
    /* Atendimento normal: ferramentas de imóvel, nada de captação. */
    expect(capturePromptOn()).toBe(false);
    expect(lastTools).not.toContain("salvarCadastroImovel");
    expect(lastTools).toContain("buscarImoveis");
    expect(lastTools).toContain("pedirAtendimentoHumano");
    /* Nenhuma ficha nem proprietário criado por um comprador. */
    expect(await counts()).toEqual({ owners: 0, captures: 0 });
  });

  test("locatário também segue no atendimento normal", async () => {
    const conversa = await conversation("5513997141174");
    await plainTurn(conversa.id, "Vocês têm casa para alugar no Boqueirão?");
    expect(capturePromptOn()).toBe(false);
    expect(lastTools).not.toContain("salvarCadastroImovel");
  });

  test("proprietário entra na captação no primeiro turno", async () => {
    const conversa = await conversation("5513997141174");

    const turn = await declararProprietario(conversa.id);

    expect(capturePromptOn()).toBe(true);
    expect(lastTools).toContain("salvarCadastroImovel");
    expect(turn.reply).toBe(captureQuestion("nome"));
  });

  test("intenção realmente ambígua: só a pergunta de desambiguação, sem captação", async () => {
    const conversa = await conversation("5513997141174");

    const turn = await plainTurn(conversa.id, "Oi, boa tarde");

    expect(turn.text).toBe(INTENT_QUESTION);
    expect(turn.handoff).toBe(false);
    /* Nem modelo, nem prompt, nem ferramenta de captação neste turno. */
    expect(modelCalls).toBe(0);
    expect(capturePromptOn()).toBe(false);
    expect(await counts()).toEqual({ owners: 0, captures: 0 });

    /* Respondida a pergunta, cada lado vai para o seu fluxo. */
    const comprador = await plainTurn(conversa.id, "Quero comprar");
    expect(capturePromptOn()).toBe(false);
    expect(comprador.text).toBe("Claro, posso ajudar.");
  });

  test("cadastro interrompido retoma na pergunta pendente", async () => {
    const conversa = await conversation("5513997141174");
    await declararProprietario(conversa.id);
    await ownerTurn(conversa.id, SCRIPT[0]!.body, SCRIPT[0]!.save);
    await ownerTurn(conversa.id, SCRIPT[1]!.body, SCRIPT[1]!.save);

    /* Volta em outra thread, sem repetir a intenção: o estado da ficha basta. */
    const volta = await conversation("5513997141174:retomada");
    const turn = await plainTurn(volta.id, "Oi, voltei");

    expect(turn.skipped).toBeUndefined();
    expect(capturePromptOn()).toBe(true);
    expect(lastSystem).toContain(captureQuestion("documentacao"));
    expect(lastSystem).toContain("1. [x] Nome completo");
    expect(await counts()).toEqual({ owners: 1, captures: 1 });
  });

  test("no meio do cadastro, pergunta clara de compra não força a pergunta pendente", async () => {
    const conversa = await conversation("5513997141174");
    await declararProprietario(conversa.id);
    await ownerTurn(conversa.id, SCRIPT[0]!.body, SCRIPT[0]!.save);
    await ownerTurn(conversa.id, SCRIPT[1]!.body, SCRIPT[1]!.save);

    const compra = await plainTurn(
      conversa.id,
      "Aproveitando: vocês têm apartamento na praia para eu comprar?",
    );

    /* Neste turno é atendimento de comprador, sem roteiro de captação. */
    expect(compra.skipped).toBeUndefined();
    expect(capturePromptOn()).toBe(false);
    expect(lastTools).not.toContain("salvarCadastroImovel");
    expect(compra.text).not.toBe(captureQuestion("documentacao"));

    /* E a ficha continua intacta, pronta para retomar no próximo turno. */
    const seguinte = await plainTurn(conversa.id, "Certo, podemos continuar o cadastro");
    expect(capturePromptOn()).toBe(true);
    expect(lastSystem).toContain(captureQuestion("documentacao"));
    expect(await counts()).toEqual({ owners: 1, captures: 1 });
  });

  test("nenhuma resposta do roteiro é lida como intenção de compra", async () => {
    for (const item of SCRIPT) {
      expect(messageIntent(item.body), `passo ${item.step}`).not.toBe("comprador");
    }
  });

  test("classificação das frases típicas de cada lado", async () => {
    const compradores = [
      "Procuro apartamento de 2 dormitórios",
      "Quero comprar uma casa em Praia Grande",
      "Gostaria de alugar um apartamento na orla",
      "Vocês têm imóvel disponível no Boqueirão?",
      "Vi o anúncio no site, ainda está disponível?",
      "Quanto custa o apartamento do código 123?",
      "Queria agendar uma visita",
      "Trabalho com financiamento pela Caixa, dá para usar FGTS?",
    ];
    for (const frase of compradores) expect(messageIntent(frase), frase).toBe("comprador");

    const proprietarios = [
      "Quero cadastrar meu apartamento para venda",
      "Sou proprietário e quero vender",
      "Tenho um imóvel para anunciar com vocês",
      "Gostaria de colocar minha casa para alugar",
      "Preciso de uma avaliação do meu terreno",
      "Quero anunciar um apartamento",
      "Pretendo vender meu sobrado ainda este ano",
    ];
    for (const frase of proprietarios) expect(messageIntent(frase), frase).toBe("proprietario");

    for (const frase of ["Oi", "Bom dia", "Tudo bem?", "Obrigado"]) {
      expect(messageIntent(frase), frase).toBe("ambiguo");
    }
  });
});

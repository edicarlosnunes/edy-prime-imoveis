/**
 * LINK_CAPTACAO — os seis cenários pedidos, ponta a ponta.
 *
 *  1. entrada pelo link (abertura exata, sem perguntar intenção)
 *  2. salvamento progressivo (resposta por resposta, na ordem do roteiro)
 *  3. retomada pelo mesmo telefone, sem repetir pergunta já respondida
 *  4. frase neutra exata quando a pergunta sai do roteiro
 *  5. foto final e fechamento exato
 *  6. ausência de duplicidade (proprietário, imóvel, unidade do mesmo prédio)
 *
 * Como roda: SQLite em memória + o caminho real de produção
 * (`inbox#aiTurn` → `agent/broker#agentReply` → `agent/link-captacao` →
 * `owner-capture#saveCaptureAnswer` → `owner-intake`/`property_captures`).
 * Só o modelo é simulado: `generateText` é trocado por um dublê que recebe as
 * ferramentas reais e age como o extrator agiria — chamando
 * `salvarCadastroVenda` com o que o proprietário acabou de responder.
 *
 * O texto que vai para o cliente NÃO vem do dublê: quem escreve é
 * `link-captacao`. É exatamente isso que estes testes verificam.
 */
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import * as schema from "../database/schema";
import type { AdminDb } from "../lib/admin-base";
import {
  CLOSING_MESSAGE,
  LINK_CAPTACAO_MESSAGE,
  LINK_CAPTACAO_ORIGIN,
  OFF_SCRIPT_REPLY,
  linkCaptacaoUrl,
  linkQuestion,
} from "./link-captacao";

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
}

/**
 * Um turno do proprietário no fluxo do link.
 *
 * Com `save`, o dublê age como o extrator: chama `salvarCadastroVenda` com o
 * que a pessoa respondeu. Sem `save`, o modelo não grava nada — é o turno em
 * que a pessoa fala qualquer coisa que não responde a pergunta pendente.
 *
 * A resposta ao cliente vem sempre do `link-captacao`, nunca do dublê: o
 * `text` devolvido aqui é de propósito um texto que o roteiro jamais usaria.
 */
async function linkTurn(
  conversationId: number,
  body: string,
  save?: Record<string, unknown>,
): Promise<{
  reply: string | undefined;
  saved: SaveResult | null;
  skipped?: string;
  replied: boolean;
}> {
  let saved: SaveResult | null = null;
  behavior = async (call) => {
    if (!save) return { text: "TEXTO DO MODELO (não deve chegar ao cliente)", steps: [] };
    saved = (await call.tools.salvarCadastroVenda!.execute(save, toolOptions)) as SaveResult;
    return {
      text: "TEXTO DO MODELO (não deve chegar ao cliente)",
      steps: [{ toolCalls: [{ toolName: "salvarCadastroVenda", input: save }] }],
    };
  };
  await addMessage(db, conversationId, { direction: "in", author: "cliente", body });
  const result = await aiTurn(db, conversationId, BASE_URL);
  return { reply: result.text, saved, skipped: result.skipped, replied: result.replied };
}

/** O clique no link: chega como mensagem com o texto pré-preenchido. */
const entrarPeloLink = (conversationId: number) => linkTurn(conversationId, LINK_CAPTACAO_MESSAGE);

async function counts() {
  const [owners] = await db.all<{ n: number }>(sql`SELECT COUNT(*) as n FROM owners`);
  const [captures] = await db.all<{ n: number }>(sql`SELECT COUNT(*) as n FROM property_captures`);
  return { owners: owners?.n ?? 0, captures: captures?.n ?? 0 };
}

interface CaptureRow {
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
}

async function captureRows() {
  return db.all<CaptureRow>(sql`SELECT * FROM property_captures ORDER BY id`);
}

async function onlyCapture() {
  const rows = await captureRows();
  expect(rows.length).toBe(1);
  return rows[0]!;
}

async function outbound(conversationId: number) {
  const rows = await db.all<{ body: string; author: string }>(
    sql`SELECT body, author FROM messages WHERE conversation_id = ${conversationId} AND direction = 'out' ORDER BY id`,
  );
  return rows;
}

/* ------------------------------------------------ textos exigidos (literais) */

/* Escritos aqui letra por letra, de propósito: é o que o cliente pediu. Se
   alguém mexer no roteiro do módulo, estes testes caem. */
const ABERTURA = "Olá! Vamos cadastrar seu imóvel.\n\nQual é o seu nome completo?";
const Q_ENDERECO = "Nos informe o endereço do imóvel que deseja vender.";
const Q_CONDOMINIO =
  "O imóvel faz parte de algum condomínio? Se sim, informe o nome e a unidade: ap., bloco, torre, casa ou lote.";
const Q_DOCUMENTACAO = "E a documentação do seu imóvel, como está? Está em seu nome?";
const Q_FOTO = "Pra finalizar, nos manda uma foto da frente do seu imóvel.";
const FECHAMENTO =
  "Pronto, seu cadastro foi concluído. As informações ficaram registradas e em breve entraremos em contato.";
const NEUTRA = "Certo, vamos verificar essa informação e, se necessário, nossa equipe te dá um retorno.";

/**
 * O roteiro respondido, na ordem, com a pergunta que deve vir DEPOIS de cada
 * resposta. A última linha do roteiro (a foto) é tratada à parte, porque o
 * reconhecimento dela não passa pelo modelo.
 */
const SCRIPT: { step: string; body: string; save: Record<string, unknown>; next: string }[] = [
  { step: "nome", body: "Maria Souza", save: { nome: "Maria Souza" }, next: Q_ENDERECO },
  {
    step: "endereco",
    body: "Rua Guimarães Rosa, 492, Boqueirão, Praia Grande - SP",
    save: {
      rua: "Rua Guimarães Rosa",
      numero: "492",
      bairro: "Boqueirão",
      cidade: "Praia Grande",
      estado: "SP",
      cep: "11701-000",
    },
    next: Q_CONDOMINIO,
  },
  {
    step: "condominio",
    body: "Sim, Condomínio Vista Azul, apartamento 163, bloco B",
    save: {
      condominio: "Condomínio Vista Azul, apartamento 163, bloco B",
      unidade: "163",
      bloco: "B",
    },
    next: Q_DOCUMENTACAO,
  },
  {
    step: "documentacao",
    body: "Está em meu nome, escritura registrada",
    save: { documentacao: "Escritura registrada no nome do proprietário" },
    next: linkQuestion("tipo"),
  },
  {
    step: "tipo",
    body: "É um apartamento",
    save: { tipoImovel: "apartamento" },
    next: linkQuestion("dormitorios"),
  },
  {
    step: "dormitorios",
    body: "3 dormitórios",
    save: { dormitorios: "3" },
    next: linkQuestion("suites"),
  },
  { step: "suites", body: "1 suíte", save: { suites: "1" }, next: linkQuestion("banheiros") },
  { step: "banheiros", body: "2 banheiros", save: { banheiros: "2" }, next: linkQuestion("vagas") },
  { step: "vagas", body: "1 vaga", save: { vagas: "1" }, next: linkQuestion("metragem") },
  {
    step: "metragem",
    body: "92 m² úteis",
    save: { metragem: "92 m²" },
    next: linkQuestion("custos", { propertyType: "apartamento" }),
  },
  {
    step: "custos",
    body: "Condomínio 850 e IPTU 1200 por ano",
    save: { custos: "Condomínio R$ 850, IPTU R$ 1.200/ano" },
    next: linkQuestion("valor"),
  },
  {
    step: "valor",
    body: "Quero 780 mil",
    save: { valorPretendido: 780000 },
    next: linkQuestion("caracteristicas"),
  },
  {
    step: "caracteristicas",
    body: "Vista para o mar e varanda gourmet",
    save: { caracteristicas: "Vista para o mar, varanda gourmet" },
    next: Q_FOTO,
  },
];

/** Percorre o roteiro até a pergunta da foto (exclusive). */
async function percorrerRoteiro(conversationId: number, steps = SCRIPT) {
  const perguntas: (string | undefined)[] = [];
  for (const item of steps) {
    const turn = await linkTurn(conversationId, item.body, item.save);
    expect(turn.saved?.salvo, `passo ${item.step}`).toBe(true);
    perguntas.push(turn.reply);
  }
  return perguntas;
}

/* -------------------------------------------------- 1. entrada pelo link */

describe("1. entrada pelo link de captação", () => {
  test("o link aponta para o WhatsApp da imobiliária com o texto que marca a origem", () => {
    expect(linkCaptacaoUrl("(13) 99714-1174")).toBe(
      `https://wa.me/5513997141174?text=${encodeURIComponent(LINK_CAPTACAO_MESSAGE)}`,
    );
    expect(LINK_CAPTACAO_MESSAGE).toContain("LINK_CAPTACAO");
  });

  test("abre com o texto exato e não pergunta intenção, compra nem locação", async () => {
    const conversa = await conversation("5513997141174");

    const primeiro = await entrarPeloLink(conversa.id);

    expect(primeiro.replied).toBe(true);
    expect(primeiro.reply).toBe(ABERTURA);
    /* Nada de intenção: quem entra pelo link já disse o que quer. */
    expect(primeiro.reply).not.toMatch(/comprar|alugar|loca[çc][ãa]o|interesse/i);
    /* Sem resposta para extrair, o modelo nem é chamado. */
    expect(modelCalls).toBe(0);
    /* Nada respondido ainda: nenhuma ficha criada. */
    expect(await counts()).toEqual({ owners: 0, captures: 0 });
  });

  test("o fluxo do link tem precedência: nenhuma ferramenta de comprador no turno", async () => {
    const conversa = await conversation("5513997141174");
    await entrarPeloLink(conversa.id);

    await linkTurn(conversa.id, SCRIPT[0]!.body, SCRIPT[0]!.save);

    expect(modelCalls).toBe(1);
    expect(lastTools).toEqual(["salvarCadastroVenda"]);
    expect(lastSystem).toContain("CADASTRO DE IMÓVEL PARA VENDA");
    expect(lastSystem).toContain("Nunca negocie, nunca avalie o imóvel");
  });

  test("o telefone nunca é perguntado: vem do canal e já fica na ficha", async () => {
    const conversa = await conversation("5513997141174");
    await entrarPeloLink(conversa.id);
    await linkTurn(conversa.id, SCRIPT[0]!.body, SCRIPT[0]!.save);

    const [owner] = await db.all<{ name: string; phone: string | null }>(
      sql`SELECT name, phone FROM owners LIMIT 1`,
    );
    expect(owner?.name).toBe("Maria Souza");
    expect(owner?.phone?.replace(/\D/g, "")).toBe(PHONE.replace(/\D/g, ""));
    for (const message of await outbound(conversa.id)) {
      expect(message.body).not.toMatch(/telefone|celular|whatsapp/i);
    }
  });
});

/* --------------------------------------------- 2. salvamento progressivo */

describe("2. salvamento progressivo, uma pergunta por vez", () => {
  test("percorre o roteiro na ordem exigida, com os textos literais", async () => {
    const conversa = await conversation("5513997141174");
    const abertura = await entrarPeloLink(conversa.id);
    expect(abertura.reply).toBe(ABERTURA);

    const perguntas = await percorrerRoteiro(conversa.id);

    expect(perguntas).toEqual(SCRIPT.map((item) => item.next));
    /* Um proprietário, uma ficha — nada duplicado no caminho. */
    expect(await counts()).toEqual({ owners: 1, captures: 1 });
  });

  test.each([
    ["Apto", "apartamento"],
    ["Apartamento", "apartamento"],
  ])("tipo curto %s é gravado sem repetir a pergunta", async (answer, expectedType) => {
    const conversa = await conversation("5513997141174");
    await entrarPeloLink(conversa.id);

    /* Avança até a pergunta de tipo usando o extrator já coberto pelo roteiro. */
    for (const item of SCRIPT.slice(0, 4)) {
      await linkTurn(conversa.id, item.body, item.save);
    }

    const callsBefore = modelCalls;
    const turn = await linkTurn(conversa.id, answer);

    expect(turn.replied).toBe(true);
    expect(turn.reply).toBe(linkQuestion("dormitorios"));
    expect(modelCalls).toBe(callsBefore);

    const ficha = await onlyCapture();
    expect(ficha.property_type).toBe(expectedType);
  });

  test("cada resposta é gravada na hora, sem esperar o fim do roteiro", async () => {
    const conversa = await conversation("5513997141174");
    await entrarPeloLink(conversa.id);

    /* Nome: a ficha nasce aqui, já marcada como venda e com a origem do link. */
    await linkTurn(conversa.id, SCRIPT[0]!.body, SCRIPT[0]!.save);
    expect(await counts()).toEqual({ owners: 1, captures: 1 });
    let ficha = await onlyCapture();
    expect(ficha.intention).toBe("venda");
    expect(ficha.notes).toContain(`Origem do cadastro: ${LINK_CAPTACAO_ORIGIN}`);

    /* Endereço: gravado no mesmo cadastro, não em outro. */
    await linkTurn(conversa.id, SCRIPT[1]!.body, SCRIPT[1]!.save);
    ficha = await onlyCapture();
    expect(ficha.street).toBe("Rua Guimarães Rosa");
    expect(ficha.number).toBe("492");
    expect(ficha.district).toBe("Boqueirão");
    expect(ficha.city).toBe("Praia Grande");

    /* Condomínio e unidade: texto completo no bloco, unidade nos complementos. */
    await linkTurn(conversa.id, SCRIPT[2]!.body, SCRIPT[2]!.save);
    ficha = await onlyCapture();
    expect(ficha.notes).toContain("Condomínio e unidade: Condomínio Vista Azul");
    expect(ficha.complements).toContain("163");
    expect(await counts()).toEqual({ owners: 1, captures: 1 });
  });

  test("a ficha fica completa ao fim do roteiro, com tudo o que foi respondido", async () => {
    const conversa = await conversation("5513997141174");
    await entrarPeloLink(conversa.id);
    await percorrerRoteiro(conversa.id);

    const ficha = await onlyCapture();
    expect(ficha.property_type).toBe("apartamento");
    expect(ficha.intention).toBe("venda");
    expect(ficha.asking_price).toBe(780000);
    expect(ficha.completeness).toBeGreaterThan(50);
    expect(ficha.notes).toContain("[captacao-ia]");
    expect(ficha.notes).toContain(`Origem do cadastro: ${LINK_CAPTACAO_ORIGIN}`);
    /* Os rótulos do bloco vêm do roteiro já em uso no WhatsApp (CAPTURE_STEPS). */
    expect(ficha.notes).toContain(
      "Imóvel registrado em nome do proprietário: Escritura registrada",
    );
    expect(ficha.notes).toContain("Dormitórios: 3");
    expect(ficha.notes).toContain("Suítes: 1");
    expect(ficha.notes).toContain("Banheiros: 2");
    expect(ficha.notes).toContain("Vagas de garagem: 1");
    expect(ficha.notes).toContain("Metragem: 92 m²");
    expect(ficha.notes).toContain("Condomínio e IPTU: Condomínio R$ 850");
    expect(ficha.notes).toContain("Características e diferenciais: Vista para o mar");
  });

  test("a IA não escreve o texto do cliente: só as frases do roteiro saem", async () => {
    const conversa = await conversation("5513997141174");
    await entrarPeloLink(conversa.id);
    await percorrerRoteiro(conversa.id);

    const permitidas = new Set<string>([ABERTURA, ...SCRIPT.map((item) => item.next)]);
    for (const message of await outbound(conversa.id)) {
      expect(permitidas.has(message.body), message.body).toBe(true);
      expect(message.body).not.toContain("TEXTO DO MODELO");
    }
  });
});

/* -------------------------------------------------------- 3. retomada */

describe("3. retomada pelo mesmo telefone", () => {
  test("volta dias depois, em outra conversa e sem clicar no link, na pergunta pendente", async () => {
    const primeira = await conversation("5513997141174");
    await entrarPeloLink(primeira.id);
    await linkTurn(primeira.id, SCRIPT[0]!.body, SCRIPT[0]!.save);
    await linkTurn(primeira.id, SCRIPT[1]!.body, SCRIPT[1]!.save);

    /* Outra thread do WhatsApp, mesmo telefone, sem o link: a origem gravada
       na ficha é o que mantém o fluxo. */
    const volta = await conversation("5513997141174:retorno");
    const retomada = await linkTurn(volta.id, "Oi, voltei para continuar");

    expect(retomada.skipped).toBeUndefined();
    /* Retoma no ponto exato: condomínio, não o nome nem o endereço de novo. */
    expect(retomada.reply).toBe(Q_CONDOMINIO);
    expect(await counts()).toEqual({ owners: 1, captures: 1 });
  });

  test("termina o roteiro depois da volta, sem duplicar proprietário nem ficha", async () => {
    const primeira = await conversation("5513997141174");
    await entrarPeloLink(primeira.id);
    await percorrerRoteiro(primeira.id, SCRIPT.slice(0, 3));

    const volta = await conversation("5513997141174:retorno");
    const perguntas = await percorrerRoteiro(volta.id, SCRIPT.slice(3));

    expect(perguntas).toEqual(SCRIPT.slice(3).map((item) => item.next));
    expect(await counts()).toEqual({ owners: 1, captures: 1 });
    const ficha = await onlyCapture();
    expect(ficha.asking_price).toBe(780000);
    expect(ficha.street).toBe("Rua Guimarães Rosa");
  });

  test("resposta que não informa nada mantém a mesma pergunta, sem avançar", async () => {
    const conversa = await conversation("5513997141174");
    await entrarPeloLink(conversa.id);
    await linkTurn(conversa.id, SCRIPT[0]!.body, SCRIPT[0]!.save);

    /* O extrator não grava nada: a pergunta pendente continua sendo a mesma. */
    const vazio = await linkTurn(conversa.id, "não entendi");
    expect(vazio.reply).toBe(Q_ENDERECO);

    const depois = await linkTurn(conversa.id, SCRIPT[1]!.body, SCRIPT[1]!.save);
    expect(depois.reply).toBe(Q_CONDOMINIO);
    expect(await counts()).toEqual({ owners: 1, captures: 1 });
  });
});

/* ----------------------------------------------------- 4. frase neutra */

describe("4. pergunta fora do roteiro", () => {
  test("responde a frase neutra exata, volta à pergunta pendente e registra nas observações", async () => {
    const conversa = await conversation("5513997141174");
    await entrarPeloLink(conversa.id);
    await linkTurn(conversa.id, SCRIPT[0]!.body, SCRIPT[0]!.save);
    await linkTurn(conversa.id, SCRIPT[1]!.body, SCRIPT[1]!.save);

    const fora = await linkTurn(conversa.id, "Quanto vocês cobram de comissão na venda?", {
      observacao: "Perguntou a comissão cobrada na venda",
    });

    expect(fora.saved?.salvo).toBe(true);
    expect(fora.reply).toBe(`${NEUTRA}\n\n${Q_CONDOMINIO}`);
    expect(OFF_SCRIPT_REPLY).toBe(NEUTRA);
    /* Nada de negociação, avaliação ou promessa na resposta. */
    expect(fora.reply).not.toMatch(/comiss[ãa]o|%|vale|garanto|prometo/i);

    const ficha = await onlyCapture();
    expect(ficha.notes).toContain("[captacao-ia]");
    expect(ficha.notes).toContain("comissão");

    /* A pergunta pendente não foi perdida: a resposta seguinte é gravada nela. */
    const seguinte = await linkTurn(conversa.id, SCRIPT[2]!.body, SCRIPT[2]!.save);
    expect(seguinte.reply).toBe(Q_DOCUMENTACAO);
  });
});

/* -------------------------------------------------------- 5. foto final */

describe("5. foto da frente e fechamento", () => {
  /** Roteiro inteiro, faltando só a foto. */
  async function atéAFoto(externalId = "5513997141174") {
    const conversa = await conversation(externalId);
    await entrarPeloLink(conversa.id);
    const perguntas = await percorrerRoteiro(conversa.id);
    expect(perguntas[perguntas.length - 1]).toBe(Q_FOTO);
    return conversa;
  }

  test("imagem entregue pelo canal encerra com o texto exato", async () => {
    const conversa = await atéAFoto();
    const antes = modelCalls;

    const foto = await linkTurn(conversa.id, "[foto] frente do prédio");

    expect(foto.reply).toBe(FECHAMENTO);
    expect(CLOSING_MESSAGE).toBe(FECHAMENTO);
    /* Reconhecimento determinístico: o último passo não depende do modelo. */
    expect(modelCalls).toBe(antes);
    const ficha = await onlyCapture();
    expect(ficha.notes).toContain("Foto da frente: imagem recebida pelo WhatsApp");
  });

  test("proprietário que avisa o envio também encerra, e a ficha diz que foi aviso", async () => {
    const conversa = await atéAFoto();

    const foto = await linkTurn(conversa.id, "Segue a foto da frente");

    expect(foto.reply).toBe(FECHAMENTO);
    const ficha = await onlyCapture();
    expect(ficha.notes).toContain("Foto da frente: proprietário informou o envio da foto");
  });

  test("pergunta no lugar da foto não encerra o cadastro: a foto continua pendente", async () => {
    const conversa = await atéAFoto();

    const duvida = await linkTurn(conversa.id, "Preciso mandar foto por dentro também?", {
      observacao: "Perguntou se precisa de foto interna",
    });

    expect(duvida.reply).toBe(`${NEUTRA}\n\n${Q_FOTO}`);
    const ficha = await onlyCapture();
    expect(ficha.notes ?? "").not.toContain("Foto da frente:");
  });

  test("depois do fechamento o fluxo do link solta a conversa", async () => {
    const conversa = await atéAFoto();
    await linkTurn(conversa.id, "[foto] frente do prédio");

    /* Roteiro concluído e sem clique novo: volta a ser atendimento normal, com
       as ferramentas de sempre — o fluxo do link não sequestra a conversa. */
    behavior = async () => ({ text: "Claro, posso ajudar.", steps: [] });
    await addMessage(db, conversa.id, {
      direction: "in",
      author: "cliente",
      body: "Vocês têm apartamento de 2 dormitórios para comprar?",
    });
    const depois = await aiTurn(db, conversa.id, BASE_URL);

    expect(depois.text).toBe("Claro, posso ajudar.");
    expect(lastTools).toContain("buscarImoveis");
    expect(lastTools).not.toContain("salvarCadastroVenda");
  });
});

/* ------------------------------------------------- 6. sem duplicidade */

describe("6. ausência de duplicidade", () => {
  /** Cadastro completo, com a foto: o primeiro imóvel encerrado. */
  async function primeiroImovelConcluido() {
    const conversa = await conversation("5513997141174");
    await entrarPeloLink(conversa.id);
    await percorrerRoteiro(conversa.id);
    const fim = await linkTurn(conversa.id, "[foto] frente do prédio");
    expect(fim.reply).toBe(FECHAMENTO);
    return conversa;
  }

  test("o mesmo proprietário nunca vira dois contatos", async () => {
    await primeiroImovelConcluido();

    /* Volta em outra thread e clica no link de novo. */
    const volta = await conversation("5513997141174:segundo");
    await entrarPeloLink(volta.id);

    expect((await counts()).owners).toBe(1);
  });

  test("clique novo depois do fechamento pede o endereço do OUTRO imóvel, não o nome", async () => {
    await primeiroImovelConcluido();
    const volta = await conversation("5513997141174:segundo");

    const novo = await entrarPeloLink(volta.id);

    /* O nome já é conhecido: o roteiro do segundo imóvel começa no endereço. */
    expect(novo.reply).toBe(Q_ENDERECO);
    expect(await counts()).toEqual({ owners: 1, captures: 1 });
  });

  test("nos turnos seguintes ao clique, o roteiro insiste no endereço do novo imóvel", async () => {
    await primeiroImovelConcluido();
    const volta = await conversation("5513997141174:segundo");
    await entrarPeloLink(volta.id);

    /* Turno seguinte ao clique, sem nada aproveitável: a ficha lida do banco
       ainda é a anterior (concluída). O fluxo NÃO pode repetir o fechamento
       do cadastro antigo — a pergunta pendente é o endereço do novo imóvel. */
    const conversa = await linkTurn(volta.id, "Oi, tudo bem?");

    expect(conversa.reply).toBe(Q_ENDERECO);
    expect(conversa.reply).not.toBe(FECHAMENTO);
    expect(await counts()).toEqual({ owners: 1, captures: 1 });
  });

  test("mesmo prédio com unidade diferente é outro imóvel", async () => {
    await primeiroImovelConcluido();
    const volta = await conversation("5513997141174:segundo");
    await entrarPeloLink(volta.id);

    const endereco = await linkTurn(
      volta.id,
      "Rua Guimarães Rosa, 492, Boqueirão, Praia Grande - SP, apartamento 205",
      {
        rua: "Rua Guimarães Rosa",
        numero: "492",
        bairro: "Boqueirão",
        cidade: "Praia Grande",
        estado: "SP",
        cep: "11701-000",
        unidade: "205",
      },
    );

    expect(endereco.saved?.salvo).toBe(true);
    expect(endereco.reply).toBe(Q_CONDOMINIO);
    /* Um proprietário, dois imóveis: a unidade é o que os separa. */
    expect(await counts()).toEqual({ owners: 1, captures: 2 });
    const [primeiro, segundo] = await captureRows();
    expect(primeiro!.complements).toContain("163");
    expect(segundo!.complements).toContain("205");
    expect(segundo!.intention).toBe("venda");
    expect(segundo!.notes).toContain(`Origem do cadastro: ${LINK_CAPTACAO_ORIGIN}`);
  });

  test("o MESMO imóvel informado de novo não abre segunda ficha", async () => {
    await primeiroImovelConcluido();
    const volta = await conversation("5513997141174:segundo");
    await entrarPeloLink(volta.id);

    /* Mesmo endereço e mesma unidade do cadastro que já existe. */
    const repetido = await linkTurn(volta.id, SCRIPT[1]!.body, {
      ...SCRIPT[1]!.save,
      unidade: "163",
      bloco: "B",
    });

    expect(repetido.saved?.salvo).toBe(true);
    expect((await counts()).captures).toBe(1);
  });

  test("não abre um segundo imóvel enquanto o primeiro está incompleto", async () => {
    const conversa = await conversation("5513997141174");
    await entrarPeloLink(conversa.id);
    await percorrerRoteiro(conversa.id, SCRIPT.slice(0, 2));

    /* Cadastro em andamento: o roteiro continua no imóvel atual. */
    const turn = await linkTurn(conversa.id, "Tenho outro imóvel para cadastrar também", {
      observacao: "Proprietário tem outro imóvel para cadastrar",
    });

    expect(turn.reply).toBe(`${NEUTRA}\n\n${Q_CONDOMINIO}`);
    expect(await counts()).toEqual({ owners: 1, captures: 1 });
  });
});

describe("7. respostas após a identificação no link genérico", () => {
  async function iniciarCadastro(conversationId: number) {
    expect((await linkTurn(conversationId, LINK_CAPTACAO_MESSAGE)).reply).toBe(
      "Você é o proprietário do imóvel ou corretor?",
    );
    expect((await linkTurn(conversationId, "proprietário")).reply).toBe(
      linkQuestion("nome"),
    );
    expect((await linkTurn(conversationId, "ana exemplo")).reply).toBe(
      linkQuestion("endereco"),
    );
  }

  test("corretora segue para identificação profissional, sem abrir ficha de proprietário", async () => {
    const conversa = await conversation("5513997141174:corretora");
    await linkTurn(conversa.id, LINK_CAPTACAO_MESSAGE);
    const perfil = await linkTurn(conversa.id, "corretora");

    expect(perfil.reply).toBe("Qual é o seu CRECI?");
    expect(await counts()).toEqual({ owners: 0, captures: 0 });
  });

  test("nome em minúsculas e rua com número são gravados antes da próxima pergunta", async () => {
    const conversa = await conversation("5513997141174:novo");
    await iniciarCadastro(conversa.id);

    const [owner] = await db.all<{ name: string; phone: string }>(
      sql`SELECT name, phone FROM owners LIMIT 1`,
    );
    expect(owner?.name?.toLowerCase()).toBe("ana exemplo");
    expect(owner?.phone?.replace(/\D/g, "")).toBe(PHONE.replace(/\D/g, ""));
    expect(await counts()).toEqual({ owners: 1, captures: 1 });

    const endereco = await linkTurn(conversa.id, "Rua Guimarães Rosa 492");
    expect(endereco.reply).toBe(linkQuestion("documentacao"));
    const ficha = await onlyCapture();
    expect(ficha.street).toBe("Rua Guimarães Rosa");
    expect(ficha.number).toBe("492");
  });

  test("nova entrada do mesmo contato não deixa uma ficha vazia ao repetir o endereço", async () => {
    const primeira = await conversation("5513997141174:primeira");
    await iniciarCadastro(primeira.id);
    await linkTurn(primeira.id, "Rua Guimarães Rosa 492");
    expect(await counts()).toEqual({ owners: 1, captures: 1 });

    const segunda = await conversation("5513997141174:segunda");
    await iniciarCadastro(segunda.id);
    const endereco = await linkTurn(segunda.id, "Rua Guimarães Rosa 492");

    expect(endereco.reply).toBe(linkQuestion("documentacao"));
    expect(await counts()).toEqual({ owners: 1, captures: 1 });
    expect((await onlyCapture()).number).toBe("492");
  });

  test("outro endereço abre outra ficha sem alterar a ficha pendente anterior", async () => {
    const primeira = await conversation("5513997141174:imovel-antigo");
    await iniciarCadastro(primeira.id);
    await linkTurn(primeira.id, "Rua Guimarães Rosa 492");
    const [anterior] = await captureRows();
    expect(anterior?.street).toBe("Rua Guimarães Rosa");

    const segunda = await conversation("5513997141174:imovel-novo");
    await iniciarCadastro(segunda.id);
    expect(await counts()).toEqual({ owners: 1, captures: 1 });
    const endereco = await linkTurn(segunda.id, "Rua das Flores 88");

    expect(endereco.reply).toBe(linkQuestion("documentacao"));
    expect(await counts()).toEqual({ owners: 1, captures: 2 });
    const [antiga, nova] = await captureRows();
    expect(antiga?.id).toBe(anterior?.id);
    expect(antiga?.street).toBe("Rua Guimarães Rosa");
    expect(antiga?.number).toBe("492");
    expect(nova?.street).toBe("Rua das Flores");
    expect(nova?.number).toBe("88");
  });

  test("ficha antiga sem endereço é completada sem abrir uma segunda ficha vazia", async () => {
    const primeira = await conversation("5513997141174:sem-endereco");
    await iniciarCadastro(primeira.id);
    const [pendente] = await captureRows();
    expect(pendente?.street).toBeNull();

    const segunda = await conversation("5513997141174:retorno");
    await iniciarCadastro(segunda.id);
    expect(await counts()).toEqual({ owners: 1, captures: 1 });
    const endereco = await linkTurn(segunda.id, "Rua Guimarães Rosa 492");

    expect(endereco.reply).toBe(linkQuestion("documentacao"));
    expect(await counts()).toEqual({ owners: 1, captures: 1 });
    const ficha = await onlyCapture();
    expect(ficha.id).toBe(pendente?.id);
    expect(ficha.street).toBe("Rua Guimarães Rosa");
    expect(ficha.number).toBe("492");
  });

  test("endereço completo extraído pela IA também avança e mantém uma só ficha", async () => {
    const conversa = await conversation("5513997141174:endereco-completo");
    await iniciarCadastro(conversa.id);

    const endereco = await linkTurn(
      conversa.id,
      "Rua Guimarães Rosa, 492, Boqueirão, Praia Grande - SP",
      { rua: "Rua Guimarães Rosa", numero: "492", bairro: "Boqueirão", cidade: "Praia Grande", estado: "SP" },
    );

    expect(endereco.saved?.salvo).toBe(true);
    expect(endereco.reply).toBe(linkQuestion("documentacao"));
    expect(await counts()).toEqual({ owners: 1, captures: 1 });
    const ficha = await onlyCapture();
    expect(ficha.street).toBe("Rua Guimarães Rosa");
    expect(ficha.number).toBe("492");
    expect(ficha.city).toBe("Praia Grande");
  });

  test("nome e rua com palavras de perfil não reiniciam a pergunta do perfil", async () => {
    const conversa = await conversation("5513997141174:palavras-perfil");
    await linkTurn(conversa.id, LINK_CAPTACAO_MESSAGE);
    await linkTurn(conversa.id, "proprietário");
    expect((await linkTurn(conversa.id, "dona maria")).reply).toBe(linkQuestion("endereco"));

    const endereco = await linkTurn(conversa.id, "Rua dos Proprietários 10");
    expect(endereco.reply).toBe(linkQuestion("documentacao"));
    const ficha = await onlyCapture();
    expect(ficha.street).toBe("Rua dos Proprietários");
    expect(ficha.number).toBe("10");
  });

  test("contato conhecido retoma o endereço em outra conversa sem levar mensagens comuns para a captação", async () => {
    await db.run(sql`INSERT INTO owners (name, phone, notes)
      VALUES ('Contato Original', ${PHONE}, 'Anotação humana preservada')`);
    const entrada = await conversation("5513997141174:marcador");
    await iniciarCadastro(entrada.id);
    expect(await counts()).toEqual({ owners: 1, captures: 0 });
    const [aguardando] = await db.all<{ notes: string }>(sql`SELECT notes FROM owners LIMIT 1`);
    expect(aguardando?.notes).toContain("Anotação humana preservada");
    expect(aguardando?.notes).toContain("[LINK_CAPTACAO_AGUARDANDO_ENDERECO:");

    const retorno = await conversation("5513997141174:outra-conversa");
    const comum = await linkTurn(retorno.id, "Oi, tudo bem?");
    expect(comum.reply).not.toBe(linkQuestion("endereco"));
    expect(await counts()).toEqual({ owners: 1, captures: 0 });

    const endereco = await linkTurn(retorno.id, "Rua dos Proprietários 10");
    expect(endereco.reply).toBe(linkQuestion("documentacao"));
    expect(await counts()).toEqual({ owners: 1, captures: 1 });
    expect((await onlyCapture()).number).toBe("10");
    const [concluido] = await db.all<{ notes: string }>(sql`SELECT notes FROM owners LIMIT 1`);
    expect(concluido?.notes).toContain("Anotação humana preservada");
    expect(concluido?.notes).not.toContain("[LINK_CAPTACAO_AGUARDANDO_ENDERECO:");
  });

  test("endereço em outra conversa não sobrescreve o imóvel pendente anterior", async () => {
    const antigo = await conversation("5513997141174:pendente-anterior");
    await iniciarCadastro(antigo.id);
    await linkTurn(antigo.id, "Rua Guimarães Rosa 492");
    const [anterior] = await captureRows();

    const entrada = await conversation("5513997141174:novo-link");
    await iniciarCadastro(entrada.id);
    expect(await counts()).toEqual({ owners: 1, captures: 1 });

    const retorno = await conversation("5513997141174:resposta-em-outra-conversa");
    const endereco = await linkTurn(retorno.id, "Rua das Flores 88");
    expect(endereco.reply).toBe(linkQuestion("documentacao"));
    expect(await counts()).toEqual({ owners: 1, captures: 2 });
    const [primeira, segunda] = await captureRows();
    expect(primeira?.id).toBe(anterior?.id);
    expect(primeira?.street).toBe("Rua Guimarães Rosa");
    expect(primeira?.number).toBe("492");
    expect(segunda?.street).toBe("Rua das Flores");
    expect(segunda?.number).toBe("88");
  });

  test("endereço completo em outra conversa usa o extrator e remove o marcador", async () => {
    await db.run(sql`INSERT INTO owners (name, phone, notes)
      VALUES ('Contato Original', ${PHONE}, 'Observação anterior')`);
    const entrada = await conversation("5513997141174:extrator-entrada");
    await iniciarCadastro(entrada.id);
    expect(await counts()).toEqual({ owners: 1, captures: 0 });

    const retorno = await conversation("5513997141174:extrator-retorno");
    const endereco = await linkTurn(
      retorno.id,
      "Rua Guimarães Rosa, 492, Boqueirão, Praia Grande - SP",
      { rua: "Rua Guimarães Rosa", numero: "492", bairro: "Boqueirão", cidade: "Praia Grande", estado: "SP" },
    );

    expect(endereco.saved?.salvo).toBe(true);
    expect(endereco.reply).toBe(linkQuestion("documentacao"));
    expect((await onlyCapture()).street).toBe("Rua Guimarães Rosa");
    const [owner] = await db.all<{ notes: string }>(sql`SELECT notes FROM owners LIMIT 1`);
    expect(owner?.notes).toContain("Observação anterior");
    expect(owner?.notes).not.toContain("[LINK_CAPTACAO_AGUARDANDO_ENDERECO:");
  });

  test("marcador vencido não captura mensagem nova e preserva observações", async () => {
    await db.run(sql`INSERT INTO owners (name, phone, notes)
      VALUES ('Contato Original', ${PHONE}, 'Observação humana\n\n[LINK_CAPTACAO_AGUARDANDO_ENDERECO:1000000000000]')`);
    const conversa = await conversation("5513997141174:marcador-vencido");
    await linkTurn(conversa.id, "Rua das Flores 88");

    expect(await counts()).toEqual({ owners: 1, captures: 0 });
    const [owner] = await db.all<{ notes: string }>(sql`SELECT notes FROM owners LIMIT 1`);
    expect(owner?.notes).toBe("Observação humana");
  });

  test("atualização no CRM da ficha antiga não desvia a resposta seguinte do imóvel novo", async () => {
    const antigo = await conversation("5513997141174:imovel-em-aberto");
    await iniciarCadastro(antigo.id);
    await linkTurn(antigo.id, "Rua Guimarães Rosa 492");
    const [anterior] = await captureRows();

    const novo = await conversation("5513997141174:imovel-em-atendimento");
    await iniciarCadastro(novo.id);
    await linkTurn(novo.id, "Rua das Flores 88");
    expect(await counts()).toEqual({ owners: 1, captures: 2 });

    /* Uma edição posterior do CRM não pode redefinir qual imóvel o WhatsApp está cadastrando. */
    await db.run(sql`UPDATE property_captures SET updated_at = ${Math.floor(Date.now() / 1000) + 3600}
      WHERE id = ${anterior!.id}`);
    await linkTurn(novo.id, "Escritura da segunda casa", {
      documentacao: "Escritura da segunda casa",
    });

    const [primeira, segunda] = await captureRows();
    expect(primeira?.notes).not.toContain("Escritura da segunda casa");
    expect(segunda?.notes).toContain("Escritura da segunda casa");

    const retorno = await conversation("5513997141174:retorno-apos-edicao");
    const tipo = await linkTurn(retorno.id, "Apartamento");
    expect(tipo.reply).toBe(linkQuestion("dormitorios"));
    const [antigaDepois, novaDepois] = await captureRows();
    expect(antigaDepois?.property_type).toBeNull();
    expect(novaDepois?.property_type).toBe("apartamento");
  });

  test("o identificador da ficha ativa é removido ao encerrar a captação", async () => {
    const conversa = await conversation("5513997141174:encerramento");
    await iniciarCadastro(conversa.id);
    await linkTurn(conversa.id, "Rua das Flores 88");
    const ficha = await onlyCapture();
    const [durante] = await db.all<{ notes: string }>(sql`SELECT notes FROM owners LIMIT 1`);
    expect(durante?.notes).toContain(`[LINK_CAPTACAO_FICHA_ATIVA:${ficha.id}:`);

    const { saveCaptureAnswer } = await import("./owner-capture");
    const salvo = await saveCaptureAnswer(db, {
      phone: PHONE,
      targetCaptureId: ficha.id,
      origem: LINK_CAPTACAO_ORIGIN,
      confirmacaoFinal: "OK",
    });
    expect(salvo.saved).toBe(true);
    const [depois] = await db.all<{ notes: string | null }>(sql`SELECT notes FROM owners LIMIT 1`);
    expect(depois?.notes ?? "").not.toContain("[LINK_CAPTACAO_FICHA_ATIVA:");
  });
});

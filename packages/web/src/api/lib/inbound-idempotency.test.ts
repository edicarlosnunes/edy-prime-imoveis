/**
 * Trava de idempotência isolada (10/09/2026).
 *
 * O teste de rota (`http/whatsapp-idempotency.test.ts`) prova o comportamento
 * ponta a ponta. Aqui o alvo é a peça sozinha: a reserva do id externo, o
 * escopo por canal e a detecção de violação de unicidade.
 *
 * SQLite em memória — nunca o banco de produção.
 */
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "bun:test";
import * as schema from "../database/schema";
import type { AdminDb } from "./admin-base";
import {
  advanceInboundEvent,
  claimInboundEvent,
  completeInboundEvent,
  failInboundEvent,
  isUniqueViolation,
  stageReached,
} from "./inbound-idempotency";
import { addMessage } from "./inbox";

let db: AdminDb;

const DDL = [
  `CREATE TABLE inbound_events (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    channel TEXT NOT NULL, external_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'processing', stage TEXT NOT NULL DEFAULT 'claimed',
    attempts INTEGER NOT NULL DEFAULT 1, last_error TEXT,
    claimed_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE UNIQUE INDEX inbound_events_channel_external_uk ON inbound_events (channel, external_id)`,
  `CREATE TABLE conversations (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    channel TEXT NOT NULL DEFAULT 'site', external_id TEXT, lead_id INTEGER,
    client_id INTEGER, property_id INTEGER, agent_id INTEGER, contact_name TEXT,
    contact_phone TEXT, mode TEXT NOT NULL DEFAULT 'ia', assigned_to INTEGER,
    assigned_name TEXT, transfer_reason TEXT, transferred_at INTEGER,
    status TEXT NOT NULL DEFAULT 'aberta', unread INTEGER NOT NULL DEFAULT 0,
    last_message TEXT, last_message_at INTEGER, created_at INTEGER NOT NULL)`,
  `CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    conversation_id INTEGER NOT NULL, direction TEXT NOT NULL DEFAULT 'in',
    author TEXT NOT NULL DEFAULT 'cliente', author_name TEXT, body TEXT NOT NULL,
    external_id TEXT, created_at INTEGER NOT NULL)`,
  `CREATE UNIQUE INDEX messages_conversation_external_uk ON messages (conversation_id, external_id)`,
];

beforeEach(async () => {
  const client = createClient({ url: ":memory:" });
  const instance = drizzle(client, { schema });
  for (const statement of DDL) await instance.run(sql.raw(statement));
  db = instance as unknown as AdminDb;
  await db.run(
    sql`INSERT INTO conversations (channel, external_id, created_at) VALUES ('whatsapp', '5513911112222', ${Math.floor(Date.now() / 1000)})`,
  );
});

const count = async (table: string) => {
  const rows = await db.all<{ n: number }>(sql.raw(`SELECT COUNT(*) as n FROM ${table}`));
  return rows[0]?.n ?? 0;
};

describe("claimInboundEvent", () => {
  test("o primeiro claim vence e o segundo é duplicata", async () => {
    const first = await claimInboundEvent(db, "whatsapp", "wamid.AAA");
    const second = await claimInboundEvent(db, "whatsapp", "wamid.AAA");

    expect(first.claimed).toBe(true);
    expect(first.duplicated).toBe(false);
    expect(second.claimed).toBe(false);
    expect(second.duplicated).toBe(true);
    expect(await count("inbound_events")).toBe(1);
  });

  test("ids diferentes são reservados separadamente", async () => {
    expect((await claimInboundEvent(db, "whatsapp", "wamid.AAA")).claimed).toBe(true);
    expect((await claimInboundEvent(db, "whatsapp", "wamid.BBB")).claimed).toBe(true);
    expect(await count("inbound_events")).toBe(2);
  });

  test("o mesmo id em canais diferentes não colide", async () => {
    expect((await claimInboundEvent(db, "whatsapp", "id-igual")).claimed).toBe(true);
    expect((await claimInboundEvent(db, "instagram", "id-igual")).claimed).toBe(true);
    expect((await claimInboundEvent(db, "whatsapp", "id-igual")).claimed).toBe(false);
  });

  test("evento sem id externo é processado, mas marcado como não dedupável", async () => {
    const result = await claimInboundEvent(db, "whatsapp", null);
    expect(result.claimed).toBe(true);
    expect(result.unidentified).toBe(true);
    expect(await count("inbound_events")).toBe(0);

    expect((await claimInboundEvent(db, "whatsapp", "   ")).unidentified).toBe(true);
    expect((await claimInboundEvent(db, "whatsapp", "")).unidentified).toBe(true);
  });

  test("concorrência: dez claims simultâneos do mesmo id, um só vence", async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => claimInboundEvent(db, "whatsapp", "wamid.RACE")),
    );
    expect(results.filter((r) => r.claimed).length).toBe(1);
    expect(results.filter((r) => r.duplicated).length).toBe(9);
    expect(await count("inbound_events")).toBe(1);
  });
});

describe("addMessage (segunda linha de defesa)", () => {
  test("mesma mensagem com o mesmo external_id entra uma vez só", async () => {
    const message = {
      direction: "in" as const,
      author: "cliente" as const,
      body: "Oi",
      externalId: "wamid.AAA",
    };
    const first = await addMessage(db, 1, message);
    const second = await addMessage(db, 1, message);

    expect(first.inserted).toBe(true);
    expect(second.inserted).toBe(false);
    expect(await count("messages")).toBe(1);
  });

  test("mensagens sem external_id continuam podendo se repetir", async () => {
    const reply = { direction: "out" as const, author: "ia" as const, body: "Resposta" };
    expect((await addMessage(db, 1, reply)).inserted).toBe(true);
    expect((await addMessage(db, 1, reply)).inserted).toBe(true);
    expect(await count("messages")).toBe(2);
  });

  test("external_ids diferentes na mesma conversa entram normalmente", async () => {
    await addMessage(db, 1, {
      direction: "in",
      author: "cliente",
      body: "Um",
      externalId: "wamid.AAA",
    });
    await addMessage(db, 1, {
      direction: "in",
      author: "cliente",
      body: "Dois",
      externalId: "wamid.BBB",
    });
    expect(await count("messages")).toBe(2);
  });

  test("o contador de não lidas não avança no reenvio", async () => {
    const message = {
      direction: "in" as const,
      author: "cliente" as const,
      body: "Oi",
      externalId: "wamid.AAA",
    };
    await addMessage(db, 1, message);
    await addMessage(db, 1, message);

    const [row] = await db.all<{ unread: number }>(sql`SELECT unread FROM conversations WHERE id = 1`);
    expect(row?.unread).toBe(1);
  });
});

describe("isUniqueViolation", () => {
  test("reconhece as mensagens do SQLite/libsql", () => {
    expect(isUniqueViolation(new Error("UNIQUE constraint failed: messages.external_id"))).toBe(true);
    expect(isUniqueViolation(new Error("SQLITE_CONSTRAINT_UNIQUE: constraint failed"))).toBe(true);
  });

  test("não confunde outros erros", () => {
    expect(isUniqueViolation(new Error("no such table: messages"))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});

/* ------------------------------------------------------------------------- */
/* Ciclo de vida da reserva: sem isso, uma falha depois do claim deixaria a  */
/* mensagem presa numa reserva órfã e o reenvio da Meta seria descartado     */
/* para sempre — perda de mensagem legítima de cliente.                      */
/* ------------------------------------------------------------------------- */

describe("reserva órfã não bloqueia a mensagem para sempre", () => {
  test("falha controlada libera o retry imediatamente", async () => {
    const first = await claimInboundEvent(db, "whatsapp", "wamid.CRASH");
    expect(first.claimed).toBe(true);
    expect(first.reason).toBe("new");

    /* o processamento explodiu depois de reservar */
    await failInboundEvent(db, first.eventId, new Error("gateway caiu"));

    const retry = await claimInboundEvent(db, "whatsapp", "wamid.CRASH");
    expect(retry.claimed).toBe(true);
    expect(retry.resumed).toBe(true);
    expect(retry.reason).toBe("takeover");
    expect(retry.attempts).toBe(2);
    /* segue sendo uma linha só: a reserva é a mesma, reaproveitada */
    expect(await count("inbound_events")).toBe(1);
  });

  test("o retry retoma da etapa onde parou", async () => {
    const first = await claimInboundEvent(db, "whatsapp", "wamid.STAGE");
    await advanceInboundEvent(db, first.eventId, "stored");
    await failInboundEvent(db, first.eventId, new Error("morreu depois de gravar"));

    const retry = await claimInboundEvent(db, "whatsapp", "wamid.STAGE");
    expect(retry.claimed).toBe(true);
    expect(retry.stage).toBe("stored");
    /* já gravou a mensagem, ainda não ligou o lead nem chamou a IA */
    expect(stageReached(retry.stage, "stored")).toBe(true);
    expect(stageReached(retry.stage, "lead_linked")).toBe(false);
    expect(stageReached(retry.stage, "replied")).toBe(false);
  });

  test("processo morto sem registrar falha: o prazo expira e outro assume", async () => {
    const first = await claimInboundEvent(db, "whatsapp", "wamid.KILL");
    expect(first.claimed).toBe(true);
    /* nenhum failInboundEvent: simula kill/timeout no meio do caminho */

    /* dentro do prazo, ninguém encosta: o dono pode estar vivo */
    const early = await claimInboundEvent(db, "whatsapp", "wamid.KILL");
    expect(early.claimed).toBe(false);
    expect(early.reason).toBe("in_flight");

    /* passado o prazo, a reserva é assumida */
    const late = await claimInboundEvent(db, "whatsapp", "wamid.KILL", {
      now: new Date(Date.now() + 61_000),
    });
    expect(late.claimed).toBe(true);
    expect(late.resumed).toBe(true);
    expect(late.reason).toBe("takeover");
  });

  test("evento concluído é descartado para sempre, mesmo com o prazo vencido", async () => {
    const first = await claimInboundEvent(db, "whatsapp", "wamid.DONE");
    await completeInboundEvent(db, first.eventId);

    const again = await claimInboundEvent(db, "whatsapp", "wamid.DONE");
    expect(again.claimed).toBe(false);
    expect(again.reason).toBe("completed");

    const muchLater = await claimInboundEvent(db, "whatsapp", "wamid.DONE", {
      now: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
    expect(muchLater.claimed).toBe(false);
    expect(muchLater.reason).toBe("completed");
  });

  test("concluir depois de falhar fecha o evento e apaga o erro", async () => {
    const first = await claimInboundEvent(db, "whatsapp", "wamid.RECUP");
    await failInboundEvent(db, first.eventId, new Error("falha transitória"));
    const retry = await claimInboundEvent(db, "whatsapp", "wamid.RECUP");
    await completeInboundEvent(db, retry.eventId);

    const rows = await db.all<{ status: string; stage: string; last_error: string | null }>(
      sql`SELECT status, stage, last_error FROM inbound_events WHERE external_id = 'wamid.RECUP'`,
    );
    expect(rows[0]?.status).toBe("completed");
    expect(rows[0]?.stage).toBe("replied");
    expect(rows[0]?.last_error).toBe(null);
  });

  test("takeover concorrente de reserva órfã: só um processo assume", async () => {
    const first = await claimInboundEvent(db, "whatsapp", "wamid.RACE2");
    await failInboundEvent(db, first.eventId, new Error("caiu"));

    const results = await Promise.all(
      Array.from({ length: 8 }, () => claimInboundEvent(db, "whatsapp", "wamid.RACE2")),
    );
    expect(results.filter((r) => r.claimed)).toHaveLength(1);
    expect(await count("inbound_events")).toBe(1);
  });

  test("stageReached respeita a ordem das etapas", () => {
    expect(stageReached("claimed", "claimed")).toBe(true);
    expect(stageReached("claimed", "stored")).toBe(false);
    expect(stageReached("lead_linked", "stored")).toBe(true);
    expect(stageReached("replied", "lead_linked")).toBe(true);
    expect(stageReached("stored", "replied")).toBe(false);
  });
});

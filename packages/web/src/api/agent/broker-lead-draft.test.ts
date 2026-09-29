import { describe, expect, test } from "bun:test";
import * as schema from "../database/schema";
import type { AdminDb } from "../lib/admin-base";
import {
  beginBrokerLeadDraft,
  loadBrokerLeadDraft,
  markBrokerLeadDraftComplete,
  recordBrokerLeadDraftAnswer,
} from "./broker-lead-draft";

function draftDb(withLead = true) {
  const leads = withLead
    ? [{ id: 17, phone: "5511999990000", createdAt: new Date() }]
    : [];
  const notes: { id: number; leadId: number; body: string }[] = [];
  const db = {
    select: () => ({
      from: (table: unknown) => {
        let rows: unknown[] = table === schema.leads ? leads : notes;
        const query = {
          where: () => query,
          orderBy: () => query,
          limit: async (count: number) => rows.slice(0, count),
          then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows).then(resolve),
        };
        return query;
      },
    }),
    insert: () => ({
      values: async (value: { leadId: number; body: string }) => {
        notes.push({ ...value, id: notes.length + 1 });
      },
    }),
  } as unknown as AdminDb;
  return { db, notes };
}

describe("broker lead draft storage", () => {
  test("resumes answers across reads and starts a fresh generic session independently", async () => {
    const { db } = draftDb();
    const first = { phone: "+55 (11) 99999-0000", session: { kind: "generic" as const, key: "entry-1" } };
    await beginBrokerLeadDraft(db, first);
    await recordBrokerLeadDraftAnswer(db, {
      ...first, stepKey: "role", value: "corretor", inboundTurnDedupeKey: "turn-a",
    });
    await recordBrokerLeadDraftAnswer(db, {
      ...first, stepKey: "creci", value: "CRECI 12345", inboundTurnDedupeKey: "turn-b",
    });

    const resumed = await loadBrokerLeadDraft(db, first);
    expect(resumed.draft?.answers).toEqual({ role: "corretor", creci: "CRECI 12345" });

    const fresh = await beginBrokerLeadDraft(db, {
      phone: "5511999990000",
      session: { kind: "generic", key: "entry-2" },
    });
    expect(fresh.answers).toEqual({});
    expect((await loadBrokerLeadDraft(db, first)).draft?.answers.creci).toBe("CRECI 12345");
  });

  test("deduplicates an inbound turn and retains completed-session history", async () => {
    const { db, notes } = draftDb();
    const input = { phone: "5511999990000", session: { kind: "token" as const, key: "ExactTokenId-A7" } };
    const answer = {
      ...input, stepKey: "nome" as const, value: "Corretora Teste",
      inboundTurnDedupeKey: "whatsapp-message-123",
    };
    const first = await recordBrokerLeadDraftAnswer(db, answer);
    const duplicate = await recordBrokerLeadDraftAnswer(db, answer);
    expect(first.duplicate).toBe(false);
    expect(duplicate.duplicate).toBe(true);
    expect(notes).toHaveLength(2); // started + one answer

    await markBrokerLeadDraftComplete(db, input);
    const loaded = await loadBrokerLeadDraft(db, input);
    expect(loaded.draft).toBeNull();
    expect(loaded.completedHistory).toHaveLength(1);
    expect(loaded.completedHistory[0]?.session.key).toBe("ExactTokenId-A7");
    expect(loaded.completedHistory[0]?.answers.nome).toBe("Corretora Teste");
  });

  test("does not silently create a lead or persist credential-like content", async () => {
    const missingLeadDb = draftDb(false).db;
    await expect(loadBrokerLeadDraft(missingLeadDb, {
      phone: "5511888880000",
      session: { kind: "generic", key: "missing" },
    })).rejects.toThrow("No lead found");
    const { db } = draftDb();
    await expect(recordBrokerLeadDraftAnswer(db, {
      phone: "5511999990000",
      session: { kind: "generic", key: "entry" },
      stepKey: "observacaoFinal",
      value: "senha: secreto",
      inboundTurnDedupeKey: "turn-secret",
    })).rejects.toThrow("Credential-like");
  });
});
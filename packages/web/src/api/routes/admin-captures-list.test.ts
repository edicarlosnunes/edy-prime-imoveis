import { describe, expect, test } from "bun:test";
import * as schema from "../database/schema";
import type { AdminDb } from "../lib/admin-base";
import { adminCaptures } from "./admin-captures";

describe("adminCaptures.list", () => {
  test("includes older captures and owners beyond the former retrieval caps", async () => {
    const captures = Array.from({ length: 501 }, (_, index) => ({
      id: index + 1,
      ownerId: index + 1,
      city: "Praia Grande",
      stage: "novo_contato",
      source: "manual",
      notes: null as string | null,
      updatedAt: new Date(index),
    }));
    captures[500]!.ownerId = 1001;
    captures[500]!.notes =
      "[captacao-ia]\n- Origem do cadastro: LINK_CAPTACAO\n[/captacao-ia]";

    const owners = Array.from({ length: 1001 }, (_, index) => ({
      id: index + 1,
      name: `Proprietário ${index + 1}`,
      phone: `551399999${String(index + 1).padStart(4, "0")}`,
    }));

    /* Handler direto com fixtures: nenhum banco, sessão ou serviço real. */
    const db = {
      select: () => ({
        from: (table: unknown) => table === schema.propertyCaptures
          ? { orderBy: async () => captures }
          : Promise.resolve(owners),
      }),
    } as unknown as AdminDb;
    const procedure = adminCaptures.list as unknown as {
      "~orpc": {
        handler: (args: {
          input: { source: string };
          context: { db: AdminDb };
        }) => Promise<{ id: number; owner: { name: string } | null }[]>;
      };
    };

    const listed = await procedure["~orpc"].handler({
      input: { source: "link_captacao" },
      context: { db },
    });

    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      id: 501,
      owner: { name: "Proprietário 1001" },
    });
  });
});
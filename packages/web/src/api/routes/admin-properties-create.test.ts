import { describe, expect, test } from "bun:test";
import * as schema from "../database/schema";
import type { AdminDb } from "../lib/admin-base";
import { buildSerial } from "../lib/capture-serial";
import { adminProperties } from "./admin-properties";

interface CaptureFixture {
  id: number;
  stage: string;
  docStatus: string;
  estimatedPrice: number | null;
  convertedPropertyId: number | null;
  serial: string | null;
  propertyType: string;
}

class FakeAdminDb {
  serialAllocations = 0;
  serialNext = 0;
  codeLookups: string[] = [];
  existingCodes = new Set<string>();
  capture: CaptureFixture | null = null;
  propertyValues: Record<string, unknown> | null = null;
  captureUpdates: Record<string, unknown>[] = [];

  select() {
    return {
      from: (table: unknown) => ({
        where: (condition: unknown) => ({
          limit: async () => {
            if (table === schema.properties) {
              const code = this.sqlStringParam(condition);
              this.codeLookups.push(code);
              return this.existingCodes.has(code) ? [{ id: 1 }] : [];
            }
            if (table === schema.propertyCaptures) return this.capture ? [this.capture] : [];
            return [];
          },
        }),
      }),
    };
  }

  run = async () => {};

  all = async () => {
    this.serialAllocations++;
    this.serialNext++;
    return [{ next: this.serialNext }];
  };

  insert(table: unknown) {
    return {
      values: (values: Record<string, unknown>) => ({
        returning: async () => {
          if (table === schema.properties) {
            this.propertyValues = values;
            return [{ id: 41, ...values }];
          }
          return [];
        },
      }),
    };
  }

  delete() {
    return { where: async () => {} };
  }

  update() {
    return {
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          this.captureUpdates.push(values);
        },
      }),
    };
  }

  private sqlStringParam(condition: unknown): string {
    const chunks = (condition as { queryChunks?: unknown[] }).queryChunks ?? [];
    const param = chunks.find(
      (chunk) =>
        typeof chunk === "object" &&
        chunk !== null &&
        "value" in chunk &&
        typeof chunk.value === "string",
    ) as { value: string } | undefined;
    return param?.value ?? "";
  }
}

const createProcedure = adminProperties.create as unknown as {
  "~orpc": {
    inputSchema: { parse: (input: unknown) => unknown };
    handler: (args: {
      input: unknown;
      context: { db: AdminDb; user: { id: number; name: string } };
    }) => Promise<{ id: number; serial: string }>;
  };
};
const updateInputSchema = (adminProperties.update as unknown as {
  "~orpc": { inputSchema: { parse: (input: unknown) => unknown } };
})["~orpc"].inputSchema;

const baseInput = {
  code: "",
  title: "Apartamento Praia",
  type: "apartamento",
  price: 650000,
};

async function createProperty(db: FakeAdminDb, input = baseInput) {
  const parsed = createProcedure["~orpc"].inputSchema.parse(input);
  return createProcedure["~orpc"].handler({
    input: parsed,
    context: {
      db: db as unknown as AdminDb,
      user: { id: 3, name: "Teste" },
    },
  });
}

describe("adminProperties.create blank code", () => {
  test("uses one generated serial for code, slug, serial, and response", async () => {
    const db = new FakeAdminDb();
    db.serialNext = 41;

    const result = await createProperty(db);
    const generated = buildSerial("apartamento", new Date().getFullYear(), 42);
    const property = db.propertyValues!;

    expect(db.serialAllocations).toBe(1);
    expect(db.codeLookups).toEqual([generated]);
    expect(property.code).toBe(generated);
    expect(property.serial).toBe(generated);
    expect(property.slug).toEndWith(generated.toLowerCase());
    expect(result.serial).toBe(generated);
  });

  test("checks duplicates using the resolved serial code", async () => {
    const db = new FakeAdminDb();
    const generated = buildSerial("apartamento", new Date().getFullYear(), 1);
    db.existingCodes.add(generated);

    await expect(createProperty(db)).rejects.toMatchObject({ code: "CONFLICT" });

    expect(db.serialAllocations).toBe(1);
    expect(db.codeLookups).toEqual([generated]);
    expect(db.propertyValues).toBeNull();
  });

  test("inherits an eligible capture serial without allocating another", async () => {
    const db = new FakeAdminDb();
    db.capture = {
      id: 9,
      stage: "validacao",
      docStatus: "completo",
      estimatedPrice: 700000,
      convertedPropertyId: null,
      serial: "AP-2025-000123",
      propertyType: "apartamento",
    };

    const result = await createProperty(db, { ...baseInput, captureId: 9 });
    const property = db.propertyValues!;

    expect(db.serialAllocations).toBe(0);
    expect(db.codeLookups).toEqual(["AP-2025-000123"]);
    expect(property.code).toBe("AP-2025-000123");
    expect(property.serial).toBe("AP-2025-000123");
    expect(property.slug).toEndWith("ap-2025-000123");
    expect(property.published).toBe(0);
    expect(result.serial).toBe("AP-2025-000123");
  });

  test("rejects an ineligible capture before allocating a serial", async () => {
    const db = new FakeAdminDb();
    db.capture = {
      id: 10,
      stage: "novo_contato",
      docStatus: "nao_iniciado",
      estimatedPrice: null,
      convertedPropertyId: null,
      serial: null,
      propertyType: "apartamento",
    };

    await expect(createProperty(db, { ...baseInput, captureId: 10 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    expect(db.serialAllocations).toBe(0);
    expect(db.propertyValues).toBeNull();
  });

  test("keeps explicit create codes and still requires one on update", async () => {
    const db = new FakeAdminDb();
    const result = await createProperty(db, { ...baseInput, code: " legado-17 " });

    expect(db.propertyValues?.code).toBe("LEGADO-17");
    expect(db.propertyValues?.slug).toEndWith("legado-17");
    expect(result.serial).toBe(buildSerial("apartamento", new Date().getFullYear(), 1));
    expect(db.serialAllocations).toBe(1);
    expect(() =>
      updateInputSchema.parse({ ...baseInput, code: "", id: 41 }),
    ).toThrow();
  });
});
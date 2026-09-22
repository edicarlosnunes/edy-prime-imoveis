/**
 * Item 6 — ENDEREÇO INTELIGENTE: estrutura central de logradouros por cidade.
 *
 * A comparação inteira vive em `lib/street-normalize.ts` (módulo puro e
 * testado). Aqui só a persistência: a tabela `streets` guarda os logradouros
 * conhecidos com apelidos, bairro e CEP, e estas rotas leem/escrevem nela.
 *
 * Regra que manda no fluxo: a estrutura NUNCA decide errado sozinha.
 *   • acima de STREET_MATCH_AUTO (0.92) → resolve sozinho ("auto");
 *   • parecido mas não o bastante → devolve sugestões e pede CONFIRMAÇÃO;
 *   • nada parecido → trata como logradouro novo ("novo").
 *
 * O bairro é VALIDAÇÃO ADICIONAL, nunca chave: divergir do cadastrado não
 * invalida o endereço, só rebaixa uma resolução automática para confirmação.
 *
 * Nada aqui exclui registro. `remove` não existe de propósito: logradouro
 * errado é corrigido por `update`.
 */
import { z } from "zod";
import { and, asc, desc, eq, like, sql } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { adminBase, type AdminDb } from "../lib/admin-base";
import * as schema from "../database/schema";
import {
  cityKey,
  matchStreet,
  streetDisplayName,
  streetKey,
  suggestStreets,
  type StreetCandidate,
} from "../lib/street-normalize";

/** Como o chamador deve tratar a resposta de `resolve`. */
export type StreetDecision = "auto" | "confirmar" | "novo" | "sem_logradouro";

function parseAliases(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function serializeAliases(aliases: readonly string[]): string {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const alias of aliases) {
    const name = String(alias ?? "").trim().replace(/\s+/g, " ").slice(0, 160);
    if (!name) continue;
    const key = streetKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return JSON.stringify(out);
}

type StreetRow = typeof schema.streets.$inferSelect;

function toCandidate(row: StreetRow): StreetCandidate & { id: number; district: string | null } {
  return {
    id: row.id,
    city: row.city,
    name: row.name,
    aliases: parseAliases(row.aliases),
    district: row.district,
  };
}

/** Logradouros de UMA cidade — cidade é filtro duro na comparação. */
async function loadCityStreets(db: AdminDb, city: string | null | undefined) {
  const key = cityKey(city);
  const rows = key
    ? await db.select().from(schema.streets).where(eq(schema.streets.cityKey, key)).limit(4000)
    : [];
  return rows;
}

/**
 * Grava o logradouro se ele ainda não existe na cidade; se existe, só soma o
 * uso e completa bairro/CEP que estavam vazios. Nunca sobrescreve o que já
 * estava preenchido e nunca duplica (índice único city_key + street_key).
 */
export async function ensureStreet(
  db: AdminDb,
  input: {
    city: string;
    name: string;
    district?: string | null;
    cep?: string | null;
    source?: string;
    confirmed?: boolean;
  },
): Promise<StreetRow | null> {
  const city = String(input.city ?? "").trim();
  const display = streetDisplayName(input.name);
  const key = streetKey(input.name);
  const ckey = cityKey(city);
  if (!city || !display || !key || !ckey) return null;

  const [existing] = await db
    .select()
    .from(schema.streets)
    .where(and(eq(schema.streets.cityKey, ckey), eq(schema.streets.streetKey, key)))
    .limit(1);

  const now = new Date();

  if (existing) {
    const patch: Partial<typeof schema.streets.$inferInsert> = {
      usageCount: existing.usageCount + 1,
      updatedAt: now,
    };
    /* Só completa lacuna — bairro/CEP já preenchidos são preservados. */
    if (!existing.district && input.district?.trim()) patch.district = input.district.trim();
    if (!existing.cep && input.cep?.trim()) patch.cep = input.cep.trim();
    if (input.confirmed && existing.confirmed === 0) patch.confirmed = 1;
    const [updated] = await db
      .update(schema.streets)
      .set(patch)
      .where(eq(schema.streets.id, existing.id))
      .returning();
    return updated ?? existing;
  }

  const [created] = await db
    .insert(schema.streets)
    .values({
      city,
      cityKey: ckey,
      name: display,
      streetKey: key,
      aliases: null,
      district: input.district?.trim() || null,
      cep: input.cep?.trim() || null,
      source: input.source ?? "cadastro",
      confirmed: input.confirmed ? 1 : 0,
      usageCount: 1,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return created ?? null;
}

export const adminStreets = {
  /** Logradouros cadastrados, filtráveis por cidade e por texto. */
  list: adminBase
    .input(
      z
        .object({
          city: z.string().max(120).optional(),
          search: z.string().max(120).optional(),
          limit: z.number().int().min(1).max(500).optional(),
        })
        .optional(),
    )
    .handler(async ({ input, context }) => {
      const filters = [];
      const ckey = cityKey(input?.city);
      if (ckey) filters.push(eq(schema.streets.cityKey, ckey));
      if (input?.search?.trim()) {
        const key = streetKey(input.search);
        if (key) filters.push(like(schema.streets.streetKey, `%${key}%`));
      }
      const rows = await context.db
        .select()
        .from(schema.streets)
        .where(filters.length ? and(...filters) : undefined)
        .orderBy(desc(schema.streets.usageCount), asc(schema.streets.name))
        .limit(input?.limit ?? 200);
      return rows.map((row) => ({ ...row, aliases: parseAliases(row.aliases) }));
    }),

  /**
   * Resolve o logradouro digitado contra a estrutura central.
   *
   * Nunca escreve nada: é consulta. Quem decide gravar é o fluxo de captação
   * (ou o corretor, por `register`), depois de a dúvida ser resolvida.
   */
  resolve: adminBase
    .input(
      z.object({
        city: z.string().max(120),
        street: z.string().max(200),
        district: z.string().max(120).nullable().optional(),
      }),
    )
    .handler(async ({ input, context }) => {
      const typed = streetDisplayName(input.street);
      if (!streetKey(input.street)) {
        return {
          decision: "sem_logradouro" as StreetDecision,
          typed,
          match: null,
          suggestions: [],
          districtMismatch: false,
          message: "Logradouro não informado.",
        };
      }

      const rows = await loadCityStreets(context.db, input.city);
      const candidates = rows.map(toCandidate);
      const best = matchStreet(candidates, { street: input.street, city: input.city });
      const suggestions = suggestStreets(candidates, { street: input.street, city: input.city }).map(
        (item) => ({
          id: (item.candidate as { id?: number }).id ?? null,
          city: item.candidate.city,
          name: item.candidate.name,
          district: (item.candidate as { district?: string | null }).district ?? null,
          score: Math.round(item.score * 100) / 100,
          exact: item.exact,
        }),
      );

      if (!best) {
        return {
          decision: "novo" as StreetDecision,
          typed,
          match: null,
          suggestions,
          districtMismatch: false,
          message: `Logradouro novo para ${input.city.trim()}: "${typed}".`,
        };
      }

      const matched = {
        id: (best.candidate as { id?: number }).id ?? null,
        city: best.candidate.city,
        name: best.candidate.name,
        district: (best.candidate as { district?: string | null }).district ?? null,
        score: Math.round(best.score * 100) / 100,
        exact: best.exact,
      };

      /* Bairro é validação ADICIONAL: quando bate diferente do cadastrado, a
         resolução automática vira pedido de confirmação em vez de erro. */
      const informed = String(input.district ?? "").trim();
      const districtMismatch = Boolean(
        informed && matched.district && cityKey(informed) !== cityKey(matched.district),
      );

      const auto = best.exact && !districtMismatch;
      return {
        decision: (auto ? "auto" : "confirmar") as StreetDecision,
        typed,
        match: matched,
        suggestions,
        districtMismatch,
        message: auto
          ? `Logradouro reconhecido: ${matched.name}.`
          : districtMismatch
            ? `"${typed}" parece ser ${matched.name}, mas o bairro informado (${informed}) difere do cadastrado (${matched.district}). Confirmar antes de usar.`
            : `"${typed}" parece ser ${matched.name} (${Math.round(matched.score * 100)}%). Confirmar antes de usar.`,
      };
    }),

  /**
   * Cadastra (ou completa) um logradouro. É o "sim, é este" do corretor: o
   * registro nasce/fica `confirmed = 1`.
   */
  register: adminBase
    .input(
      z.object({
        city: z.string().min(2).max(120),
        name: z.string().min(2).max(200),
        district: z.string().max(120).nullable().optional(),
        cep: z.string().max(20).nullable().optional(),
      }),
    )
    .handler(async ({ input, context }) => {
      const row = await ensureStreet(context.db, {
        city: input.city,
        name: input.name,
        district: input.district ?? null,
        cep: input.cep ?? null,
        source: "manual",
        confirmed: true,
      });
      if (!row) throw new ORPCError("BAD_REQUEST", { message: "Cidade e logradouro são obrigatórios" });
      return { id: row.id, name: row.name, city: row.city };
    }),

  /**
   * Corrige o logradouro e acrescenta apelidos/grafias aceitas.
   *
   * Apelidos são ADITIVOS: os que já existiam continuam valendo, porque é por
   * eles que cadastros antigos são reconhecidos.
   */
  update: adminBase
    .input(
      z.object({
        id: z.number().int(),
        name: z.string().min(2).max(200).optional(),
        district: z.string().max(120).nullable().optional(),
        cep: z.string().max(20).nullable().optional(),
        addAliases: z.array(z.string().max(160)).max(20).optional(),
        confirmed: z.boolean().optional(),
      }),
    )
    .handler(async ({ input, context }) => {
      const [row] = await context.db
        .select()
        .from(schema.streets)
        .where(eq(schema.streets.id, input.id))
        .limit(1);
      if (!row) throw new ORPCError("NOT_FOUND", { message: "Logradouro não encontrado" });

      const patch: Partial<typeof schema.streets.$inferInsert> = { updatedAt: new Date() };

      if (input.name?.trim()) {
        const display = streetDisplayName(input.name);
        const key = streetKey(input.name);
        if (!display || !key) throw new ORPCError("BAD_REQUEST", { message: "Logradouro inválido" });
        if (key !== row.streetKey) {
          const [clash] = await context.db
            .select({ id: schema.streets.id })
            .from(schema.streets)
            .where(and(eq(schema.streets.cityKey, row.cityKey), eq(schema.streets.streetKey, key)))
            .limit(1);
          if (clash && clash.id !== row.id) {
            throw new ORPCError("CONFLICT", {
              message: "Já existe esse logradouro nesta cidade — use apelidos em vez de duplicar",
            });
          }
          /* A grafia antiga não se perde: vira apelido. */
          patch.aliases = serializeAliases([...parseAliases(row.aliases), row.name, ...(input.addAliases ?? [])]);
        }
        patch.name = display;
        patch.streetKey = key;
      }

      if (!patch.aliases && input.addAliases?.length) {
        patch.aliases = serializeAliases([...parseAliases(row.aliases), ...input.addAliases]);
      }
      if (input.district !== undefined) patch.district = input.district?.trim() || null;
      if (input.cep !== undefined) patch.cep = input.cep?.trim() || null;
      if (input.confirmed !== undefined) patch.confirmed = input.confirmed ? 1 : 0;

      await context.db.update(schema.streets).set(patch).where(eq(schema.streets.id, row.id));

      await context.db.insert(schema.auditLog).values({
        userId: context.user.id,
        userName: context.user.name,
        action: "street_updated",
        entity: "street",
        entityId: String(row.id),
        detail: `${row.city} — ${row.name}${patch.name && patch.name !== row.name ? ` -> ${patch.name}` : ""}`,
      });

      return { ok: true };
    }),

  /**
   * Popula a estrutura a partir do que JÁ está cadastrado (captações e
   * imóveis). Só adiciona: nada é sobrescrito e nada é excluído. Pode rodar
   * quantas vezes quiser — repetido, apenas soma uso.
   */
  backfill: adminBase.handler(async ({ context }) => {
    const captures = await context.db
      .select({
        city: schema.propertyCaptures.city,
        street: schema.propertyCaptures.street,
        district: schema.propertyCaptures.district,
        cep: schema.propertyCaptures.cep,
      })
      .from(schema.propertyCaptures)
      .limit(5000);

    let created = 0;
    let touched = 0;
    const before = await countStreets(context.db);

    for (const row of captures) {
      if (!row.city || !row.street) continue;
      const result = await ensureStreet(context.db, {
        city: row.city,
        name: row.street,
        district: row.district,
        cep: row.cep,
        source: "cadastro",
      });
      if (result) touched += 1;
    }

    created = (await countStreets(context.db)) - before;
    return { ok: true, examined: captures.length, touched, created };
  }),
};

async function countStreets(db: AdminDb): Promise<number> {
  const rows = await db.select({ n: sql<number>`count(*)` }).from(schema.streets);
  return Number(rows[0]?.n ?? 0);
}

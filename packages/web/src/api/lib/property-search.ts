/**
 * Busca de imóveis usada pela tool `buscarImoveis` do agente.
 *
 * Por que existe: o filtro anterior era `lower(district) like '%bairro%'` no
 * SQLite, então qualquer diferença de acento ou de grafia derrubava o imóvel
 * antes de qualquer outra checagem (ex: cadastro "GUILHERMINIA" não casava com
 * a pergunta "bairro Guilhermina"). SQLite/Turso não tem `unaccent` nem
 * distância de edição, então os filtros de texto livre passaram para JS:
 * determinísticos, testáveis sem banco e tolerantes a acento, grafia e
 * sinônimos. Filtros estruturais (publicado, status, tipo, finalidade,
 * dormitórios, vagas, preço) continuam em SQL, onde são exatos.
 */
import { and, asc, eq, gte, lte, or } from "drizzle-orm";
import * as schema from "../database/schema";
import type { AdminDb } from "./admin-base";

export type PropertyRow = typeof schema.properties.$inferSelect;

export interface PropertySearchInput {
  bairro?: string;
  cidade?: string;
  tipo?: string;
  finalidade?: "venda" | "locacao";
  dormitoriosMin?: number;
  vagasMin?: number;
  precoMax?: number;
  precoMin?: number;
  termo?: string;
}

/** Sinônimos aplicados ao texto livre — a pergunta e o cadastro raramente usam a mesma palavra. */
const SYNONYMS: Record<string, string> = {
  quarto: "dormitorio",
  quartos: "dormitorio",
  dormitorios: "dormitorio",
  dorm: "dormitorio",
  dorms: "dormitorio",
  garagem: "vaga",
  garagens: "vaga",
  vagas: "vaga",
  suites: "suite",
  banheiros: "banheiro",
  apto: "apartamento",
  aptos: "apartamento",
  ap: "apartamento",
  apartamentos: "apartamento",
  casas: "casa",
  coberturas: "cobertura",
  predio: "edificio",
  bairro: "",
  no: "",
  na: "",
  do: "",
  da: "",
  de: "",
  em: "",
};

/** minúsculas, sem acento, só alfanumérico separado por espaço. */
export function normalizeText(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function tokenize(value: string | null | undefined): string[] {
  const normalized = normalizeText(value);
  if (!normalized) return [];
  return normalized
    .split(" ")
    .map((token) => (token in SYNONYMS ? SYNONYMS[token] : token))
    .filter((token) => token.length > 0);
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
    }
    previous = current;
  }
  return previous[b.length];
}

/** Tolerância proporcional: nomes curtos quase não erram, longos erram mais. */
function tolerance(length: number): number {
  if (length <= 4) return 0;
  if (length <= 6) return 1;
  if (length <= 10) return 2;
  return 3;
}

/** Um token da pergunta casa com um token do cadastro (igual, prefixo ou grafia próxima). */
function tokenMatches(needle: string, haystackToken: string): boolean {
  if (needle === haystackToken) return true;
  if (needle.length >= 4 && haystackToken.startsWith(needle)) return true;
  if (haystackToken.length >= 4 && needle.startsWith(haystackToken)) return true;
  const limit = tolerance(Math.max(needle.length, haystackToken.length));
  if (limit === 0) return false;
  if (Math.abs(needle.length - haystackToken.length) > limit) return false;
  return levenshtein(needle, haystackToken) <= limit;
}

/** Todos os tokens pedidos precisam aparecer em algum dos campos do imóvel. */
function textMatches(needle: string, fields: (string | null | undefined)[]): boolean {
  const wanted = tokenize(needle);
  if (wanted.length === 0) return true;
  const candidates = fields.flatMap((field) => tokenize(field));
  if (candidates.length === 0) return false;
  const joined = candidates.join(" ");
  return wanted.every(
    (token) =>
      (token.length >= 4 && joined.includes(token)) ||
      candidates.some((candidate) => tokenMatches(token, candidate)),
  );
}

/** Bairro/cidade: procura também em título e endereço, onde a região costuma repetir. */
export function placeMatches(row: PropertyRow, place: string): boolean {
  return textMatches(place, [row.district, row.city, row.title, row.address]);
}

/** Termo livre: inclui o código, para "CS1000" achar o imóvel também na busca. */
export function termMatches(row: PropertyRow, term: string): boolean {
  return textMatches(term, [
    row.code,
    row.title,
    row.highlight,
    row.description,
    row.features,
    row.district,
    row.city,
  ]);
}

/** Filtro puro (sem banco) — usado nos testes e por `searchProperties`. */
export function filterProperties(rows: PropertyRow[], input: PropertySearchInput): PropertyRow[] {
  return rows.filter((row) => {
    if (row.published !== 1) return false;
    if (row.status !== "disponivel" && row.status !== "reservado") return false;
    if (input.tipo && row.type !== input.tipo) return false;
    if (input.finalidade && row.purpose !== input.finalidade && row.purpose !== "venda_locacao") {
      return false;
    }
    if (input.dormitoriosMin !== undefined && row.bedrooms < input.dormitoriosMin) return false;
    if (input.vagasMin !== undefined && row.parking < input.vagasMin) return false;
    if (input.precoMax !== undefined && row.price > input.precoMax) return false;
    if (input.precoMin !== undefined && row.price < input.precoMin) return false;
    if (input.bairro && !placeMatches(row, input.bairro)) return false;
    if (input.cidade && !textMatches(input.cidade, [row.city, row.district])) return false;
    if (input.termo && !termMatches(row, input.termo)) return false;
    return true;
  });
}

/**
 * Busca no banco: filtros exatos em SQL, texto livre em JS.
 * `candidateLimit` limita o lote lido antes do filtro difuso.
 */
export async function searchProperties(
  db: AdminDb,
  input: PropertySearchInput,
  limit = 6,
  candidateLimit = 200,
): Promise<PropertyRow[]> {
  const filters = [
    eq(schema.properties.published, 1),
    or(eq(schema.properties.status, "disponivel"), eq(schema.properties.status, "reservado"))!,
  ];
  if (input.tipo) filters.push(eq(schema.properties.type, input.tipo));
  if (input.finalidade) {
    filters.push(
      or(
        eq(schema.properties.purpose, input.finalidade),
        eq(schema.properties.purpose, "venda_locacao"),
      )!,
    );
  }
  if (input.dormitoriosMin !== undefined) {
    filters.push(gte(schema.properties.bedrooms, input.dormitoriosMin));
  }
  if (input.vagasMin !== undefined) filters.push(gte(schema.properties.parking, input.vagasMin));
  if (input.precoMax !== undefined) filters.push(lte(schema.properties.price, input.precoMax));
  if (input.precoMin !== undefined) filters.push(gte(schema.properties.price, input.precoMin));

  const rows = await db
    .select()
    .from(schema.properties)
    .where(and(...filters))
    .orderBy(asc(schema.properties.price))
    .limit(candidateLimit);

  return filterProperties(rows, {
    bairro: input.bairro,
    cidade: input.cidade,
    termo: input.termo,
  }).slice(0, limit);
}

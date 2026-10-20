import { sql } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { DEFAULT_PROPERTY_TYPES, normalizePropertyTypeLabel, type PropertyTypeOption } from "../../shared/property-types";
import type { SerialDb } from "./serial-counter";

// Additive and idempotent: never changes existing properties or issued serials.
export async function ensurePropertyTypes(db: SerialDb) {
  await db.run(sql`CREATE TABLE IF NOT EXISTS crm_property_types (
    key TEXT PRIMARY KEY NOT NULL, label TEXT NOT NULL, normalized_label TEXT UNIQUE NOT NULL,
    active INTEGER NOT NULL DEFAULT 1)`);
  const values = DEFAULT_PROPERTY_TYPES.map(row => sql`(${row.key}, ${row.label}, ${normalizePropertyTypeLabel(row.label)}, 1)`);
  await db.run(sql`INSERT INTO crm_property_types (key,label,normalized_label,active)
    VALUES ${sql.join(values, sql`, `)} ON CONFLICT DO NOTHING`);
}
export async function listPropertyTypes(db: SerialDb): Promise<PropertyTypeOption[]> {
  await ensurePropertyTypes(db);
  const rows = await db.all(sql`SELECT key,label,active FROM crm_property_types ORDER BY label COLLATE NOCASE`) as {key:string;label:string;active:number}[];
  return rows.map(row => ({...row, active: Boolean(row.active)}));
}
export async function savePropertyType(db: SerialDb, input: {key?:string;label:string;active:boolean}) {
  const label = input.label.trim().replace(/\s+/g, " ");
  if (!label || label.length > 80) throw new ORPCError("BAD_REQUEST", {message:"Informe um nome com até 80 caracteres."});
  await ensurePropertyTypes(db);
  const normalized = normalizePropertyTypeLabel(label);
  const key = input.key || `tipo_${crypto.randomUUID().replace(/-/g, "")}`;
  const duplicates = await db.all(sql`SELECT key FROM crm_property_types WHERE normalized_label = ${normalized} AND key != ${key}`) as {key:string}[];
  if (duplicates.length) throw new ORPCError("CONFLICT", {message:"Já existe um tipo com esse nome, inclusive entre os desativados."});
  try {
    if (input.key) {
      const updated = await db.all(sql`UPDATE crm_property_types SET label=${label}, normalized_label=${normalized},active=${Number(input.active)} WHERE key=${key} RETURNING key`) as {key:string}[];
      if (!updated.length) throw new ORPCError("NOT_FOUND", {message:"Tipo não encontrado."});
    } else {
      await db.run(sql`INSERT INTO crm_property_types (key,label,normalized_label,active) VALUES (${key},${label},${normalized},${Number(input.active)})`);
    }
  } catch (error) {
    if (String(error).includes("UNIQUE")) throw new ORPCError("CONFLICT", {message:"Já existe um tipo com esse nome."});
    throw error;
  }
  return {key};
}
export async function validatePropertyType(db: SerialDb, key: string, existingKey?:string) {
  const rows = await listPropertyTypes(db);
  if (key === existingKey || rows.some(row => row.key === key && row.active)) return;
  throw new ORPCError("BAD_REQUEST", {message:"Selecione um tipo ativo em Configurações → Tipos de imóveis."});
}

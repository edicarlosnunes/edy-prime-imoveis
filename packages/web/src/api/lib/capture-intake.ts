/**
 * Ficha única de captação: PROPRIETÁRIO + IMÓVEL na mesma entrada.
 *
 * Módulo puro: nenhuma dependência de banco, oRPC ou rede. Recebe o que o
 * formulário mandou (do site público ou do CRM) e devolve o payload já
 * normalizado da captação, mais os avisos que a tela deve mostrar.
 *
 * Duas regras que este módulo existe para garantir:
 *
 *  1. TELEFONE identifica o PROPRIETÁRIO, nunca o imóvel. A identidade do
 *     imóvel é CEP + número + complementos identificadores (`unit_key`).
 *     Por isso o mesmo dono pode ter 3 apartamentos e ter 3 captações.
 *
 *  2. Unidade repetida AVISA, não bloqueia. Um imóvel perdido pode ser
 *     recaptado meses depois; travar no banco impediria trabalho legítimo.
 */
import {
  COMPLEMENT_FIELDS,
  type ComplementKey,
  type Complements,
  formatUnitAddress,
  normalizeCep,
  unitKey,
} from "./capture-address";

/** Origem da captação. `site` é o formulário público do proprietário. */
export const CAPTURE_SOURCES = ["site", "manual", "prospeccao", "indicacao", "portal"] as const;
export type CaptureSource = (typeof CAPTURE_SOURCES)[number];

export function normalizeSource(raw: string | null | undefined): CaptureSource {
  const value = String(raw ?? "").trim().toLowerCase();
  if ((CAPTURE_SOURCES as readonly string[]).includes(value)) return value as CaptureSource;
  /* Valores antigos gravados pelo site: `site_vender`, `site-proprietario`... */
  if (value.startsWith("site")) return "site";
  return "manual";
}

const text = (value: unknown, max = 200): string | null => {
  const clean = typeof value === "string" ? value.trim() : "";
  return clean ? clean.slice(0, max) : null;
};

/** Entrada da ficha única, do site ou do CRM. Só nome e telefone são exigidos. */
export interface CaptureFichaInput {
  ownerName: string;
  ownerPhone: string;
  ownerEmail?: string | null;
  ownerDocument?: string | null;
  cep?: string | null;
  street?: string | null;
  number?: string | null;
  district?: string | null;
  city?: string | null;
  state?: string | null;
  complements?: Complements | null;
  propertyType?: string | null;
  askingPrice?: number | null;
  intention?: string | null;
  notes?: string | null;
  source?: string | null;
}

/** Payload pronto para gravar em `property_captures`. */
export interface CapturePayload {
  city: string;
  district: string | null;
  address: string | null;
  cep: string | null;
  street: string | null;
  number: string | null;
  state: string | null;
  complements: string | null;
  unitKey: string;
  propertyType: string | null;
  askingPrice: number | null;
  intention: string | null;
  notes: string | null;
  source: CaptureSource;
}

/** Cidade padrão da imobiliária quando a ficha vem sem cidade. */
export const DEFAULT_CITY = "Praia Grande";

const COMPLEMENT_KEYS = COMPLEMENT_FIELDS.map((field) => field.key);

/** Mantém só os complementos preenchidos e conhecidos — nada de chave solta. */
export function cleanComplements(raw: Complements | null | undefined): Complements {
  const out: Complements = {};
  if (!raw || typeof raw !== "object") return out;
  for (const key of COMPLEMENT_KEYS) {
    const value = text((raw as Record<string, unknown>)[key], 60);
    if (value) out[key as ComplementKey] = value;
  }
  return out;
}

/** Serializa complementos para a coluna JSON. Vazio grava NULL, não "{}". */
export function serializeComplements(complements: Complements): string | null {
  return Object.keys(complements).length ? JSON.stringify(complements) : null;
}

/** Lê a coluna JSON. Conteúdo inválido vira objeto vazio, nunca exceção. */
export function parseComplements(raw: string | null | undefined): Complements {
  if (!raw) return {};
  try {
    return cleanComplements(JSON.parse(raw) as Complements);
  } catch {
    return {};
  }
}

/**
 * Monta o payload da captação a partir da ficha única.
 *
 * `address` (texto livre, coluna antiga) continua sendo preenchido com a linha
 * formatada para que listagens e documentos antigos não fiquem vazios.
 */
export function buildCapturePayload(input: CaptureFichaInput): CapturePayload {
  const complements = cleanComplements(input.complements);
  const cep = normalizeCep(input.cep);
  const street = text(input.street, 200);
  const number = text(input.number, 30);
  const city = text(input.city, 120) ?? DEFAULT_CITY;
  const district = text(input.district, 120);
  const state = text(input.state, 2)?.toUpperCase() ?? null;

  const address = formatUnitAddress({ cep, street, number, city, district, state }, complements) || null;

  return {
    city,
    district,
    address,
    cep,
    street,
    number,
    state,
    complements: serializeComplements(complements),
    unitKey: unitKey({ cep, number, street, city }, complements),
    propertyType: text(input.propertyType, 60),
    askingPrice: typeof input.askingPrice === "number" && Number.isFinite(input.askingPrice) && input.askingPrice > 0
      ? input.askingPrice
      : null,
    intention: text(input.intention, 120),
    notes: text(input.notes, 4000),
    source: normalizeSource(input.source),
  };
}

export interface ExistingCapture {
  id: number;
  ownerId: number;
  unitKey: string | null;
  stage: string;
}

export type DuplicateUnitWarning = {
  duplicate: true;
  captureId: number;
  sameOwner: boolean;
  message: string;
} | { duplicate: false };

/**
 * Procura uma captação já existente para a MESMA unidade imobiliária.
 *
 * Só avisa. Nunca impede o cadastro: a decisão de seguir é humana.
 * Captação perdida também é reportada — recaptar é legítimo, mas o corretor
 * precisa saber que já houve uma tentativa.
 */
export function findDuplicateUnit(
  existing: ExistingCapture[],
  candidate: { unitKey: string; ownerId?: number | null },
): DuplicateUnitWarning {
  if (!candidate.unitKey) return { duplicate: false };
  const hit = existing.find((row) => row.unitKey && row.unitKey === candidate.unitKey);
  if (!hit) return { duplicate: false };

  const sameOwner = candidate.ownerId != null && hit.ownerId === candidate.ownerId;
  const suffix = hit.stage === "perdido"
    ? " (marcada como PERDIDA — recaptar é permitido)"
    : "";
  return {
    duplicate: true,
    captureId: hit.id,
    sameOwner,
    message: sameOwner
      ? `Este mesmo imóvel já tem a captação #${hit.id} para este proprietário${suffix}.`
      : `POSSÍVEL DUPLICADO: já existe a captação #${hit.id} para este endereço, de outro proprietário${suffix}.`,
  };
}

/**
 * Guarda do "captar" automático: a captação só vira CAPTADO quando o imóvel
 * foi realmente criado no Cadastro Premium.
 *
 * Está isolado aqui porque é a regra que mais dói se errar: marcar captado sem
 * imóvel, ou marcar duas vezes num duplo clique. Sem React, sem rede — dá para
 * testar de verdade.
 *
 * Regras:
 *  - sem `capture_id` na rota, nada é marcado (cadastro comum de imóvel);
 *  - cancelar / fechar o formulário nunca marca (a captação fica em DOCUMENTAÇÃO);
 *  - imóvel criado marca exatamente uma vez, mesmo com dois eventos seguidos.
 */
import { parseOwnerPhotos } from "../../api/lib/capture-photos";

export type ConversionState = {
  captureId: number | null;
  /** Imóvel criado nesta sessão do formulário. */
  propertyId: number | null;
  /** Chamada de markConverted em andamento. */
  inFlight: boolean;
  /** markConverted já concluída com sucesso. */
  marked: boolean;
};

export type ConversionEvent =
  | { type: "property_created"; propertyId: number }
  | { type: "cancelled" }
  | { type: "mark_ok" }
  | { type: "mark_failed" };

export type ConversionPlan = {
  state: ConversionState;
  /** "mark" = chamar markConverted agora. "none" = não fazer nada. */
  action: "mark" | "none";
  propertyId: number | null;
};

export function initConversion(captureId: number | null): ConversionState {
  const valid = typeof captureId === "number" && Number.isInteger(captureId) && captureId > 0;
  return { captureId: valid ? captureId : null, propertyId: null, inFlight: false, marked: false };
}

export function planConversion(state: ConversionState, event: ConversionEvent): ConversionPlan {
  const none = (next: ConversionState = state): ConversionPlan => ({
    state: next,
    action: "none",
    propertyId: null,
  });

  switch (event.type) {
    case "cancelled":
      /* Sair sem criar imóvel deixa a captação exatamente onde estava. */
      return none({ ...state, inFlight: false });

    case "property_created": {
      if (state.captureId === null) return none({ ...state, propertyId: event.propertyId });
      if (!Number.isInteger(event.propertyId) || event.propertyId <= 0) return none(state);
      if (state.marked || state.inFlight) {
        /* Duplo clique: o imóvel já foi criado e a marcação já está resolvida. */
        return none(state);
      }
      return {
        state: { ...state, propertyId: event.propertyId, inFlight: true },
        action: "mark",
        propertyId: event.propertyId,
      };
    }

    case "mark_ok":
      return none({ ...state, inFlight: false, marked: true });

    case "mark_failed":
      /* Deixa marcável de novo: o backend é idempotente por propertyId. */
      return none({ ...state, inFlight: false, marked: false });
  }
}

/** O formulário está operando dentro de um fluxo de captação? */
export function isCaptureFlow(state: ConversionState): boolean {
  return state.captureId !== null;
}

/** Lê `?capture_id=` da rota. Tolerante: valor sujo é tratado como ausente. */
export function readCaptureId(search: string | null | undefined): number | null {
  if (!search) return null;
  const query = search.startsWith("?") ? search.slice(1) : search;
  const raw = new URLSearchParams(query).get("capture_id");
  if (raw === null) return null;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

/* ------------------------------------- fotos do Radar -> galeria do imóvel */

/** Uma linha da galeria do Cadastro de Imóveis (mesmo formato de `GalleryImage`). */
export interface InheritedImage {
  url: string;
  originalUrl: string | null;
  isPrimary: boolean;
}

/**
 * Converte as fotos PROVISÓRIAS da captação nas linhas da galeria do imóvel.
 *
 * Preserva a ORDEM da captação e a CAPA marcada no Radar (`primary`); sem
 * marca, a capa é a primeira — mesma convenção da galeria. Não faz upload:
 * devolve a MESMA URL, então nenhum arquivo é duplicado e as fotos continuam
 * na captação. Publicar segue sendo ato separado.
 */
export function galleryFromOwnerPhotos(raw: string | null | undefined): InheritedImage[] {
  const photos = parseOwnerPhotos(raw);
  if (photos.length === 0) return [];
  const primaryUrl = photos.find((photo) => photo.primary)?.url ?? photos[0]?.url ?? null;
  return photos.map((photo) => ({
    url: photo.url,
    originalUrl: null,
    isPrimary: photo.url === primaryUrl,
  }));
}

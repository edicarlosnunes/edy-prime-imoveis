export const CAPTURE_SOURCE_OPTIONS = [
  ["site", "Site"],
  ["manual", "Manual"],
  ["prospeccao", "Prospecção"],
  ["indicacao", "Indicação"],
  ["portal", "Portal"],
  ["whatsapp", "WhatsApp"],
  ["link_captacao", "Link de captação"],
] as const;

export type CaptureSourceFilter = (typeof CAPTURE_SOURCE_OPTIONS)[number][0];

const SOURCE_LABELS: Record<CaptureSourceFilter, string> = Object.fromEntries(CAPTURE_SOURCE_OPTIONS) as Record<
  CaptureSourceFilter,
  string
>;

const LEGACY_SOURCE_MARKERS = [
  { marker: "LINK_CAPTACAO", label: "Link de captação (origem legada)" },
  { marker: "whatsapp", label: "WhatsApp (origem legada)" },
] as const;

export function captureSourceFromSearch(search: string): CaptureSourceFilter | undefined {
  const value = new URLSearchParams(search).get("source");
  return CAPTURE_SOURCE_OPTIONS.some(([source]) => source === value)
    ? (value as CaptureSourceFilter)
    : undefined;
}

export function captureSourceLabel(source: string | null | undefined, notes?: string | null): string {
  if (!source) return "Origem não informada";
  if (source === "manual") {
    const lines = (notes ?? "").split(/\r?\n/).map((line) => line.trim().replace(/^[-•]\s*/, ""));
    const legacySource = LEGACY_SOURCE_MARKERS.find(({ marker }) =>
      lines.some((line) => line === `Origem do cadastro: ${marker}`),
    );
    if (legacySource) return legacySource.label;
  }
  return SOURCE_LABELS[source as CaptureSourceFilter] ?? source;
}
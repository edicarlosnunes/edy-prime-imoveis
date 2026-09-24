import { CAPTURE_SOURCE_OPTIONS, type CaptureSourceFilter } from "./capture-sources";

const STORAGE_KEY = "edy:capture-view";

export type CaptureViewState = {
  source: CaptureSourceFilter | undefined;
  search: string;
  city: string;
  selected: number | null;
  scrollY: number;
};

const emptyView = (): CaptureViewState => ({
  source: undefined,
  search: "",
  city: "",
  selected: null,
  scrollY: 0,
});

export function captureIdFromSearch(search: string): number | null {
  const raw = new URLSearchParams(search).get("capture");
  if (!raw || !/^[1-9]\d*$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}

export function parseCaptureView(raw: string | null): CaptureViewState {
  if (!raw) return emptyView();
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return emptyView();
    const view = value as Record<string, unknown>;
    return {
      source: CAPTURE_SOURCE_OPTIONS.some(([source]) => source === view.source)
        ? (view.source as CaptureSourceFilter)
        : undefined,
      search: typeof view.search === "string" ? view.search.slice(0, 120) : "",
      city: typeof view.city === "string" ? view.city.slice(0, 120) : "",
      selected: typeof view.selected === "number" && Number.isSafeInteger(view.selected) && view.selected > 0
        ? view.selected
        : null,
      scrollY: typeof view.scrollY === "number" && Number.isFinite(view.scrollY) && view.scrollY >= 0
        ? Math.min(view.scrollY, 10_000_000)
        : 0,
    };
  } catch {
    return emptyView();
  }
}

export function readCaptureView(): CaptureViewState {
  if (typeof window === "undefined") return emptyView();
  try {
    return parseCaptureView(window.sessionStorage.getItem(STORAGE_KEY));
  } catch {
    return emptyView();
  }
}

export function saveCaptureView(view: CaptureViewState): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(view));
  } catch {
    // Browsers that block storage can still use the page without restoration.
  }
}
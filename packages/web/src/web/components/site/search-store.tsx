/**
 * Estado da busca de imóveis do hero, compartilhado com a vitrine.
 *
 * Só front-end: nenhuma chamada nova de API. A lista completa de imóveis
 * publicados já vem de `properties.list`; aqui apenas filtramos em memória.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
/** Campos que a busca usa — compatível com o imóvel publicado da API. */
export interface SearchableProperty {
  purpose: string;
  city: string;
  district: string;
  type: string;
  bedrooms: number;
  price: number;
}

export interface SearchFilters {
  purpose: string;
  city: string;
  district: string;
  type: string;
  bedrooms: string;
  priceMax: string;
}

export const emptyFilters: SearchFilters = {
  purpose: "",
  city: "",
  district: "",
  type: "",
  bedrooms: "",
  priceMax: "",
};

interface SearchApi {
  filters: SearchFilters;
  applied: boolean;
  setFilter: (key: keyof SearchFilters, value: string) => void;
  apply: () => void;
  reset: () => void;
}

const SearchContext = createContext<SearchApi | null>(null);

export function SearchProvider({ children }: { children: ReactNode }) {
  const [filters, setFilters] = useState<SearchFilters>(emptyFilters);
  const [applied, setApplied] = useState(false);

  const setFilter = useCallback((key: keyof SearchFilters, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }));
  }, []);

  const apply = useCallback(() => setApplied(true), []);

  const reset = useCallback(() => {
    setFilters(emptyFilters);
    setApplied(false);
  }, []);

  const value = useMemo<SearchApi>(
    () => ({ filters, applied, setFilter, apply, reset }),
    [filters, applied, setFilter, apply, reset],
  );

  return <SearchContext.Provider value={value}>{children}</SearchContext.Provider>;
}

export function useSearch(): SearchApi {
  const context = useContext(SearchContext);
  if (context) return context;
  /* Fora do provider (ex.: página do imóvel) a busca simplesmente não existe. */
  return {
    filters: emptyFilters,
    applied: false,
    setFilter: () => {},
    apply: () => {},
    reset: () => {},
  };
}

export function hasAnyFilter(filters: SearchFilters) {
  return Object.values(filters).some((value) => value.trim() !== "");
}

const norm = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\̀-\ͯ]/g, "")
    .trim()
    .toLowerCase();

/** Aplica os filtros escolhidos sobre a lista real de imóveis publicados. */
export function filterProperties<T extends SearchableProperty>(list: T[], filters: SearchFilters): T[] {
  return list.filter((property) => {
    if (filters.purpose && norm(property.purpose) !== norm(filters.purpose)) return false;
    if (filters.city && norm(property.city) !== norm(filters.city)) return false;
    if (filters.district && norm(property.district) !== norm(filters.district)) return false;
    if (filters.type && norm(property.type) !== norm(filters.type)) return false;
    if (filters.bedrooms) {
      const min = Number(filters.bedrooms);
      if (Number.isFinite(min) && property.bedrooms < min) return false;
    }
    if (filters.priceMax) {
      const max = Number(filters.priceMax);
      /* price <= 0 é "sob consulta": nunca escondemos por causa de faixa de preço. */
      if (Number.isFinite(max) && property.price > 0 && property.price > max) return false;
    }
    return true;
  });
}

/** Opções dos selects montadas a partir dos dados reais — nada inventado. */
export function optionsFrom(list: SearchableProperty[]) {
  const collect = (pick: (property: SearchableProperty) => string) => {
    const seen = new Map<string, string>();
    for (const property of list) {
      const raw = (pick(property) ?? "").trim();
      if (!raw) continue;
      const key = norm(raw);
      if (!seen.has(key)) seen.set(key, raw);
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b, "pt-BR"));
  };

  return {
    purposes: collect((property) => property.purpose),
    cities: collect((property) => property.city),
    districts: collect((property) => property.district),
    types: collect((property) => property.type),
  };
}

import { useQuery } from "@tanstack/react-query";
import { orpc } from "../lib/api";

export function useProperties() {
  return useQuery(orpc.properties.list.queryOptions({ staleTime: 5 * 60_000 }));
}

/** Página individual do imóvel (/imovel/:slug). */
export function usePropertyDetail(slug: string) {
  return useQuery({
    ...orpc.properties.detail.queryOptions({ input: { slug } }),
    enabled: slug.length > 0,
    staleTime: 60_000,
  });
}

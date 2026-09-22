import { useQuery } from "@tanstack/react-query";
import { orpc } from "../lib/api";

/**
 * Conteúdo do site vindo do Editor do Site (/admin/editor).
 * `published` é público; `draft` só carrega em pré-visualização (exige login).
 */

export function usePublishedContent() {
  return useQuery(
    orpc.siteContent.get.queryOptions({ staleTime: 60_000, retry: false }),
  );
}

export function useDraftContent(enabled: boolean) {
  return useQuery({
    ...orpc.adminSite.state.queryOptions(),
    enabled,
    retry: false,
    staleTime: 0,
  });
}

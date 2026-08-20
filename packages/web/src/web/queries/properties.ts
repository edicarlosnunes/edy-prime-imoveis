import { useQuery } from "@tanstack/react-query";
import { orpc } from "../lib/api";

export function useProperties() {
  return useQuery(orpc.properties.list.queryOptions({ staleTime: 5 * 60_000 }));
}

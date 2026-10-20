import { useQuery } from "@tanstack/react-query";
import { orpc } from "../lib/api";
import { DEFAULT_PROPERTY_TYPES } from "../../shared/property-types";
export function usePropertyTypes() {
  const query = useQuery(orpc.siteConfig.propertyTypes.queryOptions({staleTime: 0}));
  const rows = query.data ?? DEFAULT_PROPERTY_TYPES;
  return {...query, rows, labels: Object.fromEntries(rows.map(row => [row.key,row.label]))};
}

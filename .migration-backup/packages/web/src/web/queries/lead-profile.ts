import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../lib/api";

/** Perfil de necessidade, timeline e score do lead (F4.1). */

export function useLeadProfile(leadId: number | null) {
  return useQuery({
    ...orpc.adminLeadProfile.get.queryOptions({ input: { leadId: leadId ?? 0 } }),
    enabled: leadId !== null,
  });
}

function useInvalidateLead() {
  const client = useQueryClient();
  return () => client.invalidateQueries();
}

export function useUpdateLeadProfile() {
  const invalidate = useInvalidateLead();
  return useMutation(orpc.adminLeadProfile.update.mutationOptions({ onSuccess: invalidate }));
}

export function useRecalcLeadScore() {
  const invalidate = useInvalidateLead();
  return useMutation(orpc.adminLeadProfile.recalc.mutationOptions({ onSuccess: invalidate }));
}

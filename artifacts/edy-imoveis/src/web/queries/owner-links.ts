import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../lib/api";

export function useAdminOwnerLinks(status?: "aguardando" | "iniciado" | "concluido") {
  return useQuery(orpc.adminOwnerIntakeLinks.list.queryOptions({ input: { status } }));
}

export function useCreateOwnerLink() {
  const queryClient = useQueryClient();
  return useMutation({
    ...orpc.adminOwnerIntakeLinks.create.mutationOptions(),
    onSuccess: () => {
      queryClient.invalidateQueries();
    }
  });
}

export function useOwnerLinkMetadata(token: string | null) {
  return useQuery({
    ...orpc.ownerIntakeLinks.metadata.queryOptions({ input: { token: token! } }),
    enabled: !!token,
    retry: false,
  });
}

export function useStartOwnerLink() {
  return useMutation(orpc.ownerIntakeLinks.started.mutationOptions());
}

export function useSubmitOwnerLink() {
  return useMutation(orpc.ownerIntakeLinks.submit.mutationOptions());
}
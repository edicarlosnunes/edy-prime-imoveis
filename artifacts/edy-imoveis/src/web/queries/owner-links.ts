import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../lib/api";

export type OwnerLinkStatus = "aguardando" | "iniciado" | "concluido" | "cancelado";

export function useAdminOwnerLinks(status?: OwnerLinkStatus) {
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

export function useOwnerLinkState(token: string | null) {
  return useQuery({
    ...orpc.ownerIntakeLinks.state.queryOptions({ input: { token: token! } }),
    enabled: !!token,
    retry: false,
  });
}

export function useOwnerLinkTurn() {
  const queryClient = useQueryClient();
  return useMutation({
    ...orpc.ownerIntakeLinks.turn.mutationOptions(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orpc.ownerIntakeLinks.state.key() });
      queryClient.refetchQueries({ queryKey: orpc.ownerIntakeLinks.state.key(), type: "active" });
    },
  });
}

export function useOwnerLinkFacade() {
  const queryClient = useQueryClient();
  return useMutation({
    ...orpc.ownerIntakeLinks.facade.mutationOptions(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orpc.ownerIntakeLinks.state.key() });
      queryClient.refetchQueries({ queryKey: orpc.ownerIntakeLinks.state.key(), type: "active" });
    },
  });
}

/** Cancellation is deliberately admin-scoped: the public token is never
 * reconstructed or sent from the central panel. */
export function useCancelOwnerLink() {
  const queryClient = useQueryClient();
  return useMutation({
    ...orpc.adminOwnerIntakeLinks.cancel.mutationOptions(),
    onSuccess: () => queryClient.invalidateQueries(),
  });
}

export function useCancelPublicOwnerLink() {
  const queryClient = useQueryClient();
  return useMutation({
    ...orpc.ownerIntakeLinks.cancel.mutationOptions(),
    onSuccess: () => queryClient.invalidateQueries(),
  });
}
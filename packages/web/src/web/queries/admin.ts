import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../lib/api";

/** Hooks do painel administrativo (todos passam pelo cliente tipado). */

export function useAdminMe() {
  return useQuery(orpc.adminAuth.me.queryOptions({ retry: false, staleTime: 30_000 }));
}

/* ------------------------------------------------------------- dashboard */

export function useDashboard() {
  return useQuery(orpc.adminDashboard.summary.queryOptions({ staleTime: 30_000 }));
}

/* --------------------------------------------------------------- imóveis */

export function useAdminProperties(filters?: {
  search?: string;
  status?: "disponivel" | "reservado" | "vendido" | "alugado";
  published?: boolean;
}) {
  return useQuery(orpc.adminProperties.list.queryOptions({ input: filters ?? {} }));
}

export function usePropertyOptions() {
  return useQuery(orpc.adminProperties.options.queryOptions({ staleTime: 60_000 }));
}

function useInvalidate() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries();
  };
}

export function useSaveProperty(mode: "create" | "update") {
  const invalidate = useInvalidate();
  const options =
    mode === "create"
      ? orpc.adminProperties.create.mutationOptions({ onSuccess: invalidate })
      : orpc.adminProperties.update.mutationOptions({ onSuccess: invalidate });
  return useMutation(options);
}

export function useRemoveProperty() {
  const invalidate = useInvalidate();
  return useMutation(orpc.adminProperties.remove.mutationOptions({ onSuccess: invalidate }));
}

export function useGeneratePropertyContent() {
  return useMutation(orpc.adminPropertyContent.generate.mutationOptions());
}

export function usePatchProperty() {
  const invalidate = useInvalidate();
  return useMutation(orpc.adminProperties.patch.mutationOptions({ onSuccess: invalidate }));
}

/* ----------------------------------------------------------------- leads */

export function useAdminLeads(filters?: { search?: string; status?: "aberto" | "perdido" | "ganho" }) {
  return useQuery(orpc.adminLeads.list.queryOptions({ input: filters ?? {} }));
}

export function useLead(id: number | null) {
  return useQuery({
    ...orpc.adminLeads.get.queryOptions({ input: { id: id ?? 0 } }),
    enabled: id !== null,
  });
}

export function useCreateLead() {
  const invalidate = useInvalidate();
  return useMutation(orpc.adminLeads.create.mutationOptions({ onSuccess: invalidate }));
}

export function useUpdateLead() {
  const invalidate = useInvalidate();
  return useMutation(orpc.adminLeads.update.mutationOptions({ onSuccess: invalidate }));
}

export function useSetLeadStage() {
  const invalidate = useInvalidate();
  return useMutation(orpc.adminLeads.setStage.mutationOptions({ onSuccess: invalidate }));
}

export function useMarkLeadLost() {
  const invalidate = useInvalidate();
  return useMutation(orpc.adminLeads.markLost.mutationOptions({ onSuccess: invalidate }));
}

export function useReopenLead() {
  const invalidate = useInvalidate();
  return useMutation(orpc.adminLeads.reopen.mutationOptions({ onSuccess: invalidate }));
}

export function useAddLeadNote() {
  const invalidate = useInvalidate();
  return useMutation(orpc.adminLeads.addNote.mutationOptions({ onSuccess: invalidate }));
}

export function useRemoveLead() {
  const invalidate = useInvalidate();
  return useMutation(orpc.adminLeads.remove.mutationOptions({ onSuccess: invalidate }));
}

/* -------------------------------------------------------------- clientes */

export function useAdminClients(search?: string) {
  return useQuery(orpc.adminClients.list.queryOptions({ input: { search } }));
}

export function useClient(id: number | null) {
  return useQuery({
    ...orpc.adminClients.get.queryOptions({ input: { id: id ?? 0 } }),
    enabled: id !== null,
  });
}

export function useClientOptions() {
  return useQuery(orpc.adminClients.options.queryOptions({ staleTime: 60_000 }));
}

export function useSaveClient(mode: "create" | "update") {
  const invalidate = useInvalidate();
  const options =
    mode === "create"
      ? orpc.adminClients.create.mutationOptions({ onSuccess: invalidate })
      : orpc.adminClients.update.mutationOptions({ onSuccess: invalidate });
  return useMutation(options);
}

export function useRemoveClient() {
  const invalidate = useInvalidate();
  return useMutation(orpc.adminClients.remove.mutationOptions({ onSuccess: invalidate }));
}

export function useAddClientInteraction() {
  const invalidate = useInvalidate();
  return useMutation(orpc.adminClients.addInteraction.mutationOptions({ onSuccess: invalidate }));
}

/* --------------------------------------------------------- proprietários */

export function useAdminOwners() {
  return useQuery(orpc.adminOwners.list.queryOptions());
}

export function useOwnerOptions() {
  return useQuery(orpc.adminOwners.options.queryOptions({ staleTime: 60_000 }));
}

export function useSaveOwner(mode: "create" | "update") {
  const invalidate = useInvalidate();
  const options =
    mode === "create"
      ? orpc.adminOwners.create.mutationOptions({ onSuccess: invalidate })
      : orpc.adminOwners.update.mutationOptions({ onSuccess: invalidate });
  return useMutation(options);
}

export function useRemoveOwner() {
  const invalidate = useInvalidate();
  return useMutation(orpc.adminOwners.remove.mutationOptions({ onSuccess: invalidate }));
}

/* --------------------------------------------------------------- agenda */

export function useAdminTasks() {
  return useQuery(orpc.adminTasks.list.queryOptions({ input: {} }));
}

export function useSaveTask(mode: "create" | "update") {
  const invalidate = useInvalidate();
  const options =
    mode === "create"
      ? orpc.adminTasks.create.mutationOptions({ onSuccess: invalidate })
      : orpc.adminTasks.update.mutationOptions({ onSuccess: invalidate });
  return useMutation(options);
}

export function useSetTaskStatus() {
  const invalidate = useInvalidate();
  return useMutation(orpc.adminTasks.setStatus.mutationOptions({ onSuccess: invalidate }));
}

export function useRemoveTask() {
  const invalidate = useInvalidate();
  return useMutation(orpc.adminTasks.remove.mutationOptions({ onSuccess: invalidate }));
}

/* ------------------------------------------------------------- propostas */

export function useAdminDeals() {
  return useQuery(orpc.adminDeals.list.queryOptions());
}

export function useSaveDeal(mode: "create" | "update") {
  const invalidate = useInvalidate();
  const options =
    mode === "create"
      ? orpc.adminDeals.create.mutationOptions({ onSuccess: invalidate })
      : orpc.adminDeals.update.mutationOptions({ onSuccess: invalidate });
  return useMutation(options);
}

export function useRemoveDeal() {
  const invalidate = useInvalidate();
  return useMutation(orpc.adminDeals.remove.mutationOptions({ onSuccess: invalidate }));
}

/* --------------------------------------------------------- configurações */

export function useAdminSettings() {
  return useQuery(orpc.adminSettings.get.queryOptions());
}

export function useSaveSettings() {
  const invalidate = useInvalidate();
  return useMutation(orpc.adminSettings.update.mutationOptions({ onSuccess: invalidate }));
}

export function useChangePassword() {
  return useMutation(orpc.adminAuth.changePassword.mutationOptions());
}

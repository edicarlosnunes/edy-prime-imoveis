import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../lib/api";

/** Hooks da Central de Integrações, portais, conversas, IA, automações e auditoria. */

function useInvalidate() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries();
  };
}

/* ---------------------------------------------------------- integrações */

export function useIntegrations() {
  return useQuery(orpc.adminIntegrations.list.queryOptions({ staleTime: 10_000 }));
}

export function useSaveIntegration() {
  const invalidate = useInvalidate();
  return useMutation(orpc.adminIntegrations.save.mutationOptions({ onSuccess: invalidate }));
}

export function useToggleIntegration() {
  const invalidate = useInvalidate();
  return useMutation(orpc.adminIntegrations.toggle.mutationOptions({ onSuccess: invalidate }));
}

export function useTestIntegration() {
  const invalidate = useInvalidate();
  return useMutation(orpc.adminIntegrations.test.mutationOptions({ onSuccess: invalidate }));
}

export function useConfirmPortal() {
  const invalidate = useInvalidate();
  return useMutation(orpc.adminIntegrations.confirmPortal.mutationOptions({ onSuccess: invalidate }));
}

export function useRotateWebhookToken() {
  const invalidate = useInvalidate();
  return useMutation(orpc.adminIntegrations.rotateToken.mutationOptions({ onSuccess: invalidate }));
}

export function useIntegrationEvents(key: string | null) {
  return useQuery({
    ...orpc.adminIntegrations.events.queryOptions({ input: { key: key ?? "" } }),
    enabled: Boolean(key),
  });
}

/* --------------------------------------------------------------- canais */

export function useChannelOverview() {
  return useQuery(orpc.adminChannels.overview.queryOptions({ staleTime: 15_000 }));
}

export function useChannelMatrix() {
  return useQuery(orpc.adminChannels.matrix.queryOptions({ staleTime: 15_000 }));
}

export function usePropertyChannels(propertyId: number | null) {
  return useQuery({
    ...orpc.adminChannels.forProperty.queryOptions({ input: { propertyId: propertyId ?? 0 } }),
    enabled: Boolean(propertyId),
  });
}

export function useSetChannelAuthorized() {
  const invalidate = useInvalidate();
  return useMutation(orpc.adminChannels.setAuthorized.mutationOptions({ onSuccess: invalidate }));
}

export function useBulkAuthorize() {
  const invalidate = useInvalidate();
  return useMutation(orpc.adminChannels.bulkAuthorize.mutationOptions({ onSuccess: invalidate }));
}

/* ------------------------------------------------------------ conversas */

export function useConversations(filters?: {
  status?: "aberta" | "fechada";
  mode?: "ia" | "humano";
  channel?: "whatsapp" | "instagram" | "facebook" | "site" | "teste";
}) {
  return useQuery(
    orpc.adminInbox.list.queryOptions({ input: filters ?? {}, refetchInterval: 20_000 }),
  );
}

export function useConversation(id: number | null) {
  return useQuery({
    ...orpc.adminInbox.get.queryOptions({ input: { id: id ?? 0 } }),
    enabled: Boolean(id),
  });
}

export function useTakeOver() {
  const invalidate = useInvalidate();
  return useMutation(orpc.adminInbox.takeOver.mutationOptions({ onSuccess: invalidate }));
}

export function useReturnToAi() {
  const invalidate = useInvalidate();
  return useMutation(orpc.adminInbox.returnToAi.mutationOptions({ onSuccess: invalidate }));
}

export function useSendMessage() {
  const invalidate = useInvalidate();
  return useMutation(orpc.adminInbox.send.mutationOptions({ onSuccess: invalidate }));
}

export function useCloseConversation() {
  const invalidate = useInvalidate();
  return useMutation(orpc.adminInbox.close.mutationOptions({ onSuccess: invalidate }));
}

export function useSimulateConversation() {
  const invalidate = useInvalidate();
  return useMutation(orpc.adminInbox.simulate.mutationOptions({ onSuccess: invalidate }));
}

export function useRemoveConversation() {
  const invalidate = useInvalidate();
  return useMutation(orpc.adminInbox.remove.mutationOptions({ onSuccess: invalidate }));
}

/* ---------------------------------------------------------- agentes IA */

export function useAgents() {
  return useQuery(orpc.adminAgents.list.queryOptions({ staleTime: 10_000 }));
}

export function useSaveAgent(mode: "create" | "update") {
  const invalidate = useInvalidate();
  return useMutation(
    mode === "create"
      ? orpc.adminAgents.create.mutationOptions({ onSuccess: invalidate })
      : orpc.adminAgents.update.mutationOptions({ onSuccess: invalidate }),
  );
}

export function useSetAgentActive() {
  const invalidate = useInvalidate();
  return useMutation(orpc.adminAgents.setActive.mutationOptions({ onSuccess: invalidate }));
}

export function useRemoveAgent() {
  const invalidate = useInvalidate();
  return useMutation(orpc.adminAgents.remove.mutationOptions({ onSuccess: invalidate }));
}

export function useTestAgent() {
  return useMutation(orpc.adminAgents.test.mutationOptions({}));
}

/* --------------------------------------------------------- automações */

export function useAutomations() {
  return useQuery(orpc.adminAutomations.list.queryOptions({ staleTime: 10_000 }));
}

export function useSaveAutomation(mode: "create" | "update") {
  const invalidate = useInvalidate();
  return useMutation(
    mode === "create"
      ? orpc.adminAutomations.create.mutationOptions({ onSuccess: invalidate })
      : orpc.adminAutomations.update.mutationOptions({ onSuccess: invalidate }),
  );
}

export function useSetAutomationActive() {
  const invalidate = useInvalidate();
  return useMutation(orpc.adminAutomations.setActive.mutationOptions({ onSuccess: invalidate }));
}

export function useRemoveAutomation() {
  const invalidate = useInvalidate();
  return useMutation(orpc.adminAutomations.remove.mutationOptions({ onSuccess: invalidate }));
}

export function useSweepAutomations() {
  const invalidate = useInvalidate();
  return useMutation(orpc.adminAutomations.sweep.mutationOptions({ onSuccess: invalidate }));
}

/* -------------------------------------------------------- marca d'água */

export function useWatermark() {
  return useQuery(orpc.adminWatermark.get.queryOptions({ staleTime: 10_000 }));
}

export function useSaveWatermark() {
  const invalidate = useInvalidate();
  return useMutation(orpc.adminWatermark.save.mutationOptions({ onSuccess: invalidate }));
}

export function useWatermarkQueue() {
  return useMutation(orpc.adminWatermark.queue.mutationOptions({}));
}

export function useApplyWatermarkResult() {
  return useMutation(orpc.adminWatermark.applyResult.mutationOptions({}));
}

export function useRestoreOriginal() {
  const invalidate = useInvalidate();
  return useMutation(orpc.adminWatermark.restore.mutationOptions({ onSuccess: invalidate }));
}

export function useRestorePropertyOriginals() {
  const invalidate = useInvalidate();
  return useMutation(orpc.adminWatermark.restoreProperty.mutationOptions({ onSuccess: invalidate }));
}

export function useSetPropertyWatermarkOff() {
  const invalidate = useInvalidate();
  return useMutation(orpc.adminWatermark.setPropertyOff.mutationOptions({ onSuccess: invalidate }));
}

/* ---------------------------------------------------------- auditoria */

export function useAuditLog(limit = 120) {
  return useQuery(orpc.adminAudit.list.queryOptions({ input: { limit }, staleTime: 10_000 }));
}

export function useAiDashboard() {
  return useQuery(orpc.adminAudit.aiDashboard.queryOptions({ staleTime: 15_000 }));
}

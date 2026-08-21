import { useMutation, useQuery } from "@tanstack/react-query";
import { orpc } from "../lib/api";

/** Chat público do site — hooks do widget (nada de orpc inline no componente). */

export function useChatStart(input: { token?: string; propertySlug?: string }, enabled: boolean) {
  return useQuery({
    ...orpc.siteChat.start.queryOptions({ input }),
    enabled,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

/** Histórico com polling: é assim que a resposta do corretor humano aparece. */
export function useChatHistory(token: string | null, enabled: boolean) {
  return useQuery({
    ...orpc.siteChat.history.queryOptions({ input: { token: token ?? "" } }),
    enabled: enabled && Boolean(token),
    refetchInterval: enabled ? 8000 : false,
    refetchOnWindowFocus: true,
  });
}

export function useChatSend() {
  return useMutation(orpc.siteChat.send.mutationOptions());
}

export function useChatIdentify() {
  return useMutation(orpc.siteChat.identify.mutationOptions());
}

export function useChatRequestHuman() {
  return useMutation(orpc.siteChat.requestHuman.mutationOptions());
}

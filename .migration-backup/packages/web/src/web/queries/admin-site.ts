import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../lib/api";

/** Hooks do Editor do Site e da biblioteca de mídia (todos protegidos por login). */

function useInvalidateSite() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: orpc.adminSite.key() });
    queryClient.invalidateQueries({ queryKey: orpc.siteContent.key() });
  };
}

export function useSiteState() {
  return useQuery(orpc.adminSite.state.queryOptions({ retry: false, staleTime: 0 }));
}

export function useSiteHistory() {
  return useQuery(orpc.adminSite.history.queryOptions({ retry: false }));
}

export function useSaveDraft() {
  const invalidate = useInvalidateSite();
  return useMutation(orpc.adminSite.saveDraft.mutationOptions({ onSuccess: invalidate }));
}

export function usePublishSite() {
  const invalidate = useInvalidateSite();
  return useMutation(orpc.adminSite.publish.mutationOptions({ onSuccess: invalidate }));
}

export function useRestoreVersion() {
  const invalidate = useInvalidateSite();
  return useMutation(orpc.adminSite.restore.mutationOptions({ onSuccess: invalidate }));
}

export function useDiscardDraft() {
  const invalidate = useInvalidateSite();
  return useMutation(orpc.adminSite.discardDraft.mutationOptions({ onSuccess: invalidate }));
}

/* --------------------------------------------------------------- mídia */

export function useMediaLibrary(search?: string) {
  return useQuery(orpc.adminMedia.list.queryOptions({ input: { search: search ?? "" } }));
}

function useInvalidateMedia() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: orpc.adminMedia.key() });
  };
}

export function useUpdateMedia() {
  const invalidate = useInvalidateMedia();
  return useMutation(orpc.adminMedia.update.mutationOptions({ onSuccess: invalidate }));
}

export function useRemoveMedia() {
  const invalidate = useInvalidateMedia();
  return useMutation(orpc.adminMedia.remove.mutationOptions({ onSuccess: invalidate }));
}

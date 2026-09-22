import { useMutation } from "@tanstack/react-query";
import { orpc } from "../lib/api";

/** Captação pública de proprietários (seção "Pensando em vender seu imóvel?"). */
export function useCreateOwner() {
  return useMutation(orpc.owners.create.mutationOptions());
}

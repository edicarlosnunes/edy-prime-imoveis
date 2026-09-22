import { useMutation } from "@tanstack/react-query";
import { orpc } from "../lib/api";

export function useCreateLead() {
  return useMutation(orpc.leads.create.mutationOptions());
}

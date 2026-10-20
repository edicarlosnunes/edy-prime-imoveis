/** A pending confirmation is informational; only a real failure is an error. */
export function tiktokResultStatus(state: string): "success" | "scheduled" | "processing" | "error" {
  if (state === "published") return "success";
  if (state === "scheduled") return "scheduled";
  if (state === "processing" || state === "sending") return "processing";
  return "error";
}

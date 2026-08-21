import { createGateway } from "ai";

export const gateway = createGateway({
  baseURL: process.env.AI_GATEWAY_BASE_URL,
  apiKey: process.env.AI_GATEWAY_API_KEY,
});

/* O modelo default vive em agent/model.ts (fonte única de verdade). */
export { FALLBACK_MODEL } from "./model";

export function gatewayConfigured() {
  return Boolean(process.env.AI_GATEWAY_BASE_URL && process.env.AI_GATEWAY_API_KEY);
}

import { createGateway } from "ai";
import { createGoogle } from "@ai-sdk/google";

const legacyGateway = createGateway({
  baseURL: process.env.AI_GATEWAY_BASE_URL,
  apiKey: process.env.AI_GATEWAY_API_KEY,
});

export type AIScope = "agent" | "content";

// Content generation can be enabled before the live WhatsApp agent. No model
// configuration is rewritten in the database and no paid fallback is implicit.
export function activeAIProvider(scope: AIScope = "agent") {
  const provider = (scope === "content" ? process.env.PROPERTY_AI_PROVIDER?.trim() : "")
    || process.env.AI_PROVIDER?.trim() || "gateway";
  if (provider !== "gateway" && provider !== "google") {
    throw new Error("Provedor de IA inválido: use gateway ou google.");
  }
  return provider;
}

export function effectiveModel(requested: string, scope: AIScope = "agent") {
  return activeAIProvider(scope) === "google" ? "gemini-3.5-flash-lite" : requested;
}

export function gateway(requested: string, scope: AIScope = "agent") {
  if (activeAIProvider(scope) !== "google") return legacyGateway(requested);
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim()) {
    throw new Error("A chave da Gemini não está disponível neste ambiente.");
  }
  return createGoogle({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY })(effectiveModel(requested, scope));
}

export { FALLBACK_MODEL } from "./model";

export function gatewayConfigured(scope: AIScope = "agent") {
  return activeAIProvider(scope) === "google"
    ? Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim())
    : Boolean(process.env.AI_GATEWAY_BASE_URL && process.env.AI_GATEWAY_API_KEY);
}

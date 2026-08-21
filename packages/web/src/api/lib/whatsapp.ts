/**
 * WhatsApp Cloud API (oficial da Meta). Nada de WhatsApp Web/scraping.
 * Sem credencial válida, nada é enviado — a função lança erro e o painel mostra.
 */
import type { ConfigMap } from "./integrations";

const GRAPH = "https://graph.facebook.com/v21.0";

export async function sendWhatsappText(config: ConfigMap, to: string, body: string) {
  const token = config.accessToken;
  const phoneNumberId = config.phoneNumberId;
  if (!token || !phoneNumberId) throw new Error("WhatsApp Cloud API sem credenciais");

  const response = await fetch(`${GRAPH}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: to.replace(/\D/g, ""),
      type: "text",
      text: { preview_url: false, body: body.slice(0, 4000) },
    }),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    error?: { message?: string };
    messages?: { id?: string }[];
  };
  if (!response.ok) throw new Error(payload.error?.message ?? `HTTP ${response.status}`);
  return payload.messages?.[0]?.id ?? null;
}

/** Resposta em Instagram Direct / Messenger (Graph API). */
export async function sendMetaMessage(
  config: ConfigMap,
  recipientId: string,
  body: string,
  platform: "instagram" | "facebook",
) {
  const token = config.pageToken;
  const senderId = platform === "instagram" ? config.igUserId : config.pageId;
  if (!token || !senderId) throw new Error("Token/ID da página não configurado");
  const response = await fetch(`${GRAPH}/${senderId}/messages`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: { text: body.slice(0, 1000) },
      messaging_type: "RESPONSE",
    }),
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message ?? `HTTP ${response.status}`);
  return true;
}

/** Validação da assinatura do webhook da Meta (X-Hub-Signature-256). */
export async function verifyMetaSignature(
  appSecret: string,
  rawBody: string,
  signatureHeader: string | null,
) {
  if (!appSecret) return { ok: false, reason: "App Secret não configurado" };
  if (!signatureHeader?.startsWith("sha256=")) {
    return { ok: false, reason: "Assinatura ausente" };
  }
  const expected = signatureHeader.slice("sha256=".length).toLowerCase();
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const digest = Array.from(new Uint8Array(mac), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
  if (digest.length !== expected.length) return { ok: false, reason: "Assinatura inválida" };
  let diff = 0;
  for (let i = 0; i < digest.length; i++) diff |= digest.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0 ? { ok: true, reason: "" } : { ok: false, reason: "Assinatura inválida" };
}

export interface IncomingWhatsapp {
  from: string;
  name: string | null;
  text: string;
  messageId: string | null;
}

/** Extrai as mensagens de texto do payload do webhook. */
export function parseWhatsappWebhook(payload: unknown): IncomingWhatsapp[] {
  const out: IncomingWhatsapp[] = [];
  const body = payload as {
    entry?: {
      changes?: {
        value?: {
          contacts?: { profile?: { name?: string }; wa_id?: string }[];
          messages?: {
            from?: string;
            id?: string;
            type?: string;
            text?: { body?: string };
          }[];
        };
      }[];
    }[];
  };
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      const contactName = value?.contacts?.[0]?.profile?.name ?? null;
      for (const message of value?.messages ?? []) {
        const isText = message.type ? message.type === "text" : Boolean(message.text?.body);
        if (!isText || !message.from) continue;
        out.push({
          from: message.from,
          name: contactName,
          text: message.text?.body ?? "",
          messageId: message.id ?? null,
        });
      }
    }
  }
  return out;
}

export interface IncomingMeta {
  platform: "instagram" | "facebook";
  senderId: string;
  text: string;
  messageId: string | null;
}

/** Mensagens de Instagram Direct / Messenger. */
export function parseMetaMessaging(payload: unknown): IncomingMeta[] {
  const out: IncomingMeta[] = [];
  const body = payload as {
    object?: string;
    entry?: {
      messaging?: {
        sender?: { id?: string };
        message?: { mid?: string; text?: string; is_echo?: boolean };
      }[];
    }[];
  };
  const platform = body.object === "instagram" ? "instagram" : "facebook";
  for (const entry of body.entry ?? []) {
    for (const event of entry.messaging ?? []) {
      if (!event.message?.text || event.message.is_echo) continue;
      if (!event.sender?.id) continue;
      out.push({
        platform,
        senderId: event.sender.id,
        text: event.message.text,
        messageId: event.message.mid ?? null,
      });
    }
  }
  return out;
}

/** Formulários de Lead Ads (campo leadgen). */
export interface IncomingLeadgen {
  leadgenId: string;
  formId: string | null;
  pageId: string | null;
  createdTime: number | null;
}

export function parseLeadgenWebhook(payload: unknown): IncomingLeadgen[] {
  const out: IncomingLeadgen[] = [];
  const body = payload as {
    entry?: {
      changes?: {
        field?: string;
        value?: {
          leadgen_id?: string;
          form_id?: string;
          page_id?: string;
          created_time?: number;
        };
      }[];
    }[];
  };
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "leadgen" || !change.value?.leadgen_id) continue;
      out.push({
        leadgenId: change.value.leadgen_id,
        formId: change.value.form_id ?? null,
        pageId: change.value.page_id ?? null,
        createdTime: change.value.created_time ?? null,
      });
    }
  }
  return out;
}

/** Busca os campos do lead na Graph API (exige token de página). */
export async function fetchLeadgen(leadgenId: string, pageToken: string) {
  const response = await fetch(
    `${GRAPH}/${leadgenId}?fields=field_data,created_time,campaign_name,adset_name,ad_name,form_id&access_token=${encodeURIComponent(pageToken)}`,
  );
  const payload = (await response.json().catch(() => ({}))) as {
    error?: { message?: string };
    field_data?: { name?: string; values?: string[] }[];
    campaign_name?: string;
    ad_name?: string;
  };
  if (!response.ok) throw new Error(payload.error?.message ?? `HTTP ${response.status}`);
  const fields: Record<string, string> = {};
  for (const item of payload.field_data ?? []) {
    if (item.name) fields[item.name] = (item.values ?? []).join(", ");
  }
  return { fields, campaign: payload.campaign_name ?? null, ad: payload.ad_name ?? null };
}

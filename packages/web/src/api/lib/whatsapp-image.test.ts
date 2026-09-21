import { describe, expect, test } from "bun:test";
import { basicWhatsappImageGate, parseWhatsappWebhook } from "./whatsapp";

describe("WhatsApp image safety gate", () => {
  test.each(["image/jpeg", "image/png", "image/webp"])("accepts supported image mime %s", (mime) => {
    expect(basicWhatsappImageGate(mime, 1024)).toEqual({ ok: true });
  });
  test("rejects document disguised as media", () => {
    expect(basicWhatsappImageGate("application/pdf", 1024).ok).toBe(false);
  });
  test("rejects oversized image", () => {
    expect(basicWhatsappImageGate("image/jpeg", 11 * 1024 * 1024).ok).toBe(false);
  });
  test("parser carries real WhatsApp image media id", () => {
    const payload = { entry: [{ changes: [{ value: {
      metadata: { display_phone_number: "5513997726767", phone_number_id: "123" },
      contacts: [{ profile: { name: "Teste" }, wa_id: "5513999999999" }],
      messages: [{ from: "5513999999999", id: "wamid.test", type: "image", image: { id: "media-1", mime_type: "image/jpeg" } }],
    } }] }] };
    const [message] = parseWhatsappWebhook(payload);
    expect(message?.mediaId).toBe("media-1");
    expect(message?.text).toBe("[imagem]");
  });
});

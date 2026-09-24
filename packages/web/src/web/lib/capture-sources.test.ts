import { describe, expect, test } from "bun:test";
import { captureSourceFromSearch, captureSourceLabel } from "./capture-sources";

describe("capture source filters", () => {
  test("reads persisted source identifiers from the admin query string", () => {
    expect(captureSourceFromSearch("?source=whatsapp")).toBe("whatsapp");
    expect(captureSourceFromSearch("source=link_captacao")).toBe("link_captacao");
    expect(captureSourceFromSearch("?tab=radar&source=site")).toBe("site");
  });

  test("ignores unsupported and absent source values", () => {
    expect(captureSourceFromSearch("?source=unknown")).toBeUndefined();
    expect(captureSourceFromSearch("")).toBeUndefined();
  });

  test("labels known, unknown, and missing source values truthfully", () => {
    expect(captureSourceLabel("manual")).toBe("Manual");
    expect(captureSourceLabel("whatsapp")).toBe("WhatsApp");
    expect(captureSourceLabel("link_captacao")).toBe("Link de captação");
    expect(captureSourceLabel("legacy-value")).toBe("legacy-value");
    expect(captureSourceLabel(null)).toBe("Origem não informada");
  });

  test("labels only exact structured notes markers on legacy manual rows", () => {
    expect(captureSourceLabel("manual", "- Origem do cadastro: LINK_CAPTACAO")).toBe(
      "Link de captação (origem legada)",
    );
    expect(captureSourceLabel("manual", "• Origem do cadastro: whatsapp\r\nMais detalhes")).toBe(
      "WhatsApp (origem legada)",
    );
    expect(captureSourceLabel("manual", "Observação: Origem do cadastro: whatsapp")).toBe("Manual");
    expect(captureSourceLabel("manual", "Origem do cadastro: WhatsApp")).toBe("Manual");
    expect(captureSourceLabel("site", "Origem do cadastro: whatsapp")).toBe("Site");
  });
});
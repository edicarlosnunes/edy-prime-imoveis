import { afterEach, describe, expect, test } from "bun:test";
import { downloadWhatsappMedia } from "./whatsapp";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("WhatsApp facade media", () => {
  test("retries a transient metadata failure and downloads the image", async () => {
    let metadataCalls = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("graph.facebook.com") && url.endsWith("/media-retry-test")) {
        metadataCalls++;
        if (metadataCalls === 1) {
          return new Response(JSON.stringify({ error: { message: "temporary" } }), {
            status: 503,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(
          JSON.stringify({
            url: "https://media.test/fachada.jpg",
            mime_type: "image/jpeg",
            file_size: 3,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url === "https://media.test/fachada.jpg") {
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "content-type": "image/jpeg" },
        });
      }
      throw new Error(`unexpected URL: ${url}`);
    }) as typeof fetch;

    const media = await downloadWhatsappMedia(
      { accessToken: "test-token" },
      "media-retry-test",
    );

    expect(metadataCalls).toBe(2);
    expect(media.mime).toBe("image/jpeg");
    expect(media.size).toBe(3);
    expect(media.data).toBe("AQID");
  });
});

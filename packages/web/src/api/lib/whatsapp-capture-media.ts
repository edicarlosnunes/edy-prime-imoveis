import { eq } from "drizzle-orm";
import * as schema from "../database/schema";
import { captureSnapshot } from "../agent/owner-capture";
import type { AdminDb } from "./admin-base";
import { addOwnerPhotos, serializeOwnerPhotos } from "./capture-photos";
import type { ConfigMap } from "./integrations";
import { downloadWhatsappImage } from "./whatsapp";

const MAX_CAPTURE_IMAGE_BYTES = 3 * 1024 * 1024;
const ALLOWED_CAPTURE_IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);

function randomHex(bytes = 12) {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(data, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary);
}

/**
 * Guarda a imagem recebida pelo WhatsApp como mídia interna e anexa a URL à
 * lista de fotos provisórias da captação em andamento. Nunca publica a foto.
 */
export async function storeWhatsappCaptureImage(
  db: AdminDb,
  config: ConfigMap,
  phone: string,
  mediaId: string,
) {
  const snapshot = await captureSnapshot(db, phone);
  const origin = String(
    (snapshot.answers as Record<string, string | undefined>).origem ?? "",
  ).trim().toUpperCase();
  /* Imagem fora de uma ficha LINK_CAPTACAO continua com o comportamento
     antigo do canal: não é tratada por este fluxo. */
  if (!snapshot.captureId || origin !== "LINK_CAPTACAO") return null;

  const file = await downloadWhatsappImage(config, mediaId);
  if (!ALLOWED_CAPTURE_IMAGE_MIME.has(file.mime)) {
    throw new Error(`Formato de imagem não suportado: ${file.mime || "desconhecido"}`);
  }
  if (file.size <= 0 || file.size > MAX_CAPTURE_IMAGE_BYTES) {
    throw new Error("Imagem acima do limite de 3 MB");
  }

  const id = randomHex(12);
  const url = `/api/media/${id}`;
  await db.insert(schema.media).values({
    id,
    mime: file.mime,
    size: file.size,
    data: toBase64(file.bytes),
    name: `whatsapp-${mediaId.slice(-12)}`,
    variant: "original",
    originalId: null,
  });

  try {
    const [capture] = await db
      .select({ ownerPhotos: schema.propertyCaptures.ownerPhotos })
      .from(schema.propertyCaptures)
      .where(eq(schema.propertyCaptures.id, snapshot.captureId))
      .limit(1);
    if (!capture) throw new Error("Captação não encontrada ao anexar a imagem");

    const next = addOwnerPhotos(
      capture.ownerPhotos,
      [{ url, caption: "Fachada enviada pelo proprietário via WhatsApp" }],
      { source: "proprietario" },
    );

    await db
      .update(schema.propertyCaptures)
      .set({
        ownerPhotos: serializeOwnerPhotos(next),
        updatedAt: new Date(),
      })
      .where(eq(schema.propertyCaptures.id, snapshot.captureId));

    return { url, captureId: snapshot.captureId, mime: file.mime, size: file.size };
  } catch (error) {
    await db.delete(schema.media).where(eq(schema.media.id, id));
    throw error;
  }
}

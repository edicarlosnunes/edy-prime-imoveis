/**
 * Único ponto do app com fetch manual: login, logout e upload de imagem
 * precisam de cookie de sessão / envio binário, que não passam pelo oRPC.
 */

export interface AdminUser {
  id: number;
  name: string;
  email: string;
  role: string;
}

async function readError(response: Response, fallback: string) {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? fallback;
  } catch {
    return fallback;
  }
}

export async function adminLogin(email: string, password: string): Promise<AdminUser> {
  const response = await fetch("/api/admin/login", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) throw new Error(await readError(response, "Não foi possível entrar"));
  const body = (await response.json()) as { user: AdminUser };
  return body.user;
}

export async function adminLogout() {
  await fetch("/api/admin/logout", { method: "POST", credentials: "include" });
}

const MAX_DIMENSION = 1600;
const MAX_BYTES = 3 * 1024 * 1024;

/** Redimensiona no navegador antes de enviar (limite do servidor é 3 MB). */
async function shrink(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/")) return file;
  if (file.type === "image/avif") return file;

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const alreadySmall = scale === 1 && file.size <= MAX_BYTES;
    if (alreadySmall) {
      bitmap.close();
      return file;
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((result) => resolve(result), "image/jpeg", 0.82);
    });
    return blob ?? file;
  } catch {
    return file;
  }
}

/** Envia a foto e devolve a URL pública (/api/media/:id). */
export async function uploadImage(file: File): Promise<string> {
  const blob = await shrink(file);
  if (blob.size > MAX_BYTES) throw new Error("Imagem muito grande, use um arquivo menor");

  const form = new FormData();
  const name = blob.type === "image/jpeg" && blob !== file ? "foto.jpg" : file.name;
  form.append("file", new File([blob], name, { type: blob.type || file.type }));

  const response = await fetch("/api/admin/upload", {
    method: "POST",
    credentials: "include",
    body: form,
  });
  if (!response.ok) throw new Error(await readError(response, "Falha ao enviar a imagem"));
  const body = (await response.json()) as { url: string };
  return body.url;
}

export function errorMessage(error: unknown, fallback = "Algo deu errado") {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return fallback;
}

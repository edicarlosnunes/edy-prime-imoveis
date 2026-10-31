/** Stage CRM images on public object storage so Meta does not depend on an API/database request. */
export async function prepareInstagramImage(
  imageUrl: string,
  siteOrigin: string,
  load: (id: string) => Promise<{ mime: string; data: string } | null>,
  store: (id: string, bytes: Uint8Array) => Promise<string>,
): Promise<string> {
  const url = new URL(imageUrl);
  const match = url.pathname.match(/^\/api\/media\/([a-f0-9]{8,64})$/);
  if (url.origin !== new URL(siteOrigin).origin || !match) return imageUrl;
  const row = await load(match[1]);
  if (!row) throw new Error('A imagem do Book não foi encontrada. Gere o Book novamente.');
  const binary = atob(row.data);
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  if (row.mime !== 'image/jpeg' || bytes.length < 3 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
    throw new Error('A imagem do Book precisa estar em JPEG. Gere o Book novamente.');
  }
  if (bytes.length > 8 * 1024 * 1024) throw new Error('A imagem do Book excede 8 MB.');
  return store(match[1], bytes);
}

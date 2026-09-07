/**
 * Fotos da captação: PROVISÓRIAS (do proprietário) x OFICIAIS (do anúncio).
 *
 * Módulo puro: nenhuma dependência de banco, upload ou request.
 *
 * Decisão de arquitetura (registrar no relatório): as fotos enviadas pelo
 * proprietário NÃO entram em `property_images`. Elas vivem na própria captação,
 * em `property_captures.owner_photos` (JSON), porque:
 *
 *  - uma captação ainda não tem imóvel, e `property_images.property_id` é NOT
 *    NULL — não haveria onde pendurá-las sem criar imóvel fantasma;
 *  - `property_images` é a fonte do que o SITE PÚBLICO mostra. Deixar foto de
 *    proprietário entrar ali significaria risco de publicar foto torta, com
 *    pessoa dentro ou sem autorização. A separação é física, não um flag;
 *  - a promoção para foto oficial é sempre um ato explícito do corretor
 *    (`promoteToOfficial`), nunca um efeito colateral da conversão.
 *
 * Por isso nada em `property_images` mudou: o site continua exibindo
 * exatamente o que já exibia.
 */

/** Uma foto provisória enviada/registrada pelo proprietário. */
export interface OwnerPhoto {
  /** URL servida por /api/media/:id ou link externo informado pelo dono. */
  url: string;
  /** Legenda opcional ("sala", "vista", "fachada"). */
  caption?: string | null;
  /** Quem trouxe a foto: o próprio dono pelo site, ou a equipe pelo CRM. */
  source: "proprietario" | "equipe";
  /** ISO 8601. Guardado como texto para o JSON não depender de Date. */
  addedAt: string;
}

/** Rótulo fixo de tela — a UI nunca deve inventar outro. */
export const PROVISIONAL_LABEL = "FOTOS DO PROPRIETÁRIO / PROVISÓRIAS";
export const OFFICIAL_LABEL = "FOTOS OFICIAIS / APROVADAS PARA PUBLICAÇÃO";

/** Limite defensivo: o campo é JSON em uma coluna de texto. */
export const MAX_OWNER_PHOTOS = 30;

const cleanUrl = (value: unknown): string => {
  const url = typeof value === "string" ? value.trim() : "";
  if (!url || url.length > 600) return "";
  // Só caminhos internos e http(s). Bloqueia javascript:, data:, file:.
  if (url.startsWith("/")) return url;
  if (/^https?:\/\//i.test(url)) return url;
  return "";
};

/** Lê o JSON da coluna. Conteúdo inválido nunca derruba a ficha: vira lista vazia. */
export function parseOwnerPhotos(raw: string | null | undefined): OwnerPhoto[] {
  if (!raw || typeof raw !== "string") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const photos: OwnerPhoto[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const url = cleanUrl(row.url);
    if (!url) continue;
    if (photos.some((photo) => photo.url === url)) continue;
    photos.push({
      url,
      caption: typeof row.caption === "string" && row.caption.trim() ? row.caption.trim().slice(0, 200) : null,
      source: row.source === "equipe" ? "equipe" : "proprietario",
      addedAt: typeof row.addedAt === "string" && row.addedAt ? row.addedAt : new Date(0).toISOString(),
    });
    if (photos.length >= MAX_OWNER_PHOTOS) break;
  }
  return photos;
}

/** Serializa para a coluna. Lista vazia grava NULL, não "[]". */
export function serializeOwnerPhotos(photos: OwnerPhoto[]): string | null {
  if (!photos.length) return null;
  return JSON.stringify(photos.slice(0, MAX_OWNER_PHOTOS));
}

/**
 * Acrescenta fotos provisórias, sem duplicar URL e respeitando o teto.
 * Não substitui a lista: foto de proprietário nunca some sozinha.
 */
export function addOwnerPhotos(
  current: string | null | undefined,
  incoming: Array<{ url: string; caption?: string | null }>,
  options: { source?: OwnerPhoto["source"]; now?: Date } = {},
): OwnerPhoto[] {
  const source = options.source ?? "proprietario";
  const addedAt = (options.now ?? new Date()).toISOString();
  const photos = parseOwnerPhotos(current);

  for (const item of incoming) {
    if (photos.length >= MAX_OWNER_PHOTOS) break;
    const url = cleanUrl(item?.url);
    if (!url) continue;
    if (photos.some((photo) => photo.url === url)) continue;
    photos.push({
      url,
      caption: item.caption?.trim().slice(0, 200) || null,
      source,
      addedAt,
    });
  }
  return photos;
}

/** Remove uma foto provisória pela URL. */
export function removeOwnerPhoto(current: string | null | undefined, url: string): OwnerPhoto[] {
  return parseOwnerPhotos(current).filter((photo) => photo.url !== url);
}

export interface OfficialPhoto {
  url: string;
  sortOrder: number;
  isPrimary: number;
}

/**
 * Converte fotos provisórias ESCOLHIDAS em fotos oficiais do imóvel.
 *
 * `chosen` é a lista de URLs que o corretor aprovou. Nada entra sem estar
 * nessa lista — passar lista vazia devolve lista vazia, que é exatamente o
 * comportamento na conversão automática: nenhuma foto do dono vira oficial
 * sozinha. A capa é a primeira aprovada, salvo indicação explícita.
 */
export function promoteToOfficial(
  current: string | null | undefined,
  chosen: string[],
  options: { startOrder?: number; primaryUrl?: string | null } = {},
): OfficialPhoto[] {
  const photos = parseOwnerPhotos(current);
  const wanted = chosen.map((url) => cleanUrl(url)).filter(Boolean);
  const approved = wanted.filter((url) => photos.some((photo) => photo.url === url));

  const startOrder = options.startOrder ?? 0;
  const primaryUrl = options.primaryUrl && approved.includes(cleanUrl(options.primaryUrl))
    ? cleanUrl(options.primaryUrl)
    : approved[0] ?? null;

  return approved.map((url, index) => ({
    url,
    sortOrder: startOrder + index,
    isPrimary: url === primaryUrl ? 1 : 0,
  }));
}

/** Resumo para a ficha: quantas provisórias, quantas oficiais. */
export function photoSummary(current: string | null | undefined, officialCount: number) {
  const provisional = parseOwnerPhotos(current).length;
  return {
    provisional,
    official: officialCount,
    provisionalLabel: PROVISIONAL_LABEL,
    officialLabel: OFFICIAL_LABEL,
    /** Publicar exige foto oficial: provisória nunca conta como aprovada. */
    readyToPublish: officialCount > 0,
  };
}

/**
 * Composição da marca d'água no navegador (canvas).
 *
 * A original nunca é sobrescrita: aqui só geramos um NOVO arquivo a partir da
 * foto de origem. Quem grava o resultado é a rota adminWatermark.applyResult,
 * que mantém `original_url` apontando para a foto sem marca.
 */

export interface WatermarkConfig {
  logoUrl: string;
  /** largura da marca em % da largura da foto */
  size: number;
  /** 0-100 */
  opacity: number;
  /** margem em % da largura da foto */
  margin: number;
  position:
    | "top-left"
    | "top-center"
    | "top-right"
    | "center"
    | "bottom-left"
    | "bottom-center"
    | "bottom-right";
}

async function loadImage(url: string) {
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) throw new Error(`Não foi possível ler a imagem (${response.status})`);
  const blob = await response.blob();
  return createImageBitmap(blob);
}

function place(
  position: WatermarkConfig["position"],
  canvas: { width: number; height: number },
  mark: { width: number; height: number },
  margin: number,
) {
  const left = margin;
  const centerX = (canvas.width - mark.width) / 2;
  const right = canvas.width - mark.width - margin;
  const top = margin;
  const centerY = (canvas.height - mark.height) / 2;
  const bottom = canvas.height - mark.height - margin;

  switch (position) {
    case "top-left":
      return { x: left, y: top };
    case "top-center":
      return { x: centerX, y: top };
    case "top-right":
      return { x: right, y: top };
    case "center":
      return { x: centerX, y: centerY };
    case "bottom-left":
      return { x: left, y: bottom };
    case "bottom-center":
      return { x: centerX, y: bottom };
    default:
      return { x: right, y: bottom };
  }
}

/** Devolve um JPEG com a marca aplicada sobre a foto de origem. */
export async function composeWatermark(sourceUrl: string, config: WatermarkConfig): Promise<Blob> {
  const [photo, logo] = await Promise.all([loadImage(sourceUrl), loadImage(config.logoUrl)]);

  const canvas = document.createElement("canvas");
  canvas.width = photo.width;
  canvas.height = photo.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Navegador sem suporte a canvas");

  ctx.drawImage(photo, 0, 0);

  const markWidth = Math.max(24, Math.round((config.size / 100) * photo.width));
  const markHeight = Math.round((logo.height / logo.width) * markWidth);
  const margin = Math.round((config.margin / 100) * photo.width);
  const { x, y } = place(config.position, canvas, { width: markWidth, height: markHeight }, margin);

  ctx.globalAlpha = Math.min(1, Math.max(0.1, config.opacity / 100));
  ctx.drawImage(logo, x, y, markWidth, markHeight);
  ctx.globalAlpha = 1;

  photo.close();
  logo.close();

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((result) => resolve(result), "image/jpeg", 0.9);
  });
  if (!blob) throw new Error("Falha ao gerar a imagem com marca d'água");
  return blob;
}

/** Prévia local (data URL) para a tela de configuração. */
export async function previewWatermark(sourceUrl: string, config: WatermarkConfig) {
  const blob = await composeWatermark(sourceUrl, config);
  return URL.createObjectURL(blob);
}

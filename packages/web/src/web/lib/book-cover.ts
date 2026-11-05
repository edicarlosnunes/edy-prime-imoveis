type CoverInput = {
  photos: string[];
  headline: string;
  location: string;
  info: string;
  price: string;
  previousPrice?: string | null;
  accent: string;
};

async function image(url: string) {
  const result = new Image();
  result.crossOrigin = "anonymous";
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("A foto da capa demorou para carregar. Tente novamente.")), 15000);
    result.onload = () => { window.clearTimeout(timeout); resolve(); };
    result.onerror = () => { window.clearTimeout(timeout); reject(new Error("Não foi possível carregar uma foto da capa.")); };
    result.src = url;
  });
  return result;
}

function photo(ctx: CanvasRenderingContext2D, source: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const scale = Math.max(w / source.naturalWidth, h / source.naturalHeight);
  const sw = w / scale, sh = h / scale;
  ctx.drawImage(source, (source.naturalWidth - sw) / 2, (source.naturalHeight - sh) / 2, sw, sh, x, y, w, h);
}

function fitted(ctx: CanvasRenderingContext2D, text: string, size: number, x: number, y: number, width: number, weight = 500) {
  while (size > 18) {
    ctx.font = `${weight} ${size}px Arial`;
    if (ctx.measureText(text).width <= width) break;
    size -= 1;
  }
  ctx.fillText(text, x, y, width);
}

/** One renderer for the preview, JPEG export and first video frame. Uses only real property photos. */
export async function buildPremiumCover(input: CoverInput) {
  if (!input.photos.length) throw new Error("Cadastre ao menos uma foto para gerar a capa.");
  const photos = await Promise.all(input.photos.slice(0, 3).map(image));
  const logo = await image("/esantos-logo-transparente.png");
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1080;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Seu navegador não conseguiu preparar a capa.");
  ctx.fillStyle = "#F2F0EB";
  ctx.fillRect(0, 0, 1080, 1080);
  // A generous main photograph, with two supporting photographs when available.
  photo(ctx, photos[0], 0, 0, photos.length > 1 ? 756 : 1080, 630);
  if (photos.length > 1) {
    photo(ctx, photos[1], 764, 0, 316, photos.length > 2 ? 311 : 630);
    if (photos[2]) photo(ctx, photos[2], 764, 319, 316, 311);
  }
  ctx.fillStyle = input.accent;
  ctx.fillRect(0, 630, 1080, 7);
  ctx.drawImage(logo, 46, 42, 104, 104);
  ctx.fillStyle = "#38332A";
  const words = input.headline.trim().split(/\s+/);
  let lines: string[] = [], line = "", size = 52;
  // Fit the entire headline into two lines instead of dropping words.
  do {
    ctx.font = `700 ${size}px Arial`;
    lines = []; line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width > 964 && line) { lines.push(line); line = word; }
      else line = next;
    }
    if (line) lines.push(line);
    if (lines.length <= 2) break;
    size -= 2;
  } while (size > 24);
  lines.slice(0, 2).forEach((value, i) => fitted(ctx, value, size, 58, 710 + i * 60, 964, 700));
  ctx.fillStyle = "#625D54";
  fitted(ctx, input.location, 29, 58, 818, 964);
  if (input.previousPrice) {
    fitted(ctx, `De ${input.previousPrice}`, 27, 58, 868, 964);
    const width = ctx.measureText(`De ${input.previousPrice}`).width;
    ctx.strokeStyle = "#625D54";
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(58, 859); ctx.lineTo(58 + width, 859); ctx.stroke();
  }
  ctx.fillStyle = "#825F21";
  fitted(ctx, `${input.previousPrice ? "Por " : ""}${input.price}`, 58, 58, 939, 964, 700);
  ctx.fillStyle = "#D2CABC";
  ctx.fillRect(58, 969, 964, 1);
  ctx.fillStyle = "#38332A";
  fitted(ctx, input.info, 30, 58, 1027, 964, 600);
  return canvas;
}

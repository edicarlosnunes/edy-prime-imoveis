/** Load the existing transparent brand; no solid background is added. */
export function loadBookWatermark(): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timer = setTimeout(() => { clean(); reject(new Error("A marca d’água demorou para carregar. Tente gerar o vídeo novamente.")); }, 15000);
    const clean = () => { clearTimeout(timer); image.onload = null; image.onerror = null; };
    image.onload = () => { clean(); resolve(image); };
    image.onerror = () => { clean(); reject(new Error("Não foi possível carregar a marca d’água. Nenhum vídeo foi gerado.")); };
    image.src = "/esantos-logo-transparente.png";
  });
}

/** Runs after every frame: cover, original footage, gallery and closing slide. */
export function drawBookWatermark(ctx: CanvasRenderingContext2D, image: HTMLImageElement, frameWidth: number, contentTop: number) {
  const width = frameWidth * 0.18;
  const height = width * image.naturalHeight / image.naturalWidth;
  const margin = frameWidth * 0.035;
  ctx.save();
  ctx.globalAlpha = 0.72;
  // Retain the PNG alpha while making the gold artwork black. A fine light edge
  // keeps the black mark visible over dark footage without adding a backdrop.
  ctx.filter = "brightness(0) drop-shadow(0px 0px 1px rgba(255,255,255,.9))";
  ctx.drawImage(image, frameWidth - width - margin, contentTop + margin, width, height);
  ctx.restore();
}

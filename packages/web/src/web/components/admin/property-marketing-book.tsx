import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Download,
  Film,
  Image as ImageIcon,
  Loader2,
  MessageCircle,
  Play,
  Send,
  Sparkles,
} from "lucide-react";
import { orpc } from "../../lib/api";
import { Badge, Btn } from "./ui";

type ThemeKey = "ouro" | "azul" | "oliva" | "claro";
type VideoRow = { kind?: string; url?: string };
type Theme = { label: string; accent: string; ink: string; surface: string; overlay: string };
type DemoStep =
  | { kind: "cover"; label: string }
  | { kind: "video"; label: string; url: string }
  | { kind: "photo"; label: string; url: string }
  | { kind: "cta"; label: string };
type SocialTarget = "instagram" | "facebook" | "youtube" | "other";
type ChannelResult = { status: "success" | "error" | "pending"; message: string };

const ESANTOS_LOGO = "/esantos-logo.png";

const THEMES: Record<ThemeKey, Theme> = {
  ouro: { label: "Ouro premium", accent: "#D1A24B", ink: "#FFF8EA", surface: "#20150D", overlay: "rgba(21,12,7,.76)" },
  azul: { label: "Azul executivo", accent: "#D7B56D", ink: "#F7F3EA", surface: "#0C1B2B", overlay: "rgba(7,20,34,.78)" },
  oliva: { label: "Oliva sofisticado", accent: "#D8BE7A", ink: "#FFFDF4", surface: "#253027", overlay: "rgba(23,35,26,.78)" },
  claro: { label: "Clean premium", accent: "#8A6329", ink: "#1B1712", surface: "#F3EEE4", overlay: "rgba(244,239,229,.88)" },
};

function money(value: number | null | undefined) {
  if (!value) return "Consulte o valor";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(value);
}

function formatInfo(label: string, value: number | string | null | undefined) {
  const text = String(value ?? "").trim();
  return text && text !== "0" ? `${text} ${label}` : null;
}

function shortenDescription(value: string | null | undefined, max = 720) {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "Conheça todos os detalhes deste imóvel e fale com a E. Santos para receber atendimento e mais informações.";
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSentence = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return `${(lastSentence > max * 0.55 ? cut.slice(0, lastSentence + 1) : cut).trim()}…`;
}

function cropImage(ctx: CanvasRenderingContext2D, image: HTMLImageElement, width: number, height: number) {
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const sourceWidth = width / scale;
  const sourceHeight = height / scale;
  const sx = Math.max(0, (image.naturalWidth - sourceWidth) / 2);
  const sy = Math.max(0, (image.naturalHeight - sourceHeight) / 2);
  ctx.drawImage(image, sx, sy, sourceWidth, sourceHeight, 0, 0, width, height);
}

function drawContainedImage(ctx: CanvasRenderingContext2D, image: HTMLImageElement, x: number, y: number, maxWidth: number, maxHeight: number) {
  const scale = Math.min(maxWidth / image.naturalWidth, maxHeight / image.naturalHeight);
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  ctx.drawImage(image, x, y, width, height);
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number, maxLines: number) {
  const words = text.trim().split(/\s+/);
  let line = "";
  let lineNo = 0;
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && line) {
      ctx.fillText(line, x, y + lineNo * lineHeight);
      lineNo += 1;
      if (lineNo >= maxLines) return;
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line && lineNo < maxLines) ctx.fillText(line, x, y + lineNo * lineHeight);
}

async function loadImage(url: string) {
  const image = new Image();
  image.crossOrigin = "anonymous";
  const loaded = new Promise<HTMLImageElement>((resolve, reject) => {
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Não foi possível carregar uma imagem do Book."));
  });
  image.src = url;
  return loaded;
}

function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Não foi possível gerar a arte do Book.")), "image/jpeg", 0.92);
  });
}

async function buildSocialPhotoCanvas(url: string) {
  const image = await loadImage(url);
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1080;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Seu navegador não conseguiu preparar uma foto para publicação.");
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, 1080, 1080);
  cropImage(ctx, image, 1080, 1080);
  return canvas;
}

async function uploadBookAsset(canvas: HTMLCanvasElement, name: string) {
  const blob = await canvasBlob(canvas);
  const form = new FormData();
  const jpegName = name.replace(/\.(png|webp|avif|jpeg)$/i, ".jpg");
  form.append("file", new File([blob], jpegName, { type: "image/jpeg" }));
  const response = await fetch("/api/admin/upload", { method: "POST", credentials: "same-origin", body: form });
  const payload = await response.json().catch(() => ({})) as { url?: string; error?: string };
  if (!response.ok || !payload.url) throw new Error(payload.error || "Não foi possível salvar a arte do Book.");
  return new URL(payload.url, window.location.origin).toString();
}

async function responseError(response: Response, fallback: string) {
  const payload = await response.json().catch(() => ({})) as { error?: string; message?: string };
  return payload.error || payload.message || fallback;
}

function YoutubePlayBadge({ large = false }: { large?: boolean }) {
  return (
    <span className={`absolute left-1/2 top-[42%] flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-[10px] bg-[#FF0000] shadow-xl ${large ? "h-12 w-[70px]" : "h-10 w-[58px]"}`}>
      <Play className={`${large ? "h-6 w-6" : "h-5 w-5"} fill-white text-white`} />
    </span>
  );
}

function BrandLogo({ className = "" }: { className?: string }) {
  return <img src={ESANTOS_LOGO} alt="E. Santos Gestor Imobiliário" className={`pointer-events-none object-contain ${className}`} />;
}

export function PropertyMarketingBook({ propertyId }: { propertyId: number | null }) {
  const [themeKey, setThemeKey] = useState<ThemeKey>("ouro");
  const [shortVideoUrl, setShortVideoUrl] = useState<string | null>(null);
  const [customCoverUrl, setCustomCoverUrl] = useState<string | null>(null);
  const [uploadingCustomCover, setUploadingCustomCover] = useState(false);
  const [demoIndex, setDemoIndex] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [targets, setTargets] = useState<Record<SocialTarget, boolean>>({ instagram: false, facebook: false, youtube: false, other: false });
  const [otherTarget, setOtherTarget] = useState("");
  const [channelResults, setChannelResults] = useState<Partial<Record<SocialTarget, ChannelResult>>>({});

  const detail = useQuery({
    ...orpc.adminProperties.get.queryOptions({ input: { id: propertyId ?? 0 } }),
    enabled: propertyId !== null,
  });

  useEffect(() => {
    setDemoIndex(0);
    setChannelResults({});
    if (propertyId === null) {
      setShortVideoUrl(null);
      setCustomCoverUrl(null);
      return;
    }
    const storageKey = `esantos-book-custom-cover-${propertyId}`;
    setCustomCoverUrl(window.localStorage.getItem(storageKey));
    let alive = true;
    void fetch(`/api/admin/property-videos/${propertyId}`, { credentials: "same-origin" })
      .then(async (response) => response.ok ? response.json() as Promise<{ videos?: VideoRow[] }> : { videos: [] as VideoRow[] })
      .then((payload) => {
        const short = payload.videos?.find((video) => video.kind === "short_social");
        if (alive) {
          setShortVideoUrl(short?.url ?? null);
          if (!short?.url) setTargets((current) => ({ ...current, youtube: false }));
        }
      })
      .catch(() => {
        if (alive) {
          setShortVideoUrl(null);
          setTargets((current) => ({ ...current, youtube: false }));
        }
      });
    return () => { alive = false; };
  }, [propertyId]);

  const property = detail.data;
  const images = property?.images ?? [];
  const primary = useMemo(() => images.find((image) => image.isPrimary === 1) ?? images[0] ?? null, [images]);
  const shortReady = Boolean(shortVideoUrl);
  const maxPhotos = shortReady ? 7 : 8;
  const bookPhotos = useMemo(() => images.slice(0, maxPhotos), [images, maxPhotos]);
  const theme = THEMES[themeKey];
  const headline = (property?.highlight || property?.title || "Imóvel em destaque").trim();
  const priceText = money(property?.opportunityPrice ?? property?.price);
  const info = [
    formatInfo("dorm.", property?.bedrooms),
    formatInfo("suíte", property?.suites),
    formatInfo("vaga", property?.parking),
    formatInfo("m²", property?.areaUtil),
  ].filter(Boolean).join(" · ");
  const location = [property?.district, property?.city].filter(Boolean).join(" · ");
  const whatsappMessage = encodeURIComponent(`Olá! Vi o imóvel ${property?.title || "que vocês anunciaram"}${property?.code ? ` (código ${property.code})` : ""} e gostaria de receber mais informações.`);
  const whatsappUrl = `https://wa.me/5513997726767?text=${whatsappMessage}`;
  const selectedCount = Object.values(targets).filter(Boolean).length;

  const demoSteps = useMemo<DemoStep[]>(() => {
    const steps: DemoStep[] = [{ kind: "cover", label: customCoverUrl ? "Capa personalizada" : "Capa premium E. Santos" }];
    if (shortVideoUrl) steps.push({ kind: "video", label: "Vídeo curto", url: shortVideoUrl });
    for (const [index, image] of bookPhotos.entries()) {
      steps.push({ kind: "photo", label: `Foto ${images.indexOf(image) + 1}`, url: image.url });
    }
    steps.push({ kind: "cta", label: "Contato + CTA" });
    return steps.slice(0, 10);
  }, [bookPhotos, customCoverUrl, images, shortVideoUrl]);

  const mediaCount = demoSteps.length;
  const currentDemo = demoSteps[Math.min(demoIndex, Math.max(0, demoSteps.length - 1))] ?? null;

  useEffect(() => {
    if (currentDemo?.kind !== "photo") return;
    const timer = window.setTimeout(() => setDemoIndex((current) => Math.min(demoSteps.length - 1, current + 1)), 2200);
    return () => window.clearTimeout(timer);
  }, [currentDemo, demoSteps.length]);

  async function handleCustomCover(file: File | null) {
    if (!file || !propertyId) return;
    if (!file.type.startsWith("image/")) {
      setError("Escolha uma imagem para a capa personalizada.");
      return;
    }
    setUploadingCustomCover(true);
    setError(null);
    const temporaryUrl = URL.createObjectURL(file);
    try {
      const canvas = await buildSocialPhotoCanvas(temporaryUrl);
      const savedUrl = await uploadBookAsset(canvas, `book-${property?.code || propertyId}-capa-personalizada.jpg`);
      window.localStorage.setItem(`esantos-book-custom-cover-${propertyId}`, savedUrl);
      setCustomCoverUrl(savedUrl);
      setDemoIndex(0);
      setChannelResults({});
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível salvar a capa personalizada.");
    } finally {
      URL.revokeObjectURL(temporaryUrl);
      setUploadingCustomCover(false);
    }
  }

  function removeCustomCover() {
    if (!propertyId) return;
    window.localStorage.removeItem(`esantos-book-custom-cover-${propertyId}`);
    setCustomCoverUrl(null);
    setDemoIndex(0);
    setChannelResults({});
  }

  async function buildCoverCanvas() {
    if (customCoverUrl) return buildSocialPhotoCanvas(customCoverUrl);
    if (!primary?.url || !property) throw new Error("Cadastre ao menos uma foto para gerar a capa premium.");
    const image = await loadImage(primary.url);
    const canvas = document.createElement("canvas");
    canvas.width = 1080;
    canvas.height = 1080;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Seu navegador não conseguiu preparar a capa.");
    cropImage(ctx, image, 1080, 1080);
    const gradient = ctx.createLinearGradient(0, 330, 0, 1080);
    gradient.addColorStop(0, "rgba(0,0,0,0.02)");
    gradient.addColorStop(0.52, theme.overlay);
    gradient.addColorStop(1, theme.surface);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 1080, 1080);
    if (shortReady) {
      ctx.fillStyle = "rgba(0,0,0,.68)";
      ctx.fillRect(64, 575, 430, 62);
      ctx.strokeStyle = theme.accent;
      ctx.lineWidth = 2;
      ctx.strokeRect(64, 575, 430, 62);
      ctx.fillStyle = theme.accent;
      ctx.font = "700 23px Arial";
      ctx.fillText("▶  VÍDEO NO PRÓXIMO SLIDE", 88, 615);
    }
    ctx.fillStyle = theme.ink;
    ctx.font = "700 57px Arial";
    wrapText(ctx, headline, 64, 710, 900, 66, 3);
    ctx.fillStyle = theme.accent;
    ctx.font = "700 43px Arial";
    ctx.fillText(priceText, 64, 930);
    ctx.fillStyle = theme.ink;
    ctx.font = "500 27px Arial";
    if (location) ctx.fillText(location, 64, 980);
    if (info) ctx.fillText(info, 64, 1025);
    return canvas;
  }

  async function buildCtaCanvas() {
    if (!property) throw new Error("Imóvel não carregado.");
    const logo = await loadImage(ESANTOS_LOGO);
    const canvas = document.createElement("canvas");
    canvas.width = 1080;
    canvas.height = 1080;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Seu navegador não conseguiu preparar o encerramento.");

    const bg = ctx.createRadialGradient(790, 510, 60, 560, 520, 780);
    bg.addColorStop(0, "#4a2a09");
    bg.addColorStop(0.42, "#241205");
    bg.addColorStop(1, "#090503");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 1080, 1080);

    const topGlow = ctx.createLinearGradient(0, 0, 1080, 0);
    topGlow.addColorStop(0, "rgba(242,181,54,.06)");
    topGlow.addColorStop(0.45, "rgba(255,210,90,.18)");
    topGlow.addColorStop(1, "rgba(242,181,54,.03)");
    ctx.fillStyle = topGlow;
    ctx.fillRect(0, 0, 1080, 170);

    ctx.save();
    ctx.globalAlpha = 0.34;
    ctx.globalCompositeOperation = "screen";
    drawContainedImage(ctx, logo, 480, 185, 590, 610);
    ctx.restore();

    const gold = ctx.createLinearGradient(0, 0, 650, 0);
    gold.addColorStop(0, "#F4D987");
    gold.addColorStop(0.45, "#D8A538");
    gold.addColorStop(1, "#FFF0A9");

    ctx.strokeStyle = "rgba(224,174,65,.8)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(90, 64);
    ctx.lineTo(210, 64);
    ctx.moveTo(870, 64);
    ctx.lineTo(990, 64);
    ctx.stroke();

    ctx.fillStyle = gold;
    ctx.textAlign = "center";
    ctx.font = "500 23px Georgia";
    ctx.fillText("E. SANTOS · GESTOR IMOBILIÁRIO", 540, 74);
    ctx.textAlign = "left";

    ctx.fillStyle = "#FFF7E6";
    ctx.font = "700 66px Georgia";
    ctx.fillText("GOSTOU DESTE", 88, 180);
    ctx.fillText("IMÓVEL?", 88, 255);

    ctx.strokeStyle = "#D9A63B";
    ctx.lineWidth = 3;
    ctx.roundRect(88, 290, 480, 94, 20);
    ctx.stroke();
    ctx.fillStyle = gold;
    ctx.font = "700 45px Arial";
    ctx.fillText(priceText, 140, 352);

    ctx.fillStyle = "#FFF8EA";
    ctx.font = "600 27px Arial";
    if (location) ctx.fillText(location, 140, 440);
    if (info) ctx.fillText(info, 140, 495);

    ctx.strokeStyle = "rgba(217,166,59,.75)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(140, 535);
    ctx.lineTo(520, 535);
    ctx.stroke();
    ctx.fillStyle = "#E2B64D";
    ctx.font = "700 23px Arial";
    ctx.fillText(property.code ? `CÓDIGO ${property.code}` : "ATENDIMENTO E. SANTOS", 140, 575);

    ctx.fillStyle = gold;
    ctx.font = "700 39px Georgia";
    ctx.fillText("Pronto para conhecer de perto?", 140, 690);
    ctx.fillStyle = "#FFF8EA";
    ctx.font = "400 25px Arial";
    wrapText(ctx, "Tire suas dúvidas, receba as condições atualizadas e agende uma visita com atendimento direto.", 140, 735, 800, 36, 3);

    const button = ctx.createLinearGradient(80, 0, 1000, 0);
    button.addColorStop(0, "#D39A2D");
    button.addColorStop(0.5, "#FFE38B");
    button.addColorStop(1, "#D59E31");
    ctx.fillStyle = button;
    ctx.roundRect(82, 860, 916, 100, 18);
    ctx.fill();
    ctx.strokeStyle = "#FFE598";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "#140C06";
    ctx.font = "800 31px Arial";
    ctx.textAlign = "center";
    ctx.fillText("FALE AGORA PELO WHATSAPP", 540, 922);

    ctx.fillStyle = "rgba(255,248,234,.9)";
    ctx.font = "500 19px Arial";
    ctx.fillText("E. Santos Gestor Imobiliário · Atendimento direto", 540, 1022);
    ctx.textAlign = "left";
    return canvas;
  }

  async function downloadCover() {
    setDownloading(true);
    setError(null);
    try {
      const canvas = await buildCoverCanvas();
      const link = document.createElement("a");
      link.href = canvas.toDataURL("image/jpeg", 0.92);
      link.download = `e-santos-${property?.code || propertyId || "imovel"}-${customCoverUrl ? "capa-personalizada" : "capa-premium"}.jpg`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível gerar a capa premium.");
    } finally {
      setDownloading(false);
    }
  }

  async function prepareBookAssets() {
    if (!propertyId || !property || !primary) throw new Error("Book incompleto para publicação.");
    const [coverCanvas, ctaCanvas, photoCanvases] = await Promise.all([
      buildCoverCanvas(),
      buildCtaCanvas(),
      Promise.all(bookPhotos.map((image) => buildSocialPhotoCanvas(image.url))),
    ]);
    const uploaded = await Promise.all([
      uploadBookAsset(coverCanvas, `book-${property.code || propertyId}-capa.jpg`),
      uploadBookAsset(ctaCanvas, `book-${property.code || propertyId}-cta.jpg`),
      ...photoCanvases.map((canvas, index) => uploadBookAsset(canvas, `book-${property.code || propertyId}-foto-${index + 1}.jpg`)),
    ]);
    const [coverUrl, ctaUrl, ...photoUrls] = uploaded;
    return { coverUrl, ctaUrl, photoUrls };
  }

  async function publishInstagramBook() {
    if (!propertyId || !property || !primary) throw new Error("Book incompleto para o Instagram.");
    const { coverUrl, ctaUrl, photoUrls } = await prepareBookAssets();
    const response = await fetch(`/api/admin/property-book/${propertyId}/publish-instagram`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ coverUrl, ctaUrl, photoUrls, force: false }),
    });
    const payload = await response.json().catch(() => ({})) as { error?: string; message?: string; url?: string };
    if (!response.ok) throw new Error(payload.error || "Não foi possível publicar o Book Premium.");
    return payload.url ? `Publicado. ${payload.url}` : (payload.message || "Book Premium publicado.");
  }

  async function publishFacebook() {
    if (!propertyId || !property || !primary) throw new Error("Book incompleto para o Facebook.");
    const { coverUrl, ctaUrl, photoUrls } = await prepareBookAssets();
    const bookResponse = await fetch(`/api/admin/property-book/${propertyId}/publish-facebook`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ coverUrl, ctaUrl, photoUrls, force: false }),
    });
    const bookPayload = await bookResponse.json().catch(() => ({})) as { error?: string; message?: string; url?: string };
    if (!bookResponse.ok) throw new Error(bookPayload.error || "Falha ao publicar o Book Premium no Facebook.");

    const bookMessage = bookPayload.url ? `Book Premium publicado: ${bookPayload.url}` : (bookPayload.message || "Book Premium publicado no Facebook.");
    if (!shortVideoUrl) return `${bookMessage} Publicado sem vídeo curto.`;

    const videoResponse = await fetch(`/api/admin/property-videos/${propertyId}/publish-meta`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ targets: ["facebook"], force: false }),
    });
    const videoPayload = await videoResponse.json().catch(() => ({})) as { error?: string; results?: { facebook?: { message?: string } } };
    const videoMessage = videoPayload.results?.facebook?.message || videoPayload.error || "";
    const alreadyPublished = videoResponse.status === 409 && /já foi publicado/i.test(videoMessage);
    if (!videoResponse.ok && !alreadyPublished) throw new Error(videoMessage || "O Book foi publicado, mas o Facebook recusou o vídeo curto.");
    return alreadyPublished ? `${bookMessage} O vídeo curto já estava publicado e foi preservado.` : `${bookMessage} Vídeo curto publicado junto como post complementar.`;
  }

  async function publishYoutubeShort() {
    if (!propertyId || !shortVideoUrl) throw new Error("Vídeo curto não encontrado.");
    const session = await fetch(`/api/admin/property-videos/${propertyId}/youtube-short-session`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ force: false }),
    });
    if (!session.ok) throw new Error(await responseError(session, "Não foi possível preparar o YouTube Shorts."));
    const prepared = await session.json() as { uploadUrl: string; accessToken: string; videoUrl: string; mime: string };
    const source = await fetch(prepared.videoUrl);
    if (!source.ok) throw new Error("Não foi possível abrir o vídeo curto armazenado.");
    const blob = await source.blob();
    const sent = await fetch(prepared.uploadUrl, {
      method: "PUT",
      headers: { authorization: `Bearer ${prepared.accessToken}`, "content-type": prepared.mime || blob.type || "video/mp4" },
      body: blob,
    });
    const youtube = await sent.json().catch(() => ({})) as { id?: string; error?: { message?: string } };
    if (!sent.ok || !youtube.id) throw new Error(youtube.error?.message || "O YouTube não concluiu o Short.");
    const complete = await fetch(`/api/admin/property-videos/${propertyId}/youtube-short-complete`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ videoId: youtube.id }),
    });
    if (!complete.ok) throw new Error(await responseError(complete, "Short enviado, mas o CRM não registrou o retorno."));
    const result = await complete.json() as { message?: string };
    return result.message || "YouTube Shorts publicado.";
  }

  async function publishSelectedChannels() {
    if (!propertyId || selectedCount === 0) return;
    setPublishing(true);
    setError(null);
    setChannelResults({});
    const run = async (target: SocialTarget, fn: () => Promise<string>) => {
      try {
        const message = await fn();
        setChannelResults((current) => ({ ...current, [target]: { status: "success", message } }));
      } catch (caught) {
        setChannelResults((current) => ({ ...current, [target]: { status: "error", message: caught instanceof Error ? caught.message : "Erro na publicação." } }));
      }
    };
    const jobs: Promise<void>[] = [];
    if (targets.instagram) jobs.push(run("instagram", publishInstagramBook));
    if (targets.facebook) jobs.push(run("facebook", publishFacebook));
    if (targets.youtube) jobs.push(run("youtube", publishYoutubeShort));
    if (targets.other) {
      setChannelResults((current) => ({ ...current, other: { status: "pending", message: otherTarget ? "Integração selecionada ainda pendente de adaptador de publicação." : "Nenhuma integração adicional configurada." } }));
    }
    await Promise.allSettled(jobs);
    setPublishing(false);
  }

  if (propertyId === null) {
    return (
      <div className="mt-5 border-t border-line pt-5">
        <div className="flex items-center gap-2 text-deep"><BookOpen className="h-4 w-4" /><p className="text-sm font-medium">Book / carrossel premium</p></div>
        <p className="mt-1 text-[11px] text-muted">O Book será montado automaticamente depois que o imóvel receber o código interno e for aberto em Editar.</p>
      </div>
    );
  }

  return (
    <div className="mt-5 border-t border-line pt-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-deep"><BookOpen className="h-4 w-4" /><p className="text-sm font-medium">Book / carrossel premium</p></div>
          <p className="mt-1 max-w-3xl text-[11px] leading-relaxed text-muted">O Book puxa automaticamente capa, vídeo quando houver, fotos do cadastro e fechamento para você revisar antes de publicar.</p>
        </div>
        <Badge tone={primary ? "green" : "amber"}>{primary ? `${mediaCount} MÍDIAS PREPARADAS` : "AGUARDANDO FOTOS"}</Badge>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="space-y-3">
          <label className="block max-w-sm text-xs text-deep"><span className="mb-1 block font-medium">Estilo da capa</span><select value={themeKey} onChange={(event) => setThemeKey(event.target.value as ThemeKey)} className="w-full rounded-[5px] border border-line bg-white px-3 py-2.5 text-sm">{Object.entries(THEMES).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}</select></label>
          <div className="rounded-[10px] border border-line bg-bone/30 p-3"><div className="flex items-center gap-2 text-xs font-medium text-deep"><Sparkles className="h-3.5 w-3.5 text-brass" /> Conteúdo reaproveitado do cadastro</div><p className="mt-2 text-[11px] leading-relaxed text-muted">{property?.description?.trim() ? shortenDescription(property.description, 340) : "A descrição já existente será usada; este módulo não cria uma segunda descrição."}</p></div>
          <div className="rounded-[10px] border border-line bg-white p-3">
            <p className="text-xs font-medium text-deep">Ordem oficial do Book</p>
            <ol className="mt-2 space-y-1.5 text-[11px] text-muted">
              <li className="flex items-center gap-2"><Sparkles className="h-3.5 w-3.5" /> 1. {customCoverUrl ? "Capa personalizada" : "Capa premium E. Santos"}</li>
              {shortReady && <li className="flex items-center gap-2"><Film className="h-3.5 w-3.5" /> 2. Vídeo curto</li>}
              {bookPhotos.map((image, index) => <li key={`${image.url}-${index}`} className="flex items-center gap-2"><ImageIcon className="h-3.5 w-3.5" /> {index + (shortReady ? 3 : 2)}. Foto {images.indexOf(image) + 1}</li>)}
              <li className="flex items-center gap-2"><BookOpen className="h-3.5 w-3.5" /> {mediaCount}. Contato + CTA</li>
            </ol>
            <p className="mt-2 text-[10px] text-muted">Até 10 mídias: capa → vídeo quando houver → fotos → encerramento.</p>
          </div>
        </div>

        <div>
          <div className="relative aspect-square overflow-hidden rounded-[12px] border border-line" style={{ background: theme.surface }}>
            {customCoverUrl ? (
              <img src={customCoverUrl} alt="Capa personalizada do Book" className="absolute inset-0 h-full w-full object-cover" />
            ) : (
              <>
                {primary?.url && <img src={primary.url} alt="Prévia da capa premium" className="absolute inset-0 h-full w-full object-cover" />}
                <div className="absolute inset-0" style={{ background: `linear-gradient(to bottom, transparent 25%, ${theme.overlay} 62%, ${theme.surface} 100%)` }} />
                {shortReady && <div className="absolute left-5 top-[53%] flex items-center gap-2 border px-3 py-2 text-[11px] font-bold uppercase tracking-[.08em]" style={{ borderColor: theme.accent, background: "rgba(0,0,0,.65)", color: theme.accent }}><Play className="h-3.5 w-3.5 fill-current" /> Vídeo no próximo slide</div>}
                <div className="absolute inset-x-0 bottom-0 p-6" style={{ color: theme.ink }}><h4 className="max-w-[92%] text-2xl font-semibold leading-tight sm:text-3xl">{headline}</h4><p className="mt-4 text-xl font-semibold" style={{ color: theme.accent }}>{priceText}</p><p className="mt-2 text-xs">{location}</p><p className="mt-1 text-xs">{info}</p></div>
              </>
            )}
            {customCoverUrl && <span className="absolute left-3 top-3 rounded-full bg-black/70 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[.08em] text-white">Capa personalizada</span>}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[10px] text-muted">Saída para redes: JPEG 1080×1080. A galeria original permanece intacta.</p>
            <div className="flex flex-wrap items-center gap-2">
              <Btn type="button" tone="outline" disabled={!primary || downloading} onClick={() => void downloadCover()}><Download className="h-3.5 w-3.5" /> {downloading ? "Gerando…" : "Baixar capa JPEG"}</Btn>
              <input id={`custom-book-cover-${propertyId}`} type="file" accept="image/*" className="hidden" onChange={(event) => { void handleCustomCover(event.target.files?.[0] ?? null); event.currentTarget.value = ""; }} />
              <Btn type="button" tone="outline" disabled={uploadingCustomCover} onClick={() => document.getElementById(`custom-book-cover-${propertyId}`)?.click()}><ImageIcon className="h-3.5 w-3.5" /> {uploadingCustomCover ? "Enviando…" : customCoverUrl ? "Trocar capa personalizada" : "Adicionar capa personalizada"}</Btn>
              {customCoverUrl && <Btn type="button" tone="outline" onClick={removeCustomCover}>Voltar para capa automática</Btn>}
            </div>
          </div>
          {customCoverUrl && <p className="mt-2 rounded-[7px] border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] text-emerald-800">Capa personalizada ativa. Ela será o slide 1 e será usada na publicação; a capa automática continua disponível como reserva.</p>}
        </div>
      </div>

      {primary && currentDemo && (
        <div className="mt-5 rounded-[12px] border border-brass/30 bg-bone/20 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-medium text-deep">Demo funcional do Book</p><p className="mt-1 text-[11px] text-muted">Esta é a prévia definitiva que você aprova antes de publicar.</p></div><Badge tone="green">{demoIndex + 1}/{demoSteps.length}</Badge></div>
          <div className="mx-auto mt-4 max-w-xl">
            <div className="relative aspect-square overflow-hidden rounded-[12px] border border-line bg-black">
              {currentDemo.kind === "cover" && (
                <button type="button" className="absolute inset-0 block h-full w-full text-left" onClick={() => shortReady && setDemoIndex(1)}>
                  {customCoverUrl ? <img src={customCoverUrl} alt="Capa personalizada" className="absolute inset-0 h-full w-full object-cover" /> : <><img src={primary.url} alt="Capa premium" className="absolute inset-0 h-full w-full object-cover" /><div className="absolute inset-0" style={{ background: `linear-gradient(to bottom, transparent 25%, ${theme.overlay} 62%, ${theme.surface} 100%)` }} />{shortReady && <YoutubePlayBadge large />}{shortReady && <div className="absolute left-5 top-[53%] flex items-center gap-2 border px-3 py-2 text-[11px] font-bold uppercase tracking-[.08em]" style={{ borderColor: theme.accent, background: "rgba(0,0,0,.65)", color: theme.accent }}><Play className="h-3.5 w-3.5 fill-current" /> Vídeo no próximo slide</div>}<div className="absolute inset-x-0 bottom-0 p-6" style={{ color: theme.ink }}><h4 className="text-3xl font-semibold leading-tight">{headline}</h4><p className="mt-4 text-xl font-semibold" style={{ color: theme.accent }}>{priceText}</p><p className="mt-2 text-xs">{location}</p><p className="mt-1 text-xs">{info}</p></div></>}
                </button>
              )}
              {currentDemo.kind === "video" && <video src={currentDemo.url} className="h-full w-full object-contain" controls autoPlay playsInline onEnded={() => setDemoIndex((current) => Math.min(demoSteps.length - 1, current + 1))} />}
              {currentDemo.kind === "photo" && <img src={currentDemo.url} alt={currentDemo.label} className="h-full w-full object-cover" />}
              {currentDemo.kind === "cta" && <div className="relative h-full overflow-hidden text-left text-[#fff8ea]" style={{ background: "radial-gradient(circle at 72% 48%, #4a2a09 0%, #241205 38%, #090503 100%)" }}><div className="absolute inset-x-0 top-0 h-[18%] bg-gradient-to-r from-[#d6a23a]/5 via-[#f3ca65]/20 to-[#d6a23a]/5" /><BrandLogo className="absolute right-[-3%] top-[20%] h-[58%] w-[62%] opacity-35 mix-blend-screen" /><div className="relative z-10 h-full px-10 py-8"><div className="flex items-center gap-4 text-[10px] font-medium uppercase tracking-[.22em] text-[#e4b84d]"><span className="h-px flex-1 bg-[#c89631]" /><span>E. Santos · Gestor Imobiliário</span><span className="h-px flex-1 bg-[#c89631]" /></div><h4 className="mt-6 font-serif text-[42px] font-bold uppercase leading-[.94] tracking-[-.02em] text-[#fff7e6]">Gostou deste<br />imóvel?</h4><div className="mt-5 inline-flex min-w-[52%] items-center rounded-[16px] border-2 border-[#d7a43a] px-5 py-3 text-[26px] font-extrabold text-[#e7bd55] shadow-[0_0_22px_rgba(226,174,65,.12)]">{priceText}</div><div className="mt-5 space-y-2 text-[13px] font-semibold"><p>{location}</p>{info && <p>{info}</p>}</div>{property?.code && <div className="mt-4 w-fit border-t border-[#c89631]/60 pt-3 text-[11px] font-bold uppercase tracking-[.08em] text-[#e4b84d]">Código {property.code}</div>}<div className="mt-8 max-w-[82%]"><p className="font-serif text-[22px] font-bold text-[#efc75f]">Pronto para conhecer de perto?</p><p className="mt-2 text-[12px] leading-relaxed text-[#fff8ea]/90">Tire suas dúvidas, receba as condições atualizadas e agende uma visita com atendimento direto.</p></div><a href={whatsappUrl} target="_blank" rel="noreferrer" className="absolute inset-x-10 bottom-16 flex items-center justify-center gap-3 rounded-[14px] border border-[#ffe18a] bg-gradient-to-r from-[#d39a2d] via-[#ffe38b] to-[#d59e31] px-5 py-4 text-[15px] font-extrabold uppercase text-[#140c06] no-underline shadow-[0_0_24px_rgba(255,205,87,.18)]"><MessageCircle className="h-6 w-6" /> Fale agora pelo WhatsApp</a><div className="absolute inset-x-10 bottom-6 flex items-center gap-4 text-[9px] tracking-[.12em] text-[#fff8ea]/80"><span className="h-px flex-1 bg-[#c89631]" /><span>E. Santos Gestor Imobiliário · Atendimento direto</span><span className="h-px flex-1 bg-[#c89631]" /></div></div></div>}
              <span className="absolute right-3 top-3 rounded-full bg-black/65 px-2.5 py-1 text-[10px] font-semibold text-white">{demoIndex + 1}/{demoSteps.length}</span>
            </div>
            <div className="mt-3 flex items-center justify-between gap-3"><Btn type="button" tone="outline" disabled={demoIndex === 0} onClick={() => setDemoIndex((current) => Math.max(0, current - 1))}><ChevronLeft className="h-3.5 w-3.5" /> Anterior</Btn><p className="text-center text-[11px] font-medium text-deep">{currentDemo.label}</p><Btn type="button" tone="outline" disabled={demoIndex >= demoSteps.length - 1} onClick={() => setDemoIndex((current) => Math.min(demoSteps.length - 1, current + 1))}>Próximo <ChevronRight className="h-3.5 w-3.5" /></Btn></div>
          </div>

          <div className="mt-5 border-t border-brass/20 pt-4">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-semibold uppercase tracking-[.08em] text-deep">Destinos de publicação</p><p className="mt-1 text-[11px] text-muted">Selecione os canais. Cada canal é enviado de forma independente.</p></div><Badge tone={selectedCount > 0 ? "green" : "amber"}>{selectedCount > 0 ? `${selectedCount} SELECIONADO${selectedCount > 1 ? "S" : ""}` : "NENHUM SELECIONADO"}</Badge></div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {([ ["instagram", "Instagram"], ["facebook", "Facebook"], ["youtube", "YouTube Shorts"], ["other", "Outros"] ] as const).map(([key, label]) => {
                const unavailable = key === "youtube" && !shortReady;
                return <label key={key} className={`flex items-center gap-2 rounded-[8px] border border-line bg-white px-3 py-3 text-sm text-deep ${unavailable ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}><input type="checkbox" checked={targets[key]} disabled={unavailable} onChange={(event) => setTargets((current) => ({ ...current, [key]: event.target.checked }))} /><span>{label}</span></label>;
              })}
            </div>
            {!shortReady && <p className="mt-2 text-[11px] text-muted">Sem vídeo curto: Instagram e Facebook continuam liberados. YouTube Shorts fica disponível quando houver vídeo.</p>}
            {targets.other && <div className="mt-3 rounded-[8px] border border-amber-200 bg-amber-50 p-3"><label className="block text-xs font-medium text-deep">Outras integrações</label><select value={otherTarget} onChange={(event) => setOtherTarget(event.target.value)} className="mt-2 w-full max-w-md rounded-[5px] border border-line bg-white px-3 py-2 text-sm" disabled><option value="">Nenhuma integração adicional configurada</option></select><p className="mt-2 text-[11px] text-amber-800">Outros — pendente. Só aparecerão aqui plataformas realmente configuradas no CRM.</p></div>}
            <div className="mt-4"><Btn type="button" tone="brass" disabled={selectedCount === 0 || publishing} onClick={() => void publishSelectedChannels()}>{publishing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} {publishing ? "Publicando…" : "PUBLICAR NOS CANAIS SELECIONADOS"}</Btn></div>
            {Object.keys(channelResults).length > 0 && <div className="mt-4 grid gap-2 sm:grid-cols-2">{(["instagram", "facebook", "youtube", "other"] as SocialTarget[]).map((key) => { const result = channelResults[key]; if (!result) return null; const label = key === "instagram" ? "Instagram" : key === "facebook" ? "Facebook" : key === "youtube" ? "YouTube Shorts" : "Outros"; const tone = result.status === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : result.status === "error" ? "border-red-200 bg-red-50 text-red-700" : "border-amber-200 bg-amber-50 text-amber-800"; return <div key={key} className={`rounded-[7px] border p-3 text-xs ${tone}`}><strong>{label}</strong> — {result.status === "success" ? "publicado" : result.status === "error" ? "erro" : "pendente"}<p className="mt-1 font-normal">{result.message}</p></div>; })}</div>}
          </div>
        </div>
      )}

      {error && <p className="mt-3 rounded-[6px] border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</p>}
    </div>
  );
}

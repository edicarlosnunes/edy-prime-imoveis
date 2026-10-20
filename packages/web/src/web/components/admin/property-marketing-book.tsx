import { tiktokResultStatus } from "../../../shared/tiktok-result";
import { negotiationText } from "../../../shared/negotiation";
import { propertyPrice } from "../../../shared/property-price";
import { useEffect, useMemo, useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import { recordBookVideo } from "../../lib/book-video";
import { useQuery } from "@tanstack/react-query";
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Download,
  Film,
  Image as ImageIcon,
  Loader2,
  Play,
  Send,
  Sparkles,
} from "lucide-react";
import { client, orpc } from "../../lib/api";
import { Badge, Btn } from "./ui";

type ThemeKey = "ouro" | "azul" | "oliva" | "claro";
type VideoRow = { kind?: string; url?: string };
type Theme = { label: string; accent: string; ink: string; surface: string; overlay: string };
type DemoStep =
  | { kind: "cover"; label: string }
  | { kind: "video"; label: string; url: string }
  | { kind: "photo"; label: string; url: string }
  | { kind: "cta"; label: string };
type SocialTarget = string;
type ChannelResult = { status: "success" | "error" | "pending" | "scheduled" | "processing"; message: string; checks?: { ok: boolean; label: string; detail: string }[]; at?: string };

const BOOK_CTA_BACKGROUND = "/book-cta-premium-bg.jpg";

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

export function PropertyMarketingBook({ propertyId }: { propertyId: number | null }) {
  const [ctaPreviewUrl, setCtaPreviewUrl] = useState<string | null>(null);
  const [ctaPreviewError, setCtaPreviewError] = useState<string | null>(null);
  const [themeKey, setThemeKey] = useState<ThemeKey>("ouro");
  const [shortVideoUrl, setShortVideoUrl] = useState<string | null>(null);
  const [customCoverUrl, setCustomCoverUrl] = useState<string | null>(null);
  const [uploadingCustomCover, setUploadingCustomCover] = useState(false);
  const [demoIndex, setDemoIndex] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const bookSavePromise = useRef<Promise<string> | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [tiktokStatusVersion, setTiktokStatusVersion] = useState(0);
  const [youtubeProgress, setYoutubeProgress] = useState("");
  const [generatingVideo, setGeneratingVideo] = useState(false);
  const [videoProgress, setVideoProgress] = useState("");
  const [completeVideo, setCompleteVideo] = useState<Blob | null>(null);
  const [completeVideoUrl, setCompleteVideoUrl] = useState<string | null>(null);
  const [pendingVideoSave, setPendingVideoSave] = useState(false);
  const [savedVideoUrl, setSavedVideoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [targets, setTargets] = useState<Record<SocialTarget, boolean>>({ instagram: false, facebook: false, youtube: false, tiktok: false });
  const [channelResults, setChannelResults] = useState<Partial<Record<SocialTarget, ChannelResult>>>({});

  const [openReason, setOpenReason] = useState<string | null>(null);
  const history = useQuery({ ...orpc.adminIntegrations.publicationChecks.queryOptions({ input: { propertyId: propertyId ?? 0 } }), enabled: propertyId !== null });


  const guideAuthorization = useQuery({ ...orpc.adminChannels.forProperty.queryOptions({ input: { propertyId: propertyId ?? 0 } }), enabled: propertyId !== null });
  const guideIncluded = guideAuthorization.data?.some((row) => row.channel === "imovelguide" && row.authorized) ?? false;
  const destinations = useQuery(orpc.adminIntegrations.publicationTargets.queryOptions({ refetchInterval: 15_000 }));

  const detail = useQuery({
    ...orpc.adminProperties.get.queryOptions({ input: { id: propertyId ?? 0 } }),
    enabled: propertyId !== null,
  });

  useEffect(() => {
    setDemoIndex(0);
    setChannelResults({});
    setTargets({ instagram: false, facebook: false, youtube: false, tiktok: false });
    setSavedVideoUrl(null);
    setPendingVideoSave(false);
    setVideoProgress("");
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
          setSavedVideoUrl(payload.videos?.find((video) => video.kind === "book_complete")?.url ?? null);
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

  useEffect(() => {
    if (history.data) setChannelResults(current => ({...Object.fromEntries(history.data.map((entry) => [entry.key, { status: "pending" as const, message: "Último checklist salvo; nenhum anúncio enviado neste teste.", checks: entry.checks, at: entry.at }])),...(current.tiktok && current.tiktok.status !== "pending" ? {tiktok:current.tiktok} : {})}));
  }, [history.data]);

  useEffect(() => {
    if (!propertyId) return;
    let alive=true;
    void fetch(`/api/admin/property-book/${propertyId}/tiktok-status`,{credentials:"same-origin"}).then(async response => response.ok ? response.json() : null).then(data => {
      if(!alive || !data?.result) return;
      const result=data.result;
      setChannelResults(current=>({...current,tiktok:{status:tiktokResultStatus(result.state),message:result.message || "Envio ao TikTok em conferência. Verifique o Metricool antes de repetir."}}));
    }).catch(()=>{});
    return ()=>{alive=false;};
  },[propertyId,tiktokStatusVersion]);

  const property = detail.data;
  const images = property?.images ?? [];
  const primary = useMemo(() => images.find((image) => image.isPrimary === 1) ?? images[0] ?? null, [images]);
  const shortReady = Boolean(shortVideoUrl);
  const maxPhotos = shortReady ? 7 : 8;
  const bookPhotos = useMemo(() => images.slice(0, maxPhotos), [images, maxPhotos]);
  const theme = THEMES[themeKey];
  const headline = (property?.highlight || property?.title || "Imóvel em destaque").trim();
  const pricing = propertyPrice(property ?? {});
  const priceText = money(pricing.current);
  const previousPriceText = pricing.discounted ? money(pricing.original) : null;
  const info = [
    formatInfo("dorm.", property?.bedrooms),
    formatInfo("suíte", property?.suites),
    formatInfo("vaga", property?.parking),
    formatInfo("m²", property?.areaUtil),
  ].filter(Boolean).join(" · ");
  const location = [property?.district, property?.city].filter(Boolean).join(" · ");
  const whatsappMessage = encodeURIComponent(`Olá! Vi o imóvel ${property?.title || "que vocês anunciaram"}${property?.code ? ` (código ${property.code})` : ""} e gostaria de receber mais informações.`);
  const whatsappUrl = `https://wa.me/5513997141174?text=${whatsappMessage}`;
  const destinationRows = (destinations.data ?? []).map((target) => ({
    ...target,
    ready: !destinations.isError && target.ready && (target.key !== "youtube" || shortReady),
    reason: target.key === "youtube" && target.ready && !shortReady ? "Adicione um vídeo curto ao imóvel" : target.reason,
  }));
  const selectedKeys = destinationRows.filter((target) => target.key !== "olx" && targets[target.key as SocialTarget]).map((target) => target.key);
  const selectedCount = selectedKeys.length;

  const demoSteps = useMemo<DemoStep[]>(() => {
    const steps: DemoStep[] = [{ kind: "cover", label: customCoverUrl ? "Capa personalizada" : "Capa premium E. Santos" }];
    if (shortVideoUrl) steps.push({ kind: "video", label: "Vídeo curto", url: shortVideoUrl });
    for (const image of bookPhotos) {
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
    ctx.fillStyle = theme.ink;
    ctx.font = "700 57px Arial";
    wrapText(ctx, headline, 64, 710, 900, 66, 3);
    if (previousPriceText) {
      ctx.fillStyle = theme.ink;
      ctx.font = "500 28px Arial";
      ctx.fillText(`De ${previousPriceText}`, 64, 879);
    }
    ctx.fillStyle = theme.accent;
    ctx.font = "700 43px Arial";
    ctx.fillText(`${previousPriceText ? "Por " : ""}${priceText}`, 64, 930);
    ctx.fillStyle = theme.ink;
    ctx.font = "500 27px Arial";
    if (location) ctx.fillText(location, 64, 980);
    if (info) ctx.fillText(info, 64, 1025);
    return canvas;
  }

  async function buildCtaCanvas(youtube = false) {
    if (!property) throw new Error("Imóvel não carregado.");
    const background = await loadImage(BOOK_CTA_BACKGROUND);
    const canvas = document.createElement("canvas");
    canvas.width = 1080;
    canvas.height = 1080;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Seu navegador não conseguiu preparar o encerramento.");
    ctx.drawImage(background, 0, 0, 1080, 1080);

    // Coordinates follow the empty fields in the approved institutional artwork.
    const field = (text: string, x: number, y: number, width: number, size: number, color = "#FFF8EA") => {
      ctx.fillStyle = color;
      ctx.textAlign = "left";
      let fittedSize = size;
      ctx.font = `600 ${fittedSize}px Arial`;
      while (ctx.measureText(text).width > width && fittedSize > 16) {
        fittedSize -= 1;
        ctx.font = `600 ${fittedSize}px Arial`;
      }
      ctx.fillText(text, x, y, width);
    };
    if (previousPriceText) {
      field(`De ${previousPriceText}`, 215, 362, 320, 23);
      field(`Por ${priceText}`, 215, 405, 320, 34, "#F4D987");
    } else field(priceText, 215, 392, 320, 39, "#F4D987");
    field(location, 155, 480, 355, 25);
    const rooms = [formatInfo("dorm.", property.bedrooms), formatInfo(property.suites === 1 ? "suíte" : "suítes", property.suites)].filter(Boolean).join(" · ");
    field(rooms, 155, 542, 355, 25);
    const parkingAndArea = [formatInfo(property.parking === 1 ? "vaga" : "vagas", property.parking), formatInfo("m²", property.areaUtil)].filter(Boolean).join(" · ");
    field(parkingAndArea, 155, 604, 355, 25);
    if (property.code) field(`CÓDIGO ${property.code}`, 155, 679, 355, 23, "#F4D987");
    if (youtube) {
      ctx.fillStyle = "#130F08";
      ctx.fillRect(70, 868, 945, 132);
      ctx.textAlign = "center";
      ctx.fillStyle = "#F4D987";
      ctx.font = "600 35px Arial";
      ctx.fillText("WhatsApp: (13) 99714-1174", 540, 925);
      ctx.fillStyle = "#FFF8EA";
      ctx.font = "500 27px Arial";
      ctx.fillText("Site e contato: links no perfil do canal", 540, 970);
    }
    return canvas;
  }

  useEffect(() => {
    if (currentDemo?.kind !== "cta" || !property) return;
    let alive = true;
    setCtaPreviewUrl(null);
    setCtaPreviewError(null);
    void buildCtaCanvas(targets.youtube).then((canvas) => {
      if (alive) setCtaPreviewUrl(canvas.toDataURL("image/jpeg", 0.92));
    }).catch((caught) => {
      if (alive) setCtaPreviewError(caught instanceof Error ? caught.message : "Não foi possível preparar o encerramento.");
    });
    return () => { alive = false; };
  }, [currentDemo?.kind, property, targets.youtube]);

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

  useEffect(() => {
    setCompleteVideo(null);
  }, [propertyId, property, themeKey, customCoverUrl, shortVideoUrl]);

  useEffect(() => {
    if (!completeVideo) { setCompleteVideoUrl(null); return; }
    const url = URL.createObjectURL(completeVideo);
    setCompleteVideoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [completeVideo]);

  async function buildCompleteVideo(onProgress: (message: string) => void, fresh = false) {
    if (!fresh && completeVideo) return completeVideo;
    if (!shortVideoUrl || !primary) throw new Error("Cadastre as fotos e o vídeo curto antes de gerar o vídeo completo.");
    onProgress("Preparando capa, fotos e encerramento…");
    const [cover, cta, photos] = await Promise.all([
      buildCoverCanvas(), buildCtaCanvas(true),
      Promise.all(bookPhotos.map((image) => buildSocialPhotoCanvas(image.url))),
    ]);
    const blob = await recordBookVideo({ cover, cta, photos, videoUrl: shortVideoUrl, onProgress });
    setCompleteVideo(blob);
    setPendingVideoSave(true);
    return blob;
  }

  async function saveCompleteVideo(blob: Blob, onProgress: (message: string) => void) {
    if (!propertyId) throw new Error("Salve o imóvel antes de guardar o vídeo.");
    const extension = blob.type === "video/mp4" ? "mp4" : "webm";
    const fileName = `book-completo-${property?.code || propertyId}.${extension}`;
    onProgress("Salvando vídeo completo no CRM…");
    const asset = await upload(`properties/${propertyId}/book-youtube/book-${Date.now()}.${extension}`, blob, {
      access: "public", handleUploadUrl: "/api/admin/property-videos/upload",
      clientPayload: JSON.stringify({ propertyId, kind: "book_complete" }),
      multipart: true, contentType: blob.type,
      onUploadProgress: ({ percentage }) => onProgress(`Salvando no CRM: ${Math.round(percentage)}%`),
    });
    onProgress("Ajustando e validando o vídeo completo em 30 FPS…");
    const response = await fetch("/api/admin/property-videos/attach", {
      method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
      body: JSON.stringify({ propertyId, kind: "book_complete", url: asset.url, pathname: asset.pathname, fileName, mime: blob.type, size: blob.size }),
    });
    if (!response.ok) throw new Error(await responseError(response, "Vídeo gerado, mas não foi possível salvá-lo no CRM. Tente salvar novamente antes de sair."));
    const attached = await response.json() as { video?: { url?: string } };
    const finalUrl = attached.video?.url;
    if (!finalUrl) throw new Error("O CRM não confirmou o vídeo preparado.");
    setSavedVideoUrl(finalUrl);
    setPendingVideoSave(false);
    return finalUrl;
  }

  async function retrySaveCompleteVideo() {
    if (!completeVideo) return;
    setGeneratingVideo(true);
    setError(null);
    try {
      await saveCompleteVideo(completeVideo, setVideoProgress);
      setVideoProgress("Vídeo completo salvo no cadastro deste imóvel.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Falha ao salvar o vídeo."); }
    finally { setGeneratingVideo(false); }
  }

  async function generateCompleteVideo() {
    setGeneratingVideo(true);
    setError(null);
    try {
      const blob = await buildCompleteVideo(setVideoProgress, true);
      // Um arquivo novo só substitui o anterior depois da confirmação do servidor.
      await saveCompleteVideo(blob, setVideoProgress);
      setVideoProgress("Vídeo completo salvo no CRM e vinculado ao EPI deste imóvel.");
    } catch (caught) {
      setVideoProgress("");
      setError(caught instanceof Error ? caught.message : "Não foi possível gerar o vídeo completo.");
    } finally { setGeneratingVideo(false); }
  }

  async function ensureSavedBookVideo() {
    if (bookSavePromise.current) return bookSavePromise.current;
    bookSavePromise.current = (async()=>{
      if (!pendingVideoSave && savedVideoUrl) {
        setYoutubeProgress("Preparando e conferindo o vídeo completo em 30 FPS…");
        const response=await fetch(`/api/admin/property-videos/${propertyId}/prepare-book`,{method:"POST",credentials:"same-origin"});
        if(!response.ok)throw new Error(await responseError(response,"Não foi possível preparar o vídeo."));
        const prepared=await response.json() as {url:string};setSavedVideoUrl(prepared.url);return prepared.url;
      }
      const blob=await buildCompleteVideo(setYoutubeProgress);
      return saveCompleteVideo(blob,setYoutubeProgress);
    })();
    try {return await bookSavePromise.current;} finally {bookSavePromise.current=null;}
  }

  async function publishYoutubeShort() {
    if (!propertyId || !shortVideoUrl) throw new Error("Vídeo curto não encontrado.");
    const session = await fetch(`/api/admin/property-videos/${propertyId}/youtube-short-session`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ force: false, book: true }),
    });
    if (!session.ok) throw new Error(await responseError(session, "Não foi possível preparar o YouTube Shorts."));
    const prepared = await session.json() as { uploadUrl: string; accessToken: string; videoUrl: string; mime: string };
    const bookVideoUrl = await ensureSavedBookVideo();
    setYoutubeProgress("Enviando o Book completo ao YouTube…");
    const sent = await fetch(prepared.uploadUrl, {
      method: "PUT", credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bookVideoUrl }),
    });
    const youtube = await sent.json().catch(() => ({})) as { id?: string; error?: { message?: string } };
    if (!sent.ok || !youtube.id) throw new Error(youtube.error?.message || "O YouTube não concluiu o Short.");
    const complete = await fetch(`/api/admin/property-videos/${propertyId}/youtube-short-complete`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ videoId: youtube.id, book: true }),
    });
    if (!complete.ok) throw new Error(await responseError(complete, "Short enviado, mas o CRM não registrou o retorno."));
    const result = await complete.json() as { message?: string };
    setYoutubeProgress("");
    return result.message || "Book completo enviado ao YouTube Shorts.";
  }

  async function publishTiktokBook() {
    if (!propertyId) throw new Error("Salve o imóvel antes de publicar.");
    await ensureSavedBookVideo();
    setYoutubeProgress("Enviando o Book completo ao Metricool para o TikTok…");
    const response = await fetch(`/api/admin/property-book/${propertyId}/publish-tiktok`, {method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},body:"{}"});
    if (!response.ok) throw new Error(await responseError(response,"O Metricool não confirmou o envio ao TikTok."));
    const result = await response.json() as {message:string; status:string};
    setYoutubeProgress("");
    return {message:result.message,status:tiktokResultStatus(result.status)};
  }

  async function publishSelectedChannels() {
    if (!propertyId || selectedCount === 0) return;
    setPublishing(true);
    setYoutubeProgress("");
    setError(null);
    setChannelResults({});
    const run = async (target: SocialTarget, fn: () => Promise<string | {message:string;status:ChannelResult["status"]}>) => {
      try {
        const result = await fn();
        const outcome = typeof result === "string" ? {status:"success" as const,message:result} : result;
        setChannelResults((current) => ({ ...current, [target]: outcome }));
      } catch (caught) {
        setChannelResults((current) => ({ ...current, [target]: { status: "error", message: caught instanceof Error ? caught.message : "Erro na publicação." } }));
      }
    };
    const jobs: Promise<void>[] = [];
    for (const key of selectedKeys) {
      const ready = destinationRows.find((target) => target.key === key)?.ready;
      const publish = key === "instagram" ? publishInstagramBook : key === "facebook" ? publishFacebook : key === "youtube" ? publishYoutubeShort : key === "tiktok" ? publishTiktokBook : null;
      if (key === "imovelguide") jobs.push(run(key, async () => {
        await client.adminChannels.setAuthorized({ propertyId, channel: "imovelguide", authorized: true });
        await guideAuthorization.refetch();
        return "Imóvel incluído no XML do Imóvel Guide. Aguarda leitura e validação pelo portal; isto ainda não confirma publicação.";
      }));
      else if (ready && publish) jobs.push(run(key, publish));
      else jobs.push((async () => {
        try {
          const result = await client.adminIntegrations.diagnosePublication({ propertyId, key });
          setChannelResults((current) => ({ ...current, [key]: { status: "pending", message: "Checklist executado. Nenhum anúncio enviado.", checks: result.checks, at: result.at } }));
        } catch (caught) {
          setChannelResults((current) => ({ ...current, [key]: { status: "error", message: caught instanceof Error ? caught.message : "Falha ao consultar a plataforma." } }));
        }
      })());
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
          <div className="rounded-[10px] border border-line bg-bone/30 p-3"><div className="flex items-center gap-2 text-xs font-medium text-deep"><Sparkles className="h-3.5 w-3.5 text-brass" /> Conteúdo reaproveitado do cadastro</div><p className="mt-2 whitespace-pre-line text-[11px] leading-relaxed text-muted">{property?.negotiation && negotiationText(property.negotiation)}{property?.negotiation && negotiationText(property.negotiation) ? "\n\n" : ""}{property?.description?.trim() ? shortenDescription(property.description, 340) : "A descrição já existente será usada; este módulo não cria uma segunda descrição."}</p></div>
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

                <div className="absolute inset-x-0 bottom-0 p-6" style={{ color: theme.ink }}><h4 className="max-w-[92%] text-2xl font-semibold leading-tight sm:text-3xl">{headline}</h4>{previousPriceText && <p className="mt-3 text-sm">De <span className="line-through">{previousPriceText}</span></p>}<p className={`${previousPriceText ? "mt-1" : "mt-4"} text-xl font-semibold`} style={{ color: theme.accent }}>{previousPriceText ? "Por " : ""}{priceText}</p><p className="mt-2 text-xs">{location}</p><p className="mt-1 text-xs">{info}</p></div>
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
                  {customCoverUrl ? <img src={customCoverUrl} alt="Capa personalizada" className="absolute inset-0 h-full w-full object-cover" /> : <><img src={primary.url} alt="Capa premium" className="absolute inset-0 h-full w-full object-cover" /><div className="absolute inset-0" style={{ background: `linear-gradient(to bottom, transparent 25%, ${theme.overlay} 62%, ${theme.surface} 100%)` }} />{shortReady && <YoutubePlayBadge large />}<div className="absolute inset-x-0 bottom-0 p-6" style={{ color: theme.ink }}><h4 className="text-3xl font-semibold leading-tight">{headline}</h4>{previousPriceText && <p className="mt-3 text-sm">De <span className="line-through">{previousPriceText}</span></p>}<p className={`${previousPriceText ? "mt-1" : "mt-4"} text-xl font-semibold`} style={{ color: theme.accent }}>{previousPriceText ? "Por " : ""}{priceText}</p><p className="mt-2 text-xs">{location}</p><p className="mt-1 text-xs">{info}</p></div></>}
                </button>
              )}
              {currentDemo.kind === "video" && <video src={currentDemo.url} className="h-full w-full object-contain" controls autoPlay playsInline onEnded={() => setDemoIndex((current) => Math.min(demoSteps.length - 1, current + 1))} />}
              {currentDemo.kind === "photo" && <img src={currentDemo.url} alt={currentDemo.label} className="h-full w-full object-cover" />}
              {currentDemo.kind === "cta" && (ctaPreviewUrl ? <a href={whatsappUrl} target="_blank" rel="noreferrer" className="block h-full w-full" aria-label="Fale agora pelo WhatsApp"><img src={ctaPreviewUrl} alt="Encerramento do Book com os dados do imóvel" className="h-full w-full object-contain" /></a> : <div className="flex h-full items-center justify-center p-6 text-center text-sm text-white">{ctaPreviewError || "Preparando encerramento…"}</div>)}
              <span className="absolute right-3 top-3 rounded-full bg-black/65 px-2.5 py-1 text-[10px] font-semibold text-white">{demoIndex + 1}/{demoSteps.length}</span>
            </div>
            <div className="mt-3 flex items-center justify-between gap-3"><Btn type="button" tone="outline" disabled={demoIndex === 0} onClick={() => setDemoIndex((current) => Math.max(0, current - 1))}><ChevronLeft className="h-3.5 w-3.5" /> Anterior</Btn><p className="text-center text-[11px] font-medium text-deep">{currentDemo.label}</p><Btn type="button" tone="outline" disabled={demoIndex >= demoSteps.length - 1} onClick={() => setDemoIndex((current) => Math.min(demoSteps.length - 1, current + 1))}>Próximo <ChevronRight className="h-3.5 w-3.5" /></Btn></div>
          </div>

          <div className="mt-5 rounded-[10px] border border-brass/30 bg-white p-4">
            <p className="text-sm font-semibold text-deep">Vídeo completo do imóvel</p>
            <p className="mt-1 text-[11px] text-muted">Capa → vídeo curto com o áudio original → fotos → encerramento com contato. Formato vertical 1080×1920, até 3 minutos. A montagem leva aproximadamente o tempo do vídeo; mantenha esta aba visível.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Btn type="button" tone="brass" disabled={!shortReady || generatingVideo || publishing} onClick={() => void generateCompleteVideo()}>{generatingVideo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Film className="h-3.5 w-3.5" />}{generatingVideo ? "Gerando vídeo…" : savedVideoUrl ? "Gerar nova versão" : "Gerar vídeo completo"}</Btn>
              {(savedVideoUrl || completeVideoUrl) && <a className="inline-flex items-center gap-2 rounded border border-line px-3 py-2 text-xs font-medium text-deep" href={savedVideoUrl || completeVideoUrl!} target="_blank" rel="noreferrer" download><Download className="h-3.5 w-3.5" />Baixar vídeo completo</a>}
            </div>
            {completeVideo && pendingVideoSave && !generatingVideo && <Btn type="button" tone="outline" onClick={() => void retrySaveCompleteVideo()}>Salvar vídeo no CRM</Btn>}
            {savedVideoUrl && <p className="mt-2 text-xs text-emerald-700">✅ Vídeo completo salvo no CRM · {property?.code || `Imóvel ${propertyId}`}. Ao alterar fotos, capa ou vídeo, gere uma nova versão para atualizar o arquivo salvo.</p>}
            {!shortReady && <p className="mt-2 text-[11px] text-muted">Adicione o vídeo curto acima para liberar a montagem.</p>}
            {videoProgress && <p role="status" className="mt-2 text-xs text-muted">{videoProgress}</p>}
            {(savedVideoUrl || completeVideoUrl) && <div className="mt-3"><video src={pendingVideoSave && completeVideoUrl ? completeVideoUrl : savedVideoUrl || completeVideoUrl!} controls playsInline className="mx-auto max-h-[480px] max-w-full rounded-lg bg-black" /><p className="mt-2 text-[11px] text-muted">Arquivo pronto para baixar e enviar ao TikTok, Instagram ou YouTube. Gerar e baixar não publica. Ao selecionar YouTube abaixo, o CRM reaproveita este vídeo. Instagram e Facebook mantêm seus envios atuais. O arquivo salvo continua disponível ao reabrir este cadastro, inclusive em outro computador.</p></div>}
          </div>

          <div className="mt-5 border-t border-brass/20 pt-4">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-semibold uppercase tracking-[.08em] text-deep">Destinos de publicação</p><p className="mt-1 text-[11px] text-muted">Selecione os canais. Cada canal é enviado de forma independente.</p></div><Badge tone={selectedCount > 0 ? "green" : "amber"}>{selectedCount > 0 ? `${selectedCount} SELECIONADO${selectedCount > 1 ? "S" : ""}` : "NENHUM SELECIONADO"}</Badge></div>
            <p className="mt-2 text-[11px] text-muted">Marque apenas as plataformas desejadas. Imóvel Guide: o envio inclui no XML e aguarda importação. ✅ publica pelo fluxo disponível. ❌ executa o checklist e informa o que falta, sem simular envio. ⓘ mostra o motivo. OLX: anúncio manual.</p>
            {guideIncluded && <div className="mt-3 rounded border border-green-200 p-3 text-xs"><p>Imóvel autorizado no XML do Imóvel Guide. Aguarda leitura e validação pelo portal.</p><button type="button" disabled={publishing} className="mt-2 underline" onClick={async () => { try { await client.adminChannels.setAuthorized({ propertyId, channel: "imovelguide", authorized: false }); await guideAuthorization.refetch(); } catch (caught) { setError(caught instanceof Error ? caught.message : "Falha ao retirar do XML."); } }}>Retirar este imóvel do XML do Imóvel Guide</button></div>}
            {destinations.isPending && <p role="status" className="mt-3 text-xs text-muted">Conferindo plataformas…</p>}
            {destinations.isError && <p role="alert" className="mt-3 text-xs text-red-700">Não foi possível conferir as plataformas. <button type="button" className="underline" onClick={() => void destinations.refetch()}>Tentar novamente</button></p>}
            <div className="mt-3 flex flex-wrap items-start gap-2">
              {destinationRows.map((target) => (
                <div key={target.key} className="rounded-[8px] border border-line bg-white px-3 py-2 text-sm text-deep">
                  <div className="inline-flex items-center gap-2">
                    <label className={`inline-flex items-center gap-2 ${publishing || generatingVideo || target.key === "olx" ? "cursor-not-allowed" : "cursor-pointer"}`}>
                      <input type="checkbox" checked={target.key !== "olx" && Boolean(targets[target.key])} disabled={target.key === "olx" || publishing || generatingVideo} onChange={(event) => setTargets((current) => ({ ...current, [target.key]: event.target.checked }))} />
                      <span className="font-medium">{target.name}</span><span aria-label={target.ready ? "Pronta para enviar" : "Envio pendente; permite diagnóstico"}>{target.ready ? "✅" : "❌"}</span>
                    </label>
                    <button type="button" aria-label={`Ver motivo: ${target.name}`} aria-expanded={openReason === target.key} onClick={() => setOpenReason((current) => current === target.key ? null : target.key)} className="rounded px-1 text-amber-700" title="Ver situação e motivo">ⓘ</button>
                  </div>
                  {openReason === target.key && <div className="mt-2 max-w-sm text-xs text-muted"><p>{target.reason}</p>{channelResults[target.key]?.checks?.filter((check) => !check.ok).map((check, index) => <p key={index} className="mt-2">⚠️ {check.label}: {check.detail}</p>)}</div>}
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-muted">O ❌ sai automaticamente quando a conexão e o envio estiverem disponíveis. <a className="underline" href="/admin/integracoes">Configurar integrações</a></p>
            <div className="mt-4"><Btn type="button" tone="brass" disabled={selectedCount === 0 || publishing || generatingVideo} onClick={() => void publishSelectedChannels()}>{publishing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} {publishing ? "Processando…" : "ENVIAR / TESTAR SELECIONADOS"}</Btn></div>
            {publishing && youtubeProgress && <p role="status" className="mt-3 text-xs text-muted">{youtubeProgress}</p>}
            {Object.keys(channelResults).length > 0 && <div className="mt-4 grid gap-3 sm:grid-cols-2">{Object.entries(channelResults).map(([key, result]) => {
              if (!result) return null;
              const label = destinationRows.find((target) => target.key === key)?.name || key;
              return <div key={key} className={`rounded-[7px] border p-3 text-xs ${result.status === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : result.status === "error" ? "border-red-200 bg-red-50 text-red-700" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
                <strong>{label} — {result.status === "success" ? "publicado" : result.status === "scheduled" ? "agendado no Metricool" : result.status === "processing" ? "em processamento" : result.status === "error" ? "erro" : "checklist / pendências"}</strong>
                <p className="mt-1">{result.message}</p>
                {key === "tiktok" && <button type="button" className="mt-2 underline" disabled={publishing} onClick={() => setTiktokStatusVersion(value => value + 1)}>Atualizar resultado no Metricool</button>}
                {result.at && <p className="mt-1 text-[10px]">Conferido em {new Date(result.at).toLocaleString("pt-BR")}</p>}
                {result.checks && <ul className="mt-2 space-y-2">{result.checks.map((check, index) => <li key={index}><strong>{check.ok ? "✅" : "⚠️"} {check.label}</strong><p>{check.detail}</p></li>)}</ul>}
              </div>;
            })}</div>}
          </div>
        </div>
      )}

      {error && <p className="mt-3 rounded-[6px] border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</p>}
    </div>
  );
}

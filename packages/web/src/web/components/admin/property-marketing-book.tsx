import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Download,
  Film,
  Image as ImageIcon,
  MessageCircle,
  Play,
  Sparkles,
} from "lucide-react";
import { orpc } from "../../lib/api";
import { Badge, Btn } from "./ui";

type ThemeKey = "ouro" | "azul" | "oliva" | "claro";
type VideoRow = { kind?: string; url?: string };

type Theme = {
  label: string;
  accent: string;
  ink: string;
  surface: string;
  overlay: string;
};

type DemoStep =
  | { kind: "cover"; label: string }
  | { kind: "video"; label: string; url: string }
  | { kind: "photo"; label: string; url: string }
  | { kind: "cta"; label: string };

const THEMES: Record<ThemeKey, Theme> = {
  ouro: { label: "Ouro premium", accent: "#D1A24B", ink: "#FFF8EA", surface: "#20150D", overlay: "rgba(21,12,7,.76)" },
  azul: { label: "Azul executivo", accent: "#D7B56D", ink: "#F7F3EA", surface: "#0C1B2B", overlay: "rgba(7,20,34,.78)" },
  oliva: { label: "Oliva sofisticado", accent: "#D8BE7A", ink: "#FFFDF4", surface: "#253027", overlay: "rgba(23,35,26,.78)" },
  claro: { label: "Clean premium", accent: "#8A6329", ink: "#1B1712", surface: "#F3EEE4", overlay: "rgba(244,239,229,.88)" },
};

const BADGES = ["Oportunidade", "Exclusivo", "Alto padrão", "Destaque", "Tour completo", "Nova captação"] as const;

function money(value: number | null | undefined) {
  if (!value) return "Consulte o valor";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(value);
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

export function PropertyMarketingBook({ propertyId }: { propertyId: number | null }) {
  const [themeKey, setThemeKey] = useState<ThemeKey>("ouro");
  const [badge, setBadge] = useState<(typeof BADGES)[number]>("Destaque");
  const [shortVideoUrl, setShortVideoUrl] = useState<string | null>(null);
  const [demoIndex, setDemoIndex] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const detail = useQuery({
    ...orpc.adminProperties.get.queryOptions({ input: { id: propertyId ?? 0 } }),
    enabled: propertyId !== null,
  });

  useEffect(() => {
    setDemoIndex(0);
    if (propertyId === null) {
      setShortVideoUrl(null);
      return;
    }
    let alive = true;
    void fetch(`/api/admin/property-videos/${propertyId}`, { credentials: "same-origin" })
      .then(async (response) => response.ok ? response.json() as Promise<{ videos?: VideoRow[] }> : { videos: [] as VideoRow[] })
      .then((payload) => {
        const short = payload.videos?.find((video) => video.kind === "short_social");
        if (alive) setShortVideoUrl(short?.url ?? null);
      })
      .catch(() => {
        if (alive) setShortVideoUrl(null);
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
  const ctaDescription = shortenDescription(property?.description);
  const whatsappMessage = encodeURIComponent(`Olá! Vi o imóvel ${property?.title || "que vocês anunciaram"}${property?.code ? ` (código ${property.code})` : ""} e gostaria de receber mais informações.`);
  const whatsappUrl = `https://wa.me/5513997726767?text=${whatsappMessage}`;

  const demoSteps = useMemo<DemoStep[]>(() => {
    const steps: DemoStep[] = [{ kind: "cover", label: "Capa premium E. Santos" }];
    if (shortVideoUrl) steps.push({ kind: "video", label: "Vídeo curto / cabeça", url: shortVideoUrl });
    for (const [index, image] of bookPhotos.entries()) {
      steps.push({ kind: "photo", label: `Foto ${images.indexOf(image) + 1}`, url: image.url });
    }
    steps.push({ kind: "cta", label: "Resumo + CTA" });
    return steps.slice(0, 10);
  }, [bookPhotos, images, shortVideoUrl]);

  const mediaCount = demoSteps.length;
  const currentDemo = demoSteps[Math.min(demoIndex, Math.max(0, demoSteps.length - 1))] ?? null;

  useEffect(() => {
    if (currentDemo?.kind !== "photo") return;
    const timer = window.setTimeout(() => {
      setDemoIndex((current) => Math.min(demoSteps.length - 1, current + 1));
    }, 3200);
    return () => window.clearTimeout(timer);
  }, [currentDemo, demoSteps.length]);

  async function downloadCover() {
    if (!primary?.url || !property) {
      setError("Cadastre ao menos uma foto para gerar a capa premium.");
      return;
    }
    setDownloading(true);
    setError(null);
    try {
      const image = new Image();
      image.crossOrigin = "anonymous";
      const loaded = new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("Não foi possível carregar a foto principal."));
      });
      image.src = primary.url;
      await loaded;

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

      ctx.fillStyle = theme.accent;
      ctx.fillRect(64, 60, 270, 54);
      ctx.fillStyle = themeKey === "claro" ? "#FFFFFF" : "#15110C";
      ctx.font = "700 25px Arial";
      ctx.fillText(badge.toUpperCase(), 84, 96);

      ctx.fillStyle = theme.ink;
      ctx.font = "700 34px Arial";
      ctx.fillText("E. SANTOS", 64, 646);
      ctx.font = "700 57px Arial";
      wrapText(ctx, headline, 64, 718, 900, 66, 3);

      ctx.fillStyle = theme.accent;
      ctx.font = "700 43px Arial";
      ctx.fillText(priceText, 64, 930);

      ctx.fillStyle = theme.ink;
      ctx.font = "500 27px Arial";
      if (location) ctx.fillText(location, 64, 980);
      if (info) ctx.fillText(info, 64, 1025);

      ctx.fillStyle = theme.accent;
      ctx.fillRect(842, 56, 174, 54);
      ctx.fillStyle = themeKey === "claro" ? "#FFFFFF" : "#15110C";
      ctx.font = "700 22px Arial";
      ctx.fillText("VEJA O BOOK", 858, 91);

      const data = canvas.toDataURL("image/png", 0.94);
      const link = document.createElement("a");
      link.href = data;
      link.download = `e-santos-${property.code || propertyId || "imovel"}-capa-premium.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível gerar a capa premium.");
    } finally {
      setDownloading(false);
    }
  }

  if (propertyId === null) {
    return (
      <div className="mt-5 border-t border-line pt-5">
        <div className="flex items-center gap-2 text-deep"><BookOpen className="h-4 w-4" /><p className="text-sm font-medium">Book / carrossel premium</p></div>
        <p className="mt-1 text-[11px] text-muted">O book será montado automaticamente depois que o imóvel receber o código interno e for aberto em Editar.</p>
      </div>
    );
  }

  return (
    <div className="mt-5 border-t border-line pt-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-deep"><BookOpen className="h-4 w-4" /><p className="text-sm font-medium">Book / carrossel premium</p></div>
          <p className="mt-1 max-w-3xl text-[11px] leading-relaxed text-muted">Usa a descrição já aprovada, a foto principal e a ordem atual da galeria. Não altera nem duplica as fotos originais.</p>
        </div>
        <Badge tone={primary ? "green" : "amber"}>{primary ? `${mediaCount} MÍDIAS PREPARADAS` : "AGUARDANDO FOTOS"}</Badge>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-deep"><span className="mb-1 block font-medium">Estilo da capa</span><select value={themeKey} onChange={(event) => setThemeKey(event.target.value as ThemeKey)} className="w-full rounded-[5px] border border-line bg-white px-3 py-2.5 text-sm">{Object.entries(THEMES).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}</select></label>
            <label className="text-xs text-deep"><span className="mb-1 block font-medium">Selo comercial</span><select value={badge} onChange={(event) => setBadge(event.target.value as (typeof BADGES)[number])} className="w-full rounded-[5px] border border-line bg-white px-3 py-2.5 text-sm">{BADGES.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
          </div>

          <div className="rounded-[10px] border border-line bg-bone/30 p-3">
            <div className="flex items-center gap-2 text-xs font-medium text-deep"><Sparkles className="h-3.5 w-3.5 text-brass" /> Conteúdo reaproveitado do cadastro</div>
            <p className="mt-2 text-[11px] leading-relaxed text-muted">{property?.description?.trim() ? property.description.trim().slice(0, 340) + (property.description.trim().length > 340 ? "…" : "") : "A descrição já existente será usada pelas integrações; este módulo não cria uma segunda descrição."}</p>
          </div>

          <div className="rounded-[10px] border border-line bg-white p-3">
            <p className="text-xs font-medium text-deep">Ordem oficial do book multicanal</p>
            <ol className="mt-2 space-y-1.5 text-[11px] text-muted">
              <li className="flex items-center gap-2"><Sparkles className="h-3.5 w-3.5" /> 1. Capa premium E. Santos</li>
              {shortReady && <li className="flex items-center gap-2"><Film className="h-3.5 w-3.5" /> 2. Vídeo curto / cabeça</li>}
              {bookPhotos.map((image, index) => (
                <li key={`${image.url}-${index}`} className="flex items-center gap-2">
                  <ImageIcon className="h-3.5 w-3.5" /> {index + (shortReady ? 3 : 2)}. Foto {images.indexOf(image) + 1}{image.isPrimary === 1 ? " · capa original" : ""}
                </li>
              ))}
              <li className="flex items-center gap-2"><BookOpen className="h-3.5 w-3.5" /> {mediaCount}. Resumo + CTA</li>
            </ol>
            <p className="mt-2 text-[10px] text-muted">Padrão-base: até 10 mídias. Ordem oficial: capa → vídeo → fotos → resumo/CTA.</p>
          </div>
        </div>

        <div>
          <div className="relative aspect-square overflow-hidden rounded-[12px] border border-line" style={{ background: theme.surface }}>
            {primary?.url && <img src={primary.url} alt="Prévia da capa premium" className="absolute inset-0 h-full w-full object-cover" />}
            <div className="absolute inset-0" style={{ background: `linear-gradient(to bottom, transparent 25%, ${theme.overlay} 62%, ${theme.surface} 100%)` }} />
            <div className="absolute inset-x-0 top-0 flex items-start justify-between p-5"><span className="rounded px-3 py-1.5 text-[10px] font-bold uppercase tracking-[.16em]" style={{ background: theme.accent, color: themeKey === "claro" ? "#fff" : "#15110c" }}>{badge}</span><span className="rounded px-3 py-1.5 text-[10px] font-bold uppercase tracking-[.14em]" style={{ background: theme.accent, color: themeKey === "claro" ? "#fff" : "#15110c" }}>Veja o book</span></div>
            {shortReady && <span className="absolute left-1/2 top-[43%] flex h-10 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-[10px] bg-[#FF0000] shadow-lg"><Play className="ml-0.5 h-5 w-5 fill-white text-white" /></span>}
            <div className="absolute inset-x-0 bottom-0 p-6" style={{ color: theme.ink }}><p className="text-[11px] font-bold uppercase tracking-[.2em]" style={{ color: theme.accent }}>E. Santos</p><h4 className="mt-2 max-w-[92%] text-2xl font-semibold leading-tight sm:text-3xl">{headline}</h4><p className="mt-4 text-xl font-semibold" style={{ color: theme.accent }}>{priceText}</p><p className="mt-2 text-xs">{location}</p><p className="mt-1 text-xs">{info}</p></div>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2"><p className="text-[10px] text-muted">Prévia quadrada 1:1. A galeria original permanece intacta.</p><Btn type="button" tone="outline" disabled={!primary || downloading} onClick={() => void downloadCover()}><Download className="h-3.5 w-3.5" /> {downloading ? "Gerando…" : "Baixar capa PNG"}</Btn></div>
          {error && <p className="mt-2 text-[11px] text-red-700">{error}</p>}
        </div>
      </div>

      {primary && currentDemo && (
        <div className="mt-5 rounded-[12px] border border-brass/30 bg-bone/20 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-medium text-deep">Demo funcional do Book</p>
              <p className="mt-1 text-[11px] text-muted">Clique no play da capa. O vídeo e as fotos seguem automaticamente até o resumo final.</p>
            </div>
            <Badge tone="green">{demoIndex + 1}/{demoSteps.length}</Badge>
          </div>

          <div className="mx-auto mt-4 max-w-xl">
            <div className="relative aspect-square overflow-hidden rounded-[12px] border border-line bg-black">
              {currentDemo.kind === "cover" && (
                <button type="button" className="absolute inset-0 block h-full w-full text-left" onClick={() => shortReady && setDemoIndex(1)}>
                  <img src={primary.url} alt="Capa premium" className="absolute inset-0 h-full w-full object-cover" />
                  <div className="absolute inset-0" style={{ background: `linear-gradient(to bottom, transparent 25%, ${theme.overlay} 62%, ${theme.surface} 100%)` }} />
                  <div className="absolute inset-x-0 top-0 flex items-start justify-between p-5"><span className="rounded px-3 py-1.5 text-[10px] font-bold uppercase tracking-[.16em]" style={{ background: theme.accent, color: themeKey === "claro" ? "#fff" : "#15110c" }}>{badge}</span><span className="rounded px-3 py-1.5 text-[10px] font-bold uppercase tracking-[.14em]" style={{ background: theme.accent, color: themeKey === "claro" ? "#fff" : "#15110c" }}>Assista ao vídeo</span></div>
                  {shortReady && <span className="absolute left-1/2 top-[42%] flex h-12 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-[11px] bg-[#FF0000] shadow-xl"><Play className="ml-0.5 h-6 w-6 fill-white text-white" /></span>}
                  <div className="absolute inset-x-0 bottom-0 p-6" style={{ color: theme.ink }}><p className="text-[11px] font-bold uppercase tracking-[.2em]" style={{ color: theme.accent }}>E. Santos</p><h4 className="mt-2 text-3xl font-semibold leading-tight">{headline}</h4><p className="mt-4 text-xl font-semibold" style={{ color: theme.accent }}>{priceText}</p><p className="mt-2 text-xs">{location}</p><p className="mt-1 text-xs">{info}</p></div>
                </button>
              )}

              {currentDemo.kind === "video" && (
                <video
                  src={currentDemo.url}
                  className="h-full w-full object-contain"
                  controls
                  autoPlay
                  playsInline
                  onEnded={() => setDemoIndex((current) => Math.min(demoSteps.length - 1, current + 1))}
                />
              )}

              {currentDemo.kind === "photo" && (
                <img src={currentDemo.url} alt={currentDemo.label} className="h-full w-full object-cover" />
              )}

              {currentDemo.kind === "cta" && (
                <div className="flex h-full flex-col overflow-y-auto p-7 text-left" style={{ background: theme.surface, color: theme.ink }}>
                  <div className="text-center">
                    <p className="text-xs font-bold uppercase tracking-[.2em]" style={{ color: theme.accent }}>E. Santos</p>
                    <h4 className="mt-3 text-2xl font-semibold leading-tight">{property?.title || headline}</h4>
                    <p className="mt-2 text-lg font-semibold" style={{ color: theme.accent }}>{priceText}</p>
                    <p className="mt-2 text-xs">{location}{location && info ? " · " : ""}{info}</p>
                  </div>

                  <div className="mt-5 rounded-[12px] border border-white/10 bg-black/15 p-4">
                    <p className="text-xs font-bold uppercase tracking-[.14em]" style={{ color: theme.accent }}>Conheça melhor este imóvel</p>
                    <p className="mt-2 text-[13px] leading-relaxed opacity-95">{ctaDescription}</p>
                  </div>

                  <div className="mt-5 text-center">
                    <p className="text-sm font-medium">Gostou deste imóvel?</p>
                    <p className="mt-1 text-[11px] opacity-80">Tire suas dúvidas e receba os detalhes direto no WhatsApp.</p>
                  </div>
                  <a
                    href={whatsappUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-3 flex items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-bold no-underline"
                    style={{ background: theme.accent, color: themeKey === "claro" ? "#fff" : "#15110c" }}
                  >
                    <MessageCircle className="h-5 w-5" /> Quero saber mais sobre este imóvel
                  </a>
                  <p className="mt-2 text-center text-[10px] opacity-70">Ao clicar, você inicia uma conversa com a E. Santos sobre este imóvel.</p>
                </div>
              )}

              <span className="absolute right-3 top-3 rounded-full bg-black/65 px-2.5 py-1 text-[10px] font-semibold text-white">{demoIndex + 1}/{demoSteps.length}</span>
            </div>

            <div className="mt-3 flex items-center justify-between gap-3">
              <Btn type="button" tone="outline" disabled={demoIndex === 0} onClick={() => setDemoIndex((current) => Math.max(0, current - 1))}><ChevronLeft className="h-3.5 w-3.5" /> Anterior</Btn>
              <p className="text-center text-[11px] font-medium text-deep">{currentDemo.label}</p>
              <Btn type="button" tone="outline" disabled={demoIndex >= demoSteps.length - 1} onClick={() => setDemoIndex((current) => Math.min(demoSteps.length - 1, current + 1))}>Próximo <ChevronRight className="h-3.5 w-3.5" /></Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
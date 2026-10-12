import { useEffect, useMemo, useState } from "react";
import { BookOpen, Download, Film, Image as ImageIcon, Sparkles } from "lucide-react";
import type { GalleryImage } from "./property-gallery";
import { Badge, Btn } from "./ui";

type ThemeKey = "ouro" | "azul" | "oliva" | "claro";

type VideoRow = { kind?: string };

type Theme = {
  label: string;
  accent: string;
  ink: string;
  surface: string;
  overlay: string;
};

const THEMES: Record<ThemeKey, Theme> = {
  ouro: { label: "Ouro premium", accent: "#D1A24B", ink: "#FFF8EA", surface: "#20150D", overlay: "rgba(21,12,7,.76)" },
  azul: { label: "Azul executivo", accent: "#D7B56D", ink: "#F7F3EA", surface: "#0C1B2B", overlay: "rgba(7,20,34,.78)" },
  oliva: { label: "Oliva sofisticado", accent: "#D8BE7A", ink: "#FFFDF4", surface: "#253027", overlay: "rgba(23,35,26,.78)" },
  claro: { label: "Clean premium", accent: "#8A6329", ink: "#1B1712", surface: "#F3EEE4", overlay: "rgba(244,239,229,.88)" },
};

const BADGES = ["Oportunidade", "Exclusivo", "Alto padrão", "Destaque", "Tour completo", "Nova captação"] as const;

function formatInfo(label: string, value: string | number) {
  const text = String(value ?? "").trim();
  return text && text !== "0" ? `${text} ${label}` : null;
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

export function PropertyMarketingBook({
  propertyId,
  images,
  title,
  highlight,
  price,
  opportunityPrice,
  district,
  city,
  bedrooms,
  suites,
  parking,
  areaUtil,
  code,
  description,
}: {
  propertyId: number | null;
  images: GalleryImage[];
  title: string;
  highlight: string;
  price: string;
  opportunityPrice: string;
  district: string;
  city: string;
  bedrooms: string;
  suites: string;
  parking: string;
  areaUtil: string;
  code: string;
  description: string;
}) {
  const [themeKey, setThemeKey] = useState<ThemeKey>("ouro");
  const [badge, setBadge] = useState<(typeof BADGES)[number]>("Destaque");
  const [shortReady, setShortReady] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (propertyId === null) {
      setShortReady(false);
      return;
    }
    let alive = true;
    void fetch(`/api/admin/property-videos/${propertyId}`, { credentials: "same-origin" })
      .then(async (response) => {
        if (!response.ok) return { videos: [] as VideoRow[] };
        return response.json() as Promise<{ videos?: VideoRow[] }>;
      })
      .then((payload) => {
        if (alive) setShortReady(Boolean(payload.videos?.some((video) => video.kind === "short_social")));
      })
      .catch(() => {
        if (alive) setShortReady(false);
      });
    return () => { alive = false; };
  }, [propertyId]);

  const primary = useMemo(() => images.find((image) => image.isPrimary) ?? images[0] ?? null, [images]);
  const maxPhotos = shortReady ? 8 : 9;
  const bookPhotos = useMemo(() => images.slice(0, maxPhotos), [images, maxPhotos]);
  const theme = THEMES[themeKey];
  const headline = (highlight || title || "Imóvel em destaque").trim();
  const priceText = (opportunityPrice || price).trim() ? `R$ ${(opportunityPrice || price).trim()}` : "Consulte o valor";
  const info = [
    formatInfo("dorm.", bedrooms),
    formatInfo("suíte", suites),
    formatInfo("vaga", parking),
    formatInfo("m²", areaUtil),
  ].filter(Boolean).join(" · ");
  const location = [district, city].filter(Boolean).join(" · ");
  const mediaCount = Number(shortReady) + 1 + bookPhotos.length;

  async function downloadCover() {
    if (!primary?.url) {
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
      const gradient = ctx.createLinearGradient(0, 360, 0, 1080);
      gradient.addColorStop(0, "rgba(0,0,0,0.02)");
      gradient.addColorStop(0.5, theme.overlay);
      gradient.addColorStop(1, theme.surface);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 1080, 1080);

      ctx.fillStyle = theme.accent;
      ctx.fillRect(64, 60, 250, 54);
      ctx.fillStyle = themeKey === "claro" ? "#FFFFFF" : "#15110C";
      ctx.font = "700 25px Arial";
      ctx.fillText(badge.toUpperCase(), 84, 96);

      ctx.fillStyle = theme.ink;
      ctx.font = "700 34px Arial";
      ctx.fillText("E. SANTOS", 64, 650);
      ctx.font = "700 57px Arial";
      wrapText(ctx, headline, 64, 720, 900, 66, 3);

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
      link.download = `e-santos-${code || propertyId || "imovel"}-capa-premium.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível gerar a capa premium.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="mt-5 border-t border-line pt-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-deep">
            <BookOpen className="h-4 w-4" />
            <p className="text-sm font-medium">Book / carrossel premium</p>
          </div>
          <p className="mt-1 max-w-3xl text-[11px] leading-relaxed text-muted">
            Usa o cadastro, a foto principal e a ordem atual da galeria. Não altera nem duplica as fotos originais do imóvel.
          </p>
        </div>
        <Badge tone={primary ? "green" : "amber"}>{primary ? `${mediaCount} MÍDIAS PREPARADAS` : "AGUARDANDO FOTOS"}</Badge>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-deep">
              <span className="mb-1 block font-medium">Estilo da capa</span>
              <select value={themeKey} onChange={(event) => setThemeKey(event.target.value as ThemeKey)} className="w-full rounded-[5px] border border-line bg-white px-3 py-2.5 text-sm">
                {Object.entries(THEMES).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}
              </select>
            </label>
            <label className="text-xs text-deep">
              <span className="mb-1 block font-medium">Selo comercial</span>
              <select value={badge} onChange={(event) => setBadge(event.target.value as (typeof BADGES)[number])} className="w-full rounded-[5px] border border-line bg-white px-3 py-2.5 text-sm">
                {BADGES.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
          </div>

          <div className="rounded-[10px] border border-line bg-bone/30 p-3">
            <div className="flex items-center gap-2 text-xs font-medium text-deep"><Sparkles className="h-3.5 w-3.5 text-brass" /> Conteúdo reaproveitado do cadastro</div>
            <p className="mt-2 text-[11px] leading-relaxed text-muted">{description.trim() ? description.trim().slice(0, 340) + (description.trim().length > 340 ? "…" : "") : "A descrição já existente será usada pelas integrações; este módulo não cria uma segunda descrição."}</p>
          </div>

          <div className="rounded-[10px] border border-line bg-white p-3">
            <p className="text-xs font-medium text-deep">Ordem do book multicanal</p>
            <ol className="mt-2 space-y-1.5 text-[11px] text-muted">
              {shortReady && <li className="flex items-center gap-2"><Film className="h-3.5 w-3.5" /> 1. Vídeo curto / cabeça</li>}
              <li className="flex items-center gap-2"><Sparkles className="h-3.5 w-3.5" /> {shortReady ? 2 : 1}. Capa premium E. Santos</li>
              {bookPhotos.map((image, index) => (
                <li key={`${image.url}-${index}`} className="flex items-center gap-2"><ImageIcon className="h-3.5 w-3.5" /> {index + (shortReady ? 3 : 2)}. Foto {images.indexOf(image) + 1}{image.isPrimary ? " · capa original" : ""}</li>
              ))}
            </ol>
            <p className="mt-2 text-[10px] text-muted">Padrão-base: até 10 mídias. As integrações futuras adaptarão esse book ao limite de cada plataforma.</p>
          </div>
        </div>

        <div>
          <div className="relative aspect-square overflow-hidden rounded-[12px] border border-line" style={{ background: theme.surface }}>
            {primary?.url && <img src={primary.url} alt="Prévia da capa premium" className="absolute inset-0 h-full w-full object-cover" />}
            <div className="absolute inset-0" style={{ background: `linear-gradient(to bottom, transparent 25%, ${theme.overlay} 62%, ${theme.surface} 100%)` }} />
            <div className="absolute inset-x-0 top-0 flex items-start justify-between p-5">
              <span className="rounded px-3 py-1.5 text-[10px] font-bold uppercase tracking-[.16em]" style={{ background: theme.accent, color: themeKey === "claro" ? "#fff" : "#15110c" }}>{badge}</span>
              <span className="rounded px-3 py-1.5 text-[10px] font-bold uppercase tracking-[.14em]" style={{ background: theme.accent, color: themeKey === "claro" ? "#fff" : "#15110c" }}>Veja o book</span>
            </div>
            <div className="absolute inset-x-0 bottom-0 p-6" style={{ color: theme.ink }}>
              <p className="text-[11px] font-bold uppercase tracking-[.2em]" style={{ color: theme.accent }}>E. Santos</p>
              <h4 className="mt-2 max-w-[92%] text-2xl font-semibold leading-tight sm:text-3xl">{headline}</h4>
              <p className="mt-4 text-xl font-semibold" style={{ color: theme.accent }}>{priceText}</p>
              <p className="mt-2 text-xs">{location}</p>
              <p className="mt-1 text-xs">{info}</p>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[10px] text-muted">Prévia quadrada 1:1. A galeria original permanece intacta.</p>
            <Btn type="button" tone="outline" disabled={!primary || downloading} onClick={() => void downloadCover()}>
              <Download className="h-3.5 w-3.5" /> {downloading ? "Gerando…" : "Baixar capa PNG"}
            </Btn>
          </div>
          {error && <p className="mt-2 text-[11px] text-red-700">{error}</p>}
        </div>
      </div>
    </div>
  );
}

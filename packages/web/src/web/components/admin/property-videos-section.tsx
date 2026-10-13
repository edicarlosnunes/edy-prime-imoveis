import { useCallback, useEffect, useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import { CheckCircle2, Film, Loader2, Send, Trash2, Upload, Youtube } from "lucide-react";
import { Badge, Btn, ErrorNote } from "./ui";
import { PropertyMarketingBook } from "./property-marketing-book";

export type PropertyVideoKind = "short_social" | "youtube_long";
type SocialTarget = "instagram" | "facebook" | "youtube";

type PropertyVideo = {
  id: number;
  propertyId: number;
  kind: PropertyVideoKind;
  url: string;
  pathname: string | null;
  fileName: string | null;
  mime: string | null;
  size: number | null;
  durationSeconds: number | null;
};

const SLOTS = [
  {
    kind: "short_social" as const,
    title: "Vídeo curto · Instagram / Facebook",
    description: "Encaixe aqui o vídeo curto. Ele entra automaticamente no Book Premium abaixo; não precisa publicar separado.",
    recommendation: "Padrão social: até 60 segundos.",
  },
  {
    kind: "youtube_long" as const,
    title: "Vídeo completo · YouTube",
    description: "Apresentação completa do imóvel. É independente do Book curto e pode ser publicada no YouTube quando estiver pronta.",
    recommendation: "Recomendado: aproximadamente 2 a 3 minutos.",
  },
];

function fileSize(value: number | null) {
  if (!value) return "";
  const mb = value / 1024 / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

function durationLabel(value: number | null) {
  if (!value) return "";
  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

async function videoDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      const value = Number.isFinite(video.duration) ? Math.round(video.duration) : 0;
      URL.revokeObjectURL(url);
      resolve(value);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(0);
    };
    video.src = url;
  });
}

function safeName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(-140);
}

async function responseError(response: Response, fallback: string) {
  const payload = await response.json().catch(() => ({})) as { error?: string; message?: string };
  return payload.error || payload.message || fallback;
}

export function PropertyVideosSection({ propertyId }: { propertyId: number | null }) {
  const [videos, setVideos] = useState<PropertyVideo[]>([]);
  const [loading, setLoading] = useState(propertyId !== null);
  const [busy, setBusy] = useState<PropertyVideoKind | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [publishBusy, setPublishBusy] = useState(false);
  const [publishMessage, setPublishMessage] = useState<string | null>(null);
  const [targets, setTargets] = useState<Record<SocialTarget, boolean>>({ instagram: false, facebook: false, youtube: false });
  const shortInput = useRef<HTMLInputElement>(null);
  const longInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (propertyId === null) {
      setVideos([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const response = await fetch(`/api/admin/property-videos/${propertyId}`, { credentials: "same-origin" });
      const payload = await response.json().catch(() => ({})) as { videos?: PropertyVideo[]; error?: string };
      if (!response.ok) throw new Error(payload.error || "Não foi possível carregar os vídeos.");
      setVideos(payload.videos ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível carregar os vídeos.");
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => { void load(); }, [load]);

  const shortVideo = videos.find((video) => video.kind === "short_social") ?? null;
  const longVideo = videos.find((video) => video.kind === "youtube_long") ?? null;
  const missing = Number(!shortVideo) + Number(!longVideo);
  const selectedCount = Object.values(targets).filter(Boolean).length;

  async function choose(kind: PropertyVideoKind, file: File | null) {
    if (!file || propertyId === null) return;
    setError(null);
    setPublishMessage(null);
    if (!file.type.startsWith("video/")) {
      setError("Selecione um arquivo de vídeo.");
      return;
    }
    const durationSeconds = await videoDuration(file);
    if (kind === "short_social" && durationSeconds > 60) {
      setError(`O vídeo curto tem ${durationLabel(durationSeconds)}. Para o Book social, use no máximo 1:00.`);
      return;
    }

    setBusy(kind);
    setProgress(0);
    try {
      const filename = safeName(file.name || `${kind}.mp4`);
      const blob = await upload(`properties/${propertyId}/${kind}/${filename}`, file, {
        access: "public",
        handleUploadUrl: "/api/admin/property-videos/upload",
        clientPayload: JSON.stringify({ propertyId, kind }),
        multipart: true,
        contentType: file.type || undefined,
        onUploadProgress: ({ percentage }) => setProgress(Math.round(percentage)),
      });

      const response = await fetch("/api/admin/property-videos/attach", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          propertyId,
          kind,
          url: blob.url,
          pathname: blob.pathname,
          fileName: file.name,
          mime: file.type,
          size: file.size,
          durationSeconds,
        }),
      });
      if (!response.ok) throw new Error(await responseError(response, "Não foi possível vincular o vídeo ao imóvel."));
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha no upload do vídeo.");
    } finally {
      setBusy(null);
      setProgress(0);
      if (shortInput.current) shortInput.current.value = "";
      if (longInput.current) longInput.current.value = "";
    }
  }

  async function remove(kind: PropertyVideoKind) {
    if (propertyId === null) return;
    if (!window.confirm("Remover este vídeo do imóvel? Isso não remove nem bloqueia o imóvel.")) return;
    setBusy(kind);
    setError(null);
    setPublishMessage(null);
    try {
      const response = await fetch(`/api/admin/property-videos/${propertyId}/${kind}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error(await responseError(response, "Não foi possível remover o vídeo."));
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível remover o vídeo.");
    } finally {
      setBusy(null);
    }
  }

  async function publishLong() {
    if (propertyId === null || !longVideo) return;
    setPublishBusy(true);
    setError(null);
    setPublishMessage(null);
    try {
      const source = await fetch(longVideo.url);
      if (!source.ok) throw new Error("Não foi possível abrir o vídeo completo armazenado.");
      const blob = await source.blob();
      const mime = longVideo.mime || blob.type || "video/mp4";
      const session = await fetch("/api/oauth/youtube/upload-session", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ propertyId, fileName: longVideo.fileName || "video-imovel.mp4", fileSize: blob.size, mime }),
      });
      if (!session.ok) throw new Error(await responseError(session, "Não foi possível preparar o upload no YouTube."));
      const prepared = await session.json() as { uploadUrl: string; accessToken: string };
      const sent = await fetch(prepared.uploadUrl, {
        method: "PUT",
        headers: { authorization: `Bearer ${prepared.accessToken}`, "content-type": mime },
        body: blob,
      });
      const youtube = await sent.json().catch(() => ({})) as { id?: string; error?: { message?: string } };
      if (!sent.ok || !youtube.id) throw new Error(youtube.error?.message || "O YouTube não concluiu o upload.");
      const complete = await fetch("/api/oauth/youtube/upload-complete", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ propertyId, videoId: youtube.id }),
      });
      if (!complete.ok) throw new Error(await responseError(complete, "Vídeo enviado, mas não foi possível registrar o retorno."));
      const result = await complete.json() as { message?: string; link?: string };
      setPublishMessage(`YouTube: ${result.message || "vídeo enviado como privado"}${result.link ? `\n${result.link}` : ""}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha ao publicar o vídeo completo no YouTube.");
    } finally {
      setPublishBusy(false);
    }
  }

  async function publishSelectedShort() {
    if (propertyId === null || !shortVideo || selectedCount === 0) return;
    setPublishBusy(true);
    setError(null);
    setPublishMessage(null);
    const messages: string[] = [];
    try {
      if (targets.facebook) {
        const response = await fetch(`/api/admin/property-videos/${propertyId}/publish-meta`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ targets: ["facebook"], force: false }),
        });
        const payload = await response.json().catch(() => ({})) as { error?: string; results?: { facebook?: { message?: string } } };
        if (!response.ok) throw new Error(payload.error || payload.results?.facebook?.message || "Falha ao publicar no Facebook.");
        messages.push(payload.results?.facebook?.message || "Facebook: vídeo curto publicado.");
      }

      if (targets.youtube) {
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
        messages.push(result.message || "YouTube Shorts: vídeo curto publicado.");
      }

      if (targets.instagram) {
        messages.push("Instagram selecionado: use o botão do Book Premium abaixo para publicar capa + vídeo + fotos + encerramento.");
      }
      setPublishMessage(messages.join("\n\n"));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha ao publicar nos canais selecionados.");
    } finally {
      setPublishBusy(false);
    }
  }

  return (
    <div className="mt-5 border-t border-line pt-5">
      <div className="rounded-[10px] border border-line bg-bone/30 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-deep">Destinos de publicação</p>
            <p className="mt-1 text-[11px] text-muted">Escolha para onde este conteúdo será enviado. Instagram usa o Book Premium; Facebook e YouTube Shorts usam o vídeo curto.</p>
          </div>
          <Badge tone={selectedCount > 0 ? "green" : "amber"}>{selectedCount > 0 ? `${selectedCount} SELECIONADO${selectedCount > 1 ? "S" : ""}` : "NENHUM SELECIONADO"}</Badge>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-3">
          <label className="flex items-center gap-2 text-sm text-deep"><input type="checkbox" checked={targets.instagram} onChange={(event) => setTargets((current) => ({ ...current, instagram: event.target.checked }))} /> Instagram</label>
          <label className="flex items-center gap-2 text-sm text-deep"><input type="checkbox" checked={targets.facebook} onChange={(event) => setTargets((current) => ({ ...current, facebook: event.target.checked }))} /> Facebook</label>
          <label className="flex items-center gap-2 text-sm text-deep"><input type="checkbox" checked={targets.youtube} onChange={(event) => setTargets((current) => ({ ...current, youtube: event.target.checked }))} /> YouTube Shorts</label>
        </div>
        <div className="mt-3">
          <Btn type="button" tone="outline" disabled={!shortVideo || selectedCount === 0 || publishBusy} onClick={() => void publishSelectedShort()}>{publishBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Publicar nos canais selecionados</Btn>
          {!shortVideo && <p className="mt-2 text-[11px] text-muted">Encaixe o vídeo curto antes de enviar para Facebook ou YouTube Shorts.</p>}
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-deep"><Film className="h-4 w-4" /><p className="text-sm font-medium">Vídeos do imóvel</p></div>
          <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-muted">Esta área é independente do salvamento principal do imóvel. Você pode concluir o cadastro e depois encaixar, substituir ou corrigir os vídeos sem mexer nos dados já salvos.</p>
        </div>
        <Badge tone={missing === 0 ? "green" : "red"}>{missing === 0 ? "VÍDEOS COMPLETOS" : missing === 2 ? "2 VÍDEOS PENDENTES" : "1 VÍDEO PENDENTE"}</Badge>
      </div>

      {loading ? (
        <div className="mt-4 flex items-center gap-2 text-xs text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Carregando vídeos…</div>
      ) : (
        <>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {SLOTS.map((slot) => {
              const video = videos.find((item) => item.kind === slot.kind);
              const slotBusy = busy === slot.kind;
              const inputRef = slot.kind === "short_social" ? shortInput : longInput;
              return (
                <div key={slot.kind} className={`rounded-[8px] border p-4 ${video ? "border-emerald-200 bg-emerald-50/40" : "border-red-200 bg-red-50/50"}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium text-deep">{slot.title}</p><Badge tone={video ? "green" : "red"}>{video ? "PRONTO" : "PENDENTE"}</Badge></div>
                  <p className="mt-2 text-xs leading-relaxed text-muted">{slot.description}</p>
                  <p className="mt-1 text-[11px] font-medium text-deep">{slot.recommendation}</p>

                  {video && (
                    <div className="mt-3 rounded border border-line bg-white p-3">
                      <div className="flex items-center gap-2 text-xs text-emerald-800"><CheckCircle2 className="h-4 w-4" /> Arquivo vinculado ao imóvel</div>
                      <p className="mt-1 truncate text-[11px] text-muted">{video.fileName || "vídeo"}</p>
                      <p className="mt-0.5 text-[11px] text-muted">{[durationLabel(video.durationSeconds), fileSize(video.size)].filter(Boolean).join(" · ")}</p>
                      <a href={video.url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-[11px] text-brass underline underline-offset-2">Abrir vídeo</a>
                    </div>
                  )}

                  {slotBusy && <div className="mt-3"><div className="h-1.5 overflow-hidden rounded bg-bone"><div className="h-full bg-deep transition-all" style={{ width: `${Math.max(3, progress)}%` }} /></div><p className="mt-1 text-[11px] text-muted">Enviando… {progress}%</p></div>}

                  <input ref={inputRef} type="file" accept="video/mp4,video/quicktime,video/webm,video/x-m4v,video/mpeg" className="hidden" onChange={(event) => void choose(slot.kind, event.target.files?.[0] ?? null)} />
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Btn type="button" tone="outline" disabled={Boolean(busy) || propertyId === null} title={propertyId === null ? "Finalize o cadastro do imóvel para anexar o vídeo." : undefined} onClick={() => inputRef.current?.click()}><Upload className="h-3.5 w-3.5" /> {video ? "Substituir vídeo" : "Selecionar vídeo"}</Btn>
                    {video && <Btn type="button" tone="outline" disabled={Boolean(busy)} onClick={() => void remove(slot.kind)}><Trash2 className="h-3.5 w-3.5" /> Remover</Btn>}
                  </div>

                  {slot.kind === "youtube_long" && propertyId !== null && (
                    <div className="mt-4 border-t border-line pt-3">
                      <Btn type="button" tone="brass" disabled={!longVideo || publishBusy} onClick={() => void publishLong()}>{publishBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Youtube className="h-3.5 w-3.5" />} Publicar vídeo completo no YouTube</Btn>
                      {!longVideo && <p className="mt-2 text-[11px] text-muted">Cadastre primeiro o vídeo completo.</p>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {publishMessage && <div className="mt-4 whitespace-pre-line rounded-[6px] border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">{publishMessage}</div>}
          {propertyId === null && <p className="mt-3 text-[11px] text-muted">Os vídeos serão liberados depois que o imóvel receber o código interno definitivo. Isso não bloqueia nem altera o cadastro principal.</p>}
        </>
      )}

      <ErrorNote message={error} />
      <PropertyMarketingBook propertyId={propertyId} />
    </div>
  );
}

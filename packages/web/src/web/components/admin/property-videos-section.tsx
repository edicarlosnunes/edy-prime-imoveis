import { useCallback, useEffect, useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import { CheckCircle2, Film, Loader2, Send, Trash2, Upload, Youtube } from "lucide-react";
import { Badge, Btn, ErrorNote } from "./ui";

export type PropertyVideoKind = "short_social" | "youtube_long";

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

type SlotConfig = {
  kind: PropertyVideoKind;
  title: string;
  description: string;
  recommendation: string;
};

const SLOTS: SlotConfig[] = [
  {
    kind: "short_social",
    title: "Vídeo curto · Instagram / Facebook",
    description: "Arquivo principal para Reels, Facebook e futuros anúncios do imóvel.",
    recommendation: "Até 60 segundos.",
  },
  {
    kind: "youtube_long",
    title: "Vídeo completo · YouTube",
    description: "Apresentação completa do imóvel. Depois da publicação, o link do YouTube fica ligado ao imóvel.",
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
  const [instagram, setInstagram] = useState(true);
  const [facebook, setFacebook] = useState(true);
  const [youtubeShort, setYoutubeShort] = useState(false);
  const shortInput = useRef<HTMLInputElement>(null);
  const longInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (propertyId === null) return;
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

  useEffect(() => {
    void load();
  }, [load]);

  const shortVideo = videos.find((video) => video.kind === "short_social") ?? null;
  const longVideo = videos.find((video) => video.kind === "youtube_long") ?? null;
  const shortReady = Boolean(shortVideo);
  const youtubeReady = Boolean(longVideo);
  const missing = Number(!shortReady) + Number(!youtubeReady);

  async function choose(kind: PropertyVideoKind, file: File | null) {
    if (!file || propertyId === null) return;
    setError(null);
    setPublishMessage(null);
    const durationSeconds = await videoDuration(file);
    if (kind === "short_social" && durationSeconds > 60) {
      setError(`O vídeo curto tem ${durationLabel(durationSeconds)}. Para Instagram/Facebook, use no máximo 1:00.`);
      return;
    }
    if (!file.type.startsWith("video/")) {
      setError("Selecione um arquivo de vídeo.");
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
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Não foi possível vincular o vídeo ao imóvel.");
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
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Não foi possível remover o vídeo.");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível remover o vídeo.");
    } finally {
      setBusy(null);
    }
  }

  async function uploadStoredVideoToYouTube(
    video: PropertyVideo,
    mode: "short" | "long",
  ) {
    if (propertyId === null) return null;
    const source = await fetch(video.url);
    if (!source.ok) throw new Error("Não foi possível abrir o arquivo de vídeo armazenado.");
    const blob = await source.blob();
    const mime = video.mime || blob.type || "video/mp4";

    if (mode === "short") {
      const session = await fetch(`/api/admin/property-videos/${propertyId}/youtube-short-session`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ force: false }),
      });
      if (!session.ok) throw new Error(await responseError(session, "Não foi possível preparar o YouTube Short."));
      const prepared = await session.json() as { uploadUrl: string; accessToken: string };
      const sent = await fetch(prepared.uploadUrl, {
        method: "PUT",
        headers: {
          authorization: `Bearer ${prepared.accessToken}`,
          "content-type": mime,
          "content-length": String(blob.size),
        },
        body: blob,
      });
      const youtube = await sent.json().catch(() => ({})) as { id?: string; error?: { message?: string } };
      if (!sent.ok || !youtube.id) throw new Error(youtube.error?.message || "O YouTube não concluiu o envio do Short.");
      const complete = await fetch(`/api/admin/property-videos/${propertyId}/youtube-short-complete`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ videoId: youtube.id }),
      });
      if (!complete.ok) throw new Error(await responseError(complete, "Short enviado, mas não foi possível registrar o retorno."));
      return await complete.json() as { message?: string; link?: string };
    }

    const session = await fetch("/api/oauth/youtube/upload-session", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        propertyId,
        fileName: video.fileName || "video-imovel.mp4",
        fileSize: blob.size,
        mime,
      }),
    });
    if (!session.ok) throw new Error(await responseError(session, "Não foi possível preparar o upload no YouTube."));
    const prepared = await session.json() as { uploadUrl: string; accessToken: string };
    const sent = await fetch(prepared.uploadUrl, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${prepared.accessToken}`,
        "content-type": mime,
        "content-length": String(blob.size),
      },
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
    return await complete.json() as { message?: string; link?: string };
  }

  async function publishShort() {
    if (propertyId === null || !shortVideo) return;
    if (!instagram && !facebook && !youtubeShort) {
      setError("Selecione pelo menos um destino para o vídeo curto.");
      return;
    }
    setPublishBusy(true);
    setError(null);
    setPublishMessage(null);
    const messages: string[] = [];
    try {
      const metaTargets = [instagram ? "instagram" : null, facebook ? "facebook" : null].filter(Boolean);
      if (metaTargets.length > 0) {
        const response = await fetch(`/api/admin/property-videos/${propertyId}/publish-meta`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ targets: metaTargets, force: false }),
        });
        const payload = await response.json().catch(() => ({})) as {
          error?: string;
          results?: Record<string, { ok?: boolean; message?: string }>;
        };
        if (!response.ok && !payload.results) throw new Error(payload.error || "Falha ao publicar nas redes Meta.");
        for (const [target, result] of Object.entries(payload.results ?? {})) {
          messages.push(`${target === "instagram" ? "Instagram" : "Facebook"}: ${result.message || (result.ok ? "publicado" : "erro")}`);
        }
      }
      if (youtubeShort) {
        const result = await uploadStoredVideoToYouTube(shortVideo, "short");
        messages.push(`YouTube Shorts: ${result?.message || "enviado como privado"}`);
      }
      setPublishMessage(messages.join("\n"));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha ao publicar o vídeo curto.");
      if (messages.length > 0) setPublishMessage(messages.join("\n"));
    } finally {
      setPublishBusy(false);
    }
  }

  async function publishLong() {
    if (propertyId === null || !longVideo) return;
    setPublishBusy(true);
    setError(null);
    setPublishMessage(null);
    try {
      const result = await uploadStoredVideoToYouTube(longVideo, "long");
      setPublishMessage(`YouTube: ${result?.message || "vídeo enviado como privado"}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha ao publicar o vídeo completo no YouTube.");
    } finally {
      setPublishBusy(false);
    }
  }

  return (
    <div className="mt-5 border-t border-line pt-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-deep">
            <Film className="h-4 w-4" />
            <p className="text-sm font-medium">Vídeos do imóvel</p>
          </div>
          <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-muted">
            Última etapa operacional. Vídeo faltando não bloqueia cadastro, site, anúncio ou publicação do imóvel.
          </p>
        </div>
        <Badge tone={missing === 0 ? "green" : "red"}>
          {missing === 0 ? "VÍDEOS COMPLETOS" : missing === 2 ? "2 VÍDEOS PENDENTES" : "1 VÍDEO PENDENTE"}
        </Badge>
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
              const canUpload = propertyId !== null;
              return (
                <div key={slot.kind} className={`rounded-[8px] border p-4 ${video ? "border-emerald-200 bg-emerald-50/40" : "border-red-200 bg-red-50/50"}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium text-deep">{slot.title}</p>
                    <Badge tone={video ? "green" : "red"}>{video ? "PRONTO" : "PENDENTE"}</Badge>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-muted">{slot.description}</p>
                  <p className="mt-1 text-[11px] font-medium text-deep">{slot.recommendation}</p>

                  {video && (
                    <div className="mt-3 rounded border border-line bg-white p-3">
                      <div className="flex items-center gap-2 text-xs text-emerald-800">
                        <CheckCircle2 className="h-4 w-4" /> Arquivo vinculado ao imóvel
                      </div>
                      <p className="mt-1 truncate text-[11px] text-muted">{video.fileName || "vídeo"}</p>
                      <p className="mt-0.5 text-[11px] text-muted">
                        {[durationLabel(video.durationSeconds), fileSize(video.size)].filter(Boolean).join(" · ")}
                      </p>
                      <a href={video.url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-[11px] text-brass underline underline-offset-2">Abrir vídeo</a>
                    </div>
                  )}

                  {slotBusy && (
                    <div className="mt-3">
                      <div className="h-1.5 overflow-hidden rounded bg-bone"><div className="h-full bg-deep transition-all" style={{ width: `${Math.max(3, progress)}%` }} /></div>
                      <p className="mt-1 text-[11px] text-muted">Enviando… {progress}%</p>
                    </div>
                  )}

                  <input
                    ref={inputRef}
                    type="file"
                    accept="video/mp4,video/quicktime,video/webm,video/x-m4v,video/mpeg"
                    className="hidden"
                    onChange={(event) => void choose(slot.kind, event.target.files?.[0] ?? null)}
                  />
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Btn
                      type="button"
                      tone="outline"
                      disabled={Boolean(busy) || !canUpload}
                      title={canUpload ? undefined : "Finalize o cadastro do imóvel para anexar o vídeo."}
                      onClick={() => inputRef.current?.click()}
                    >
                      <Upload className="h-3.5 w-3.5" /> {video ? "Substituir vídeo" : "Selecionar vídeo"}
                    </Btn>
                    {video && (
                      <Btn type="button" tone="outline" disabled={Boolean(busy)} onClick={() => void remove(slot.kind)}>
                        <Trash2 className="h-3.5 w-3.5" /> Remover
                      </Btn>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {propertyId !== null && (
            <div className="mt-4 rounded-[8px] border border-line bg-bone/25 p-4">
              <div className="flex items-center gap-2 text-deep">
                <Send className="h-4 w-4" />
                <p className="text-sm font-medium">Publicar / enviar vídeo</p>
              </div>
              <p className="mt-1 text-[11px] text-muted">Primeiro o arquivo fica guardado no imóvel. Depois você escolhe para quais canais quer enviar.</p>

              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <div className="rounded-[8px] border border-line bg-white p-4">
                  <p className="text-sm font-medium text-deep">Vídeo curto</p>
                  <div className="mt-3 grid gap-2 text-sm text-deep">
                    <label className="flex items-center gap-2"><input type="checkbox" checked={instagram} onChange={(event) => setInstagram(event.target.checked)} /> Instagram</label>
                    <label className="flex items-center gap-2"><input type="checkbox" checked={facebook} onChange={(event) => setFacebook(event.target.checked)} /> Facebook</label>
                    <label className="flex items-center gap-2"><input type="checkbox" checked={youtubeShort} onChange={(event) => setYoutubeShort(event.target.checked)} /> YouTube Shorts</label>
                  </div>
                  <Btn type="button" tone="brass" className="mt-4" disabled={!shortVideo || publishBusy} onClick={() => void publishShort()}>
                    {publishBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                    Publicar vídeo curto
                  </Btn>
                  {!shortVideo && <p className="mt-2 text-[11px] text-muted">Cadastre primeiro o vídeo curto acima.</p>}
                </div>

                <div className="rounded-[8px] border border-line bg-white p-4">
                  <p className="text-sm font-medium text-deep">Vídeo completo</p>
                  <p className="mt-2 text-xs text-muted">Destino: YouTube. No primeiro teste, o vídeo continua sendo enviado como privado.</p>
                  <Btn type="button" tone="brass" className="mt-4" disabled={!longVideo || publishBusy} onClick={() => void publishLong()}>
                    {publishBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Youtube className="h-3.5 w-3.5" />}
                    Publicar vídeo completo
                  </Btn>
                  {!longVideo && <p className="mt-2 text-[11px] text-muted">Cadastre primeiro o vídeo completo acima.</p>}
                </div>
              </div>

              {publishMessage && (
                <div className="mt-4 whitespace-pre-line rounded-[6px] border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
                  {publishMessage}
                </div>
              )}
            </div>
          )}

          {propertyId === null && (
            <p className="mt-3 text-[11px] text-muted">
              Os dois campos já fazem parte deste cadastro. Como o imóvel ainda não recebeu o código interno definitivo, os botões de envio serão liberados assim que o cadastro for finalizado e aberto em Editar. Isso não bloqueia o imóvel e não muda nenhuma outra etapa.
            </p>
          )}
        </>
      )}

      <ErrorNote message={error} />
    </div>
  );
}

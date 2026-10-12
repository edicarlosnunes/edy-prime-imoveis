import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Circle, ExternalLink, Play, RefreshCw, Save, Upload, Youtube } from "lucide-react";
import { AdminGuard } from "../../components/admin/guard";
import { AdminLayout } from "../../components/admin/layout";
import { Badge, Btn, Card, ErrorNote, Field, Input, Select } from "../../components/admin/ui";
import { orpc } from "../../lib/api";
import { errorMessage } from "../../lib/admin-session";

const steps = [
  {
    title: "Preparar Google Cloud",
    detail: "Ativar YouTube Data API v3 e criar um cliente OAuth 2.0 do tipo Aplicativo da Web.",
  },
  {
    title: "Conectar o canal",
    detail: "Autorizar o CRM com youtube.upload + leitura do canal e guardar o refresh token com segurança.",
  },
  {
    title: "Testar conexão",
    detail: "Confirmar pela API qual canal foi autorizado antes de liberar qualquer envio.",
  },
  {
    title: "Enviar 1 vídeo de teste",
    detail: "Selecionar um imóvel aprovado, enviar o vídeo como privado e conferir título, link e status no YouTube.",
  },
];

type YouTubeConfig = {
  clientId: string;
  clientSecret: string;
  privacy: "private" | "unlisted" | "public";
};

type PropertyOption = {
  id: number;
  code: string;
  title: string;
  purpose: string;
  price: number;
  district: string;
  city: string;
  bedrooms: number;
  suites: number;
  parking: number;
  areaUtil: number;
  description: string | null;
  youtubeUrl: string | null;
};

type PublishResult = {
  videoId: string;
  link: string;
  title: string;
  privacy: string;
  uploadStatus: string;
};

function fileSize(bytes: number) {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function YouTubePage() {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const origin = typeof window === "undefined" ? "https://www.esantoscorretor.com.br" : window.location.origin;
  const callback = `${origin}/api/oauth/youtube/callback`;
  const [config, setConfig] = useState<YouTubeConfig>({ clientId: "", clientSecret: "", privacy: "private" });
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [properties, setProperties] = useState<PropertyOption[]>([]);
  const [loadingProperties, setLoadingProperties] = useState(false);
  const [propertyId, setPropertyId] = useState("");
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [publishResult, setPublishResult] = useState<PublishResult | null>(null);

  const overview = useQuery(orpc.adminIntegrations.instagram.youtubeOverview.queryOptions({ staleTime: 10_000 }));

  useEffect(() => {
    if (!overview.data) return;
    setConfig({
      clientId: overview.data.clientId,
      clientSecret: overview.data.clientSecret,
      privacy: overview.data.privacy,
    });
  }, [overview.data]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const result = new URLSearchParams(window.location.search).get("youtube");
    if (result === "connected") {
      setError(null);
      setFeedback("Google autorizado. O refresh token do YouTube foi salvo com segurança no servidor.");
      void queryClient.invalidateQueries();
      window.history.replaceState({}, "", "/admin/youtube");
    } else if (result) {
      setFeedback(null);
      setError("A autorização do Google não foi concluída. Tente Conectar com Google novamente.");
    }
  }, [queryClient]);

  const save = useMutation(orpc.adminIntegrations.instagram.youtubeSave.mutationOptions({
    onSuccess: async () => {
      setError(null);
      setFeedback("Credenciais do Google salvas com segurança. O Client Secret ficou mascarado.");
      await queryClient.invalidateQueries();
    },
    onError: (caught) => {
      setFeedback(null);
      setError(errorMessage(caught));
    },
  }));

  const hasClientId = config.clientId.trim().length > 10;
  const hasSecret = config.clientSecret.trim().length > 0;
  const saved = Boolean(overview.data?.clientId && overview.data?.clientSecret);
  const connected = overview.data?.status === "conectado";
  const selectedProperty = properties.find((property) => String(property.id) === propertyId) ?? null;

  async function loadProperties() {
    setLoadingProperties(true);
    try {
      const response = await fetch("/api/oauth/youtube/properties", { credentials: "same-origin" });
      const payload = await response.json().catch(() => ({})) as { ok?: boolean; properties?: PropertyOption[]; message?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.message || "Falha ao carregar os imóveis disponíveis.");
      setProperties(payload.properties ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha ao carregar os imóveis disponíveis.");
    } finally {
      setLoadingProperties(false);
    }
  }

  useEffect(() => {
    if (connected) void loadProperties();
  }, [connected]);

  async function testConnection() {
    setTesting(true);
    setError(null);
    setFeedback(null);
    try {
      const response = await fetch("/api/oauth/youtube/test", { credentials: "same-origin" });
      const payload = await response.json().catch(() => ({})) as { ok?: boolean; message?: string };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.message || "Falha ao testar a conexão com o YouTube.");
      }
      setFeedback(payload.message || "Canal do YouTube confirmado com sucesso.");
      await queryClient.invalidateQueries();
      await loadProperties();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha ao testar a conexão com o YouTube.");
    } finally {
      setTesting(false);
    }
  }

  async function publishVideo() {
    if (!connected || !selectedProperty || !videoFile) return;
    setUploading(true);
    setError(null);
    setFeedback(null);
    setPublishResult(null);
    try {
      const startResponse = await fetch("/api/oauth/youtube/upload-session", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          propertyId: selectedProperty.id,
          fileName: videoFile.name,
          fileSize: videoFile.size,
          mime: videoFile.type || "application/octet-stream",
        }),
      });
      const start = await startResponse.json().catch(() => ({})) as {
        ok?: boolean;
        message?: string;
        uploadUrl?: string;
        accessToken?: string;
      };
      if (!startResponse.ok || !start.ok || !start.uploadUrl || !start.accessToken) {
        throw new Error(start.message || "Não foi possível iniciar o envio do vídeo.");
      }

      const uploadResponse = await fetch(start.uploadUrl, {
        method: "PUT",
        headers: {
          authorization: `Bearer ${start.accessToken}`,
          "content-type": videoFile.type || "application/octet-stream",
        },
        body: videoFile,
      });
      const uploaded = await uploadResponse.json().catch(() => ({})) as {
        id?: string;
        error?: { message?: string };
      };
      if (!uploadResponse.ok || !uploaded.id) {
        throw new Error(uploaded.error?.message || `Falha no envio do vídeo para o YouTube (HTTP ${uploadResponse.status}).`);
      }

      const completeResponse = await fetch("/api/oauth/youtube/upload-complete", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ propertyId: selectedProperty.id, videoId: uploaded.id }),
      });
      const complete = await completeResponse.json().catch(() => ({})) as {
        ok?: boolean;
        message?: string;
        videoId?: string;
        link?: string;
        title?: string;
        privacy?: string;
        uploadStatus?: string;
      };
      if (!completeResponse.ok || !complete.ok || !complete.videoId || !complete.link) {
        throw new Error(complete.message || "O vídeo foi enviado, mas o CRM não conseguiu confirmar a publicação.");
      }

      setPublishResult({
        videoId: complete.videoId,
        link: complete.link,
        title: complete.title || selectedProperty.title,
        privacy: complete.privacy || "private",
        uploadStatus: complete.uploadStatus || "uploaded",
      });
      setFeedback(`Vídeo enviado com sucesso para o YouTube e vinculado ao imóvel ${selectedProperty.code}.`);
      await loadProperties();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha ao publicar o vídeo no YouTube.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <AdminLayout
      title="YouTube · Publicação de imóveis"
      subtitle="Integrações → YouTube. A preparação do CRM vem antes da autorização do Google e do primeiro vídeo."
      actions={
        <a
          href="/admin/integracoes"
          className="inline-flex items-center gap-2 rounded-[3px] border border-line bg-white px-3 py-2 text-xs font-medium text-deep hover:bg-bone/60"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Integrações
        </a>
      }
    >
      <Card title="Cronograma · começo, meio e fim">
        <div className="grid gap-3 lg:grid-cols-4">
          {steps.map((step, index) => {
            const done = (index === 0 && saved) || (connected && index <= 2) || (index === 3 && Boolean(publishResult));
            return (
              <div key={step.title} className="rounded-[4px] border border-line bg-bone/25 p-4">
                <div className="flex items-center gap-2">
                  {done ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Circle className="h-4 w-4 text-brass" />}
                  <span className="label-xs text-muted">Etapa {index + 1}</span>
                </div>
                <p className="mt-2 text-sm font-medium text-deep">{step.title}</p>
                <p className="mt-1 text-[11px] leading-relaxed text-muted">{step.detail}</p>
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="mt-6" title="1. Conectar o YouTube">
        <div className="grid gap-4 lg:grid-cols-2">
          <Field label="Google OAuth Client ID" hint="Cole o ID do cliente criado no Google Cloud.">
            <Input
              value={config.clientId}
              placeholder="Cole o Google OAuth Client ID"
              onChange={(event) => setConfig((prev) => ({ ...prev, clientId: event.target.value }))}
            />
          </Field>
          <Field label="Google OAuth Client Secret" hint="Depois de salvo, ficará mascarado e o valor completo não volta para o navegador.">
            <Input
              type="password"
              value={config.clientSecret}
              placeholder="Cole o novo Google OAuth Client Secret"
              onChange={(event) => setConfig((prev) => ({ ...prev, clientSecret: event.target.value }))}
            />
          </Field>
          <Field label="URI de redirecionamento" hint="Precisa ser exatamente a mesma cadastrada no cliente OAuth do Google.">
            <Input value={callback} readOnly />
          </Field>
          <Field label="Privacidade padrão do vídeo">
            <Select
              value={config.privacy}
              onChange={(event) => setConfig((prev) => ({
                ...prev,
                privacy: event.target.value === "public" ? "public" : event.target.value === "unlisted" ? "unlisted" : "private",
              }))}
            >
              <option value="private">Privado durante o primeiro teste</option>
              <option value="unlisted">Não listado</option>
              <option value="public">Público</option>
            </Select>
          </Field>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Btn
            disabled={save.isPending || !hasClientId || !hasSecret}
            onClick={() => {
              setError(null);
              setFeedback(null);
              save.mutate(config);
            }}
          >
            <Save className="h-4 w-4" /> Salvar conexão
          </Btn>
          <Btn
            disabled={!saved}
            onClick={() => {
              window.location.href = "/api/oauth/youtube/start";
            }}
          >
            <Youtube className="h-4 w-4" /> Conectar com Google
          </Btn>
          <Btn tone="outline" disabled={!saved || testing} onClick={() => void testConnection()}>
            <RefreshCw className={`h-4 w-4 ${testing ? "animate-spin" : ""}`} />
            {testing ? "Testando" : "Testar conexão"}
          </Btn>
          <Badge tone={connected ? "green" : saved ? "amber" : "neutral"}>
            {connected ? "YouTube conectado" : saved ? "Credenciais salvas" : "Aguardando Google Cloud"}
          </Badge>
        </div>
        <p className="mt-3 text-[11px] text-muted">
          Depois de salvar as credenciais, clique em “Conectar com Google”. Após a autorização, use “Testar conexão” para confirmar pela API qual canal do YouTube foi conectado.
        </p>
      </Card>

      {feedback && <p className="mt-4 rounded-[3px] border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{feedback}</p>}
      <ErrorNote message={error ?? overview.data?.lastError ?? null} />

      <Card className="mt-6" title="2. Publicar vídeo do imóvel">
        <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
          <div className="rounded-[4px] border border-dashed border-line bg-bone/20 p-5">
            <div className="flex items-center gap-2 text-deep">
              <Upload className="h-4 w-4" />
              <p className="text-sm font-medium">Vídeo do imóvel</p>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted">
              Escolha primeiro o imóvel aprovado e disponível. Depois selecione o arquivo de vídeo. O primeiro envio fica privado e, quando o YouTube confirmar, o link é gravado no próprio cadastro do imóvel.
            </p>

            <div className="mt-4 space-y-3">
              <Field label="Imóvel">
                <Select
                  value={propertyId}
                  disabled={!connected || loadingProperties || uploading}
                  onChange={(event) => {
                    setPropertyId(event.target.value);
                    setPublishResult(null);
                  }}
                >
                  <option value="">{loadingProperties ? "Carregando imóveis..." : "Selecione o imóvel"}</option>
                  {properties.map((property) => (
                    <option key={property.id} value={property.id}>
                      {property.code} · {property.title}{property.youtubeUrl ? " · já possui link YouTube" : ""}
                    </option>
                  ))}
                </Select>
              </Field>

              <input
                ref={fileRef}
                className="hidden"
                type="file"
                accept="video/*"
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  setVideoFile(file);
                  setPublishResult(null);
                  setError(null);
                }}
              />

              <Btn
                tone="outline"
                disabled={!connected || !propertyId || uploading}
                onClick={() => fileRef.current?.click()}
              >
                <Upload className="h-4 w-4" /> Selecionar vídeo
              </Btn>

              {videoFile && (
                <div className="rounded-[3px] border border-line bg-white px-3 py-2 text-xs text-deep">
                  <p className="font-medium">{videoFile.name}</p>
                  <p className="mt-1 text-muted">{fileSize(videoFile.size)} · {videoFile.type || "vídeo"}</p>
                </div>
              )}
            </div>
          </div>

          <div className="rounded-[4px] border border-line bg-bone/20 p-5">
            <div className="flex items-center gap-2 text-deep">
              <Play className="h-4 w-4" />
              <p className="text-sm font-medium">Prévia da publicação</p>
            </div>
            <p className="mt-2 text-xs text-muted">
              Título: {selectedProperty?.title || "selecione um imóvel"}
            </p>
            <p className="mt-1 text-xs text-muted">
              {selectedProperty ? `${selectedProperty.code} · ${selectedProperty.district} · ${selectedProperty.city}` : "Descrição: preço, bairro, cidade, detalhes e código do imóvel"}
            </p>
            <p className="mt-1 text-xs text-muted">Privacidade deste primeiro envio: privado</p>
            <p className="mt-1 text-xs text-muted">Duplicidade: bloqueada; republicação exigirá confirmação</p>

            <Btn
              className="mt-4"
              disabled={!connected || !selectedProperty || !videoFile || uploading}
              onClick={() => void publishVideo()}
            >
              <ExternalLink className="h-4 w-4" />
              {uploading ? "Enviando vídeo..." : "Publicar no YouTube"}
            </Btn>

            {publishResult && (
              <div className="mt-4 rounded-[3px] border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
                <p className="font-medium">Vídeo publicado e vinculado ao imóvel.</p>
                <p className="mt-1">ID: {publishResult.videoId}</p>
                <p className="mt-1">Status: {publishResult.uploadStatus} · Privacidade: {publishResult.privacy}</p>
                <a
                  className="mt-2 inline-flex items-center gap-1 font-medium underline"
                  href={publishResult.link}
                  target="_blank"
                  rel="noreferrer"
                >
                  Abrir vídeo no YouTube <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            )}
          </div>
        </div>
      </Card>
    </AdminLayout>
  );
}

export default function AdminYouTube() {
  return <AdminGuard><YouTubePage /></AdminGuard>;
}

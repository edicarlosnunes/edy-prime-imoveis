import { useEffect, useState } from "react";
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
    detail: "Autorizar o CRM com o escopo mínimo youtube.upload e guardar o refresh token com segurança.",
  },
  {
    title: "Testar conexão",
    detail: "Confirmar pela API qual canal foi autorizado antes de liberar qualquer envio.",
  },
  {
    title: "Enviar 1 vídeo de teste",
    detail: "Selecionar um imóvel aprovado, enviar o vídeo e conferir título, descrição, link e status no YouTube.",
  },
];

type YouTubeConfig = {
  clientId: string;
  clientSecret: string;
  privacy: "private" | "unlisted" | "public";
};

function YouTubePage() {
  const queryClient = useQueryClient();
  const origin = typeof window === "undefined" ? "https://www.esantoscorretor.com.br" : window.location.origin;
  const callback = `${origin}/api/oauth/youtube/callback`;
  const [config, setConfig] = useState<YouTubeConfig>({ clientId: "", clientSecret: "", privacy: "private" });
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const overview = useQuery(orpc.adminIntegrations.instagram.youtubeOverview.queryOptions({ staleTime: 10_000 }));

  useEffect(() => {
    if (!overview.data) return;
    setConfig({
      clientId: overview.data.clientId,
      clientSecret: overview.data.clientSecret,
      privacy: overview.data.privacy,
    });
  }, [overview.data]);

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
  const saved = overview.data?.status === "configurando" || overview.data?.status === "conectado";

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
            const done = index === 0 && saved;
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
          <Btn disabled>
            <Youtube className="h-4 w-4" /> Conectar com Google
          </Btn>
          <Btn tone="outline" disabled>
            <RefreshCw className="h-4 w-4" /> Testar conexão
          </Btn>
          <Badge tone={saved ? "amber" : "neutral"}>{saved ? "Credenciais salvas" : "Aguardando Google Cloud"}</Badge>
        </div>
        <p className="mt-3 text-[11px] text-muted">
          Primeiro salve o Client ID e o Client Secret. Na etapa seguinte o botão “Conectar com Google” será liberado para a autorização OAuth 2.0; nenhum token permanente será colado manualmente.
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
              O envio só será liberado para imóvel aprovado e disponível. O vídeo será selecionado do cadastro do imóvel ou anexado à mídia do próprio imóvel — nunca em uma área solta sem vínculo.
            </p>
            <Btn className="mt-4" tone="outline" disabled>
              Selecionar vídeo
            </Btn>
          </div>

          <div className="rounded-[4px] border border-line bg-bone/20 p-5">
            <div className="flex items-center gap-2 text-deep">
              <Play className="h-4 w-4" />
              <p className="text-sm font-medium">Prévia da publicação</p>
            </div>
            <p className="mt-2 text-xs text-muted">Título: puxado do imóvel</p>
            <p className="mt-1 text-xs text-muted">Descrição: preço, bairro, cidade, detalhes, link e código do imóvel</p>
            <p className="mt-1 text-xs text-muted">Duplicidade: bloqueada; republicação exigirá confirmação</p>
            <Btn className="mt-4" disabled>
              <ExternalLink className="h-4 w-4" /> Publicar no YouTube
            </Btn>
          </div>
        </div>
      </Card>
    </AdminLayout>
  );
}

export default function AdminYouTube() {
  return <AdminGuard><YouTubePage /></AdminGuard>;
}

import { ArrowLeft, CheckCircle2, Circle, ExternalLink, Play, RefreshCw, Upload, Youtube } from "lucide-react";
import { AdminGuard } from "../../components/admin/guard";
import { AdminLayout } from "../../components/admin/layout";
import { Badge, Btn, Card, Field, Input, Select } from "../../components/admin/ui";

const steps = [
  {
    title: "Preparar Google Cloud",
    detail: "Ativar YouTube Data API v3 e criar um cliente OAuth 2.0 do tipo Aplicativo da Web.",
    done: false,
  },
  {
    title: "Conectar o canal",
    detail: "Autorizar o CRM com o escopo mínimo youtube.upload e guardar o refresh token com segurança.",
    done: false,
  },
  {
    title: "Testar conexão",
    detail: "Confirmar pela API qual canal foi autorizado antes de liberar qualquer envio.",
    done: false,
  },
  {
    title: "Enviar 1 vídeo de teste",
    detail: "Selecionar um imóvel aprovado, enviar o vídeo e conferir título, descrição, link e status no YouTube.",
    done: false,
  },
];

function YouTubePage() {
  const origin = typeof window === "undefined" ? "https://www.esantoscorretor.com.br" : window.location.origin;
  const callback = `${origin}/api/oauth/youtube/callback`;

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
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="admin-card rounded-[4px] border border-line bg-white px-4 py-4">
          <p className="label-xs text-muted">Status</p>
          <p className="mt-2 text-xl font-semibold text-deep">Preparando</p>
          <p className="mt-1 text-[11px] text-muted">Nenhuma autorização Google foi feita ainda.</p>
        </div>
        <div className="admin-card rounded-[4px] border border-line bg-white px-4 py-4">
          <p className="label-xs text-muted">Canal conectado</p>
          <p className="mt-2 text-xl font-semibold text-deep">—</p>
          <p className="mt-1 text-[11px] text-muted">Será preenchido depois do OAuth.</p>
        </div>
        <div className="admin-card rounded-[4px] border border-line bg-white px-4 py-4">
          <p className="label-xs text-muted">Vídeos enviados</p>
          <p className="mt-2 text-xl font-semibold text-deep">0</p>
          <p className="mt-1 text-[11px] text-muted">Contagem de publicações feitas por este CRM.</p>
        </div>
        <div className="admin-card rounded-[4px] border border-line bg-white px-4 py-4">
          <p className="label-xs text-muted">Escopo previsto</p>
          <p className="mt-2 break-all font-mono text-sm font-semibold text-deep">youtube.upload</p>
          <p className="mt-1 text-[11px] text-muted">Somente o necessário para enviar vídeos.</p>
        </div>
      </div>

      <Card className="mt-6" title="Cronograma · começo, meio e fim">
        <div className="grid gap-3 lg:grid-cols-4">
          {steps.map((step, index) => (
            <div key={step.title} className="rounded-[4px] border border-line bg-bone/25 p-4">
              <div className="flex items-center gap-2">
                {step.done ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Circle className="h-4 w-4 text-brass" />}
                <span className="label-xs text-muted">Etapa {index + 1}</span>
              </div>
              <p className="mt-2 text-sm font-medium text-deep">{step.title}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-muted">{step.detail}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card className="mt-6" title="1. Conectar o YouTube">
        <div className="grid gap-4 lg:grid-cols-2">
          <Field label="Google OAuth Client ID" hint="Será criado no Google Cloud. Não colar credencial antes da etapa de configuração.">
            <Input placeholder="Aguardando Client ID" disabled />
          </Field>
          <Field label="Google OAuth Client Secret" hint="Será armazenado somente no servidor e ficará mascarado depois de salvo.">
            <Input placeholder="Aguardando Client Secret" disabled />
          </Field>
          <Field label="URI de redirecionamento" hint="Endereço que será cadastrado exatamente igual no cliente OAuth do Google.">
            <Input value={callback} readOnly />
          </Field>
          <Field label="Privacidade padrão do vídeo">
            <Select defaultValue="private" disabled>
              <option value="private">Privado durante o primeiro teste</option>
              <option value="unlisted">Não listado</option>
              <option value="public">Público</option>
            </Select>
          </Field>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Btn disabled>
            <Youtube className="h-4 w-4" /> Conectar com Google
          </Btn>
          <Btn tone="outline" disabled>
            <RefreshCw className="h-4 w-4" /> Testar conexão
          </Btn>
          <Badge tone="amber">Aguardando Google Cloud</Badge>
        </div>
        <p className="mt-3 text-[11px] text-muted">
          Diferente do Instagram, o YouTube usa OAuth 2.0: não vamos copiar um token permanente manualmente. O CRM receberá a autorização do Google e guardará o refresh token no servidor.
        </p>
      </Card>

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

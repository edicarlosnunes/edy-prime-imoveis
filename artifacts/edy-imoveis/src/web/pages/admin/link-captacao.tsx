import { useState } from "react";
import { AdminGuard } from "../../components/admin/guard";
import { AdminLayout } from "../../components/admin/layout";
import { Card, Btn, Badge, dateTimeLabel, Empty } from "../../components/admin/ui";
import { useAdminOwnerLinks, useCreateOwnerLink } from "../../queries/owner-links";
import { Check, Copy } from "lucide-react";

export default function AdminLinkCaptacao() {
  return (
    <AdminGuard>
      <AdminLayout
        title="Link de captação"
        subtitle="Gere um link seguro para abrir a ficha pública de captação"
      >
        <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
          <div>
            <Generator />
          </div>
          <div>
            <LinksList />
          </div>
        </div>
      </AdminLayout>
    </AdminGuard>
  );
}

function Generator() {
  const [created, setCreated] = useState<{ url: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const create = useCreateOwnerLink();

  async function generate() {
    try {
      const res = await create.mutateAsync({});
      const url = `${window.location.origin}${res.path}`;
      setCreated({ url });
      setCopied(false);
    } catch (e) {
      alert("Erro ao criar link.");
    }
  }

  function copy() {
    if (created) {
      navigator.clipboard.writeText(created.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <Card title="Novo link">
      <div className="space-y-4">
        <p className="text-sm leading-relaxed text-muted">
          Gere uma URL exclusiva e envie pelo canal que desejar. A identificação será preenchida na ficha pública.
        </p>
        <Btn tone="brass" className="w-full" disabled={create.isPending} onClick={generate}>
          {create.isPending ? "Gerando..." : "Gerar link de captação"}
        </Btn>

        {created && (
          <div className="mt-6 rounded-[4px] border border-brass/30 bg-brass/5 p-4">
            <div className="mb-2 text-[11px] font-semibold tracking-wide text-brass uppercase">Link Gerado com Sucesso</div>
            <p className="text-xs text-muted mb-3">Copie o link e envie pelo canal que desejar. Ele fica indisponível após a conclusão.</p>
            <div className="flex flex-col gap-2 rounded-[4px] border border-line bg-white p-2 sm:flex-row sm:items-center">
              <input readOnly value={created.url} className="flex-1 bg-transparent text-xs text-deep outline-none" />
              <button
                type="button"
                onClick={copy}
                className="flex h-8 shrink-0 items-center justify-center gap-2 rounded-[3px] bg-brass/10 px-3 text-xs font-medium text-brass transition-colors hover:bg-brass/20"
                title="Copiar link"
              >
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copied ? "Copiado" : "Copiar link"}
              </button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function LinksList() {
  const { data = [], isLoading } = useAdminOwnerLinks();

  if (isLoading) return <Card>Carregando...</Card>;

  return (
    <Card title="Links gerados">
      {data.length === 0 ? (
        <Empty>Nenhum link gerado ainda.</Empty>
      ) : (
        <div className="space-y-3">
          {data.map(link => (
            <div key={link.id} className="flex flex-col gap-3 rounded-[4px] border border-line bg-white/50 p-4 transition-colors hover:bg-white sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="font-medium text-deep">{link.ownerName || `Link de captação #${link.id}`}</div>
                {link.phone && <div className="text-xs text-muted mt-0.5">{link.phone}</div>}
                <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-muted">
                  <span>Criado: {dateTimeLabel(link.createdAt)}</span>
                  {link.startedAt && <span>Iniciado: {dateTimeLabel(link.startedAt)}</span>}
                  {link.completedAt && <span className="font-medium text-green-600/80">Concluído: {dateTimeLabel(link.completedAt)}</span>}
                </div>
              </div>
              <div className="shrink-0">
                {link.status === "aguardando" && <Badge tone="neutral">Aguardando</Badge>}
                {link.status === "iniciado" && <Badge tone="amber">Iniciado</Badge>}
                {link.status === "concluido" && <Badge tone="green">Concluído</Badge>}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
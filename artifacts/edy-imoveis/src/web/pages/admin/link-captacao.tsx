import { useState } from "react";
import { AdminGuard } from "../../components/admin/guard";
import { AdminLayout } from "../../components/admin/layout";
import { Card, Btn, Badge, dateTimeLabel, Empty, Modal, Textarea } from "../../components/admin/ui";
import { useAdminOwnerLinks, useCancelOwnerLink, useCreateOwnerLink } from "../../queries/owner-links";
import { Check, Copy, Eye, XCircle } from "lucide-react";

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
      const url = `${window.location.origin}${res.shortPath}`;
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
  const [selected, setSelected] = useState<any>(null);

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
                <div className="font-medium text-deep">{link.ownerName || `Link #${link.id}`}</div>
                {link.phone && <div className="text-xs text-muted mt-0.5">{link.phone}</div>}
                {link.captureSerial && <div className="mt-1 text-xs text-deep">EPI {link.captureSerial} · {link.captureType || "Imóvel"}{link.captureAddress ? ` · ${link.captureAddress}` : ""}</div>}
                <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-muted">
                  <span>Criado: {dateTimeLabel(link.createdAt)}</span>
                  {link.startedAt && <span>Iniciado: {dateTimeLabel(link.startedAt)}</span>}
                  {link.completedAt && <span className="font-medium text-green-600/80">Concluído: {dateTimeLabel(link.completedAt)}</span>}
                  {link.lastFieldAt && <span>Atualizado: {dateTimeLabel(link.lastFieldAt)}</span>}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {link.status === "aguardando" && <Badge tone="neutral">Aguardando</Badge>}
                {link.status === "iniciado" && <Badge tone="amber">{link.registrationStatus === "EM_ANDAMENTO" ? "Em andamento" : "Pré-cadastro"}</Badge>}
                {link.status === "concluido" && <Badge tone="green">Concluído</Badge>}
                {link.status === "cancelado" && <Badge tone="red">Cancelado</Badge>}
                <Btn tone="ghost" className="px-2 py-1.5" onClick={() => setSelected(link)} title="Inspecionar ficha"><Eye className="h-4 w-4" /></Btn>
              </div>
            </div>
          ))}
        </div>
      )}
      <LinkDetail link={selected} onClose={() => setSelected(null)} />
    </Card>
  );
}

function LinkDetail({ link, onClose }: { link: any; onClose: () => void }) {
  const cancel = useCancelOwnerLink();
  const [reason, setReason] = useState("");
  if (!link) return null;
  const draft = typeof link.draft === "string" ? (() => { try { return JSON.parse(link.draft); } catch { return {}; } })() : (link.draft ?? {});
  async function cancelLink() {
    if (!window.confirm("Cancelar esta captação? O link ficará inativo.")) return;
    try {
      await cancel.mutateAsync({ id: link.id, reason: reason.trim() || undefined });
      onClose();
    } catch { window.alert("Não foi possível cancelar a captação."); }
  }
  return <Modal open={!!link} onClose={onClose} title={`Link #${link.id}`} wide>
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={link.status === "cancelado" ? "red" : link.status === "concluido" ? "green" : "amber"}>{String(link.status).toUpperCase()}</Badge>
        {link.profile && <span className="text-xs text-muted">{link.profile}</span>}
        {link.captureSerial && <span className="text-xs font-medium text-deep">EPI {link.captureSerial}</span>}
      </div>
      <div className="grid gap-3 text-sm sm:grid-cols-2">
        <div><span className="text-xs text-muted">Participante</span><p className="font-medium">{link.ownerName || "Aguardando identificação"}</p></div>
        <div><span className="text-xs text-muted">Telefone</span><p>{link.phone || "—"}</p></div>
        <div><span className="text-xs text-muted">Imóvel</span><p>{link.captureType || draft.propertyType || "—"}</p></div>
        <div><span className="text-xs text-muted">Endereço</span><p>{link.captureAddress || draft.address || "—"}</p></div>
      </div>
      <div>
        <h3 className="label-xs text-muted">Respostas coletadas</h3>
        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded border border-line bg-bone/30 p-3 text-xs text-deep">{JSON.stringify(draft.answers ?? {}, null, 2)}</pre>
      </div>
      <div>
        <h3 className="label-xs text-muted">Transcrição</h3>
        <div className="mt-2 max-h-64 space-y-2 overflow-auto rounded border border-line bg-bone/30 p-3 text-xs">{(draft.transcript ?? []).map((item: any, i: number) => <p key={i}><b>{item.role === "user" ? "Participante" : "Assistente"}:</b> {item.text}</p>)}{!(draft.transcript ?? []).length && <span className="text-muted">Nenhuma resposta ainda.</span>}</div>
      </div>
      {link.status !== "cancelado" && link.status !== "concluido" && <div className="border-t border-line pt-4">
        <Textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="Motivo do cancelamento (opcional)" />
        <Btn tone="danger" className="mt-3" onClick={() => void cancelLink()} disabled={cancel.isPending}><XCircle className="h-4 w-4" />{cancel.isPending ? "Cancelando..." : "Cancelar captação"}</Btn>
      </div>}
    </div>
  </Modal>;
}
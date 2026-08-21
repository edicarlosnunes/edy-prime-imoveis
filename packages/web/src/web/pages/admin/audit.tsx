import { AdminGuard } from "../../components/admin/guard";
import { AdminLayout } from "../../components/admin/layout";
import { Badge, Card, Empty, Stat, dateTimeLabel } from "../../components/admin/ui";
import { useAiDashboard, useAuditLog } from "../../queries/integrations";

function AuditPage() {
  const log = useAuditLog(150);
  const dashboard = useAiDashboard();
  const entries = log.data ?? [];

  return (
    <AdminLayout
      title="IA, automações e auditoria"
      subtitle="Números reais de atendimento automático e o histórico de ações do painel."
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Conversas" value={dashboard.data?.conversations.total ?? "—"} />
        <Stat
          label="Atendidas pela IA"
          value={dashboard.data?.messages.daIa ?? "—"}
          hint="mensagens nos últimos 30 dias"
        />
        <Stat
          label="Transferidas"
          value={`${dashboard.data?.conversations.taxaTransferencia ?? 0}%`}
          hint={`${dashboard.data?.conversations.transferidas ?? 0} conversa(s)`}
        />
        <Stat
          label="Automações"
          value={`${dashboard.data?.automations.ativas ?? 0}/${dashboard.data?.automations.total ?? 0}`}
          hint={`${dashboard.data?.automations.execucoes ?? 0} execuções · ${dashboard.data?.automations.falhas ?? 0} falhas`}
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card title="Conversas por canal">
          {(dashboard.data?.conversations.porCanal.length ?? 0) === 0 ? (
            <Empty>Nenhuma conversa registrada ainda.</Empty>
          ) : (
            <div className="space-y-2">
              {(dashboard.data?.conversations.porCanal ?? []).map((item) => (
                <div
                  key={item.channel}
                  className="flex items-center justify-between rounded-[3px] border border-line px-3 py-2 text-sm"
                >
                  <span className="text-ink">{item.channel}</span>
                  <Badge>{item.count}</Badge>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Motivos de transferência para humano">
          {(dashboard.data?.motivosTransferencia.length ?? 0) === 0 ? (
            <Empty>Nenhuma transferência registrada.</Empty>
          ) : (
            <div className="max-h-64 space-y-2 overflow-y-auto">
              {(dashboard.data?.motivosTransferencia ?? []).map((item) => (
                <div key={item.id} className="rounded-[3px] border border-line px-3 py-2">
                  <p className="text-xs text-ink">{item.reason}</p>
                  <p className="text-[11px] text-muted">{dateTimeLabel(item.at)}</p>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card className="mt-4" title="Eventos das integrações">
        {(dashboard.data?.integrationEvents.length ?? 0) === 0 ? (
          <Empty>Nenhum evento registrado.</Empty>
        ) : (
          <div className="max-h-72 space-y-2 overflow-y-auto">
            {(dashboard.data?.integrationEvents ?? []).map((event) => (
              <div
                key={event.id}
                className="flex flex-wrap items-start justify-between gap-2 rounded-[3px] border border-line px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-xs text-ink">
                    <strong>{event.integrationKey}</strong> · {event.kind}
                  </p>
                  <p className="text-[11px] text-muted">{event.message}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={event.ok === 1 ? "green" : "red"}>
                    {event.ok === 1 ? "ok" : "falha"}
                  </Badge>
                  <span className="text-[11px] text-muted">{dateTimeLabel(event.createdAt)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="mt-4" title="Auditoria do painel">
        {log.isLoading && <Empty>Carregando…</Empty>}
        {!log.isLoading && entries.length === 0 && <Empty>Nenhuma ação registrada ainda.</Empty>}
        {entries.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-line text-left">
                  <th className="label-xs py-2 pr-3 text-muted">Quando</th>
                  <th className="label-xs py-2 pr-3 text-muted">Quem</th>
                  <th className="label-xs py-2 pr-3 text-muted">Ação</th>
                  <th className="label-xs py-2 pr-3 text-muted">Detalhe</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id} className="border-b border-line/60">
                    <td className="py-2 pr-3 text-xs text-muted whitespace-nowrap">
                      {dateTimeLabel(entry.createdAt)}
                    </td>
                    <td className="py-2 pr-3 text-xs text-ink">{entry.userName ?? "—"}</td>
                    <td className="py-2 pr-3 text-xs text-ink">{entry.action}</td>
                    <td className="py-2 pr-3 text-xs text-muted">
                      {[entry.entity, entry.entityId].filter(Boolean).join(" #")}
                      {entry.detail ? ` — ${entry.detail}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </AdminLayout>
  );
}

export default function AdminAudit() {
  return (
    <AdminGuard>
      <AuditPage />
    </AdminGuard>
  );
}

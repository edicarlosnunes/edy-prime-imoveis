import { Link } from "wouter";
import {
  BarChart3,
  Building2,
  CalendarCheck,
  CheckCircle2,
  FileSignature,
  Handshake,
  KeyRound,
  Percent,
  TrendingUp,
  Users,
  XCircle,
} from "lucide-react";
import { AdminGuard } from "../../components/admin/guard";
import { AdminLayout } from "../../components/admin/layout";
import {
  Badge,
  Card,
  Empty,
  Stat,
  dateTimeLabel,
  money,
  shortMoney,
} from "../../components/admin/ui";
import {
  LEAD_STAGES,
  labelOf,
  sourceLabel,
  stageLabel,
  taskTypeLabel,
} from "../../components/admin/labels";
import { useDashboard } from "../../queries/admin";

export default function AdminDashboard() {
  return (
    <AdminGuard>
      <AdminLayout title="Dashboard" subtitle="Visão geral do negócio">
        <Content />
      </AdminLayout>
    </AdminGuard>
  );
}

function Content() {
  const { data, isLoading } = useDashboard();

  if (isLoading || !data) {
    return <Empty>Carregando indicadores…</Empty>;
  }

  const funnelMax = Math.max(1, ...data.funnel.map((step) => step.total));
  const sourceMax = Math.max(1, ...data.leadsBySource.map((item) => item.total));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Imóveis"
          value={data.properties.total}
          hint={`${data.properties.published} publicados`}
          tone="green"
          icon={<Building2 className="h-4 w-4" />}
        />
        <Stat
          label="Vendidos / reservados"
          value={data.properties.sold + data.properties.reserved}
          hint={`${data.properties.sold} vendidos · ${data.properties.reserved} reservados`}
          tone="brass"
          icon={<KeyRound className="h-4 w-4" />}
        />
        <Stat
          label="Leads"
          value={data.leads.total}
          hint={`${data.leads.new} novos`}
          tone="blue"
          icon={<Users className="h-4 w-4" />}
        />
        <Stat
          label="Visitas agendadas"
          value={data.leads.scheduledVisits}
          hint="no funil"
          tone="teal"
          icon={<CalendarCheck className="h-4 w-4" />}
        />
        <Stat
          label="Propostas"
          value={data.deals.total}
          hint={`${data.deals.open} em aberto`}
          tone="bronze"
          icon={<FileSignature className="h-4 w-4" />}
        />
        <Stat
          label="Em negociação"
          value={data.leads.negotiating}
          hint="leads na etapa"
          tone="brass"
          icon={<Handshake className="h-4 w-4" />}
        />
        <Stat
          label="Vendas fechadas"
          value={data.deals.closed}
          hint={shortMoney(data.money.vgvClosed)}
          tone="green"
          icon={<CheckCircle2 className="h-4 w-4" />}
        />
        <Stat
          label="Leads perdidos"
          value={data.leads.lost}
          hint={`${data.leads.open} em aberto`}
          tone="rose"
          icon={<XCircle className="h-4 w-4" />}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Stat
          label="VGV dos imóveis"
          value={shortMoney(data.money.vgvPortfolio)}
          hint="imóveis disponíveis"
          tone="blue"
          icon={<BarChart3 className="h-4 w-4" />}
        />
        <Stat
          label="VGV em propostas"
          value={shortMoney(data.money.vgvProposals)}
          hint="propostas em aberto"
          tone="teal"
          icon={<TrendingUp className="h-4 w-4" />}
        />
        <Stat
          label="Comissão prevista"
          value={shortMoney(data.money.expectedCommission)}
          hint={`${money(data.money.closedCommission)} já fechada`}
          tone="brass"
          icon={<Percent className="h-4 w-4" />}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title="Funil comercial">
          <ul className="space-y-3">
            {LEAD_STAGES.map((stage) => {
              const total = data.funnel.find((step) => step.stage === stage)?.total ?? 0;
              return (
                <li key={stage}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-deep">{stageLabel[stage]}</span>
                    <span className="text-muted">{total}</span>
                  </div>
                  <div className="mt-1.5 h-1.5 w-full bg-bone">
                    <div
                      className="h-full bg-brass"
                      style={{ width: `${(total / funnelMax) * 100}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>

        <Card title="Origem dos leads">
          {data.leadsBySource.length === 0 ? (
            <Empty>Nenhum lead registrado ainda.</Empty>
          ) : (
            <ul className="space-y-3">
              {data.leadsBySource.map((item) => (
                <li key={item.source}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-deep">{labelOf(sourceLabel, item.source)}</span>
                    <span className="text-muted">{item.total}</span>
                  </div>
                  <div className="mt-1.5 h-1.5 w-full bg-bone">
                    <div
                      className="h-full bg-deep"
                      style={{ width: `${(item.total / sourceMax) * 100}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card
          title="Leads recentes"
          action={
            <Link href="/admin/leads" className="text-xs text-brass hover:underline">
              ver todos
            </Link>
          }
        >
          {data.recentLeads.length === 0 ? (
            <Empty>Sem leads por enquanto.</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {data.recentLeads.map((lead) => (
                <li key={lead.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-deep">{lead.name}</p>
                    <p className="truncate text-xs text-muted">
                      {lead.interest} · {labelOf(sourceLabel, lead.source)} · {dateTimeLabel(lead.createdAt)}
                    </p>
                  </div>
                  <Badge tone={lead.status === "perdido" ? "red" : "brass"}>
                    {labelOf(stageLabel, lead.stage)}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="Imóveis mais procurados"
          action={
            <Link href="/admin/imoveis" className="text-xs text-brass hover:underline">
              gerenciar
            </Link>
          }
        >
          {data.topProperties.length === 0 ? (
            <Empty>Cadastre imóveis para ver as visualizações.</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {data.topProperties.map((property) => (
                <li key={property.id} className="flex items-center gap-3 py-3">
                  <div className="h-12 w-16 shrink-0 overflow-hidden bg-bone">
                    {property.cover && (
                      <img src={property.cover} alt="" className="h-full w-full object-cover" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-deep">{property.title}</p>
                    <p className="text-xs text-muted">
                      {property.code} · {money(property.price)}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-muted">{property.views} visitas</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card
        title="Agenda · próximas tarefas"
        action={
          <Link href="/admin/agenda" className="text-xs text-brass hover:underline">
            abrir agenda
          </Link>
        }
      >
        {data.upcomingTasks.length === 0 ? (
          <Empty>Nenhuma tarefa pendente.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {data.upcomingTasks.map((task) => (
              <li key={task.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm text-deep">{task.title}</p>
                  <p className="text-xs text-muted">
                    {labelOf(taskTypeLabel, task.type)} · {dateTimeLabel(task.dueAt)}
                  </p>
                </div>
                <Badge tone={new Date(task.dueAt) < new Date() ? "red" : "neutral"}>
                  {new Date(task.dueAt) < new Date() ? "atrasada" : "pendente"}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

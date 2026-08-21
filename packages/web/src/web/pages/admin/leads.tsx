import { useMemo, useState } from "react";
import { MessageCircle, Plus } from "lucide-react";
import { AdminGuard } from "../../components/admin/guard";
import { AdminLayout } from "../../components/admin/layout";
import {
  Badge,
  Btn,
  Card,
  Empty,
  ErrorNote,
  Input,
  Select,
  dateLabel,
  waLink,
} from "../../components/admin/ui";
import {
  LEAD_STAGES,
  labelOf,
  leadStatusLabel,
  sourceLabel,
  stageLabel,
} from "../../components/admin/labels";
import { errorMessage } from "../../lib/admin-session";
import { useAdminLeads, useSetLeadStage } from "../../queries/admin";
import { LeadDetail } from "./lead-detail";

export default function AdminLeads() {
  return (
    <AdminGuard>
      <Content />
    </AdminGuard>
  );
}

type StatusFilter = "" | "aberto" | "perdido" | "ganho";

function Content() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("aberto");
  const [view, setView] = useState<"funil" | "lista">(() =>
    typeof window !== "undefined" && window.innerWidth < 768 ? "lista" : "funil",
  );
  const [open, setOpen] = useState<number | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filters = useMemo(
    () => ({ search: search.trim() || undefined, status: status || undefined }),
    [search, status],
  );
  const { data, isLoading } = useAdminLeads(filters);
  const setStage = useSetLeadStage();

  const leads = data ?? [];

  async function moveStage(id: number, stage: (typeof LEAD_STAGES)[number]) {
    setError(null);
    try {
      await setStage.mutateAsync({ id, stage });
    } catch (caught) {
      setError(errorMessage(caught, "Não foi possível mover o lead"));
    }
  }

  return (
    <AdminLayout
      title="Leads / CRM"
      subtitle="Funil comercial do primeiro contato à venda"
      actions={
        <>
          <Btn tone="outline" onClick={() => setView(view === "funil" ? "lista" : "funil")}>
            {view === "funil" ? "Ver lista" : "Ver funil"}
          </Btn>
          <Btn tone="brass" onClick={() => setOpen("new")}>
            <Plus className="h-3.5 w-3.5" /> Novo lead
          </Btn>
        </>
      }
    >
      <div className="space-y-4">
        <Card>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_220px]">
            <Input
              placeholder="Buscar por nome ou telefone"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <Select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)}>
              <option value="">Todos</option>
              <option value="aberto">Em aberto</option>
              <option value="ganho">Ganhos</option>
              <option value="perdido">Perdidos</option>
            </Select>
          </div>
        </Card>

        <ErrorNote message={error} />
        {isLoading && <Empty>Carregando leads…</Empty>}
        {!isLoading && leads.length === 0 && <Empty>Nenhum lead encontrado.</Empty>}

        {!isLoading && leads.length > 0 && view === "funil" && (
          <div className="-mx-4 overflow-x-auto px-4 pb-2">
            <div className="flex min-w-max gap-3">
              {LEAD_STAGES.map((stage) => {
                const column = leads.filter((lead) => lead.stage === stage);
                return (
                  <div key={stage} className="w-72 shrink-0">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="label-xs text-muted">{stageLabel[stage]}</p>
                      <span className="text-xs text-muted">{column.length}</span>
                    </div>
                    <div className="min-h-24 space-y-2 rounded-[4px] border border-line bg-bone/30 p-2">
                      {column.map((lead) => (
                        <div key={lead.id} className="rounded-[3px] border border-line bg-white p-3">
                          <button
                            type="button"
                            onClick={() => setOpen(lead.id)}
                            className="block w-full text-left"
                          >
                            <p className="truncate text-sm font-medium text-deep">{lead.name}</p>
                            <p className="truncate text-xs text-muted">{lead.interest}</p>
                            <p className="mt-1 text-xs text-muted">
                              {lead.phone} · {labelOf(sourceLabel, lead.source)}
                            </p>
                            {lead.status === "perdido" && (
                              <span className="mt-1 inline-block">
                                <Badge tone="red">perdido</Badge>
                              </span>
                            )}
                          </button>
                          <div className="mt-2 flex items-center gap-2">
                            <Select
                              className="py-1.5 text-xs"
                              value={lead.stage}
                              onChange={(event) =>
                                void moveStage(
                                  lead.id,
                                  event.target.value as (typeof LEAD_STAGES)[number],
                                )
                              }
                            >
                              {LEAD_STAGES.map((value) => (
                                <option key={value} value={value}>
                                  {stageLabel[value]}
                                </option>
                              ))}
                            </Select>
                            <a
                              href={waLink(lead.phone, `Olá ${lead.name}, tudo bem?`)}
                              target="_blank"
                              rel="noreferrer"
                              aria-label="WhatsApp"
                              className="rounded-[3px] border border-line p-2 text-emerald-700 hover:bg-emerald-50"
                            >
                              <MessageCircle className="h-3.5 w-3.5" />
                            </a>
                          </div>
                        </div>
                      ))}
                      {column.length === 0 && (
                        <p className="px-1 py-3 text-center text-xs text-muted">vazio</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {!isLoading && leads.length > 0 && view === "lista" && (
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left">
                    <th className="label-xs py-2 text-muted">Lead</th>
                    <th className="label-xs py-2 text-muted">Interesse</th>
                    <th className="label-xs py-2 text-muted">Etapa</th>
                    <th className="label-xs py-2 text-muted">Origem</th>
                    <th className="label-xs py-2 text-muted">Próxima ação</th>
                    <th className="label-xs py-2 text-muted">Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {leads.map((lead) => (
                    <tr key={lead.id} className="border-b border-line/60">
                      <td className="py-3">
                        <button
                          type="button"
                          onClick={() => setOpen(lead.id)}
                          className="text-left text-deep hover:text-brass"
                        >
                          {lead.name}
                          <span className="block text-xs text-muted">{lead.phone}</span>
                        </button>
                      </td>
                      <td className="py-3 text-muted">{lead.interest}</td>
                      <td className="py-3">
                        <Badge tone="brass">{labelOf(stageLabel, lead.stage)}</Badge>
                      </td>
                      <td className="py-3 text-muted">{labelOf(sourceLabel, lead.source)}</td>
                      <td className="py-3 text-muted">
                        {lead.nextAction ?? "—"}
                        {lead.nextActionAt && (
                          <span className="block text-xs">{dateLabel(lead.nextActionAt)}</span>
                        )}
                      </td>
                      <td className="py-3">
                        <Badge tone={lead.status === "perdido" ? "red" : lead.status === "ganho" ? "green" : "neutral"}>
                          {labelOf(leadStatusLabel, lead.status)}
                        </Badge>
                      </td>
                      <td className="py-3 text-right">
                        <a
                          href={waLink(lead.phone, `Olá ${lead.name}, tudo bem?`)}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-emerald-700 hover:underline"
                        >
                          WhatsApp
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>

      {open !== null && (
        <LeadDetail leadId={open === "new" ? null : open} onClose={() => setOpen(null)} />
      )}
    </AdminLayout>
  );
}

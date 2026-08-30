import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { AdminGuard } from "../../components/admin/guard";
import { AdminLayout } from "../../components/admin/layout";
import {
  Badge,
  Btn,
  Card,
  Empty,
  ErrorNote,
  Field,
  Input,
  Modal,
  Select,
  Stat,
  Textarea,
  dateLabel,
  money,
  shortMoney,
} from "../../components/admin/ui";
import { dealStatusLabel, dealStatuses, labelOf } from "../../components/admin/labels";
import { errorMessage } from "../../lib/admin-session";
import {
  MoneyInputError,
  formatMoneyInput,
  parseMoneyInput,
  parsePercentInput,
} from "../../lib/money-input";
import {
  useAdminDeals,
  useAdminLeads,
  useClientOptions,
  usePropertyOptions,
  useRemoveDeal,
  useSaveDeal,
} from "../../queries/admin";

type DealStatus = (typeof dealStatuses)[number];

interface FormState {
  id: number | null;
  clientId: string;
  leadId: string;
  propertyId: string;
  clientName: string;
  askingPrice: string;
  offerPrice: string;
  status: DealStatus;
  commissionRate: string;
  notes: string;
  dealDate: string;
}

function emptyForm(): FormState {
  return {
    id: null,
    clientId: "",
    leadId: "",
    propertyId: "",
    clientName: "",
    askingPrice: "",
    offerPrice: "",
    status: "enviada",
    commissionRate: "6",
    notes: "",
    dealDate: new Date().toISOString().slice(0, 10),
  };
}

/**
 * Monta o payload numérico da proposta a partir do formulário.
 * Lança MoneyInputError com mensagem clara quando o texto digitado é inválido.
 */
function moneyPayload(form: FormState) {
  return {
    askingPrice: parseMoneyInput(form.askingPrice, "Valor pedido"),
    offerPrice: parseMoneyInput(form.offerPrice, "Valor proposto"),
    commissionRate: parsePercentInput(form.commissionRate, "Comissão"),
  };
}

export default function AdminDeals() {
  return (
    <AdminGuard>
      <Content />
    </AdminGuard>
  );
}

function Content() {
  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useAdminDeals();
  const properties = usePropertyOptions();
  const clients = useClientOptions();
  const leads = useAdminLeads();
  const save = useSaveDeal(form?.id ? "update" : "create");
  const remove = useRemoveDeal();

  const deals = data ?? [];
  const open = deals.filter((deal) => deal.status !== "recusada" && deal.status !== "fechada");
  const closed = deals.filter((deal) => deal.status === "fechada");
  const sum = (list: typeof deals, field: "offerPrice" | "commissionValue") =>
    list.reduce((total, deal) => total + (deal[field] ?? 0), 0);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => (current ? { ...current, [key]: value } : current));
  }

  function propertyLabel(id: number | null) {
    if (!id) return "—";
    const property = (properties.data ?? []).find((item) => item.id === id);
    return property ? `${property.code} — ${property.title}` : `#${id}`;
  }

  function clientLabel(deal: (typeof deals)[number]) {
    if (deal.clientName) return deal.clientName;
    const client = (clients.data ?? []).find((item) => item.id === deal.clientId);
    if (client) return client.name;
    const lead = (leads.data ?? []).find((item) => item.id === deal.leadId);
    return lead?.name ?? "—";
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!form) return;
    setError(null);

    let amounts: ReturnType<typeof moneyPayload>;
    try {
      amounts = moneyPayload(form);
    } catch (caught) {
      setError(
        caught instanceof MoneyInputError
          ? caught.message
          : "Verifique os valores informados, use o formato 320.000,00",
      );
      return;
    }

    const payload = {
      clientId: form.clientId ? Number(form.clientId) : null,
      leadId: form.leadId ? Number(form.leadId) : null,
      propertyId: form.propertyId ? Number(form.propertyId) : null,
      clientName: form.clientName.trim() || null,
      askingPrice: amounts.askingPrice,
      offerPrice: amounts.offerPrice,
      status: form.status,
      commissionRate: amounts.commissionRate,
      notes: form.notes.trim() || null,
      dealDate: form.dealDate || null,
    };
    try {
      if (form.id) await save.mutateAsync({ ...payload, id: form.id });
      else await save.mutateAsync(payload);
      setForm(null);
    } catch (caught) {
      setError(errorMessage(caught, "Não foi possível salvar a proposta"));
    }
  }

  return (
    <AdminLayout
      title="Propostas / Negócios"
      subtitle="Valores, status e comissão prevista"
      actions={
        <Btn tone="brass" onClick={() => setForm(emptyForm())}>
          <Plus className="h-3.5 w-3.5" /> Nova proposta
        </Btn>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Propostas" value={deals.length} />
          <Stat label="Em aberto" value={open.length} hint={shortMoney(sum(open, "offerPrice"))} />
          <Stat label="Fechadas" value={closed.length} hint={shortMoney(sum(closed, "offerPrice"))} />
          <Stat
            label="Comissão prevista"
            value={shortMoney(sum(open, "commissionValue"))}
            hint={`${money(sum(closed, "commissionValue"))} fechada`}
          />
        </div>

        <ErrorNote message={error} />
        {isLoading && <Empty>Carregando propostas…</Empty>}
        {!isLoading && deals.length === 0 && <Empty>Nenhuma proposta registrada.</Empty>}

        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {deals.map((deal) => (
            <Card key={deal.id}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  tone={
                    deal.status === "fechada"
                      ? "green"
                      : deal.status === "recusada"
                        ? "red"
                        : deal.status === "aceita"
                          ? "brass"
                          : "amber"
                  }
                >
                  {labelOf(dealStatusLabel, deal.status)}
                </Badge>
                <span className="text-xs text-muted">{dateLabel(deal.dealDate ?? deal.createdAt)}</span>
              </div>
              <p className="mt-2 text-sm font-medium text-deep">{clientLabel(deal)}</p>
              <p className="text-xs text-muted">{propertyLabel(deal.propertyId)}</p>
              <div className="mt-3 grid grid-cols-3 gap-3 border-t border-line pt-3 text-xs">
                <div>
                  <p className="label-xs text-muted">Pedido</p>
                  <p className="mt-1 text-sm text-deep">{money(deal.askingPrice)}</p>
                </div>
                <div>
                  <p className="label-xs text-muted">Proposto</p>
                  <p className="mt-1 text-sm text-deep">{money(deal.offerPrice)}</p>
                </div>
                <div>
                  <p className="label-xs text-muted">Comissão</p>
                  <p className="mt-1 text-sm text-deep">
                    {money(deal.commissionValue)}
                    {deal.commissionRate ? ` (${deal.commissionRate}%)` : ""}
                  </p>
                </div>
              </div>
              {deal.notes && <p className="mt-3 text-xs text-muted">{deal.notes}</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                <Btn
                  tone="outline"
                  onClick={() =>
                    setForm({
                      id: deal.id,
                      clientId: deal.clientId ? String(deal.clientId) : "",
                      leadId: deal.leadId ? String(deal.leadId) : "",
                      propertyId: deal.propertyId ? String(deal.propertyId) : "",
                      clientName: deal.clientName ?? "",
                      askingPrice: formatMoneyInput(deal.askingPrice),
                      offerPrice: formatMoneyInput(deal.offerPrice),
                      status: deal.status as DealStatus,
                      commissionRate: deal.commissionRate === null ? "" : String(deal.commissionRate),
                      notes: deal.notes ?? "",
                      dealDate: deal.dealDate
                        ? new Date(deal.dealDate).toISOString().slice(0, 10)
                        : "",
                    })
                  }
                >
                  <Pencil className="h-3.5 w-3.5" /> Editar
                </Btn>
                <Btn
                  tone="danger"
                  onClick={async () => {
                    if (!window.confirm("Excluir esta proposta?")) return;
                    setError(null);
                    try {
                      await remove.mutateAsync({ id: deal.id });
                    } catch (caught) {
                      setError(errorMessage(caught, "Não foi possível excluir"));
                    }
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Btn>
              </div>
            </Card>
          ))}
        </div>
      </div>

      {form && (
        <Modal open onClose={() => setForm(null)} wide title={form.id ? "Editar proposta" : "Nova proposta"}>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Imóvel">
                <Select value={form.propertyId} onChange={(e) => set("propertyId", e.target.value)}>
                  <option value="">Nenhum</option>
                  {(properties.data ?? []).map((property) => (
                    <option key={property.id} value={property.id}>
                      {property.code} — {property.title}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Cliente cadastrado">
                <Select value={form.clientId} onChange={(e) => set("clientId", e.target.value)}>
                  <option value="">Nenhum</option>
                  {(clients.data ?? []).map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Lead relacionado">
                <Select value={form.leadId} onChange={(e) => set("leadId", e.target.value)}>
                  <option value="">Nenhum</option>
                  {(leads.data ?? []).map((lead) => (
                    <option key={lead.id} value={lead.id}>
                      {lead.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Nome do cliente (livre)">
                <Input value={form.clientName} onChange={(e) => set("clientName", e.target.value)} />
              </Field>
              <Field label="Valor pedido (R$)">
                <Input value={form.askingPrice} onChange={(e) => set("askingPrice", e.target.value)} inputMode="decimal" />
              </Field>
              <Field label="Valor proposto (R$)">
                <Input value={form.offerPrice} onChange={(e) => set("offerPrice", e.target.value)} inputMode="decimal" />
              </Field>
              <Field label="Comissão (%)">
                <Input
                  value={form.commissionRate}
                  onChange={(e) => set("commissionRate", e.target.value)}
                  inputMode="decimal"
                />
              </Field>
              <Field label="Status">
                <Select value={form.status} onChange={(e) => set("status", e.target.value as DealStatus)}>
                  {dealStatuses.map((value) => (
                    <option key={value} value={value}>
                      {dealStatusLabel[value]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Data">
                <Input type="date" value={form.dealDate} onChange={(e) => set("dealDate", e.target.value)} />
              </Field>
            </div>
            <Field label="Observações">
              <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} />
            </Field>
            <ErrorNote message={error} />
            <div className="flex justify-end gap-2 border-t border-line pt-4">
              <Btn tone="outline" onClick={() => setForm(null)}>
                Cancelar
              </Btn>
              <Btn type="submit" tone="brass" disabled={save.isPending}>
                Salvar
              </Btn>
            </div>
          </form>
        </Modal>
      )}
    </AdminLayout>
  );
}

import { useEffect, useState } from "react";
import { MessageCircle, Pencil, Plus, Trash2 } from "lucide-react";
import { AdminGuard } from "../../components/admin/guard";
import { AdminLayout } from "../../components/admin/layout";
import {
  Btn,
  Card,
  Empty,
  ErrorNote,
  Field,
  Input,
  Modal,
  Textarea,
  dateTimeLabel,
  money,
  waLink,
} from "../../components/admin/ui";
import { errorMessage } from "../../lib/admin-session";
import {
  useAddClientInteraction,
  useAdminClients,
  useClient,
  useRemoveClient,
  useSaveClient,
} from "../../queries/admin";

export default function AdminClients() {
  return (
    <AdminGuard>
      <Content />
    </AdminGuard>
  );
}

function Content() {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<number | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { data, isLoading } = useAdminClients(search.trim() || undefined);
  const remove = useRemoveClient();

  return (
    <AdminLayout
      title="Clientes"
      subtitle="Perfil de busca e histórico de atendimento"
      actions={
        <Btn tone="brass" onClick={() => setOpen("new")}>
          <Plus className="h-3.5 w-3.5" /> Novo cliente
        </Btn>
      }
    >
      <div className="space-y-4">
        <Card>
          <Input
            placeholder="Buscar por nome ou telefone"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </Card>

        <ErrorNote message={error} />
        {isLoading && <Empty>Carregando clientes…</Empty>}
        {!isLoading && (data?.length ?? 0) === 0 && <Empty>Nenhum cliente cadastrado.</Empty>}

        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {(data ?? []).map((client) => (
            <Card key={client.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-deep">{client.name}</p>
                  <p className="text-xs text-muted">
                    {client.phone}
                    {client.email ? ` · ${client.email}` : ""}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    {client.interest ?? "Interesse não informado"}
                    {client.bedrooms ? ` · ${client.bedrooms} dorm` : ""}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    Faixa: {client.priceMin ? money(client.priceMin) : "—"} a{" "}
                    {client.priceMax ? money(client.priceMax) : "—"}
                  </p>
                  {client.districts && (
                    <p className="mt-1 text-xs text-muted">Bairros: {client.districts}</p>
                  )}
                </div>
                <a
                  href={waLink(client.phone, `Olá ${client.name}, tudo bem?`)}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="WhatsApp"
                  className="rounded-[3px] border border-line p-2 text-emerald-700 hover:bg-emerald-50"
                >
                  <MessageCircle className="h-3.5 w-3.5" />
                </a>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Btn tone="outline" onClick={() => setOpen(client.id)}>
                  <Pencil className="h-3.5 w-3.5" /> Abrir
                </Btn>
                <Btn
                  tone="danger"
                  onClick={async () => {
                    if (!window.confirm(`Excluir o cliente ${client.name}?`)) return;
                    setError(null);
                    try {
                      await remove.mutateAsync({ id: client.id });
                    } catch (caught) {
                      setError(errorMessage(caught, "Não foi possível excluir"));
                    }
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" /> Excluir
                </Btn>
              </div>
            </Card>
          ))}
        </div>
      </div>

      {open !== null && (
        <ClientForm clientId={open === "new" ? null : open} onClose={() => setOpen(null)} />
      )}
    </AdminLayout>
  );
}

interface FormState {
  name: string;
  phone: string;
  email: string;
  interest: string;
  priceMin: string;
  priceMax: string;
  districts: string;
  bedrooms: string;
  notes: string;
}

const empty: FormState = {
  name: "",
  phone: "",
  email: "",
  interest: "",
  priceMin: "",
  priceMax: "",
  districts: "",
  bedrooms: "",
  notes: "",
};

function optionalNum(value: string) {
  if (!value.trim()) return null;
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function ClientForm({ clientId, onClose }: { clientId: number | null; onClose: () => void }) {
  const [form, setForm] = useState<FormState>(empty);
  const [entry, setEntry] = useState("");
  const [error, setError] = useState<string | null>(null);

  const detail = useClient(clientId);
  const save = useSaveClient(clientId ? "update" : "create");
  const addInteraction = useAddClientInteraction();

  useEffect(() => {
    const client = detail.data?.client;
    if (!client) return;
    setForm({
      name: client.name,
      phone: client.phone,
      email: client.email ?? "",
      interest: client.interest ?? "",
      priceMin: client.priceMin === null ? "" : String(client.priceMin),
      priceMax: client.priceMax === null ? "" : String(client.priceMax),
      districts: client.districts ?? "",
      bedrooms: client.bedrooms === null ? "" : String(client.bedrooms),
      notes: client.notes ?? "",
    });
  }, [detail.data]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const payload = {
      name: form.name.trim(),
      phone: form.phone.trim(),
      email: form.email.trim() || null,
      interest: form.interest.trim() || null,
      priceMin: optionalNum(form.priceMin),
      priceMax: optionalNum(form.priceMax),
      districts: form.districts.trim() || null,
      bedrooms: form.bedrooms ? Math.trunc(Number(form.bedrooms)) : null,
      notes: form.notes.trim() || null,
    };
    try {
      if (clientId) await save.mutateAsync({ ...payload, id: clientId });
      else await save.mutateAsync(payload);
      onClose();
    } catch (caught) {
      setError(errorMessage(caught, "Não foi possível salvar o cliente"));
    }
  }

  return (
    <Modal open onClose={onClose} wide title={clientId ? "Cliente" : "Novo cliente"}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Nome">
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} required />
          </Field>
          <Field label="Telefone / WhatsApp">
            <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} required />
          </Field>
          <Field label="E-mail">
            <Input value={form.email} onChange={(e) => set("email", e.target.value)} />
          </Field>
          <Field label="Interesse" hint="Ex: Compra 2 dorm frente mar">
            <Input value={form.interest} onChange={(e) => set("interest", e.target.value)} />
          </Field>
          <Field label="Faixa de preço — mínimo">
            <Input value={form.priceMin} onChange={(e) => set("priceMin", e.target.value)} inputMode="decimal" />
          </Field>
          <Field label="Faixa de preço — máximo">
            <Input value={form.priceMax} onChange={(e) => set("priceMax", e.target.value)} inputMode="decimal" />
          </Field>
          <Field label="Bairros de interesse" hint="Separe por vírgula">
            <Input value={form.districts} onChange={(e) => set("districts", e.target.value)} />
          </Field>
          <Field label="Dormitórios desejados">
            <Input value={form.bedrooms} onChange={(e) => set("bedrooms", e.target.value)} inputMode="numeric" />
          </Field>
        </div>

        <Field label="Observações">
          <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} />
        </Field>

        <ErrorNote message={error} />

        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Btn tone="outline" onClick={onClose}>
            Fechar
          </Btn>
          <Btn type="submit" tone="brass" disabled={save.isPending}>
            Salvar
          </Btn>
        </div>
      </form>

      {clientId !== null && (
        <div className="mt-5 border-t border-line pt-4">
          <p className="label-xs text-muted">Histórico de atendimento</p>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <Input
              placeholder="Registrar contato, visita, retorno…"
              value={entry}
              onChange={(event) => setEntry(event.target.value)}
            />
            <Btn
              disabled={!entry.trim() || addInteraction.isPending}
              onClick={async () => {
                try {
                  await addInteraction.mutateAsync({ id: clientId, body: entry.trim() });
                  setEntry("");
                } catch (caught) {
                  setError(errorMessage(caught, "Não foi possível registrar"));
                }
              }}
            >
              Adicionar
            </Btn>
          </div>
          <ul className="mt-3 divide-y divide-line">
            {(detail.data?.interactions ?? []).map((item) => (
              <li key={item.id} className="py-2.5">
                <p className="text-sm text-deep">{item.body}</p>
                <p className="text-xs text-muted">{dateTimeLabel(item.createdAt)}</p>
              </li>
            ))}
            {(detail.data?.interactions ?? []).length === 0 && (
              <li className="py-2.5 text-xs text-muted">Nenhum atendimento registrado.</li>
            )}
          </ul>
        </div>
      )}
    </Modal>
  );
}

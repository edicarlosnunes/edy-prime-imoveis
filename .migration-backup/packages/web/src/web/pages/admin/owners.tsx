import { useState } from "react";
import { MessageCircle, Pencil, Plus, Trash2 } from "lucide-react";
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
  Textarea,
  waLink,
} from "../../components/admin/ui";
import { captureStatusLabel, captureStatuses, labelOf } from "../../components/admin/labels";
import { errorMessage } from "../../lib/admin-session";
import { useAdminOwners, useRemoveOwner, useSaveOwner } from "../../queries/admin";

type Capture = (typeof captureStatuses)[number];

interface FormState {
  id: number | null;
  name: string;
  phone: string;
  email: string;
  notes: string;
  captureStatus: Capture;
}

const empty: FormState = {
  id: null,
  name: "",
  phone: "",
  email: "",
  notes: "",
  captureStatus: "prospeccao",
};

export default function AdminOwners() {
  return (
    <AdminGuard>
      <Content />
    </AdminGuard>
  );
}

function Content() {
  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { data, isLoading } = useAdminOwners();
  const remove = useRemoveOwner();
  const save = useSaveOwner(form?.id ? "update" : "create");

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => (current ? { ...current, [key]: value } : current));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!form) return;
    setError(null);
    const payload = {
      name: form.name.trim(),
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      notes: form.notes.trim() || null,
      captureStatus: form.captureStatus,
    };
    try {
      if (form.id) await save.mutateAsync({ ...payload, id: form.id });
      else await save.mutateAsync(payload);
      setForm(null);
    } catch (caught) {
      setError(errorMessage(caught, "Não foi possível salvar"));
    }
  }

  return (
    <AdminLayout
      title="Proprietários"
      subtitle="Captação e imóveis vinculados"
      actions={
        <Btn tone="brass" onClick={() => setForm(empty)}>
          <Plus className="h-3.5 w-3.5" /> Novo proprietário
        </Btn>
      }
    >
      <div className="space-y-4">
        <ErrorNote message={error} />
        {isLoading && <Empty>Carregando…</Empty>}
        {!isLoading && (data?.length ?? 0) === 0 && <Empty>Nenhum proprietário cadastrado.</Empty>}

        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {(data ?? []).map((owner) => (
            <Card key={owner.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-deep">{owner.name}</p>
                    <Badge tone={owner.captureStatus === "captado" ? "green" : "neutral"}>
                      {labelOf(captureStatusLabel, owner.captureStatus)}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {owner.phone ?? "sem telefone"}
                    {owner.email ? ` · ${owner.email}` : ""}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    Imóveis:{" "}
                    {owner.properties.length === 0
                      ? "nenhum vinculado"
                      : owner.properties.map((property) => property.code).join(", ")}
                  </p>
                  {owner.notes && <p className="mt-2 text-xs text-muted">{owner.notes}</p>}
                </div>
                {owner.phone && (
                  <a
                    href={waLink(owner.phone, `Olá ${owner.name}, tudo bem?`)}
                    target="_blank"
                    rel="noreferrer"
                    aria-label="WhatsApp"
                    className="rounded-[3px] border border-line p-2 text-emerald-700 hover:bg-emerald-50"
                  >
                    <MessageCircle className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Btn
                  tone="outline"
                  onClick={() =>
                    setForm({
                      id: owner.id,
                      name: owner.name,
                      phone: owner.phone ?? "",
                      email: owner.email ?? "",
                      notes: owner.notes ?? "",
                      captureStatus: owner.captureStatus as Capture,
                    })
                  }
                >
                  <Pencil className="h-3.5 w-3.5" /> Editar
                </Btn>
                <Btn
                  tone="danger"
                  onClick={async () => {
                    if (!window.confirm(`Excluir ${owner.name}?`)) return;
                    setError(null);
                    try {
                      await remove.mutateAsync({ id: owner.id });
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

      {form && (
        <Modal open onClose={() => setForm(null)} title={form.id ? "Editar proprietário" : "Novo proprietário"}>
          <form onSubmit={submit} className="space-y-4">
            <Field label="Nome">
              <Input value={form.name} onChange={(e) => set("name", e.target.value)} required />
            </Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Telefone">
                <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} />
              </Field>
              <Field label="E-mail">
                <Input value={form.email} onChange={(e) => set("email", e.target.value)} />
              </Field>
            </div>
            <Field label="Status de captação">
              <Select
                value={form.captureStatus}
                onChange={(e) => set("captureStatus", e.target.value as Capture)}
              >
                {captureStatuses.map((value) => (
                  <option key={value} value={value}>
                    {captureStatusLabel[value]}
                  </option>
                ))}
              </Select>
            </Field>
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

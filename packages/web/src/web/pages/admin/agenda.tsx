import { useState } from "react";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
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
  dateTimeLabel,
  toInputDateTime,
} from "../../components/admin/ui";
import {
  labelOf,
  taskStatusLabel,
  taskStatuses,
  taskTypeLabel,
  taskTypes,
} from "../../components/admin/labels";
import { errorMessage } from "../../lib/admin-session";
import {
  useAdminLeads,
  useAdminTasks,
  useClientOptions,
  usePropertyOptions,
  useRemoveTask,
  useSaveTask,
  useSetTaskStatus,
} from "../../queries/admin";

type TaskType = (typeof taskTypes)[number];
type TaskStatus = (typeof taskStatuses)[number];

interface FormState {
  id: number | null;
  title: string;
  type: TaskType;
  dueAt: string;
  status: TaskStatus;
  leadId: string;
  clientId: string;
  propertyId: string;
  notes: string;
}

function emptyForm(): FormState {
  return {
    id: null,
    title: "",
    type: "visita",
    dueAt: toInputDateTime(new Date()),
    status: "pendente",
    leadId: "",
    clientId: "",
    propertyId: "",
    notes: "",
  };
}

export default function AdminAgenda() {
  return (
    <AdminGuard>
      <Content />
    </AdminGuard>
  );
}

function Content() {
  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<TaskStatus | "">("");

  const { data, isLoading } = useAdminTasks();
  const leads = useAdminLeads();
  const clients = useClientOptions();
  const properties = usePropertyOptions();
  const save = useSaveTask(form?.id ? "update" : "create");
  const setStatus = useSetTaskStatus();
  const remove = useRemoveTask();

  const tasks = (data ?? []).filter((task) => (filter ? task.status === filter : true));

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => (current ? { ...current, [key]: value } : current));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!form) return;
    setError(null);
    const payload = {
      title: form.title.trim(),
      type: form.type,
      dueAt: form.dueAt,
      status: form.status,
      leadId: form.leadId ? Number(form.leadId) : null,
      clientId: form.clientId ? Number(form.clientId) : null,
      propertyId: form.propertyId ? Number(form.propertyId) : null,
      notes: form.notes.trim() || null,
    };
    try {
      if (form.id) await save.mutateAsync({ ...payload, id: form.id });
      else await save.mutateAsync(payload);
      setForm(null);
    } catch (caught) {
      setError(errorMessage(caught, "Não foi possível salvar a tarefa"));
    }
  }

  async function run(action: Promise<unknown>) {
    setError(null);
    try {
      await action;
    } catch (caught) {
      setError(errorMessage(caught, "Ação não concluída"));
    }
  }

  return (
    <AdminLayout
      title="Agenda"
      subtitle="Visitas, retornos, reuniões, propostas e follow-ups"
      actions={
        <Btn tone="brass" onClick={() => setForm(emptyForm())}>
          <Plus className="h-3.5 w-3.5" /> Nova tarefa
        </Btn>
      }
    >
      <div className="space-y-4">
        <Card>
          <Select value={filter} onChange={(event) => setFilter(event.target.value as TaskStatus | "")}>
            <option value="">Todas as tarefas</option>
            {taskStatuses.map((value) => (
              <option key={value} value={value}>
                {taskStatusLabel[value]}
              </option>
            ))}
          </Select>
        </Card>

        <ErrorNote message={error} />
        {isLoading && <Empty>Carregando agenda…</Empty>}
        {!isLoading && tasks.length === 0 && <Empty>Nenhuma tarefa registrada.</Empty>}

        <div className="space-y-2">
          {tasks.map((task) => {
            const late = task.status === "pendente" && new Date(task.dueAt) < new Date();
            return (
              <Card key={task.id} className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-deep">{task.title}</p>
                    <Badge tone="brass">{labelOf(taskTypeLabel, task.type)}</Badge>
                    <Badge
                      tone={
                        task.status === "concluida" ? "green" : late ? "red" : task.status === "cancelada" ? "neutral" : "amber"
                      }
                    >
                      {late ? "atrasada" : labelOf(taskStatusLabel, task.status)}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted">{dateTimeLabel(task.dueAt)}</p>
                  {task.notes && <p className="mt-1 text-xs text-muted">{task.notes}</p>}
                </div>
                <div className="flex flex-wrap gap-2">
                  {task.status !== "concluida" && (
                    <Btn
                      tone="outline"
                      onClick={() => void run(setStatus.mutateAsync({ id: task.id, status: "concluida" }))}
                    >
                      <Check className="h-3.5 w-3.5" /> Concluir
                    </Btn>
                  )}
                  {task.status === "pendente" && (
                    <Btn
                      tone="outline"
                      onClick={() => void run(setStatus.mutateAsync({ id: task.id, status: "cancelada" }))}
                    >
                      <X className="h-3.5 w-3.5" /> Cancelar
                    </Btn>
                  )}
                  <Btn
                    tone="outline"
                    onClick={() =>
                      setForm({
                        id: task.id,
                        title: task.title,
                        type: task.type as TaskType,
                        dueAt: toInputDateTime(task.dueAt),
                        status: task.status as TaskStatus,
                        leadId: task.leadId ? String(task.leadId) : "",
                        clientId: task.clientId ? String(task.clientId) : "",
                        propertyId: task.propertyId ? String(task.propertyId) : "",
                        notes: task.notes ?? "",
                      })
                    }
                  >
                    <Pencil className="h-3.5 w-3.5" /> Editar
                  </Btn>
                  <Btn
                    tone="danger"
                    onClick={() => {
                      if (!window.confirm("Excluir esta tarefa?")) return;
                      void run(remove.mutateAsync({ id: task.id }));
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Btn>
                </div>
              </Card>
            );
          })}
        </div>
      </div>

      {form && (
        <Modal open onClose={() => setForm(null)} wide title={form.id ? "Editar tarefa" : "Nova tarefa"}>
          <form onSubmit={submit} className="space-y-4">
            <Field label="Título">
              <Input value={form.title} onChange={(e) => set("title", e.target.value)} required />
            </Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Tipo">
                <Select value={form.type} onChange={(e) => set("type", e.target.value as TaskType)}>
                  {taskTypes.map((value) => (
                    <option key={value} value={value}>
                      {taskTypeLabel[value]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Data e hora">
                <Input
                  type="datetime-local"
                  value={form.dueAt}
                  onChange={(e) => set("dueAt", e.target.value)}
                  required
                />
              </Field>
              <Field label="Status">
                <Select value={form.status} onChange={(e) => set("status", e.target.value as TaskStatus)}>
                  {taskStatuses.map((value) => (
                    <option key={value} value={value}>
                      {taskStatusLabel[value]}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Lead">
                <Select value={form.leadId} onChange={(e) => set("leadId", e.target.value)}>
                  <option value="">Nenhum</option>
                  {(leads.data ?? []).map((lead) => (
                    <option key={lead.id} value={lead.id}>
                      {lead.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Cliente">
                <Select value={form.clientId} onChange={(e) => set("clientId", e.target.value)}>
                  <option value="">Nenhum</option>
                  {(clients.data ?? []).map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name}
                    </option>
                  ))}
                </Select>
              </Field>
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

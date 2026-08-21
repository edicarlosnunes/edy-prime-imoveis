import { useEffect, useState } from "react";
import { MessageCircle, Trash2 } from "lucide-react";
import {
  Badge,
  Btn,
  ErrorNote,
  Field,
  Input,
  Modal,
  Select,
  Textarea,
  dateTimeLabel,
  toInputDateTime,
  waLink,
} from "../../components/admin/ui";
import {
  LEAD_STAGES,
  leadSources,
  leadStatusLabel,
  sourceLabel,
  stageLabel,
} from "../../components/admin/labels";
import { LeadNeeds } from "../../components/admin/lead-needs";
import { errorMessage } from "../../lib/admin-session";
import {
  useAddLeadNote,
  useClientOptions,
  useCreateLead,
  useLead,
  useMarkLeadLost,
  usePropertyOptions,
  useRemoveLead,
  useReopenLead,
  useUpdateLead,
} from "../../queries/admin";

interface FormState {
  name: string;
  phone: string;
  email: string;
  interest: string;
  message: string;
  source: string;
  stage: (typeof LEAD_STAGES)[number];
  status: "aberto" | "perdido" | "ganho";
  lostReason: string;
  propertyId: string;
  clientId: string;
  nextAction: string;
  nextActionAt: string;
}

const empty: FormState = {
  name: "",
  phone: "",
  email: "",
  interest: "Compra",
  message: "",
  source: "manual",
  stage: "novo",
  status: "aberto",
  lostReason: "",
  propertyId: "",
  clientId: "",
  nextAction: "",
  nextActionAt: "",
};

export function LeadDetail({ leadId, onClose }: { leadId: number | null; onClose: () => void }) {
  const [form, setForm] = useState<FormState>(empty);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const detail = useLead(leadId);
  const properties = usePropertyOptions();
  const clients = useClientOptions();
  const create = useCreateLead();
  const update = useUpdateLead();
  const addNote = useAddLeadNote();
  const markLost = useMarkLeadLost();
  const reopen = useReopenLead();
  const remove = useRemoveLead();

  useEffect(() => {
    const lead = detail.data?.lead;
    if (!lead) return;
    setForm({
      name: lead.name,
      phone: lead.phone,
      email: lead.email ?? "",
      interest: lead.interest,
      message: lead.message ?? "",
      source: lead.source,
      stage: lead.stage as FormState["stage"],
      status: lead.status as FormState["status"],
      lostReason: lead.lostReason ?? "",
      propertyId: lead.propertyId ? String(lead.propertyId) : "",
      clientId: lead.clientId ? String(lead.clientId) : "",
      nextAction: lead.nextAction ?? "",
      nextActionAt: toInputDateTime(lead.nextActionAt),
    });
  }, [detail.data]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      if (leadId === null) {
        await create.mutateAsync({
          name: form.name.trim(),
          phone: form.phone.trim(),
          email: form.email.trim() || null,
          interest: form.interest.trim() || "Compra",
          message: form.message.trim() || null,
          source: form.source,
          stage: form.stage,
          propertyId: form.propertyId ? Number(form.propertyId) : null,
          clientId: form.clientId ? Number(form.clientId) : null,
        });
      } else {
        await update.mutateAsync({
          id: leadId,
          name: form.name.trim(),
          phone: form.phone.trim(),
          email: form.email.trim() || null,
          interest: form.interest.trim() || "Compra",
          message: form.message.trim() || null,
          source: form.source,
          stage: form.stage,
          status: form.status,
          lostReason: form.lostReason.trim() || null,
          propertyId: form.propertyId ? Number(form.propertyId) : null,
          clientId: form.clientId ? Number(form.clientId) : null,
          nextAction: form.nextAction.trim() || null,
          nextActionAt: form.nextActionAt || null,
        });
      }
      onClose();
    } catch (caught) {
      setError(errorMessage(caught, "Não foi possível salvar o lead"));
    }
  }

  async function run(action: Promise<unknown>, close = false) {
    setError(null);
    try {
      await action;
      if (close) onClose();
    } catch (caught) {
      setError(errorMessage(caught, "Ação não concluída"));
    }
  }

  const lead = detail.data?.lead;

  return (
    <Modal open onClose={onClose} wide title={leadId === null ? "Novo lead" : "Lead"}>
      <div className="space-y-5">
        {lead && (
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="brass">{stageLabel[lead.stage] ?? lead.stage}</Badge>
            <Badge tone={lead.status === "perdido" ? "red" : lead.status === "ganho" ? "green" : "neutral"}>
              {leadStatusLabel[lead.status] ?? lead.status}
            </Badge>
            <span className="text-xs text-muted">
              criado em {dateTimeLabel(lead.createdAt)} · origem {sourceLabel[lead.source] ?? lead.source}
            </span>
            <a
              href={waLink(lead.phone, `Olá ${lead.name}, tudo bem? Sou o Edy, da Edy Premi Imóveis.`)}
              target="_blank"
              rel="noreferrer"
              className="ml-auto inline-flex items-center gap-1.5 rounded-[3px] bg-emerald-600 px-3 py-2 text-[11px] tracking-wide text-white uppercase hover:bg-emerald-700"
            >
              <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
            </a>
          </div>
        )}

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
            <Field label="Interesse">
              <Input value={form.interest} onChange={(e) => set("interest", e.target.value)} />
            </Field>
            <Field label="Origem">
              <Select value={form.source} onChange={(e) => set("source", e.target.value)}>
                {leadSources.map((value) => (
                  <option key={value} value={value}>
                    {sourceLabel[value]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Etapa do funil">
              <Select value={form.stage} onChange={(e) => set("stage", e.target.value as FormState["stage"])}>
                {LEAD_STAGES.map((value) => (
                  <option key={value} value={value}>
                    {stageLabel[value]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Imóvel associado">
              <Select value={form.propertyId} onChange={(e) => set("propertyId", e.target.value)}>
                <option value="">Nenhum</option>
                {(properties.data ?? []).map((property) => (
                  <option key={property.id} value={property.id}>
                    {property.code} — {property.title}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Cliente vinculado">
              <Select value={form.clientId} onChange={(e) => set("clientId", e.target.value)}>
                <option value="">Nenhum</option>
                {(clients.data ?? []).map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </Select>
            </Field>
            {leadId !== null && (
              <>
                <Field label="Próxima ação">
                  <Input value={form.nextAction} onChange={(e) => set("nextAction", e.target.value)} />
                </Field>
                <Field label="Data da próxima ação">
                  <Input
                    type="datetime-local"
                    value={form.nextActionAt}
                    onChange={(e) => set("nextActionAt", e.target.value)}
                  />
                </Field>
              </>
            )}
          </div>

          <Field label="Observações / mensagem">
            <Textarea value={form.message} onChange={(e) => set("message", e.target.value)} />
          </Field>

          {leadId !== null && form.status === "perdido" && (
            <Field label="Motivo da perda">
              <Input value={form.lostReason} onChange={(e) => set("lostReason", e.target.value)} />
            </Field>
          )}

          <ErrorNote message={error} />

          <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
            {leadId !== null && lead?.status !== "perdido" && (
              <Btn
                tone="outline"
                onClick={() => {
                  const reason = window.prompt("Motivo da perda:");
                  if (!reason || reason.trim().length < 2) return;
                  void run(markLost.mutateAsync({ id: leadId, reason: reason.trim() }), true);
                }}
              >
                Marcar como perdido
              </Btn>
            )}
            {leadId !== null && lead?.status === "perdido" && (
              <Btn tone="outline" onClick={() => void run(reopen.mutateAsync({ id: leadId }), true)}>
                Reabrir lead
              </Btn>
            )}
            {leadId !== null && (
              <Btn
                tone="danger"
                onClick={() => {
                  if (!window.confirm("Excluir este lead e suas observações?")) return;
                  void run(remove.mutateAsync({ id: leadId }), true);
                }}
              >
                <Trash2 className="h-3.5 w-3.5" /> Excluir
              </Btn>
            )}
            <Btn tone="outline" onClick={onClose}>
              Fechar
            </Btn>
            <Btn type="submit" tone="brass" disabled={create.isPending || update.isPending}>
              Salvar
            </Btn>
          </div>
        </form>

        {leadId !== null && (
          <div className="border-t border-line pt-4">
            <p className="label-xs text-muted">Observações</p>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <Input
                placeholder="Registrar um atendimento, ligação, visita…"
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
              <Btn
                tone="primary"
                disabled={!note.trim() || addNote.isPending}
                onClick={async () => {
                  await run(addNote.mutateAsync({ id: leadId, body: note.trim() }));
                  setNote("");
                }}
              >
                Adicionar
              </Btn>
            </div>
            <ul className="mt-3 divide-y divide-line">
              {(detail.data?.notes ?? []).map((item) => (
                <li key={item.id} className="py-2.5">
                  <p className="text-sm text-deep">{item.body}</p>
                  <p className="text-xs text-muted">{dateTimeLabel(item.createdAt)}</p>
                </li>
              ))}
              {(detail.data?.notes ?? []).length === 0 && (
                <li className="py-2.5 text-xs text-muted">Nenhuma observação ainda.</li>
              )}
            </ul>
          </div>
        )}

        {leadId !== null && <LeadNeeds leadId={leadId} />}
      </div>
    </Modal>
  );
}

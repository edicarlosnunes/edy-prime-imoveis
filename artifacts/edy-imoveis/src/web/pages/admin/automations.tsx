import { useState } from "react";
import { Plus, RefreshCw, Trash2, Zap } from "lucide-react";
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
  dateTimeLabel,
} from "../../components/admin/ui";
import { errorMessage } from "../../lib/admin-session";
import {
  useAutomations,
  useRemoveAutomation,
  useSaveAutomation,
  useSetAutomationActive,
  useSweepAutomations,
} from "../../queries/integrations";

type Trigger =
  | "lead_novo"
  | "lead_sem_resposta"
  | "conversa_transferida"
  | "imovel_publicado"
  | "proposta_enviada";
type ActionType = "criar_tarefa" | "nota_lead" | "mudar_etapa" | "whatsapp_texto";

interface ActionState {
  type: ActionType;
  text: string;
  stage: string;
  hours: number;
}

interface FormState {
  id: number | null;
  name: string;
  trigger: Trigger;
  source: string;
  hours: number;
  active: boolean;
  actions: ActionState[];
}

const STAGES = [
  "novo",
  "primeiro_contato",
  "qualificado",
  "imovel_apresentado",
  "visita_agendada",
  "proposta_enviada",
  "negociacao",
];

const emptyForm: FormState = {
  id: null,
  name: "Primeiro contato em 2 horas",
  trigger: "lead_novo",
  source: "",
  hours: 24,
  active: false,
  actions: [{ type: "criar_tarefa", text: "Ligar para {nome}", stage: "novo", hours: 2 }],
};

function AutomationForm({
  state,
  onChange,
  onClose,
  triggers,
  actionTypes,
}: {
  state: FormState;
  onChange: (next: FormState) => void;
  onClose: () => void;
  triggers: { value: string; label: string }[];
  actionTypes: { value: string; label: string }[];
}) {
  const save = useSaveAutomation(state.id ? "update" : "create");
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    try {
      const payload = {
        name: state.name,
        trigger: state.trigger,
        conditions: {
          ...(state.source ? { source: state.source } : {}),
          ...(state.trigger === "lead_sem_resposta" ? { hours: state.hours } : {}),
        },
        actions: state.actions.map((action) => ({
          type: action.type,
          text: action.text || undefined,
          stage: action.type === "mudar_etapa" ? action.stage : undefined,
          hours: action.type === "criar_tarefa" ? action.hours : undefined,
        })),
        active: state.active,
      };
      if (state.id) await save.mutateAsync({ ...payload, id: state.id });
      else await save.mutateAsync(payload);
      onClose();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  return (
    <Modal open onClose={onClose} title={state.id ? "Editar automação" : "Nova automação"} wide>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Nome">
          <Input value={state.name} onChange={(e) => onChange({ ...state, name: e.target.value })} />
        </Field>
        <Field label="Gatilho">
          <Select
            value={state.trigger}
            onChange={(e) => onChange({ ...state, trigger: e.target.value as Trigger })}
          >
            {triggers.map((trigger) => (
              <option key={trigger.value} value={trigger.value}>
                {trigger.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Somente para leads desta origem" hint="Deixe vazio para todas as origens">
          <Input
            placeholder="site, zap, olx, whatsapp…"
            value={state.source}
            onChange={(e) => onChange({ ...state, source: e.target.value })}
          />
        </Field>
        {state.trigger === "lead_sem_resposta" && (
          <Field label="Horas sem contato">
            <Input
              type="number"
              min={1}
              max={720}
              value={state.hours}
              onChange={(e) => onChange({ ...state, hours: Number(e.target.value) || 24 })}
            />
          </Field>
        )}
      </div>

      <div className="mt-5 space-y-3">
        <div className="flex items-center justify-between">
          <p className="label-xs text-muted">Ações</p>
          <Btn
            tone="outline"
            onClick={() =>
              onChange({
                ...state,
                actions: [
                  ...state.actions,
                  { type: "nota_lead", text: "", stage: "novo", hours: 2 },
                ],
              })
            }
          >
            <Plus className="h-3.5 w-3.5" /> Adicionar ação
          </Btn>
        </div>

        {state.actions.map((action, index) => (
          <div key={index} className="rounded-[3px] border border-line p-3">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Tipo">
                <Select
                  value={action.type}
                  onChange={(e) =>
                    onChange({
                      ...state,
                      actions: state.actions.map((item, position) =>
                        position === index ? { ...item, type: e.target.value as ActionType } : item,
                      ),
                    })
                  }
                >
                  {actionTypes.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </Field>
              {action.type === "mudar_etapa" ? (
                <Field label="Etapa destino">
                  <Select
                    value={action.stage}
                    onChange={(e) =>
                      onChange({
                        ...state,
                        actions: state.actions.map((item, position) =>
                          position === index ? { ...item, stage: e.target.value } : item,
                        ),
                      })
                    }
                  >
                    {STAGES.map((stage) => (
                      <option key={stage} value={stage}>
                        {stage}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : action.type === "criar_tarefa" ? (
                <Field label="Vencimento (horas)">
                  <Input
                    type="number"
                    min={1}
                    max={720}
                    value={action.hours}
                    onChange={(e) =>
                      onChange({
                        ...state,
                        actions: state.actions.map((item, position) =>
                          position === index
                            ? { ...item, hours: Number(e.target.value) || 2 }
                            : item,
                        ),
                      })
                    }
                  />
                </Field>
              ) : null}
              <Field
                label={action.type === "whatsapp_texto" ? "Mensagem" : "Texto"}
                className="md:col-span-2"
                hint="Use {nome} e {origem} para personalizar."
              >
                <Textarea
                  value={action.text}
                  onChange={(e) =>
                    onChange({
                      ...state,
                      actions: state.actions.map((item, position) =>
                        position === index ? { ...item, text: e.target.value } : item,
                      ),
                    })
                  }
                />
              </Field>
            </div>
            {action.type === "whatsapp_texto" && (
              <p className="mt-2 text-[11px] text-amber-800">
                Só funciona com o WhatsApp Cloud API conectado. Sem credencial, a execução falha e
                fica registrada.
              </p>
            )}
            {state.actions.length > 1 && (
              <Btn
                tone="danger"
                className="mt-2"
                onClick={() =>
                  onChange({
                    ...state,
                    actions: state.actions.filter((_, position) => position !== index),
                  })
                }
              >
                Remover ação
              </Btn>
            )}
          </div>
        ))}
      </div>

      <Field label="Ativa" className="mt-4">
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={state.active}
            onChange={(e) => onChange({ ...state, active: e.target.checked })}
          />
          Executar automaticamente
        </label>
      </Field>

      <ErrorNote message={error} />
      <footer className="mt-5 flex justify-end gap-2 border-t border-line pt-4">
        <Btn tone="outline" onClick={onClose}>
          Cancelar
        </Btn>
        <Btn disabled={save.isPending} onClick={submit}>
          Salvar automação
        </Btn>
      </footer>
    </Modal>
  );
}

function AutomationsPage() {
  const query = useAutomations();
  const setActive = useSetAutomationActive();
  const remove = useRemoveAutomation();
  const sweep = useSweepAutomations();
  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function guard(action: () => Promise<string | void>) {
    setError(null);
    setNotice(null);
    try {
      const message = await action();
      if (message) setNotice(message);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  const triggers = query.data?.triggers ?? [];
  const actionTypes = query.data?.actionTypes ?? [];
  const automations = query.data?.automations ?? [];
  const runs = query.data?.runs ?? [];

  return (
    <AdminLayout
      title="Automações"
      subtitle="Regras que agem sozinhas no CRM quando algo acontece."
      actions={
        <div className="flex gap-2">
          <Btn
            tone="outline"
            disabled={sweep.isPending}
            onClick={() =>
              guard(async () => {
                const result = await sweep.mutateAsync({});
                return `${result.fired} disparo(s) em ${result.checked} lead(s) verificado(s).`;
              })
            }
          >
            <RefreshCw className="h-3.5 w-3.5" /> Verificar regras de tempo
          </Btn>
          <Btn onClick={() => setForm({ ...emptyForm })}>
            <Plus className="h-3.5 w-3.5" /> Nova automação
          </Btn>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Automações" value={automations.length} />
        <Stat label="Ativas" value={automations.filter((item) => item.active).length} />
        <Stat label="Execuções (30 dias)" value={runs.length} />
        <Stat label="Falhas" value={runs.filter((run) => run.ok === 0).length} />
      </div>

      <ErrorNote message={error} />
      {notice && (
        <p className="mt-3 rounded-[3px] border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          {notice}
        </p>
      )}

      <div className="mt-6 space-y-3">
        {query.isLoading && <Empty>Carregando…</Empty>}
        {!query.isLoading && automations.length === 0 && (
          <Empty>Nenhuma automação criada. Comece com “primeiro contato em 2 horas”.</Empty>
        )}
        {automations.map((automation) => {
          const parsedActions = (() => {
            try {
              return JSON.parse(automation.actions) as ActionState[];
            } catch {
              return [];
            }
          })();
          const conditions = (() => {
            try {
              return JSON.parse(automation.conditions) as { source?: string; hours?: number };
            } catch {
              return {};
            }
          })();
          return (
            <Card key={automation.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Zap className="h-4 w-4 text-brass" />
                    <p className="text-sm font-medium text-deep">{automation.name}</p>
                    <Badge tone={automation.active ? "green" : "neutral"}>
                      {automation.active ? "Ativa" : "Pausada"}
                    </Badge>
                  </div>
                  <p className="mt-1 text-[11px] text-muted">
                    {triggers.find((item) => item.value === automation.trigger)?.label ??
                      automation.trigger}
                    {conditions.source ? ` · origem: ${conditions.source}` : ""}
                    {conditions.hours ? ` · ${conditions.hours}h` : ""}
                    {" · "}
                    {parsedActions.map((action) => action.type).join(", ")}
                  </p>
                  <p className="mt-1 text-[11px] text-muted">
                    {automation.runCount} execução(ões) · {automation.errorCount} falha(s)
                    {automation.lastRunAt ? ` · última em ${dateTimeLabel(automation.lastRunAt)}` : ""}
                  </p>
                  {automation.lastError && (
                    <p className="mt-1 text-[11px] text-red-700">{automation.lastError}</p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Btn
                    tone="outline"
                    onClick={() =>
                      setForm({
                        id: automation.id,
                        name: automation.name,
                        trigger: automation.trigger as Trigger,
                        source: conditions.source ?? "",
                        hours: conditions.hours ?? 24,
                        active: automation.active,
                        actions:
                          parsedActions.length > 0
                            ? parsedActions.map((action) => ({
                                type: action.type,
                                text: action.text ?? "",
                                stage: action.stage ?? "novo",
                                hours: action.hours ?? 2,
                              }))
                            : emptyForm.actions,
                      })
                    }
                  >
                    Editar
                  </Btn>
                  <Btn
                    tone={automation.active ? "outline" : "brass"}
                    onClick={() =>
                      guard(() =>
                        setActive.mutateAsync({ id: automation.id, active: !automation.active }),
                      )
                    }
                  >
                    {automation.active ? "Pausar" : "Ativar"}
                  </Btn>
                  <Btn
                    tone="danger"
                    onClick={() => {
                      if (!window.confirm(`Remover a automação ${automation.name}?`)) return;
                      void guard(() => remove.mutateAsync({ id: automation.id }));
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Btn>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <Card className="mt-6" title="Últimas execuções">
        {runs.length === 0 ? (
          <Empty>Nenhuma execução registrada.</Empty>
        ) : (
          <div className="max-h-80 space-y-2 overflow-y-auto">
            {runs.slice(0, 40).map((run) => (
              <div
                key={run.id}
                className="flex items-start justify-between gap-3 rounded-[3px] border border-line px-3 py-2"
              >
                <div>
                  <p className="text-xs text-ink">{run.message}</p>
                  <p className="text-[11px] text-muted">{dateTimeLabel(run.createdAt)}</p>
                </div>
                <Badge tone={run.ok === 1 ? "green" : "red"}>{run.ok === 1 ? "ok" : "falha"}</Badge>
              </div>
            ))}
          </div>
        )}
        <p className="mt-3 text-[11px] text-muted">
          Regras por tempo são verificadas quando você abre esta tela ou clica em “Verificar regras de
          tempo”. Não existe execução em segundo plano neste ambiente.
        </p>
      </Card>

      {form && (
        <AutomationForm
          state={form}
          onChange={setForm}
          onClose={() => setForm(null)}
          triggers={triggers}
          actionTypes={actionTypes}
        />
      )}
    </AdminLayout>
  );
}

export default function AdminAutomations() {
  return (
    <AdminGuard>
      <AutomationsPage />
    </AdminGuard>
  );
}

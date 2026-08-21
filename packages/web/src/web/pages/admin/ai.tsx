import { useState } from "react";
import { Bot, Pause, Play, Plus, Trash2 } from "lucide-react";
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
} from "../../components/admin/ui";
import { errorMessage } from "../../lib/admin-session";
import {
  useAgents,
  useAiDashboard,
  useRemoveAgent,
  useSaveAgent,
  useSetAgentActive,
  useTestAgent,
} from "../../queries/integrations";

const MODELS = [
  "openai/gpt-5.4-mini",
  "openai/gpt-5.4",
  "anthropic/claude-haiku-4.5",
  "anthropic/claude-sonnet-4.6",
  "google/gemini-3-flash",
];

const CHANNELS = [
  { value: "site", label: "Site" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Messenger" },
] as const;

type Channel = (typeof CHANNELS)[number]["value"];

interface FormState {
  id: number | null;
  name: string;
  model: string;
  active: boolean;
  greeting: string;
  instructions: string;
  tone: string;
  hoursStart: string;
  hoursEnd: string;
  channels: Channel[];
  qualification: string;
  transferRules: string;
  transferMessage: string;
  idleMinutes: number;
  humanConditions: string;
}

const empty: FormState = {
  id: null,
  name: "Atendimento Edy Premi",
  model: "openai/gpt-5.4-mini",
  active: false,
  greeting: "Olá! Sou o atendimento da Edy Premi Imóveis. Como posso ajudar?",
  instructions:
    "Ajude o cliente a encontrar imóveis do nosso cadastro em Praia Grande. Seja objetivo e elegante.",
  tone: "Sofisticado, direto e humano.",
  hoursStart: "08:00",
  hoursEnd: "20:00",
  channels: ["site"],
  qualification: "Perfil desejado, faixa de valor, prazo, forma de pagamento e bairro preferido.",
  transferRules:
    "Pedido de visita, negociação de valor, documentação, contrato ou qualquer dúvida jurídica.",
  transferMessage: "Vou chamar um corretor para continuar seu atendimento.",
  idleMinutes: 30,
  humanConditions: "Cliente insatisfeito, reclamação ou assunto fora de imóveis.",
};

function AgentForm({
  state,
  onChange,
  onClose,
  onSaved,
}: {
  state: FormState;
  onChange: (next: FormState) => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const save = useSaveAgent(state.id ? "update" : "create");
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    try {
      const payload = {
        name: state.name,
        active: state.active,
        model: state.model,
        greeting: state.greeting,
        instructions: state.instructions,
        tone: state.tone,
        hoursStart: state.hoursStart,
        hoursEnd: state.hoursEnd,
        channels: state.channels,
        qualification: state.qualification,
        transferRules: state.transferRules,
        transferMessage: state.transferMessage,
        idleMinutes: state.idleMinutes,
        humanConditions: state.humanConditions,
      };
      if (state.id) await save.mutateAsync({ ...payload, id: state.id });
      else await save.mutateAsync(payload);
      onSaved();
      onClose();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  return (
    <Modal open onClose={onClose} title={state.id ? "Editar agente" : "Novo agente de IA"} wide>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Nome do agente">
          <Input value={state.name} onChange={(e) => onChange({ ...state, name: e.target.value })} />
        </Field>
        <Field label="Modelo">
          <Select value={state.model} onChange={(e) => onChange({ ...state, model: e.target.value })}>
            {MODELS.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Canais onde o agente atende" className="md:col-span-2">
          <div className="flex flex-wrap gap-3">
            {CHANNELS.map((channel) => (
              <label key={channel.value} className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={state.channels.includes(channel.value)}
                  onChange={(event) =>
                    onChange({
                      ...state,
                      channels: event.target.checked
                        ? [...state.channels, channel.value]
                        : state.channels.filter((item) => item !== channel.value),
                    })
                  }
                />
                {channel.label}
              </label>
            ))}
          </div>
        </Field>
        <Field label="Mensagem de abertura" className="md:col-span-2">
          <Textarea
            value={state.greeting}
            onChange={(e) => onChange({ ...state, greeting: e.target.value })}
          />
        </Field>
        <Field label="Tom de voz">
          <Textarea value={state.tone} onChange={(e) => onChange({ ...state, tone: e.target.value })} />
        </Field>
        <Field label="Instruções do corretor">
          <Textarea
            value={state.instructions}
            onChange={(e) => onChange({ ...state, instructions: e.target.value })}
          />
        </Field>
        <Field label="O que qualificar">
          <Textarea
            value={state.qualification}
            onChange={(e) => onChange({ ...state, qualification: e.target.value })}
          />
        </Field>
        <Field label="Quando transferir para humano">
          <Textarea
            value={state.transferRules}
            onChange={(e) => onChange({ ...state, transferRules: e.target.value })}
          />
        </Field>
        <Field label="Nunca prosseguir sozinho quando">
          <Textarea
            value={state.humanConditions}
            onChange={(e) => onChange({ ...state, humanConditions: e.target.value })}
          />
        </Field>
        <Field label="Mensagem ao transferir">
          <Textarea
            value={state.transferMessage}
            onChange={(e) => onChange({ ...state, transferMessage: e.target.value })}
          />
        </Field>
        <Field label="Início do atendimento humano">
          <Input
            type="time"
            value={state.hoursStart}
            onChange={(e) => onChange({ ...state, hoursStart: e.target.value })}
          />
        </Field>
        <Field label="Fim do atendimento humano">
          <Input
            type="time"
            value={state.hoursEnd}
            onChange={(e) => onChange({ ...state, hoursEnd: e.target.value })}
          />
        </Field>
        <Field label="Minutos de silêncio antes de avisar o corretor">
          <Input
            type="number"
            min={1}
            max={1440}
            value={state.idleMinutes}
            onChange={(e) => onChange({ ...state, idleMinutes: Number(e.target.value) || 30 })}
          />
        </Field>
        <Field label="Ativo">
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={state.active}
              onChange={(e) => onChange({ ...state, active: e.target.checked })}
            />
            Responder automaticamente nos canais marcados
          </label>
        </Field>
      </div>

      <ErrorNote message={error} />
      <footer className="mt-5 flex justify-end gap-2 border-t border-line pt-4">
        <Btn tone="outline" onClick={onClose}>
          Cancelar
        </Btn>
        <Btn disabled={save.isPending} onClick={submit}>
          Salvar agente
        </Btn>
      </footer>
    </Modal>
  );
}

function Sandbox({ agentId }: { agentId: number }) {
  const test = useTestAgent();
  const [turns, setTurns] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [handoff, setHandoff] = useState<string | null>(null);

  async function submit() {
    const next = [...turns, { role: "user" as const, content: draft.trim() }];
    setTurns(next);
    setDraft("");
    setError(null);
    try {
      const result = await test.mutateAsync({ id: agentId, turns: next });
      setTurns([...next, { role: "assistant", content: result.text }]);
      setHandoff(result.handoff ? (result.handoffReason ?? "transferência solicitada") : null);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  return (
    <Card title="Teste isolado (não cria lead, não envia mensagem)">
      <div className="max-h-72 space-y-2 overflow-y-auto">
        {turns.length === 0 && <Empty>Faça uma pergunta como se fosse um cliente.</Empty>}
        {turns.map((turn, index) => (
          <div
            key={`${turn.role}-${index}`}
            className={
              turn.role === "user"
                ? "max-w-[85%] rounded-[4px] bg-bone/60 px-3 py-2 text-sm text-ink"
                : "ml-auto max-w-[85%] rounded-[4px] bg-deep px-3 py-2 text-sm text-white"
            }
          >
            <p className="whitespace-pre-wrap">{turn.content}</p>
          </div>
        ))}
      </div>
      {handoff && (
        <p className="mt-3 rounded-[3px] border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          A IA pediu atendimento humano: {handoff}
        </p>
      )}
      <ErrorNote message={error} />
      <div className="mt-3 flex gap-2">
        <Input
          placeholder="Ex: tem cobertura em Praia Grande até R$ 900 mil?"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <Btn disabled={test.isPending || draft.trim().length === 0} onClick={submit}>
          Enviar
        </Btn>
      </div>
    </Card>
  );
}

function AiPage() {
  const agents = useAgents();
  const dashboard = useAiDashboard();
  const setActive = useSetAgentActive();
  const remove = useRemoveAgent();
  const [form, setForm] = useState<FormState | null>(null);
  const [sandbox, setSandbox] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function guard(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  return (
    <AdminLayout
      title="Agente de IA"
      subtitle="Atendimento automático baseado só nos imóveis cadastrados, com transferência para humano."
      actions={
        <Btn onClick={() => setForm({ ...empty })}>
          <Plus className="h-3.5 w-3.5" /> Novo agente
        </Btn>
      }
    >
      {!agents.data?.gatewayReady && (
        <ErrorNote message="Provedor de IA não configurado neste ambiente. Os agentes ficam cadastrados, mas não respondem até o gateway estar disponível." />
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Agentes" value={dashboard.data?.agents.total ?? "—"} />
        <Stat label="Ativos" value={dashboard.data?.agents.ativos ?? "—"} />
        <Stat label="Conversas com IA" value={dashboard.data?.conversations.emIa ?? "—"} />
        <Stat
          label="Transferidas"
          value={`${dashboard.data?.conversations.taxaTransferencia ?? 0}%`}
          hint="para atendimento humano"
        />
      </div>

      <ErrorNote message={error} />

      <div className="mt-6 space-y-3">
        {agents.isLoading && <Empty>Carregando agentes…</Empty>}
        {!agents.isLoading && (agents.data?.agents.length ?? 0) === 0 && (
          <Empty>Nenhum agente cadastrado ainda.</Empty>
        )}
        {(agents.data?.agents ?? []).map((agent) => (
          <Card key={agent.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <Bot className="h-4 w-4 text-brass" />
                  <p className="text-sm font-medium text-deep">{agent.name}</p>
                  <Badge tone={agent.active ? "green" : "neutral"}>
                    {agent.active ? "Ativo" : "Pausado"}
                  </Badge>
                </div>
                <p className="mt-1 text-[11px] text-muted">
                  {agent.model} · canais: {agent.channels.join(", ") || "nenhum"} · atende{" "}
                  {agent.hoursStart}–{agent.hoursEnd}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Btn
                  tone="outline"
                  onClick={() => setSandbox(sandbox === agent.id ? null : agent.id)}
                >
                  Testar
                </Btn>
                <Btn
                  tone="outline"
                  onClick={() =>
                    setForm({
                      id: agent.id,
                      name: agent.name,
                      model: agent.model,
                      active: agent.active,
                      greeting: agent.greeting,
                      instructions: agent.instructions,
                      tone: agent.tone,
                      hoursStart: agent.hoursStart,
                      hoursEnd: agent.hoursEnd,
                      channels: agent.channels.filter((channel): channel is Channel =>
                        CHANNELS.some((item) => item.value === channel),
                      ),
                      qualification: agent.qualification,
                      transferRules: agent.transferRules,
                      transferMessage: agent.transferMessage,
                      idleMinutes: agent.idleMinutes,
                      humanConditions: agent.humanConditions,
                    })
                  }
                >
                  Editar
                </Btn>
                <Btn
                  tone={agent.active ? "outline" : "brass"}
                  onClick={() =>
                    guard(() => setActive.mutateAsync({ id: agent.id, active: !agent.active }))
                  }
                >
                  {agent.active ? (
                    <>
                      <Pause className="h-3.5 w-3.5" /> Pausar
                    </>
                  ) : (
                    <>
                      <Play className="h-3.5 w-3.5" /> Ativar
                    </>
                  )}
                </Btn>
                <Btn
                  tone="danger"
                  onClick={() => {
                    if (!window.confirm(`Remover o agente ${agent.name}?`)) return;
                    void guard(() => remove.mutateAsync({ id: agent.id }));
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Btn>
              </div>
            </div>
            {sandbox === agent.id && (
              <div className="mt-4">
                <Sandbox agentId={agent.id} />
              </div>
            )}
          </Card>
        ))}
      </div>

      <Card className="mt-6" title="Limites da IA">
        <ul className="space-y-2 text-xs leading-relaxed text-muted">
          <li>• Só cita imóveis existentes no cadastro — a busca consulta o banco a cada resposta.</li>
          <li>• Nunca fecha venda, não negocia valor e não trata contrato ou documentação.</li>
          <li>• Assim que um corretor assume a conversa, a IA para de responder.</li>
          <li>• Toda transferência fica registrada com o motivo.</li>
        </ul>
      </Card>

      {form && (
        <AgentForm
          state={form}
          onChange={setForm}
          onClose={() => setForm(null)}
          onSaved={() => void agents.refetch()}
        />
      )}
    </AdminLayout>
  );
}

export default function AdminAi() {
  return (
    <AdminGuard>
      <AiPage />
    </AdminGuard>
  );
}

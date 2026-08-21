import { useState } from "react";
import { Bot, RotateCcw, Send, User, X } from "lucide-react";
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
  Stat,
  Textarea,
  dateTimeLabel,
} from "../../components/admin/ui";
import { cn } from "../../lib/utils";
import { errorMessage } from "../../lib/admin-session";
import {
  useCloseConversation,
  useConversation,
  useConversations,
  useReopenConversation,
  useReturnToAi,
  useSendMessage,
  useSimulateConversation,
  useTakeOver,
} from "../../queries/integrations";

type ModeFilter = "" | "ia" | "humano";
type ChannelFilter = "" | "whatsapp" | "instagram" | "facebook" | "site" | "teste";

const channelLabel: Record<string, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  facebook: "Messenger",
  site: "Site",
  teste: "Teste interno",
};

function ConversationsPage() {
  const [filter, setFilter] = useState<"aberta" | "fechada">("aberta");
  const [mode, setMode] = useState<ModeFilter>("");
  const [channel, setChannel] = useState<ChannelFilter>("");
  const [selected, setSelected] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [simulation, setSimulation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const list = useConversations({
    status: filter,
    ...(mode ? { mode } : {}),
    ...(channel ? { channel } : {}),
  });
  const detail = useConversation(selected);
  const takeOver = useTakeOver();
  const returnToAi = useReturnToAi();
  const send = useSendMessage();
  const close = useCloseConversation();
  const reopen = useReopenConversation();
  const simulate = useSimulateConversation();

  const conversation = detail.data?.conversation;

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

  return (
    <AdminLayout
      title="Conversas"
      subtitle="Atendimento por canal. Quando um humano assume, a IA para de responder na hora."
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Conversas" value={list.data?.counts.total ?? "—"} />
        <Stat label="Com a IA" value={list.data?.counts.ia ?? "—"} />
        <Stat label="Com humano" value={list.data?.counts.humano ?? "—"} />
        <Stat label="Não lidas" value={list.data?.counts.naoLidas ?? "—"} />
      </div>

      <ErrorNote message={error} />
      {notice && (
        <p className="mt-3 rounded-[3px] border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          {notice}
        </p>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-[340px_1fr]">
        <Card
          title="Caixa de entrada"
          action={
            <div className="flex gap-1">
              <Btn
                tone={filter === "aberta" ? "primary" : "ghost"}
                className="px-2.5 py-1.5"
                onClick={() => setFilter("aberta")}
              >
                Abertas
              </Btn>
              <Btn
                tone={filter === "fechada" ? "primary" : "ghost"}
                className="px-2.5 py-1.5"
                onClick={() => setFilter("fechada")}
              >
                Fechadas
              </Btn>
            </div>
          }
        >
          <div className="mb-3 grid gap-2 sm:grid-cols-2">
            <Select value={mode} onChange={(event) => setMode(event.target.value as ModeFilter)}>
              <option value="">Todos os atendimentos</option>
              <option value="ia">Com a IA</option>
              <option value="humano">Com humano</option>
            </Select>
            <Select
              value={channel}
              onChange={(event) => setChannel(event.target.value as ChannelFilter)}
            >
              <option value="">Todos os canais</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="instagram">Instagram</option>
              <option value="facebook">Messenger</option>
              <option value="site">Site</option>
              <option value="teste">Teste interno</option>
            </Select>
          </div>

          {list.isLoading && <Empty>Carregando…</Empty>}
          {!list.isLoading && (list.data?.conversations.length ?? 0) === 0 && (
            <Empty>Nenhuma conversa {filter === "aberta" ? "aberta" : "fechada"}.</Empty>
          )}
          <div className="max-h-[520px] space-y-2 overflow-y-auto">
            {(list.data?.conversations ?? []).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelected(item.id)}
                className={cn(
                  "w-full rounded-[3px] border px-3 py-2.5 text-left transition-colors",
                  selected === item.id
                    ? "border-brass bg-brass/5"
                    : "border-line hover:border-brass/60",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm text-deep">
                    {item.contactName || item.contactPhone || `Conversa #${item.id}`}
                  </p>
                  <Badge tone={item.mode === "ia" ? "brass" : "green"}>
                    {item.mode === "ia" ? "IA" : "Humano"}
                  </Badge>
                </div>
                <p className="mt-1 truncate text-[11px] text-muted">
                  {channelLabel[item.channel] ?? item.channel} · {dateTimeLabel(item.lastMessageAt)}
                </p>
                {item.lastMessage && (
                  <p className="mt-1 line-clamp-2 text-xs text-muted">{item.lastMessage}</p>
                )}
                {item.unread > 0 && <Badge tone="red">{item.unread} nova(s)</Badge>}
              </button>
            ))}
          </div>
        </Card>

        <div className="space-y-4">
          {!conversation && <Empty>Selecione uma conversa para ver o histórico.</Empty>}

          {conversation && (
            <Card
              title={`${channelLabel[conversation.channel] ?? conversation.channel} · ${
                conversation.contactName || conversation.contactPhone || `#${conversation.id}`
              }`}
              action={
                <div className="flex flex-wrap gap-2">
                  {conversation.mode === "ia" ? (
                    <Btn
                      tone="brass"
                      disabled={takeOver.isPending}
                      onClick={() =>
                        guard(async () => {
                          await takeOver.mutateAsync({ id: conversation.id });
                          return "Você assumiu a conversa. A IA não responde mais aqui.";
                        })
                      }
                    >
                      <User className="h-3.5 w-3.5" /> Assumir
                    </Btn>
                  ) : (
                    <Btn
                      tone="outline"
                      disabled={returnToAi.isPending}
                      onClick={() =>
                        guard(async () => {
                          await returnToAi.mutateAsync({ id: conversation.id });
                          return "Atendimento devolvido para a IA.";
                        })
                      }
                    >
                      <Bot className="h-3.5 w-3.5" /> Devolver à IA
                    </Btn>
                  )}
                  {conversation.status === "fechada" ? (
                    <Btn
                      tone="outline"
                      disabled={reopen.isPending}
                      onClick={() =>
                        guard(async () => {
                          await reopen.mutateAsync({ id: conversation.id });
                          setFilter("aberta");
                          return "Conversa reaberta.";
                        })
                      }
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> Reabrir
                    </Btn>
                  ) : (
                    <Btn
                      tone="ghost"
                      disabled={close.isPending}
                      onClick={() =>
                        guard(async () => {
                          await close.mutateAsync({ id: conversation.id });
                          return "Conversa fechada.";
                        })
                      }
                    >
                      <X className="h-3.5 w-3.5" /> Fechar
                    </Btn>
                  )}
                </div>
              }
            >
              {conversation.transferReason && (
                <p className="mb-3 rounded-[3px] border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  Transferido: {conversation.transferReason}
                </p>
              )}

              <div className="max-h-[380px] space-y-2 overflow-y-auto pr-1">
                {(detail.data?.messages ?? []).map((message) => (
                  <div
                    key={message.id}
                    className={cn(
                      "max-w-[80%] rounded-[4px] px-3 py-2 text-sm",
                      message.author === "cliente"
                        ? "bg-bone/60 text-ink"
                        : message.author === "sistema"
                          ? "mx-auto bg-transparent text-center text-[11px] text-muted"
                          : "ml-auto bg-deep text-white",
                    )}
                  >
                    {message.author !== "sistema" && (
                      <p className="label-xs opacity-70">
                        {message.author === "cliente"
                          ? "Cliente"
                          : message.author === "ia"
                            ? `IA${message.authorName ? ` · ${message.authorName}` : ""}`
                            : `Corretor${message.authorName ? ` · ${message.authorName}` : ""}`}
                      </p>
                    )}
                    <p className="whitespace-pre-wrap">{message.body}</p>
                    {message.author !== "sistema" && (
                      <p className="mt-1 text-[10px] opacity-60">{dateTimeLabel(message.createdAt)}</p>
                    )}
                  </div>
                ))}
              </div>

              <div className="mt-4 space-y-2">
                <Textarea
                  placeholder="Escrever como corretor (assume a conversa automaticamente)"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                />
                <Btn
                  disabled={send.isPending || draft.trim().length === 0}
                  onClick={() =>
                    guard(async () => {
                      const result = await send.mutateAsync({
                        id: conversation.id,
                        body: draft.trim(),
                      });
                      setDraft("");
                      return result.delivery.detail;
                    })
                  }
                >
                  <Send className="h-3.5 w-3.5" /> Enviar
                </Btn>
              </div>
            </Card>
          )}

          <Card title="Testar o fluxo da IA (canal interno)">
            <p className="mb-3 text-xs text-muted">
              Cria uma conversa no canal “Teste interno”, com o agente ativo respondendo sobre os
              imóveis reais. Nada é enviado para clientes.
            </p>
            <div className="flex flex-wrap gap-2">
              <Input
                className="max-w-md"
                placeholder="Ex: procuro apartamento 2 dormitórios em Praia Grande"
                value={simulation}
                onChange={(event) => setSimulation(event.target.value)}
              />
              <Btn
                tone="outline"
                disabled={simulate.isPending || simulation.trim().length === 0}
                onClick={() =>
                  guard(async () => {
                    const result = await simulate.mutateAsync({ body: simulation.trim() });
                    setSelected(result.conversationId);
                    setSimulation("");
                    return result.replied
                      ? `IA respondeu${result.handoff ? " e pediu atendimento humano" : ""}.`
                      : `IA não respondeu: ${result.skipped}`;
                  })
                }
              >
                Enviar mensagem de teste
              </Btn>
            </div>
          </Card>
        </div>
      </div>
    </AdminLayout>
  );
}

export default function AdminConversations() {
  return (
    <AdminGuard>
      <ConversationsPage />
    </AdminGuard>
  );
}

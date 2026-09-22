import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { Loader2, MessageSquare, Minus, Send, UserRound, X } from "lucide-react";
import { site, whatsappLink } from "../../lib/site";
import {
  useChatHistory,
  useChatIdentify,
  useChatRequestHuman,
  useChatSend,
  useChatStart,
} from "../../queries/site-chat";

/**
 * Chat público do site. Fala com o mesmo agente de IA do painel e, quando o
 * visitante pede uma pessoa, a conversa vira atendimento humano em
 * /admin/conversas — o atendimento continua aqui dentro, sem sair do site.
 */

const TOKEN_KEY = "edy-chat-token";

type ChatMessage = { id: number; author: string; body: string };
type ChatCard = { code: string; title: string; price: number; district: string; image: string; slug: string };
type ChatState = {
  token: string;
  mode: "ia" | "humano";
  status: "aberta" | "fechada";
  identified: boolean;
  askName: boolean;
  askPhone: boolean;
};

/**
 * A IA responde em markdown leve. Aqui não interpretamos HTML: só limpamos a
 * marcação para o texto ficar legível na bolha (links viram o próprio rótulo).
 */
function plainText(body: string) {
  return body
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^\s*[-*]{3,}\s*$/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const phoneDigits = (value: string) => value.replace(/\D/g, "");

/* Imóvel sem preço cadastrado (price = 0) não pode aparecer como "R$ 0". */
const brl = (value: number) =>
  value > 0
    ? value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })
    : "Sob consulta";

function readToken() {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function saveToken(token: string) {
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* navegador sem storage: a conversa vale só para esta aba */
  }
}

export function ChatWidget({ propertySlug }: { propertySlug?: string }) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [cards, setCards] = useState<ChatCard[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [state, setState] = useState<ChatState | null>(null);
  const [identity, setIdentity] = useState({ name: "", phone: "" });
  /* Resultado do último envio do formulário de contato. Sem isso o visitante
     não sabia se o WhatsApp foi aceito: o formulário simplesmente desaparecia. */
  const [identityFeedback, setIdentityFeedback] = useState<string | null>(null);
  const [identityError, setIdentityError] = useState<string | null>(null);
  /* Confirmado pelo servidor: o polling do histórico não pode ressuscitar o
     formulário depois que o contato já foi salvo. */
  const [identityDone, setIdentityDone] = useState(false);
  const scroller = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setToken(readToken());
  }, []);

  const start = useChatStart(
    { token: token ?? undefined, propertySlug },
    open,
  );
  const history = useChatHistory(state?.token ?? token, open && Boolean(state?.token ?? token));
  const send = useChatSend();
  const identify = useChatIdentify();
  const requestHuman = useChatRequestHuman();

  /* Token e histórico vindos do servidor ao abrir. */
  useEffect(() => {
    const data = start.data;
    if (!data) return;
    setState(data.state as ChatState);
    if (data.state.token) {
      setToken(data.state.token);
      saveToken(data.state.token);
    }
    setMessages(data.messages as ChatMessage[]);
    setNotice(data.notice ?? null);
  }, [start.data]);

  /* Polling: é assim que a resposta do corretor humano chega. */
  useEffect(() => {
    const data = history.data;
    if (!data?.state) return;
    setState(data.state as ChatState);
    if (data.messages.length >= messages.length) setMessages(data.messages as ChatMessage[]);
  }, [history.data]);

  useEffect(() => {
    if (!open) return;
    const node = scroller.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, open, send.isPending]);

  const greeting = start.data?.greeting ?? "";
  const unavailable = start.data ? !start.data.available : false;

  const visible = useMemo(
    () => messages.filter((message) => message.author !== "sistema"),
    [messages],
  );

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if (!body || send.isPending || !state?.token) return;
    setDraft("");
    setMessages((current) => [...current, { id: -Date.now(), author: "cliente", body }]);
    send.mutate(
      { token: state.token, body, propertySlug },
      {
        onSuccess: (data) => {
          setState(data.state as ChatState);
          if (data.messages.length > 0) setMessages(data.messages as ChatMessage[]);
          setCards(data.properties as ChatCard[]);
          setNotice(data.notice ?? null);
        },
        onError: () => setNotice("Falha ao enviar. Tente novamente."),
      },
    );
  }

  function submitIdentity(event: React.FormEvent) {
    event.preventDefault();
    if (!state?.token || identify.isPending) return;
    const name = identity.name.trim();
    const phone = identity.phone.trim();
    if (!name && !phone) return;

    /* Valida antes de enviar: DDD + 8 ou 9 dígitos. */
    if (state.askPhone && phoneDigits(phone).length < 10) {
      setIdentityError("Digite o número com DDD, ex: (13) 99999-9999.");
      setIdentityFeedback(null);
      return;
    }
    setIdentityError(null);

    identify.mutate(
      { token: state.token, name: name || undefined, phone: phone || undefined },
      {
        onSuccess: (data) => {
          if (data.state) setState(data.state as ChatState);
          if (!data.ok || !data.saved) {
            setIdentityError(
              data.reason === "telefone_invalido"
                ? "Não reconheci esse número. Confira o DDD e os dígitos."
                : data.reason === "nome_invalido"
                  ? "Digite seu nome (só letras), por exemplo: Maria Silva."
                  : "Não consegui salvar agora. Tente novamente.",
            );
            return;
          }
          /* Só limpa o campo quando o dado foi realmente aceito. */
          setIdentity({ name: "", phone: "" });
          setIdentityError(null);
          if (phone) {
            setIdentityDone(true);
            setIdentityFeedback(
              data.crm
                ? "WhatsApp registrado. Um corretor da Edy Prime Imóveis vai te chamar por ele."
                : "Anotei seu WhatsApp na conversa. Um corretor já consegue ver e responder aqui.",
            );
          } else {
            setIdentityFeedback("Obrigado! Anotei seu nome.");
          }
        },
        onError: () => {
          setIdentityError("Falha de conexão ao enviar. Tente novamente.");
        },
      },
    );
  }

  function callHuman() {
    if (!state?.token || requestHuman.isPending) return;
    requestHuman.mutate(
      { token: state.token },
      {
        onSuccess: (data) => {
          if (data.state) setState(data.state as ChatState);
          setNotice("Pronto — um corretor foi avisado e responde aqui mesmo.");
        },
      },
    );
  }

  const askIdentity = Boolean(state && (state.askName || state.askPhone)) && !identityDone;

  return (
    <>
      {/* FAB — empilhado acima do botão do WhatsApp */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Abrir chat com a Edy Prime"
          className="fixed right-5 bottom-24 z-50 flex items-center gap-3 border border-brass/40 bg-deep px-5 py-4 text-white shadow-lg transition-colors hover:bg-brass"
          style={{ marginBottom: "env(safe-area-inset-bottom)" }}
        >
          <MessageSquare className="h-5 w-5" />
          <span className="label-xs hidden sm:inline">Fale com agente IA</span>
        </button>
      )}

      {open && (
        <div
          className="fixed inset-x-3 bottom-3 z-[60] flex max-h-[82vh] flex-col border border-line bg-paper shadow-2xl sm:inset-x-auto sm:right-5 sm:bottom-5 sm:w-[380px]"
          style={{ marginBottom: "env(safe-area-inset-bottom)" }}
          role="dialog"
          aria-label="Chat Edy Prime Imóveis"
        >
          <header className="flex items-center justify-between gap-3 bg-deep px-5 py-4 text-white">
            <div>
              <p className="label-xs text-brass-soft">{site.brand} · atendimento</p>
              <p className="display text-lg leading-tight">
                {state?.mode === "humano" ? "Corretor no atendimento" : "Assistente virtual"}
              </p>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Minimizar chat"
                className="p-2 text-white/70 transition-colors hover:text-white"
              >
                <Minus className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Fechar chat"
                className="p-2 text-white/70 transition-colors hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </header>

          <div ref={scroller} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {start.isLoading && (
              <p className="flex items-center gap-2 border border-line bg-white px-4 py-3 text-sm text-ink">
                <Loader2 className="h-4 w-4 animate-spin" /> Abrindo atendimento…
              </p>
            )}

            {!start.isLoading && greeting && visible.length === 0 && (
              <p className="border border-line bg-white px-4 py-3 text-sm leading-relaxed text-ink">
                {greeting}
              </p>
            )}

            {visible.map((message) => (
              <div
                key={message.id}
                className={
                  message.author === "cliente"
                    ? "ml-auto max-w-[85%] bg-deep px-4 py-3 text-sm leading-relaxed text-white"
                    : "mr-auto max-w-[85%] border border-line bg-white px-4 py-3 text-sm leading-relaxed whitespace-pre-line text-ink"
                }
              >
                {message.author === "humano" && (
                  <span className="label-xs mb-1 block text-brass">Corretor</span>
                )}
                {message.author === "cliente" ? message.body : plainText(message.body)}
              </div>
            ))}

            {send.isPending && (
              <p className="mr-auto flex items-center gap-2 border border-line bg-white px-4 py-3 text-sm text-ink">
                <Loader2 className="h-4 w-4 animate-spin" /> escrevendo…
              </p>
            )}

            {cards.length > 0 && (
              <div className="space-y-2 pt-1">
                {cards.map((card) => (
                  <Link
                    key={card.code}
                    to={`/imovel/${card.slug}`}
                    className="flex items-center gap-3 border border-line bg-white p-2 transition-colors hover:border-brass"
                  >
                    <img src={card.image} alt="" className="h-16 w-20 flex-none object-cover" />
                    <span className="min-w-0">
                      <span className="label-xs block text-muted">
                        {card.district} · {card.code}
                      </span>
                      <span className="block truncate text-sm text-deep">{card.title}</span>
                      <span className="display block text-base text-deep">{brl(card.price)}</span>
                    </span>
                  </Link>
                ))}
              </div>
            )}

            {notice && (
              <p className="border border-brass/40 bg-white px-4 py-3 text-sm text-ink">
                {notice}
                {unavailable && (
                  <>
                    {" "}
                    <a
                      href={whatsappLink("Olá! Vim pelo site e quero falar com um corretor.")}
                      target="_blank"
                      rel="noreferrer"
                      className="underline"
                    >
                      Abrir WhatsApp
                    </a>
                  </>
                )}
              </p>
            )}

            {identityFeedback && (
              <p className="border border-brass/40 bg-white px-4 py-3 text-sm text-ink" role="status">
                {identityFeedback}
              </p>
            )}

            {askIdentity && (
              <form
                onSubmit={submitIdentity}
                className="space-y-2 border border-line bg-white px-4 py-3"
              >
                <p className="text-sm text-ink">
                  {state?.askName
                    ? "Como posso te chamar?"
                    : "Qual seu WhatsApp? Assim o corretor te envia as opções."}
                </p>
                {state?.askName ? (
                  <input
                    value={identity.name}
                    onChange={(event) => setIdentity({ ...identity, name: event.target.value })}
                    placeholder="Seu nome"
                    maxLength={120}
                    className="w-full border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-brass"
                  />
                ) : (
                  <input
                    value={identity.phone}
                    onChange={(event) => setIdentity({ ...identity, phone: event.target.value })}
                    placeholder="(13) 99999-9999"
                    inputMode="tel"
                    maxLength={30}
                    className="w-full border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-brass"
                  />
                )}
                <button
                  type="submit"
                  disabled={identify.isPending}
                  className="flex w-full items-center justify-center gap-2 bg-deep px-4 py-2 text-sm text-white transition-colors hover:bg-brass disabled:opacity-60"
                >
                  {identify.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Enviar
                </button>
                {identityError && (
                  <p className="text-sm text-[#b3261e]" role="alert">
                    {identityError}
                  </p>
                )}
              </form>
            )}
          </div>

          <div className="border-t border-line px-4 py-3">
            {state?.mode !== "humano" && (
              <button
                type="button"
                onClick={callHuman}
                disabled={requestHuman.isPending || !state?.token}
                className="mb-3 flex w-full items-center justify-center gap-2 border border-line px-4 py-2 text-sm text-deep transition-colors hover:border-brass disabled:opacity-60"
              >
                {requestHuman.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <UserRound className="h-4 w-4" />
                )}
                Falar com um corretor
              </button>
            )}

            <form onSubmit={submit} className="flex items-end gap-2">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) submit(event);
                }}
                rows={1}
                maxLength={800}
                placeholder="Escreva sua mensagem…"
                className="max-h-24 min-h-[42px] flex-1 resize-none border border-line bg-white px-3 py-2 text-sm outline-none focus:border-brass"
              />
              <button
                type="submit"
                disabled={send.isPending || !draft.trim()}
                aria-label="Enviar mensagem"
                className="flex h-[42px] w-[42px] flex-none items-center justify-center bg-deep text-white transition-colors hover:bg-brass disabled:opacity-60"
              >
                {send.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </button>
            </form>
            <p className="mt-2 text-[11px] leading-snug text-muted">
              Atendimento virtual da {site.brand}. Não pedimos senha, CPF completo ou dados de
              pagamento.
            </p>
          </div>
        </div>
      )}
    </>
  );
}

export default ChatWidget;

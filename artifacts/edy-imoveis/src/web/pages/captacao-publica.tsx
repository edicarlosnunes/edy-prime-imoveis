import { useEffect, useState } from "react";
import { Camera, Check, Loader2, Send } from "lucide-react";
import { useRoute } from "wouter";
import { useOwnerLinkFacade, useOwnerLinkState, useOwnerLinkTurn } from "../queries/owner-links";

type Profile = "PROPRIETARIO" | "LOCADOR" | "CORRETOR";

export default function CaptacaoPublica() {
  const [, params] = useRoute("/captacao/:token");
  const token = params?.token ?? null;
  const state = useOwnerLinkState(token);
  const turn = useOwnerLinkTurn();
  const facade = useOwnerLinkFacade();
  const [text, setText] = useState("");
  const [profile, setProfile] = useState<Profile | undefined>();
  const [photo, setPhoto] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  useEffect(() => {
    if (state.data?.profile) setProfile(state.data.profile as Profile);
  }, [state.data?.profile]);

  if (!token || state.isError) return <Unavailable />;
  if (state.isLoading || !state.data) return <div className="min-h-screen bg-[#07101f] flex items-center justify-center text-white"><Loader2 className="animate-spin" /></div>;

  const data = state.data;
  const done = data.completed;

  async function send(value = text, selectedProfile = profile) {
    const message = value.trim();
    if (!message || turn.isPending) return;
    setText("");
    await turn.mutateAsync({ token, text: message, profile: selectedProfile });
  }

  function selectPhoto(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { setFileError("A foto deve ter no máximo 2 MB."); return; }
    setFileError(null);
    const reader = new FileReader();
    reader.onload = () => {
      const image = String(reader.result);
      setPhoto(image);
      void facade.mutateAsync({ token, facadeImage: image });
    };
    reader.readAsDataURL(file);
  }

  return (
    <main className="min-h-screen bg-[#07101f] px-4 py-8 text-slate-100">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-xl flex-col">
        <header className="mb-6 border-b border-white/10 pb-5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[#d8ad5c]">Edy Prime Imóveis</p>
          <h1 className="mt-2 text-2xl font-semibold">Cadastro de imóvel</h1>
          <p className="mt-1 text-sm text-slate-400">Uma pergunta por vez. Você pode responder com suas próprias palavras.</p>
          <div className="mt-4 h-1 rounded-full bg-white/10"><div className="h-full rounded-full bg-[#d8ad5c] transition-all" style={{ width: `${data.progress ?? (done ? 100 : 0)}%` }} /></div>
        </header>

        <section className="flex-1 space-y-3">
          {(data.draft?.transcript ?? []).map((item, index) => <div key={`${item.role}-${index}`} className={item.role === "user" ? "ml-auto max-w-[88%] rounded-2xl rounded-br-sm bg-[#b58b42] px-4 py-3 text-sm text-white" : "max-w-[94%] rounded-2xl rounded-bl-sm border border-white/10 bg-white/5 px-4 py-4 text-sm leading-relaxed text-slate-200 whitespace-pre-line"}>{item.text}</div>)}
          {(!data.draft?.transcript?.length || data.draft.transcript.at(-1)?.role === "user") && <div className="max-w-[94%] rounded-2xl rounded-bl-sm border border-white/10 bg-white/5 px-4 py-4 text-sm leading-relaxed text-slate-200 whitespace-pre-line">{done ? "Cadastro concluído. A equipe da Edy Prime fará a revisão antes de qualquer publicação." : data.question}</div>}
          {data.review && data.question.toLowerCase().includes("revise") && <div className="rounded-xl border border-[#d8ad5c]/30 bg-[#d8ad5c]/10 p-3 text-xs leading-5 text-[#e9c978]"><strong>{data.review.broker ? "CORRETOR" : "PERFIL"}:</strong> {data.review.profile ?? "—"}<br />{data.review.broker && <><strong>CORRETOR:</strong> {data.review.broker.name ?? "—"}<br /></>}<strong>PROPRIETÁRIO:</strong> {data.review.owner ?? "—"}<br /><strong>IMÓVEL:</strong> {data.review.propertyType ?? "—"} · {data.review.location ?? "—"}<br /><strong>FINALIDADE:</strong> {data.review.purpose ?? "—"} · <strong>VALOR:</strong> {data.review.value ?? "NÃO SEI"}<br /><strong>CARACTERÍSTICAS:</strong> {data.review.characteristics ?? "—"}<br /><strong>DOCUMENTAÇÃO:</strong> {data.review.documentation ?? "—"}{data.review.occupancy && <><br /><strong>OCUPAÇÃO:</strong> {data.review.occupancy}</>}</div>}
          {photo && <img src={photo} alt="Fachada provisória" className="max-h-48 w-full rounded-xl object-cover opacity-80" />}
        </section>

        {!done && (
          <footer className="mt-6">
            {!data.profile && (
              <div className="mb-3 grid grid-cols-3 gap-2">
                {(["PROPRIETARIO", "LOCADOR", "CORRETOR"] as Profile[]).map((item) => (
                  <button key={item} type="button" onClick={() => { setProfile(item); void send(item === "PROPRIETARIO" ? "Proprietário" : item === "LOCADOR" ? "Locador" : "Corretor", item); }} className="rounded-xl border border-white/10 bg-white/5 px-2 py-3 text-xs text-slate-200 hover:border-[#d8ad5c]">{item}</button>
                ))}
              </div>
            )}
            {data.question.toLowerCase().includes("revise") && <div className="mb-3 flex gap-2"><button type="button" onClick={() => void send("CONFIRMAR")} className="flex-1 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-medium text-white">Confirmar</button><button type="button" onClick={() => void send("CORRIGIR")} className="flex-1 rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm font-medium text-white">Corrigir</button></div>}
            <div className="flex items-end gap-2">
              {data.question.toLowerCase().includes("foto") && <label className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-white/10 bg-white/5 text-[#d8ad5c]">
                <Camera className="h-4 w-4" /><input type="file" accept="image/jpeg,image/png,image/webp,image/avif" className="hidden" onChange={selectPhoto} />
              </label>}
              <textarea value={text} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder="Digite sua resposta..." rows={2} className="min-h-11 flex-1 resize-none rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-white outline-none focus:border-[#d8ad5c]" />
              <button type="button" onClick={() => void send()} disabled={turn.isPending || !text.trim()} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#b58b42] text-white disabled:opacity-50">{turn.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}</button>
            </div>
            {turn.isError && <p className="mt-2 text-center text-xs text-red-300">Não foi possível salvar sua resposta. Tente novamente.</p>}
            {facade.isError && <p className="mt-2 text-center text-xs text-red-300">A foto deve ser JPG, PNG, WEBP ou AVIF e ter até 2 MB.</p>}
            {facade.isPending && <p className="mt-2 text-center text-xs text-slate-400">Enviando foto provisória…</p>}
            {facade.isSuccess && <p className="mt-2 text-center text-xs text-emerald-300">Foto provisória recebida.</p>}
            {fileError && <p className="mt-2 text-center text-xs text-red-300">{fileError}</p>}
            <p className="mt-2 text-center text-[11px] text-slate-500">Você pode dizer “não sei” ou “corrigir”. Não inventamos dados.</p>
          </footer>
        )}
        {done && <div className="mt-6 flex items-center justify-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-3 text-sm text-emerald-300"><Check className="h-4 w-4" /> Recebido para revisão humana</div>}
      </div>
    </main>
  );
}

function Unavailable() {
  return <main className="flex min-h-screen items-center justify-center bg-[#07101f] p-6 text-center text-slate-300"><div><h1 className="text-xl font-semibold text-white">Link indisponível</h1><p className="mt-2 text-sm">Verifique o link ou solicite uma nova captação.</p></div></main>;
}
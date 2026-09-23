import { useEffect, useState } from "react";
import { Camera, Check, Loader2, Send, XCircle } from "lucide-react";
import { useRoute } from "wouter";
import { useCancelPublicOwnerLink, useOwnerLinkFacade, useOwnerLinkState, useOwnerLinkTurn } from "../queries/owner-links";

type Profile = "PROPRIETARIO" | "LOCADOR" | "CORRETOR";

export default function CaptacaoPublica() {
  const [, tokenParams] = useRoute("/captacao/:token");
  const [, codeParams] = useRoute("/c/:code");
  const token = tokenParams?.token ?? codeParams?.code ?? null;
  const state = useOwnerLinkState(token);
  const turn = useOwnerLinkTurn();
  const facade = useOwnerLinkFacade();
  const cancel = useCancelPublicOwnerLink();
  const [text, setText] = useState("");
  const [profile, setProfile] = useState<Profile | undefined>();
  const [photo, setPhoto] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [photoResult, setPhotoResult] = useState<{ message: string } | null>(null);

  useEffect(() => {
    if (state.data?.profile) setProfile(state.data.profile as Profile);
  }, [state.data?.profile]);

  if (!token || state.isError) return <Unavailable />;
  if (state.isLoading || !state.data) return <div className="min-h-screen bg-[#07101f] flex items-center justify-center text-white"><Loader2 className="animate-spin" /></div>;

  const data = state.data;
  const cancelled = data.status === "cancelado";
  const done = data.completed || cancelled || Boolean(photoResult);
  const terminalMessage = photoResult?.message ?? (data.completed ? data.question : null);

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
      void facade.mutateAsync({ token, facadeImage: image }).then((result) => {
        setPhotoResult({ message: result.message });
      }).catch(() => undefined);
    };
    reader.readAsDataURL(file);
  }

  return (
    <main className="min-h-screen bg-[#07101f] px-4 py-8 text-slate-100">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-xl flex-col">
         <header className="mb-6 border-b border-white/10 pb-5">
           <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[#d8ad5c]">EDY PRIME</p>
          <h1 className="mt-2 text-2xl font-semibold">Cadastro de imóvel</h1>
           <div className="mt-4 h-1 rounded-full bg-white/10"><div className="h-full rounded-full bg-[#d8ad5c] transition-all" style={{ width: `${data.progress ?? (done ? 100 : 0)}%` }} /></div>
           {data.capture?.serial && <p className="mt-3 text-xs text-slate-400">EPI: <strong className="text-slate-200">{data.capture.serial}</strong></p>}
        </header>

        <section className="flex-1 space-y-3">
           <div className="max-w-[94%] rounded-2xl rounded-bl-sm border border-white/10 bg-white/5 px-4 py-4 text-sm leading-relaxed text-slate-200">Vamos cadastrar seu imóvel?</div>
           {(data.draft?.transcript ?? []).map((item, index) => <div key={`${item.role}-${index}`} className={item.role === "user" ? "ml-auto max-w-[88%] rounded-2xl rounded-br-sm bg-[#b58b42] px-4 py-3 text-sm text-white" : "max-w-[94%] rounded-2xl rounded-bl-sm border border-white/10 bg-white/5 px-4 py-4 text-sm leading-relaxed text-slate-200 whitespace-pre-line"}>{item.text}</div>)}
           {(photoResult || !data.draft?.transcript?.length || data.draft.transcript.at(-1)?.role === "user") && <div className="max-w-[94%] rounded-2xl rounded-bl-sm border border-white/10 bg-white/5 px-4 py-4 text-sm leading-relaxed text-slate-200 whitespace-pre-line">{terminalMessage ?? data.question}</div>}
          {photo && <img src={photo} alt="Fachada provisória" className="max-h-48 w-full rounded-xl object-cover opacity-80" />}
        </section>

         {!done && (
          <footer className="mt-6">
             {!data.profile && (
               <div className="mb-3 grid grid-cols-3 gap-2">
                {(["PROPRIETARIO", "LOCADOR", "CORRETOR"] as Profile[]).map((item) => (
                   <button key={item} type="button" onClick={() => { setProfile(item); void send(item === "PROPRIETARIO" ? "Proprietário" : item === "LOCADOR" ? "Locador" : "Corretor", item); }} className="rounded-xl border border-white/10 bg-white/5 px-2 py-3 text-xs text-slate-200 hover:border-[#d8ad5c]">{item === "PROPRIETARIO" ? "Proprietário" : item === "LOCADOR" ? "Locador" : "Corretor"}</button>
                ))}
              </div>
            )}
             <QuickOptions question={data.question} onSelect={(value) => void send(value)} />
             {data.question.toLowerCase().includes("foto") ? <label className="flex min-h-14 w-full cursor-pointer items-center justify-center gap-3 rounded-xl bg-[#b58b42] px-4 py-4 text-sm font-semibold text-white">
               <Camera className="h-5 w-5" /> Enviar foto da fachada
               <input type="file" accept="image/jpeg,image/png,image/webp,image/avif" className="hidden" onChange={selectPhoto} />
             </label> : <div className="flex items-end gap-2">
               <textarea value={text} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder="Digite sua resposta..." rows={2} className="min-h-11 flex-1 resize-none rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-white outline-none focus:border-[#d8ad5c]" />
               <button type="button" onClick={() => void send()} disabled={turn.isPending || !text.trim()} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#b58b42] text-white disabled:opacity-50">{turn.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}</button>
             </div>}
            {turn.isError && <p className="mt-2 text-center text-xs text-red-300">Não foi possível salvar sua resposta. Tente novamente.</p>}
            {facade.isError && <p className="mt-2 text-center text-xs text-red-300">A foto deve ser JPG, PNG, WEBP ou AVIF e ter até 2 MB.</p>}
            {facade.isPending && <p className="mt-2 text-center text-xs text-slate-400">Enviando foto provisória…</p>}
            {fileError && <p className="mt-2 text-center text-xs text-red-300">{fileError}</p>}
          </footer>
        )}
         {cancelled && <div className="mt-6 flex items-center justify-center gap-2 rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200"><XCircle className="h-4 w-4" /> Cadastro cancelado. Este link não está mais ativo.</div>}
         {done && !cancelled && <div className="mt-6 space-y-3"><div className="flex items-center justify-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-3 text-sm text-emerald-300"><Check className="h-4 w-4" /> Recebido para revisão humana</div></div>}
          {!done && <PublicCancel token={token} cancel={cancel} />}
      </div>
    </main>
  );
}

function PublicCancel({ token, cancel }: { token: string; cancel: ReturnType<typeof useCancelPublicOwnerLink> }) {
  const [reason, setReason] = useState("");
  async function submit() {
    if (!window.confirm("Cancelar este cadastro? Essa ação não pode ser desfeita.")) return;
    try { await cancel.mutateAsync({ token, reason: reason.trim() || undefined }); }
    catch { window.alert("Não foi possível cancelar agora. Tente novamente."); }
  }
  return <div className="mt-8 border-t border-white/10 pt-4 text-center">
    <details className="text-left">
      <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-300">Cancelar cadastro</summary>
      <div className="mt-3 flex gap-2">
        <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Motivo (opcional)" className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white outline-none focus:border-[#d8ad5c]" />
         <button type="button" onClick={() => void submit()} disabled={cancel.isPending} className="rounded-lg border border-red-400/30 px-3 py-2 text-xs text-red-200 hover:bg-red-400/10 disabled:opacity-50">{cancel.isPending ? "Cancelando…" : "Cancelar cadastro"}</button>
      </div>
    </details>
  </div>;
}

function QuickOptions({ question, onSelect }: { question: string; onSelect: (value: string) => void }) {
  const normalized = question.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  let options: string[] = [];
  if (normalized.includes("venda") || normalized.includes("locacao")) options = ["Venda", "Locação"];
  else if (normalized.includes("sim ou nao") || normalized.includes("fica em condominio") || normalized.includes("disponivel")) options = ["SIM", "NÃO"];
  else if (normalized.includes("tipo do imovel")) options = ["Apartamento", "Casa", "Terreno", "Lote", "Gleba", "Sítio", "Chácara", "Fazenda", "Imóvel rural", "Outro"];
  else if (normalized.includes("unidade da area")) options = ["m²", "Hectares", "Alqueires"];
  else if (normalized.includes("mobiliado") || normalized.includes("mobilia")) options = ["Mobiliado", "Parcialmente mobiliado", "Sem mobília"];
  if (!options.length) return null;
  return <div className="mb-3 flex flex-wrap gap-2">{options.map((option) => <button key={option} type="button" onClick={() => onSelect(option)} className="rounded-xl border border-[#d8ad5c]/50 bg-[#d8ad5c]/10 px-4 py-3 text-sm text-[#f1d58e] hover:bg-[#d8ad5c]/20">{option}</button>)}</div>;
}

function Unavailable() {
  return <main className="flex min-h-screen items-center justify-center bg-[#07101f] p-6 text-center text-slate-300"><div><h1 className="text-xl font-semibold text-white">Link indisponível</h1><p className="mt-2 text-sm">Verifique o link ou solicite uma nova captação.</p></div></main>;
}
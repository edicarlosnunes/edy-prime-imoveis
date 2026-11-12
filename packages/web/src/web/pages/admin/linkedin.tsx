import { useEffect, useState } from "react";
import { AdminLayout } from "../../components/admin/layout";
import { useIntegrations, useSaveIntegration } from "../../queries/integrations";

type LinkedInStatus = { connected: boolean; accountName: string | null; expiresAt: string | null; error: string | null };

export default function LinkedInPage() {
 const query = useIntegrations();
 const save = useSaveIntegration();
 const item = query.data?.items.find(value => value.key === "linkedin_direct");
 const [clientId, setClientId] = useState("");
 const [clientSecret, setClientSecret] = useState("");
 const [code, setCode] = useState("");
 const [includeImage, setIncludeImage] = useState(true);
 const [status, setStatus] = useState<LinkedInStatus | null>(null);
 const [busy, setBusy] = useState(false);
 const [notice, setNotice] = useState("");
 const [consent, setConsent] = useState(false);
 useEffect(() => {
  if (!item) return;
  setClientId(item.config.clientId ?? "");
  setClientSecret(item.config.clientSecret ?? "");
 }, [item?.key, item?.config.clientId, item?.config.clientSecret]);
 async function refresh() {
  try {
   const response = await fetch("/api/admin/linkedin/status", { credentials: "same-origin" });
   if (!response.ok) throw new Error("Faça login no CRM.");
   setStatus(await response.json());
  } catch (error) { setNotice(error instanceof Error ? error.message : "Falha ao consultar a conta."); }
 }
 useEffect(() => { void refresh(); }, []);
 async function connect() {
  setBusy(true); setNotice("");
  try {
   await save.mutateAsync({ key: "linkedin_direct", config: { clientId: clientId.trim(), clientSecret: clientSecret.trim() } });
   const response = await fetch("/api/oauth/linkedin/start", { method: "POST", credentials: "same-origin" });
   const data = await response.json();
   if (!response.ok || !data.url) throw new Error(data.error || "Não foi possível iniciar a autorização.");
   window.location.assign(data.url);
  } catch (error) { setNotice(error instanceof Error ? error.message : "Falha de conexão."); setBusy(false); }
 }
 async function publish() {
  if (!consent) return;
  setBusy(true); setNotice("");
  try {
   const response = await fetch("/api/admin/linkedin/publish", {
    method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: code.trim(), includeImage }),
   });
   const data = await response.json();
   if (!response.ok) throw new Error(data.error || "LinkedIn não confirmou a publicação.");
   setNotice("PUBLICADO — LinkedIn confirmou o anúncio do EPI " + code.toUpperCase() + ". ID: " + data.postId);
   setConsent(false);
  } catch (error) { setNotice(error instanceof Error ? error.message : "Falha ao publicar."); }
  finally { setBusy(false); }
 }
 return (
  <AdminLayout title="LinkedIn — Integração direta" subtitle="Publicação oficial pelo CRM, sem Metricool, cobrança ou alteração dos outros canais.">
   <div className="mx-auto max-w-4xl space-y-5">
    <section className="rounded border border-line bg-white/80 p-5">
     <h2 className="text-lg font-semibold text-deep">1. Conectar seu LinkedIn ao CRM</h2>
     <p className="mt-2 text-sm text-muted">
      O aplicativo LinkedIn usa Share on LinkedIn (w_member_social) e Sign In with LinkedIn using OpenID Connect
      (openid/profile). A autorização publica no perfil autenticado; página empresarial exige aprovação separada
      da Community Management API pelo LinkedIn. Conectar não publica anúncios.
     </p>
     <a className="mt-2 inline-block text-sm text-blue-700 underline" href="https://www.linkedin.com/developers/apps" target="_blank" rel="noreferrer">Abrir aplicativos LinkedIn Developers</a>
     <div className="mt-3 rounded border border-line p-3">
      <p className="text-xs font-semibold">URL de retorno autorizada (cadastrar no app LinkedIn → Auth):</p>
      <code className="block break-all text-sm">https://www.esantoscorretor.com.br/api/oauth/linkedin/callback</code>
      <p className="mt-2 text-xs text-muted">Habilite os dois produtos citados acima e copie Client ID e Client Secret do aplicativo para os campos abaixo. Não envie o segredo por mensagem.</p>
     </div>
     <div className="mt-4 grid gap-3 sm:grid-cols-2">
      <label className="text-sm font-medium text-deep">Client ID
       <input className="mt-1 w-full rounded border border-line p-2" value={clientId} onChange={e => setClientId(e.target.value)} placeholder="Client ID do aplicativo" />
      </label>
      <label className="text-sm font-medium text-deep">Client Secret
       <input className="mt-1 w-full rounded border border-line p-2" type="password" value={clientSecret} onChange={e => setClientSecret(e.target.value)} placeholder="Client Secret do aplicativo" autoComplete="new-password" />
      </label>
     </div>
     <div className="mt-4 flex flex-wrap items-center gap-3">
      <button className="rounded bg-deep px-5 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={busy || !clientId.trim() || !clientSecret.trim()} onClick={() => void connect()}>
       {busy ? "Conectando…" : "Salvar e conectar LinkedIn"}
      </button>
      <button className="rounded border border-line px-4 py-2 text-sm" onClick={() => void refresh()}>Atualizar situação</button>
     </div>
     <p className="mt-3 text-xs text-muted">
      Situação: {status?.connected ? "Conectado — " + (status.accountName || "LinkedIn") : "Aguardando autorização"}.
      {status?.error ? " " + status.error : ""}
     </p>
    </section>
    <section className="rounded border border-line bg-white/80 p-5">
     <h2 className="text-lg font-semibold text-deep">2. Publicar um imóvel autorizado</h2>
     <p className="mt-2 text-sm text-muted">
      Informe o código EPI de um imóvel já publicado no site. O CRM monta a descrição comercial segura
      e envia a primeira foto real cadastrada, sem dados financeiros reservados do proprietário.
      A publicação só acontece quando você clicar no botão e confirmar.
     </p>
     <label className="mt-4 block text-sm font-medium text-deep">Código EPI
      <input className="mt-1 w-full rounded border border-line p-2" value={code} onChange={e => {setCode(e.target.value);setConsent(false);}} placeholder="AP-2026-000020" />
     </label>
     <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={includeImage} onChange={e => setIncludeImage(e.target.checked)} /> Incluir primeira foto real do cadastro</label>
     <label className="mt-3 flex items-start gap-2 text-sm"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} /> Autorizo publicar agora este imóvel no LinkedIn. Confirmei os dados comerciais e o preço.</label>
     <button className="mt-4 rounded bg-deep px-5 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={busy || !status?.connected || !consent || !code.trim()} onClick={() => void publish()}>
      {busy ? "Enviando…" : "Publicar no LinkedIn"}
     </button>
     <p className="mt-2 text-xs text-muted">Envio independente: não altera o estado de publicações do Facebook, Instagram, TikTok ou YouTube.</p>
    </section>
    {notice && <p role="status" className="rounded border border-line bg-white p-3 text-sm">{notice}</p>}
   </div>
  </AdminLayout>
 );
}

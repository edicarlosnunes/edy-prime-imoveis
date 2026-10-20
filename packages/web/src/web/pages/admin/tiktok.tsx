import { useEffect, useState } from "react";
import { AdminGuard } from "../../components/admin/guard";
import { AdminLayout } from "../../components/admin/layout";
import { Badge, Btn, Card, ErrorNote, Field, Input, Textarea } from "../../components/admin/ui";
import { useIntegrations, useSaveIntegration } from "../../queries/integrations";
import { errorMessage } from "../../lib/admin-session";

type Config = Record<string, unknown>;

function ProfileForm({ config }: { config: Config }) {
  const [username, setUsername] = useState(String(config.username ?? "@esantosgestorimobiliario"));
  const [accountEmail, setAccountEmail] = useState(String(config.accountEmail ?? ""));
  const [notes, setNotes] = useState(String(config.notes ?? ""));
  const [saved, setSaved] = useState(false);
  const save = useSaveIntegration();
  return <Card title="Dados do perfil">
    <form className="space-y-4" onChange={() => setSaved(false)} onSubmit={(event) => {
      event.preventDefault();
      setSaved(false);
      save.mutate({ key: "tiktok_publishing", config: { username: username.trim(), accountEmail: accountEmail.trim(), notes } }, { onSuccess: () => setSaved(true) });
    }}>
      <Field label="Nome de usuário"><Input value={username} onChange={(event) => setUsername(event.target.value)} required maxLength={100} /></Field>
      <Field label="E-mail da conta" hint="Opcional. Informe o endereço confirmado no celular."><Input type="email" autoComplete="email" value={accountEmail} onChange={(event) => setAccountEmail(event.target.value)} maxLength={254} /></Field>
      <Field label="Observações" hint="Não informe senha nem códigos de acesso."><Textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={2000} /></Field>
      <Btn type="submit" disabled={save.isPending}>{save.isPending ? "Salvando…" : "Salvar dados do perfil"}</Btn>
      {save.isError && <ErrorNote message={errorMessage(save.error)} />}
      {saved && <p role="status" className="text-sm text-emerald-700">Dados do perfil salvos. A conexão de envio é verificada no quadro acima.</p>}
    </form>
  </Card>;
}

function TikTokPage() {
  const query = useIntegrations();
  const item = query.data?.items.find((entry) => entry.key === "tiktok_publishing");
  const [connection,setConnection] = useState<{ready:boolean;username:string;message:string} | null>(null);
  const [message,setMessage] = useState(() => new URLSearchParams(window.location.search).get("result") ?? "");
  const [testing,setTesting] = useState(false);
  useEffect(()=>{
    let alive=true;
    void fetch("/api/admin/tiktok/connection",{credentials:"same-origin"}).then(async response=>{
      if(!response.ok) throw new Error("Não foi possível consultar a conexão.");
      const data=await response.json();if(alive)setConnection(data);
    }).catch(error=>{if(alive)setMessage(errorMessage(error));});
    return ()=>{alive=false;};
  },[]);
  async function testConnection() {
    setTesting(true);setMessage("");
    try {
      const response=await fetch("/api/admin/tiktok/test",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},body:"{}"});
      const data=await response.json();
      if(!response.ok)throw new Error(data.error ?? "Falha no teste da conexão.");
      setMessage(data.message);setConnection({ready:true,username:"",message:data.message});await query.refetch();
    } catch(error) {setMessage(errorMessage(error));setConnection(current=>current ? {...current,ready:false} : null);}
    finally {setTesting(false);}
  }
  return <AdminLayout title="TikTok" subtitle="Vídeo completo do imóvel pelo Metricool.">
    <div className="space-y-4">
      <Card title="Conectar o envio ao TikTok">
        <Badge tone={connection?.ready ? "green" : "amber"}>{connection?.ready ? "Perfil validado" : "Aguardando autorização"}</Badge>
        {connection?.username && <p className="mt-3 text-sm text-deep">TikTok: @{connection.username}</p>}
        <p className="mt-3 text-sm text-muted">Conecte sua conta Metricool, que já possui o perfil do TikTok. Depois teste a conexão para confirmar o destinatário.</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <a className="inline-flex items-center rounded-lg bg-deep px-4 py-3 text-sm text-white" href="/api/oauth/metricool/start">Conectar com Metricool</a>
          <Btn tone="outline" disabled={testing} onClick={()=>void testConnection()}>{testing ? "Testando…" : "Testar conexão"}</Btn>
        </div>
        {message && <p role="status" className="mt-4 text-sm text-deep">{message}</p>}
        {connection?.message && connection.message !== message && <p className="mt-2 text-sm text-deep">{connection.message}</p>}
        <p className="mt-4 text-xs text-muted">Não contrata plano nem impulsionamento. Valem os limites da sua conta Metricool. No imóvel, selecione TikTok e clique em Enviar / testar selecionados. O envio divulga publicamente o imóvel como conteúdo comercial da E. Santos. O recebimento pelo Metricool será mostrado como agendado; não como publicação já concluída.</p>
      </Card>
      {query.isLoading ? <p role="status">Carregando perfil…</p> : query.isError ? <ErrorNote message={errorMessage(query.error)} /> : item ? <ProfileForm config={item.config} /> : <ErrorNote message="Configuração do TikTok indisponível." />}
      <a className="text-sm underline" href="/admin/integracoes">Voltar às integrações</a>
    </div>
  </AdminLayout>;
}

export default function AdminTikTok() {
  return <AdminGuard><TikTokPage /></AdminGuard>;
}

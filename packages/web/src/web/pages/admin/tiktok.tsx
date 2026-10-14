import { useState } from "react";
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
      {saved && <p role="status" className="text-sm text-emerald-700">Dados salvos. A vinculação da conta continua pendente.</p>}
    </form>
  </Card>;
}

function TikTokPage() {
  const query = useIntegrations();
  const item = query.data?.items.find((entry) => entry.key === "tiktok_publishing");
  return <AdminLayout title="TikTok" subtitle="Prepare o perfil para os vídeos dos imóveis.">
    <div className="space-y-4">
      <Card title="Vinculação da conta">
        <Badge tone="amber">Aguardando vinculação</Badge>
        <p className="mt-3 text-sm text-muted">Esta pasta guarda os dados do perfil. Para publicar pelo CRM, ainda precisamos cadastrar o aplicativo no TikTok, autorizar a conta e validar o envio de um vídeo.</p>
        <p className="mt-2 text-sm text-muted">O TikTok tem sua própria autorização; esta etapa não passa pela Meta.</p>
      </Card>
      {query.isLoading ? <p role="status">Carregando perfil…</p> : query.isError ? <ErrorNote message={errorMessage(query.error)} /> : item ? <ProfileForm config={item.config} /> : <ErrorNote message="Configuração do TikTok indisponível. Atualize a página após a atualização do CRM." />}
      <a className="text-sm underline" href="/admin/integracoes">Voltar às integrações</a>
    </div>
  </AdminLayout>;
}

export default function AdminTikTok() {
  return <AdminGuard><TikTokPage /></AdminGuard>;
}

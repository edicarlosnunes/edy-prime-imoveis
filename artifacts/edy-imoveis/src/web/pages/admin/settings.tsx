import { useEffect, useState } from "react";
import { AdminGuard } from "../../components/admin/guard";
import { AdminLayout } from "../../components/admin/layout";
import { Btn, Card, ErrorNote, Field, Input, Textarea } from "../../components/admin/ui";
import { DEFAULT_PRIORITY_CITIES } from "../../../api/lib/priority-area";
import { errorMessage } from "../../lib/admin-session";
import {
  useAdminSettings,
  useBackfillStreets,
  useChangePassword,
  useSaveSettings,
  useStreets,
} from "../../queries/admin";

interface FormState {
  companyName: string;
  brokerName: string;
  whatsapp: string;
  email: string;
  creci: string;
  cnai: string;
  address: string;
  instagram: string;
  facebook: string;
  commissionRate: string;
  /** Uma cidade por linha. Vazio = lista padrão. */
  priorityCities: string;
}

const empty: FormState = {
  companyName: "",
  brokerName: "",
  whatsapp: "",
  email: "",
  creci: "",
  cnai: "",
  address: "",
  instagram: "",
  facebook: "",
  commissionRate: "6",
  priorityCities: DEFAULT_PRIORITY_CITIES.join("\n"),
};

export default function AdminSettings() {
  return (
    <AdminGuard>
      <Content />
    </AdminGuard>
  );
}

function Content() {
  const [form, setForm] = useState<FormState>(empty);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordDone, setPasswordDone] = useState(false);

  const settings = useAdminSettings();
  const save = useSaveSettings();
  const changePassword = useChangePassword();

  useEffect(() => {
    const row = settings.data;
    if (!row) return;
    setForm({
      companyName: row.companyName,
      brokerName: row.brokerName,
      whatsapp: row.whatsapp,
      email: row.email,
      creci: row.creci ?? "",
      cnai: row.cnai ?? "",
      address: row.address ?? "",
      instagram: row.instagram ?? "",
      facebook: row.facebook ?? "",
      commissionRate: String(row.commissionRate ?? 6),
      /* A API já devolve a lista efetiva (configurada ou a padrão). */
      priorityCities: (row.priorityCities ?? []).join("\n"),
    });
  }, [settings.data]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setSaved(false);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    try {
      await save.mutateAsync({
        companyName: form.companyName.trim(),
        brokerName: form.brokerName.trim(),
        whatsapp: form.whatsapp.trim(),
        email: form.email.trim(),
        creci: form.creci.trim(),
        cnai: form.cnai.trim(),
        address: form.address.trim(),
        instagram: form.instagram.trim(),
        facebook: form.facebook.trim(),
        commissionRate: Number(form.commissionRate.replace(",", ".")) || 0,
        priorityCities: form.priorityCities
          .split(/[\n,;]/)
          .map((city) => city.trim())
          .filter(Boolean),
      });
      setSaved(true);
    } catch (caught) {
      setError(errorMessage(caught, "Não foi possível salvar as configurações"));
    }
  }

  async function submitPassword(event: React.FormEvent) {
    event.preventDefault();
    setPasswordError(null);
    setPasswordDone(false);
    if (newPassword.length < 10) {
      setPasswordError("A nova senha precisa ter pelo menos 10 caracteres");
      return;
    }
    if (newPassword !== repeatPassword) {
      setPasswordError("As senhas não conferem");
      return;
    }
    try {
      await changePassword.mutateAsync({ currentPassword, newPassword });
      setPasswordDone(true);
      setCurrentPassword("");
      setNewPassword("");
      setRepeatPassword("");
      window.setTimeout(() => {
        window.location.href = "/admin/login";
      }, 1500);
    } catch (caught) {
      setPasswordError(errorMessage(caught, "Não foi possível alterar a senha"));
    }
  }

  return (
    <AdminLayout title="Configurações" subtitle="Dados da imobiliária e acesso ao painel">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title="Dados da imobiliária">
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Nome da imobiliária">
                <Input value={form.companyName} onChange={(e) => set("companyName", e.target.value)} required />
              </Field>
              <Field label="Nome do corretor">
                <Input value={form.brokerName} onChange={(e) => set("brokerName", e.target.value)} required />
              </Field>
              <Field label="WhatsApp" hint="Com DDI e DDD, só números: 5513997726767">
                <Input value={form.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} required />
              </Field>
              <Field label="E-mail">
                <Input value={form.email} onChange={(e) => set("email", e.target.value)} required />
              </Field>
              <Field label="CRECI">
                <Input value={form.creci} onChange={(e) => set("creci", e.target.value)} />
              </Field>
              {/* CRECI e CNAI saem impressos na Ficha Técnica e na Autorização.
                  Ficarem só no fallback do código escondia dado jurídico. */}
              <Field label="CNAI (avaliação de imóveis)">
                <Input value={form.cnai} onChange={(e) => set("cnai", e.target.value)} />
              </Field>
              <Field label="Comissão padrão (%)">
                <Input
                  value={form.commissionRate}
                  onChange={(e) => set("commissionRate", e.target.value)}
                  inputMode="decimal"
                />
              </Field>
            </div>
            <Field label="Endereço">
              <Input value={form.address} onChange={(e) => set("address", e.target.value)} />
            </Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Instagram">
                <Input value={form.instagram} onChange={(e) => set("instagram", e.target.value)} />
              </Field>
              <Field label="Facebook">
                <Input value={form.facebook} onChange={(e) => set("facebook", e.target.value)} />
              </Field>
            </div>
            {/* ÁREA PRIORITÁRIA: prioridade, não limite. Cidade fora da lista
                é cadastrada pelo mesmo fluxo, sem bloqueio — só recebe o
                destaque vermelho no Radar. */}
            <Field
              label="Cidades da área prioritária"
              hint="Uma por linha. É prioridade, não limite: imóvel fora da lista é cadastrado igual e só recebe destaque no Radar. Em branco usa a lista padrão."
            >
              <Textarea
                rows={5}
                value={form.priorityCities}
                onChange={(e) => set("priorityCities", e.target.value)}
              />
            </Field>
            <ErrorNote message={error} />
            {saved && <p className="text-xs text-emerald-700">Configurações salvas.</p>}
            <div className="flex justify-end border-t border-line pt-4">
              <Btn type="submit" tone="brass" disabled={save.isPending}>
                Salvar dados
              </Btn>
            </div>
          </form>
        </Card>

        <StreetsCard />

        <Card title="Senha administrativa">
          <form onSubmit={submitPassword} className="space-y-4">
            <Field label="Senha atual">
              <Input
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                required
              />
            </Field>
            <Field label="Nova senha" hint="Mínimo de 10 caracteres">
              <Input
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                required
              />
            </Field>
            <Field label="Repetir nova senha">
              <Input
                type="password"
                autoComplete="new-password"
                value={repeatPassword}
                onChange={(event) => setRepeatPassword(event.target.value)}
                required
              />
            </Field>
            <ErrorNote message={passwordError} />
            {passwordDone && (
              <p className="text-xs text-emerald-700">
                Senha alterada. Você será levado ao login para entrar novamente.
              </p>
            )}
            <div className="flex justify-end border-t border-line pt-4">
              <Btn type="submit" tone="primary" disabled={changePassword.isPending}>
                Alterar senha
              </Btn>
            </div>
          </form>
        </Card>
      </div>
    </AdminLayout>
  );
}

/**
 * Item 6 — ENDEREÇO INTELIGENTE: estrutura central de logradouros por cidade.
 *
 * A base é construída a partir do que JÁ existe nas captações (nada é
 * inventado, nada é sobrescrito) e cresce sozinha a cada cadastro novo. Aqui
 * o corretor só enxerga o tamanho da base e pode mandar recarregar do
 * histórico. A comparação/tolerância a abreviação e erro de grafia mora em
 * `street-normalize.ts` e é usada pelo fluxo de captação.
 */
function StreetsCard() {
  const streets = useStreets({ limit: 500 });
  const backfill = useBackfillStreets();
  const [note, setNote] = useState<string | null>(null);
  const rows = streets.data ?? [];
  const cities = new Set(rows.map((row) => row.city));
  async function run() {
    setNote(null);
    try {
      const result = await backfill.mutateAsync({});
      setNote(
        `${result.examined} captações lidas · ${result.created} logradouro(s) novo(s) · ${result.touched} confirmação(ões) de uso. Nada foi apagado.`,
      );
    } catch (error) {
      setNote(errorMessage(error, "Não foi possível recarregar os logradouros"));
    }
  }
  return (
    <Card title="Logradouros (endereço inteligente)">
      <div className="space-y-3 text-sm text-deep">
        <p className="text-xs text-muted">
          Base central usada para reconhecer rua abreviada ou com erro de grafia no cadastro. Em
          caso de dúvida o cadastro pede confirmação — nunca decide sozinho.
        </p>
        <div className="flex flex-wrap gap-4 text-xs text-muted">
          <span>
            <b className="text-deep">{rows.length}</b> logradouro(s) na base
          </span>
          <span>
            <b className="text-deep">{cities.size}</b> cidade(s)
          </span>
        </div>
        {rows.length === 0 && (
          <p className="text-xs text-amber-800">
            Base vazia. Recarregar do histórico aproveita os endereços já cadastrados.
          </p>
        )}
        {note && <p className="text-xs text-muted">{note}</p>}
        <div className="flex justify-end border-t border-line pt-4">
          <Btn tone="outline" disabled={backfill.isPending} onClick={() => void run()}>
            {backfill.isPending ? "Recarregando…" : "Recarregar do histórico de captações"}
          </Btn>
        </div>
      </div>
    </Card>
  );
}

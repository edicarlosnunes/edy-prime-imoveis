import { useMemo, useState } from "react";
import { Check, Copy, Link2, Plug, RefreshCw, ShieldCheck, TestTube } from "lucide-react";
import { AdminGuard } from "../../components/admin/guard";
import { AdminLayout } from "../../components/admin/layout";
import { Badge, Btn, Card, Empty, ErrorNote, Field, Input, Modal, Select, Stat, Textarea, dateTimeLabel } from "../../components/admin/ui";
import {
  useConfirmPortal,
  useIntegrations,
  useRotateWebhookToken,
  useSaveIntegration,
  useTestIntegration,
  useToggleIntegration,
} from "../../queries/integrations";
import { errorMessage } from "../../lib/admin-session";

type Item = NonNullable<ReturnType<typeof useIntegrations>["data"]>["items"][number];

const statusLabel: Record<string, { label: string; tone: "green" | "amber" | "red" | "neutral" }> = {
  conectado: { label: "Conectado", tone: "green" },
  configurando: { label: "Configurando", tone: "amber" },
  aguardando_credencial: { label: "Aguardando credencial", tone: "amber" },
  erro: { label: "Com erro", tone: "red" },
  nao_configurado: { label: "Não configurado", tone: "neutral" },
  nao_disponivel: { label: "Não disponível", tone: "neutral" },
};

function CopyLine({ label, url }: { label: string; url: string }) {
  const [copied, setCopied] = useState(false);
  const copyable = url.startsWith("http");
  return (
    <div className="flex items-center gap-2 rounded-[3px] border border-line bg-bone/30 px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="label-xs text-muted">{label}</p>
        <p className="truncate text-xs text-ink">{url}</p>
      </div>
      {copyable && (
        <button
          type="button"
          aria-label={`Copiar ${label}`}
          className="rounded-[3px] p-1.5 text-muted hover:bg-white hover:text-deep"
          onClick={() => {
            void navigator.clipboard?.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          }}
        >
          {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
        </button>
      )}
    </div>
  );
}

function IntegrationCard({ item, onOpen }: { item: Item; onOpen: () => void }) {
  const status = statusLabel[item.status] ?? statusLabel.nao_configurado!;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex h-full w-full flex-col gap-3 rounded-[4px] border border-line bg-white/80 p-4 text-left transition-colors hover:border-brass"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-[3px] bg-deep text-xs font-semibold text-white">
            {item.mark}
          </span>
          <div>
            <p className="text-sm font-medium text-deep">{item.name}</p>
            <p className="text-[11px] text-muted">{item.category}</p>
          </div>
        </div>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>
      <p className="text-xs leading-relaxed text-muted">{item.purpose}</p>
      {item.enabled && <Badge tone="brass">Ativa</Badge>}
      {item.lastError && <p className="text-[11px] text-red-700">{item.lastError}</p>}
    </button>
  );
}

function Detail({ item, onClose }: { item: Item; onClose: () => void }) {
  const [values, setValues] = useState<Record<string, string>>({ ...item.config });
  const [note, setNote] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const save = useSaveIntegration();
  const toggle = useToggleIntegration();
  const test = useTestIntegration();
  const confirm = useConfirmPortal();
  const rotate = useRotateWebhookToken();
  const isPortal = item.category === "Portais de Imóveis";

  async function run(action: () => Promise<string>) {
    setError(null);
    setFeedback(null);
    try {
      setFeedback(await action());
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  return (
    <Modal open onClose={onClose} title={item.name} wide>
      <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-4">
          <div className="rounded-[3px] border border-line bg-bone/30 px-3 py-3">
            <p className="label-xs text-muted">Como funciona oficialmente</p>
            <p className="mt-1 text-xs leading-relaxed text-ink">{item.method}</p>
          </div>

          {!item.available ? (
            <ErrorNote message="Não existe caminho oficial disponível hoje. Nada aqui pode ser ativado sem inventar integração." />
          ) : (
            <>
              {item.fields.length === 0 && (
                <p className="text-xs text-muted">Esta integração não exige credencial.</p>
              )}
              {item.fields.map((field) => (
                <Field key={field.key} label={field.label} hint={field.help}>
                  {field.type === "textarea" ? (
                    <Textarea
                      value={values[field.key] ?? ""}
                      onChange={(event) =>
                        setValues((prev) => ({ ...prev, [field.key]: event.target.value }))
                      }
                    />
                  ) : field.type === "select" ? (
                    <Select
                      value={values[field.key] ?? field.options?.[0]?.value ?? ""}
                      onChange={(event) =>
                        setValues((prev) => ({ ...prev, [field.key]: event.target.value }))
                      }
                    >
                      {(field.options ?? []).map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </Select>
                  ) : field.type === "switch" ? (
                    <label className="flex items-center gap-2 text-sm text-ink">
                      <input
                        type="checkbox"
                        checked={values[field.key] === "true"}
                        onChange={(event) =>
                          setValues((prev) => ({
                            ...prev,
                            [field.key]: event.target.checked ? "true" : "false",
                          }))
                        }
                      />
                      Ativado
                    </label>
                  ) : (
                    <Input
                      type={field.secret ? "text" : "text"}
                      placeholder={field.placeholder}
                      value={values[field.key] ?? ""}
                      onChange={(event) =>
                        setValues((prev) => ({ ...prev, [field.key]: event.target.value }))
                      }
                    />
                  )}
                </Field>
              ))}
              {item.fields.some((field) => field.secret) && (
                <p className="text-[11px] text-muted">
                  Campos com •••• já estão guardados no servidor. Deixe como está para manter o valor.
                </p>
              )}
            </>
          )}
        </div>

        <div className="space-y-4">
          {item.urls.length > 0 && (
            <div className="space-y-2">
              <p className="label-xs text-muted">Endereços para informar no portal</p>
              {item.urls.map((entry) => (
                <CopyLine key={entry.label} label={entry.label} url={entry.url} />
              ))}
            </div>
          )}

          {item.pending.length > 0 && (
            <div className="rounded-[3px] border border-amber-200 bg-amber-50 px-3 py-3">
              <p className="label-xs text-amber-800">O que precisa vir de fora</p>
              <ul className="mt-2 space-y-1 text-xs text-amber-900">
                {item.pending.map((entry) => (
                  <li key={entry}>• {entry}</li>
                ))}
              </ul>
            </div>
          )}

          {isPortal && item.available && (
            <div className="rounded-[3px] border border-line px-3 py-3">
              <p className="label-xs text-muted">Confirmação do portal</p>
              <p className="mt-1 text-[11px] text-muted">
                Marque só depois que o portal confirmar que leu o XML. Sem isso a integração não
                aparece como conectada.
              </p>
              <Input
                className="mt-2"
                placeholder="Protocolo/contato do portal (opcional)"
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
              <div className="mt-2 flex gap-2">
                <Btn
                  tone="brass"
                  disabled={confirm.isPending}
                  onClick={() =>
                    run(async () => {
                      const result = await confirm.mutateAsync({
                        key: item.key,
                        confirmed: true,
                        note: note || undefined,
                      });
                      return result.message;
                    })
                  }
                >
                  <ShieldCheck className="h-3.5 w-3.5" /> Confirmar leitura
                </Btn>
                {item.status === "conectado" && (
                  <Btn
                    tone="outline"
                    onClick={() =>
                      run(async () => {
                        const result = await confirm.mutateAsync({ key: item.key, confirmed: false });
                        return result.message;
                      })
                    }
                  >
                    Remover
                  </Btn>
                )}
              </div>
            </div>
          )}

          {item.key === "lead_webhook" && (
            <Btn
              tone="outline"
              onClick={() =>
                run(async () => {
                  const result = await rotate.mutateAsync({ key: item.key });
                  return `Novo token gerado. Atualize a URL nos portais: ${result.url}`;
                })
              }
            >
              <RefreshCw className="h-3.5 w-3.5" /> Gerar novo token
            </Btn>
          )}

          <div className="space-y-2 rounded-[3px] border border-line px-3 py-3">
            <p className="label-xs text-muted">Situação</p>
            <p className="text-xs text-ink">
              {statusLabel[item.status]?.label ?? item.status}
              {item.lastTestAt ? ` · último teste em ${dateTimeLabel(item.lastTestAt)}` : ""}
            </p>
            {item.docsUrl && (
              <a
                href={item.docsUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-brass underline"
              >
                <Link2 className="h-3 w-3" /> Documentação oficial
              </a>
            )}
          </div>

          {feedback && (
            <p className="rounded-[3px] border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
              {feedback}
            </p>
          )}
          <ErrorNote message={error} />
        </div>
      </div>

      <footer className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <label className="flex items-center gap-2 text-xs text-ink">
          <input
            type="checkbox"
            checked={item.enabled}
            disabled={!item.available || toggle.isPending}
            onChange={(event) =>
              run(async () => {
                await toggle.mutateAsync({ key: item.key, enabled: event.target.checked });
                return event.target.checked ? "Integração ativada." : "Integração desativada.";
              })
            }
          />
          Usar esta integração
        </label>
        <div className="flex gap-2">
          {item.canTest && (
            <Btn
              tone="outline"
              disabled={test.isPending}
              onClick={() =>
                run(async () => {
                  const result = await test.mutateAsync({ key: item.key });
                  return `${result.ok ? "OK" : "Falhou"} — ${result.message}`;
                })
              }
            >
              <TestTube className="h-3.5 w-3.5" /> Testar conexão
            </Btn>
          )}
          <Btn
            disabled={!item.available || save.isPending}
            onClick={() =>
              run(async () => {
                await save.mutateAsync({ key: item.key, config: values });
                return "Configuração salva.";
              })
            }
          >
            Salvar
          </Btn>
        </div>
      </footer>
    </Modal>
  );
}

function IntegrationsPage() {
  const query = useIntegrations();
  const [openKey, setOpenKey] = useState<string | null>(null);
  const items = query.data?.items ?? [];
  const counts = query.data?.counts;
  const open = useMemo(() => items.find((item) => item.key === openKey) ?? null, [items, openKey]);

  return (
    <AdminLayout
      title="Central de Integrações"
      subtitle="Portais, WhatsApp, Meta, Google e feeds — cada um com o método oficial e o que ainda falta."
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Integrações" value={counts?.total ?? "—"} />
        <Stat label="Conectadas" value={counts?.conectado ?? "—"} hint="Testadas ou confirmadas" />
        <Stat label="Aguardando" value={counts?.pendente ?? "—"} hint="Falta credencial ou contrato" />
        <Stat label="Com erro" value={counts?.erro ?? "—"} />
      </div>

      {query.isLoading && <Empty>Carregando integrações…</Empty>}

      <div className="mt-6 space-y-8">
        {(query.data?.categories ?? []).map((category) => {
          const group = items.filter((item) => item.category === category);
          if (group.length === 0) return null;
          return (
            <section key={category}>
              <header className="mb-3 flex items-center gap-2">
                <Plug className="h-4 w-4 text-brass" />
                <h2 className="display text-xl text-deep">{category}</h2>
              </header>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {group.map((item) => (
                  <IntegrationCard key={item.key} item={item} onOpen={() => setOpenKey(item.key)} />
                ))}
              </div>
            </section>
          );
        })}
      </div>

      <Card className="mt-8" title="Como o sistema trata integração">
        <ul className="space-y-2 text-xs leading-relaxed text-muted">
          <li>
            • Nenhuma integração aparece como <strong>conectada</strong> sem teste real ou confirmação
            do portal. Simulação nunca conta.
          </li>
          <li>• Credenciais ficam somente no servidor; a tela mostra apenas os últimos dígitos.</li>
          <li>
            • Portais brasileiros publicam por leitura de XML — por isso o caminho é cadastrar a URL
            do feed no painel do portal e confirmar aqui depois da primeira leitura.
          </li>
        </ul>
      </Card>

      {open && <Detail item={open} onClose={() => setOpenKey(null)} />}
    </AdminLayout>
  );
}

export default function AdminIntegrations() {
  return (
    <AdminGuard>
      <IntegrationsPage />
    </AdminGuard>
  );
}

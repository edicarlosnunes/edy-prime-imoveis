import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Megaphone, RefreshCw, Send, TestTube } from "lucide-react";
import { AdminGuard } from "../../components/admin/guard";
import { AdminLayout } from "../../components/admin/layout";
import { Badge, Btn, Card, Empty, ErrorNote, Field, Input, Select } from "../../components/admin/ui";
import { orpc } from "../../lib/api";
import { errorMessage } from "../../lib/admin-session";

type ConfigState = {
  pageId: string;
  pageToken: string;
  imageVariant: "marcada" | "original";
  enabled: boolean;
};

function useFacebookOverview() {
  return useQuery(orpc.adminFacebook.overview.queryOptions({ staleTime: 10_000 }));
}

function money(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

const statusTone: Record<string, "green" | "amber" | "red" | "neutral" | "brass"> = {
  conectado: "green",
  configurando: "amber",
  aguardando_credencial: "amber",
  erro: "red",
  nao_configurado: "neutral",
  publicado: "green",
  nao_enviado: "neutral",
};

const statusLabel: Record<string, string> = {
  conectado: "Conectado",
  configurando: "Pronto para testar",
  aguardando_credencial: "Aguardando token",
  erro: "Com erro",
  nao_configurado: "Aguardando token",
  publicado: "Publicado",
  nao_enviado: "Não enviado",
};

function SummaryCard({
  label,
  value,
  hint,
  mono = false,
}: {
  label: string;
  value: string | number;
  hint?: string;
  mono?: boolean;
}) {
  return (
    <div className="admin-card min-w-0 rounded-[4px] border border-line bg-white px-4 py-4">
      <p className="label-xs text-muted">{label}</p>
      <p
        className={`mt-2 break-words text-xl font-semibold leading-tight text-deep ${mono ? "font-mono text-base sm:text-lg" : ""}`}
      >
        {value}
      </p>
      {hint && <p className="mt-1 text-[11px] leading-relaxed text-muted">{hint}</p>}
    </div>
  );
}

function FacebookPage() {
  const queryClient = useQueryClient();
  const overview = useFacebookOverview();
  const [config, setConfig] = useState<ConfigState>({
    pageId: "",
    pageToken: "",
    imageVariant: "marcada",
    enabled: true,
  });
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!overview.data) return;
    setConfig({
      pageId: overview.data.integration.pageId,
      pageToken: overview.data.integration.pageToken,
      imageVariant: overview.data.integration.imageVariant,
      enabled:
        overview.data.integration.status === "nao_configurado"
          ? true
          : overview.data.integration.enabled,
    });
  }, [overview.data]);

  const save = useMutation(
    orpc.adminFacebook.save.mutationOptions({
      onSuccess: async (result) => {
        setError(null);
        setFeedback(`Configuração salva · ${statusLabel[result.status] ?? result.status}`);
        await queryClient.invalidateQueries();
      },
      onError: (caught) => setError(errorMessage(caught)),
    }),
  );

  const test = useMutation(
    orpc.adminFacebook.test.mutationOptions({
      onSuccess: async (result) => {
        setError(result.ok ? null : result.message);
        setFeedback(result.ok ? result.message : null);
        await queryClient.invalidateQueries();
      },
      onError: (caught) => setError(errorMessage(caught)),
    }),
  );

  const publish = useMutation(
    orpc.adminFacebook.publish.mutationOptions({
      onSuccess: async (result) => {
        setError(null);
        setFeedback(result.message);
        await queryClient.invalidateQueries();
      },
      onError: (caught) => setError(errorMessage(caught)),
    }),
  );

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return overview.data?.properties ?? [];
    return (overview.data?.properties ?? []).filter((property) =>
      [property.code, property.title, property.district, property.city]
        .join(" ")
        .toLowerCase()
        .includes(term),
    );
  }, [overview.data?.properties, search]);

  const publishedCount = overview.data?.properties.filter((item) => item.facebook.status === "publicado").length ?? 0;
  const integration = overview.data?.integration;
  const connectionLabel = statusLabel[integration?.status ?? "nao_configurado"] ?? "Aguardando token";
  const hasToken = config.pageToken.trim().length > 0;

  return (
    <AdminLayout
      title="Facebook · Publicação de imóveis"
      subtitle="Integrações → Facebook. Configure uma vez e publique somente os imóveis aprovados no CRM."
      actions={
        <a
          href="/admin/integracoes"
          className="inline-flex items-center gap-2 rounded-[3px] border border-line bg-white px-3 py-2 text-xs font-medium text-deep hover:bg-bone/60"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Integrações
        </a>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          label="Status da conexão"
          value={connectionLabel}
          hint="Isto é um status, não é contador nem número de registro."
        />
        <SummaryCard
          label="Page ID"
          value={integration?.pageId || "—"}
          hint="Identificador numérico da Página do Facebook."
          mono
        />
        <SummaryCard
          label="Imóveis prontos"
          value={overview.data?.properties.length ?? "—"}
          hint="Aprovados, disponíveis e com foto."
        />
        <SummaryCard label="Já publicados" value={publishedCount} hint="Publicações enviadas por este CRM." />
      </div>

      <Card className="mt-6" title="1. Conectar a Página do Facebook">
        <div className="grid gap-4 lg:grid-cols-2">
          <Field label="ID da Página do Facebook" hint="Page ID numérico da Página que vai receber os anúncios.">
            <Input
              value={config.pageId}
              placeholder="Ex.: 123456789012345"
              onChange={(event) => setConfig((prev) => ({ ...prev, pageId: event.target.value }))}
            />
          </Field>
          <Field label="Page Access Token" hint="Cole aqui o token da Página. Depois de salvo, ele aparece apenas mascarado.">
            <Input
              type="password"
              value={config.pageToken}
              placeholder="Token da Página"
              onChange={(event) => setConfig((prev) => ({ ...prev, pageToken: event.target.value }))}
            />
          </Field>
          <Field label="Foto enviada">
            <Select
              value={config.imageVariant}
              onChange={(event) =>
                setConfig((prev) => ({
                  ...prev,
                  imageVariant: event.target.value === "original" ? "original" : "marcada",
                }))
              }
            >
              <option value="marcada">Com marca d'água, quando existir</option>
              <option value="original">Original, sem marca d'água</option>
            </Select>
          </Field>
          <Field label="Publicação pelo CRM">
            <label className="flex h-10 items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={config.enabled}
                onChange={(event) => setConfig((prev) => ({ ...prev, enabled: event.target.checked }))}
              />
              Ativar publicação de imóveis no Facebook
            </label>
          </Field>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Btn
            disabled={save.isPending || !config.pageId.trim() || !hasToken}
            onClick={() => {
              setError(null);
              setFeedback(null);
              save.mutate(config);
            }}
          >
            <Megaphone className="h-4 w-4" /> Salvar conexão
          </Btn>
          <Btn
            tone="outline"
            disabled={test.isPending || save.isPending || !hasToken}
            onClick={() => {
              setError(null);
              setFeedback(null);
              test.mutate({});
            }}
          >
            <TestTube className="h-4 w-4" /> Testar conexão
          </Btn>
          <Btn tone="outline" disabled={overview.isFetching} onClick={() => void overview.refetch()}>
            <RefreshCw className="h-4 w-4" /> Atualizar
          </Btn>
          {integration && (
            <Badge tone={statusTone[integration.status] ?? "neutral"}>
              {connectionLabel}
            </Badge>
          )}
        </div>
        {!hasToken && (
          <p className="mt-3 text-[11px] text-muted">
            Os botões Salvar e Testar ficam disponíveis assim que o token da Página for colado.
          </p>
        )}
      </Card>

      {feedback && (
        <p className="mt-4 rounded-[3px] border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          {feedback}
        </p>
      )}
      <ErrorNote message={error ?? integration?.lastError ?? null} />

      <Card className="mt-6" title="2. Publicar imóveis">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <Input
            className="max-w-sm"
            placeholder="Buscar por código, título, bairro ou cidade"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <p className="text-[11px] text-muted">
            O CRM bloqueia duplicidade. “Republicar” cria uma nova publicação somente com sua confirmação.
          </p>
        </div>

        {overview.isLoading && <Empty>Carregando imóveis…</Empty>}
        {!overview.isLoading && rows.length === 0 && <Empty>Nenhum imóvel disponível para publicar.</Empty>}

        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="border-b border-line text-left">
                  <th className="py-2 pr-3 label-xs text-muted">Imóvel</th>
                  <th className="px-3 py-2 label-xs text-muted">Local</th>
                  <th className="px-3 py-2 label-xs text-muted">Preço</th>
                  <th className="px-3 py-2 label-xs text-muted">Facebook</th>
                  <th className="py-2 pl-3 text-right label-xs text-muted">Ação</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((property) => {
                  const already = property.facebook.status === "publicado";
                  const busy = publish.isPending;
                  return (
                    <tr key={property.id} className="border-b border-line/60 align-top">
                      <td className="py-3 pr-3">
                        <p className="font-medium text-deep">{property.title}</p>
                        <p className="text-[11px] text-muted">{property.code}</p>
                      </td>
                      <td className="px-3 py-3 text-xs text-ink">
                        {[property.district, property.city].filter(Boolean).join(" · ")}
                      </td>
                      <td className="px-3 py-3 text-xs text-ink">{money(property.price)}</td>
                      <td className="px-3 py-3">
                        <Badge tone={statusTone[property.facebook.status] ?? "neutral"}>
                          {statusLabel[property.facebook.status] ?? property.facebook.status}
                        </Badge>
                        {property.facebook.message && (
                          <p className="mt-1 max-w-sm text-[10px] leading-relaxed text-muted">
                            {property.facebook.message}
                          </p>
                        )}
                      </td>
                      <td className="py-3 pl-3 text-right">
                        <Btn
                          tone={already ? "outline" : "brass"}
                          disabled={busy || integration?.status !== "conectado" || !config.enabled}
                          onClick={() => {
                            const force = already;
                            if (
                              force &&
                              !window.confirm(
                                `O imóvel ${property.code} já foi publicado. Deseja criar uma NOVA publicação no Facebook?`,
                              )
                            ) {
                              return;
                            }
                            setError(null);
                            setFeedback(null);
                            publish.mutate({ propertyId: property.id, force });
                          }}
                        >
                          <Send className="h-3.5 w-3.5" /> {already ? "Republicar" : "Publicar"}
                        </Btn>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </AdminLayout>
  );
}

export default function AdminFacebook() {
  return (
    <AdminGuard>
      <FacebookPage />
    </AdminGuard>
  );
}

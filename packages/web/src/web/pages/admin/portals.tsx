import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { AdminGuard } from "../../components/admin/guard";
import { AdminLayout } from "../../components/admin/layout";
import { Badge, Btn, Card, Empty, ErrorNote, Input, Stat } from "../../components/admin/ui";
import {
  useBulkAuthorize,
  useChannelMatrix,
  useChannelOverview,
  useSetChannelAuthorized,
} from "../../queries/integrations";
import { errorMessage } from "../../lib/admin-session";

const CHANNELS = [
  { key: "feed", label: "Feed geral" },
  { key: "zap", label: "ZAP / VivaReal" },
  { key: "olx", label: "OLX" },
  { key: "imovelweb", label: "Imovelweb" },
] as const;

function PortalsPage() {
  const overview = useChannelOverview();
  const matrix = useChannelMatrix();
  const setAuthorized = useSetChannelAuthorized();
  const bulk = useBulkAuthorize();
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  const rows = (matrix.data ?? []).filter((row) => {
    const term = search.trim().toLowerCase();
    if (!term) return true;
    return row.title.toLowerCase().includes(term) || row.code.toLowerCase().includes(term);
  });

  async function guard(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  return (
    <AdminLayout
      title="Portais de Imóveis"
      subtitle="Escolha imóvel por imóvel o que sai em cada portal. O XML é lido pelos portais no ciclo deles."
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(overview.data?.channels ?? []).map((channel) => (
          <Stat
            key={channel.channel}
            label={CHANNELS.find((item) => item.key === channel.channel)?.label ?? channel.channel}
            value={channel.count}
            hint="imóveis no XML agora"
          />
        ))}
      </div>

      <Card className="mt-6" title="Endereços dos arquivos XML">
        <div className="space-y-2">
          {(overview.data?.channels ?? []).map((channel) => (
            <div
              key={channel.channel}
              className="flex flex-wrap items-center justify-between gap-2 rounded-[3px] border border-line bg-bone/30 px-3 py-2"
            >
              <span className="text-xs text-ink">{channel.url}</span>
              <a
                href={channel.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-brass underline"
              >
                Abrir <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-muted">
          Cadastre a URL no painel do portal. ZAP/VivaReal lê aproximadamente a cada 12 horas.
        </p>
      </Card>

      <ErrorNote message={error} />

      <Card className="mt-6" title="Autorização por imóvel">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Input
            className="max-w-xs"
            placeholder="Buscar por código ou título"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {CHANNELS.map((channel) => (
            <Btn
              key={channel.key}
              tone="outline"
              disabled={bulk.isPending || rows.length === 0}
              onClick={() =>
                guard(() =>
                  bulk.mutateAsync({
                    propertyIds: rows.filter((row) => row.published).map((row) => row.id),
                    channel: channel.key,
                    authorized: true,
                  }),
                )
              }
            >
              Autorizar todos em {channel.label}
            </Btn>
          ))}
        </div>

        {matrix.isLoading && <Empty>Carregando imóveis…</Empty>}
        {!matrix.isLoading && rows.length === 0 && <Empty>Nenhum imóvel encontrado.</Empty>}

        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-line text-left">
                  <th className="py-2 pr-3 label-xs text-muted">Imóvel</th>
                  {CHANNELS.map((channel) => (
                    <th key={channel.key} className="py-2 px-3 label-xs text-muted">
                      {channel.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-line/60">
                    <td className="py-2.5 pr-3">
                      <p className="text-sm text-deep">{row.title}</p>
                      <p className="flex items-center gap-2 text-[11px] text-muted">
                        {row.code}
                        {!row.published && <Badge tone="amber">Não publicado</Badge>}
                        {row.status !== "disponivel" && <Badge>{row.status}</Badge>}
                      </p>
                    </td>
                    {CHANNELS.map((channel) => (
                      <td key={channel.key} className="px-3 py-2.5">
                        <input
                          type="checkbox"
                          aria-label={`${row.code} em ${channel.label}`}
                          checked={row.channels[channel.key]}
                          onChange={(event) =>
                            guard(() =>
                              setAuthorized.mutateAsync({
                                propertyId: row.id,
                                channel: channel.key,
                                authorized: event.target.checked,
                              }),
                            )
                          }
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </AdminLayout>
  );
}

export default function AdminPortals() {
  return (
    <AdminGuard>
      <PortalsPage />
    </AdminGuard>
  );
}

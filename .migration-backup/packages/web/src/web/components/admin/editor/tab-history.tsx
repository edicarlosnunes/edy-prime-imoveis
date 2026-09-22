import { useState } from "react";
import { History, RotateCcw } from "lucide-react";
import { Badge, Btn, Empty, ErrorNote, dateTimeLabel } from "../ui";
import { errorMessage } from "../../../lib/admin-session";
import { useRestoreVersion, useSiteHistory } from "../../../queries/admin-site";
import { mergeSiteContent, type SiteContent } from "../../../lib/site-content";

/**
 * Histórico de publicações: restaurar traz a versão de volta para o RASCUNHO
 * (nada vai ao ar sem clicar em "Publicar alterações").
 */
export function TabHistory({ onRestored }: { onRestored: (content: SiteContent) => void }) {
  const history = useSiteHistory();
  const restore = useRestoreVersion();
  const [error, setError] = useState<string | null>(null);

  async function restoreVersion(id: number) {
    setError(null);
    try {
      const result = await restore.mutateAsync({ id });
      onRestored(mergeSiteContent(result.data));
    } catch (cause) {
      setError(errorMessage(cause, "Não foi possível restaurar"));
    }
  }

  return (
    <div className="space-y-4">
      <ErrorNote message={error} />
      <p className="text-xs text-muted">
        Restaurar uma versão traz o conteúdo dela para o rascunho. O site só muda depois de
        publicar.
      </p>

      {history.isLoading && <p className="text-sm text-muted">Carregando…</p>}

      {history.data?.length === 0 && <Empty>Nenhuma publicação registrada ainda.</Empty>}

      <div className="space-y-2">
        {history.data?.map((version) => (
          <div
            key={version.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-[3px] border border-line bg-white/80 px-4 py-3"
          >
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 text-sm text-ink">
                <History className="h-3.5 w-3.5 shrink-0 text-muted" />
                <span className="truncate">{version.label ?? "Publicação"}</span>
                {version.status === "published" ? (
                  <Badge tone="green">no ar</Badge>
                ) : (
                  <Badge>histórico</Badge>
                )}
              </p>
              <p className="mt-1 text-xs text-muted">
                {dateTimeLabel(version.publishedAt ?? version.createdAt)}
                {version.author ? ` · ${version.author}` : ""}
              </p>
            </div>
            <Btn
              tone="outline"
              disabled={restore.isPending}
              onClick={() => restoreVersion(version.id)}
            >
              <RotateCcw className="h-3.5 w-3.5" /> Restaurar
            </Btn>
          </div>
        ))}
      </div>
    </div>
  );
}

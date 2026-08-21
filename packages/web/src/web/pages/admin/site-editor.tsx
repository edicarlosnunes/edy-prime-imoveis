import { useEffect, useMemo, useState } from "react";
import { Eye, Loader2, RotateCcw, Save, Upload } from "lucide-react";
import { AdminGuard } from "../../components/admin/guard";
import { AdminLayout } from "../../components/admin/layout";
import { Badge, Btn, ErrorNote, dateTimeLabel } from "../../components/admin/ui";
import { errorMessage } from "../../lib/admin-session";
import {
  cloneSiteContent,
  defaultSiteContent,
  mergeSiteContent,
  type SiteContent,
} from "../../lib/site-content";
import {
  useDiscardDraft,
  usePublishSite,
  useSaveDraft,
  useSiteState,
} from "../../queries/admin-site";
import { MediaLibrary } from "../../components/admin/editor/image-picker";
import type { Patch } from "../../components/admin/editor/parts";
import { TabIdentity, TabSeo } from "../../components/admin/editor/tabs-brand";
import { TabHero, TabMenu } from "../../components/admin/editor/tabs-hero";
import { TabSections } from "../../components/admin/editor/tabs-sections";
import { TabCompany, TabFooter } from "../../components/admin/editor/tabs-company";
import { TabHistory } from "../../components/admin/editor/tab-history";
import { TabTypography } from "../../components/admin/editor/tab-typography";

const tabs = [
  { key: "identidade", label: "Identidade" },
  { key: "textos", label: "Textos" },
  { key: "capa", label: "Capa" },
  { key: "menu", label: "Menu" },
  { key: "secoes", label: "Seções" },
  { key: "empresa", label: "Empresa" },
  { key: "rodape", label: "Rodapé" },
  { key: "seo", label: "SEO" },
  { key: "midia", label: "Imagens" },
  { key: "historico", label: "Histórico" },
] as const;

type TabKey = (typeof tabs)[number]["key"];

function Editor() {
  const state = useSiteState();
  const saveDraft = useSaveDraft();
  const publish = usePublishSite();
  const discard = useDiscardDraft();

  const [tab, setTab] = useState<TabKey>("identidade");
  const [content, setContent] = useState<SiteContent>(defaultSiteContent);
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mediaOpen, setMediaOpen] = useState(false);

  // Carrega o rascunho (ou o que está no ar) uma única vez
  useEffect(() => {
    if (loaded || state.isLoading || !state.data) return;
    const source = state.data.draft?.data ?? state.data.published?.data;
    setContent(mergeSiteContent(source));
    setLoaded(true);
  }, [loaded, state.isLoading, state.data]);

  const patch: Patch = useMemo(
    () => (recipe) => {
      setContent((previous) => {
        const next = cloneSiteContent(previous);
        recipe(next);
        return next;
      });
      setDirty(true);
      setNotice(null);
    },
    [],
  );

  const publishedAt = state.data?.published?.publishedAt ?? null;
  const draftUpdatedAt = state.data?.draft?.updatedAt ?? null;
  const hasUnpublished = dirty || Boolean(state.data?.hasChanges);

  async function onSave() {
    setError(null);
    try {
      await saveDraft.mutateAsync({ data: content as unknown as Record<string, unknown> });
      setDirty(false);
      setNotice("Rascunho salvo.");
    } catch (cause) {
      setError(errorMessage(cause, "Não foi possível salvar o rascunho"));
    }
  }

  async function onPreview() {
    setError(null);
    try {
      await saveDraft.mutateAsync({ data: content as unknown as Record<string, unknown> });
      setDirty(false);
      window.open("/?preview=1", "_blank", "noopener");
    } catch (cause) {
      setError(errorMessage(cause, "Não foi possível abrir a pré-visualização"));
    }
  }

  async function onPublish() {
    setError(null);
    try {
      await publish.mutateAsync({ data: content as unknown as Record<string, unknown> });
      setDirty(false);
      setNotice("Alterações publicadas no site.");
    } catch (cause) {
      setError(errorMessage(cause, "Não foi possível publicar"));
    }
  }

  async function onDiscard() {
    setError(null);
    try {
      const result = await discard.mutateAsync({});
      setContent(mergeSiteContent(result.data));
      setDirty(false);
      setNotice("Rascunho descartado.");
    } catch (cause) {
      setError(errorMessage(cause, "Não foi possível descartar o rascunho"));
    }
  }

  const busy = saveDraft.isPending || publish.isPending || discard.isPending;

  return (
    <AdminLayout
      title="Editor do Site"
      subtitle="Edite textos, cores, imagens e seções — publique quando estiver pronto"
      actions={
        <>
          {hasUnpublished ? (
            <Badge tone="amber">alterações não publicadas</Badge>
          ) : (
            <Badge tone="green">site atualizado</Badge>
          )}
          <Btn tone="outline" disabled={busy} onClick={onDiscard}>
            <RotateCcw className="h-3.5 w-3.5" /> Descartar
          </Btn>
          <Btn tone="outline" disabled={busy} onClick={onSave}>
            {saveDraft.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            Salvar rascunho
          </Btn>
          <Btn tone="outline" disabled={busy} onClick={onPreview}>
            <Eye className="h-3.5 w-3.5" /> Pré-visualizar
          </Btn>
          <Btn tone="brass" disabled={busy} onClick={onPublish}>
            {publish.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Upload className="h-3.5 w-3.5" />
            )}
            Publicar alterações
          </Btn>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted">
          <span>Publicado em: {dateTimeLabel(publishedAt)}</span>
          <span>Rascunho salvo em: {dateTimeLabel(draftUpdatedAt)}</span>
        </div>

        <ErrorNote message={error} />
        {notice && (
          <p className="rounded-[3px] border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
            {notice}
          </p>
        )}

        <nav className="flex flex-wrap gap-1 border-b border-line pb-2">
          {tabs.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key)}
              className={`rounded-[3px] px-3 py-2 text-xs tracking-wide uppercase transition-colors ${
                tab === item.key ? "bg-deep text-white" : "text-muted hover:bg-bone/60 hover:text-deep"
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>

        {!loaded && state.isLoading ? (
          <p className="text-sm text-muted">Carregando conteúdo…</p>
        ) : (
          <>
            {tab === "identidade" && <TabIdentity content={content} patch={patch} />}
            {tab === "textos" && <TabTypography content={content} patch={patch} />}
            {tab === "capa" && <TabHero content={content} patch={patch} />}
            {tab === "menu" && <TabMenu content={content} patch={patch} />}
            {tab === "secoes" && <TabSections content={content} patch={patch} />}
            {tab === "empresa" && <TabCompany content={content} patch={patch} />}
            {tab === "rodape" && <TabFooter content={content} patch={patch} />}
            {tab === "seo" && <TabSeo content={content} patch={patch} />}
            {tab === "midia" && (
              <div className="rounded-[4px] border border-line bg-white/80 p-5">
                <p className="text-sm text-muted">
                  Envie, renomeie e exclua as imagens usadas no site e nos imóveis.
                </p>
                <Btn tone="outline" className="mt-4" onClick={() => setMediaOpen(true)}>
                  Abrir biblioteca de imagens
                </Btn>
                <MediaLibrary open={mediaOpen} onClose={() => setMediaOpen(false)} />
              </div>
            )}
            {tab === "historico" && (
              <TabHistory
                onRestored={(restored) => {
                  setContent(restored);
                  setDirty(false);
                  setNotice("Versão restaurada no rascunho. Publique para colocar no ar.");
                }}
              />
            )}
          </>
        )}
      </div>
    </AdminLayout>
  );
}

function AdminSiteEditor() {
  return (
    <AdminGuard>
      <Editor />
    </AdminGuard>
  );
}

export default AdminSiteEditor;

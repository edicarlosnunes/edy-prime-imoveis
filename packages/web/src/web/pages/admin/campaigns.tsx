import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { upload } from "@vercel/blob/client";
import { AdminGuard } from "../../components/admin/guard";
import { AdminLayout } from "../../components/admin/layout";
import { Btn, Card, ErrorNote, Field, Input, Textarea } from "../../components/admin/ui";
import { client, orpc } from "../../lib/api";
import { errorMessage } from "../../lib/admin-session";
import { CampaignView, type CampaignContent } from "../campaign";

const firstSlug = "cadastre-seu-imovel";
const blank: CampaignContent = {
  title: "", highlight: "", description: "", cover: "", background: "", video: "",
  website: "", email: "", whatsapp: "",
};
const firstDraft: CampaignContent = {
  ...blank,
  title: "Quer vender ou alugar seu imóvel? Cadastre com a E. Santos",
  highlight: "Apresente seu imóvel com fotos, vídeo e imagens de drone.",
  description: "Quer vender ou alugar seu imóvel? A E. Santos Gestor Imobiliário ajuda você a preparar e divulgar seu imóvel com fotos, vídeo e imagens de drone. Chame a gente no WhatsApp e cadastre seu imóvel.",
  website: "https://www.esantoscorretor.com.br",
  whatsapp: "5513997141174",
};

type SavedCampaign = Awaited<ReturnType<typeof client.adminCampaigns.list>>[number];
type MediaField = "cover" | "background" | "video";

export default function AdminCampaigns() {
  return <AdminGuard><Campaigns /></AdminGuard>;
}

function Campaigns() {
  const list = useQuery(orpc.adminCampaigns.list.queryOptions());
  const [selection, select] = useState<string | null>(null);
  const selected = list.data?.find((item) => item.slug === selection);
  return (
    <AdminLayout title="Campanhas" subtitle="Prepare anúncios institucionais e publique no site.">
      {list.isPending ? <p>Carregando…</p> : list.isError ? (
        <ErrorNote message={errorMessage(list.error)} />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            <Btn onClick={() => select(null)}>Nova campanha</Btn>
            {list.data?.map((item) => <Btn key={item.slug} onClick={() => select(item.slug)}>
              {item.draft.title} · {item.published ? "No site" : "Rascunho"}
            </Btn>)}
          </div>
          <Editor key={selected?.slug ?? "new"} saved={selected} first={!list.data?.length} onSaved={select} />
        </>
      )}
    </AdminLayout>
  );
}

function Editor({ saved, first, onSaved }: { saved?: SavedCampaign; first: boolean; onSaved: (slug: string) => void }) {
  const cache = useQueryClient();
  const [slug, setSlug] = useState(saved?.slug ?? (first ? firstSlug : ""));
  const [data, setData] = useState(saved?.draft ?? (first ? firstDraft : blank));
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const url = slug === firstSlug ? "/cadastre-seu-imovel" : `/campanha/${slug}`;
  const publicUrl = `${window.location.origin}${url}`;
  const caption = [data.description, data.website, data.email,
    data.whatsapp ? `https://wa.me/${data.whatsapp}` : "",
    saved?.published ? publicUrl : "",
  ].filter(Boolean).join("\n\n");

  function update(field: keyof CampaignContent, value: string) {
    setData((current) => ({ ...current, [field]: value }));
  }

  async function perform(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    await Promise.all([
      cache.invalidateQueries({ queryKey: orpc.adminCampaigns.list.key() }),
      cache.invalidateQueries({ queryKey: orpc.publicCampaigns.get.key() }),
    ]);
  }

  function save(publish: boolean) {
    return perform(async () => {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error("Use letras minúsculas, números e hífens no endereço.");
      if (!data.title.trim()) throw new Error("Informe o título da campanha.");
      if (publish && (!data.cover || !data.video || !data.whatsapp || !data.email || !data.website || !data.description.trim())) {
        throw new Error("Preencha descrição, capa, vídeo, site, e-mail e WhatsApp antes de publicar.");
      }
      await client.adminCampaigns.save({ slug, data, publish, create: !saved });
      await refresh();
      onSaved(slug);
      setNotice(publish ? "Campanha publicada no site." : "Rascunho salvo.");
    });
  }

  function addMedia(field: MediaField, file: File) {
    return perform(async () => {
      if (field === "video") {
        const blob = await upload("campaigns/campaign.mp4", file, {
          access: "public",
          contentType: file.type || "video/mp4",
          handleUploadUrl: "/api/admin/campaigns/video-upload",
        });
        update(field, blob.url);
      } else {
        const form = new FormData();
        form.append("file", file);
        const response = await fetch("/api/admin/upload", { method: "POST", body: form });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Falha ao enviar a imagem.");
        update(field, result.url);
      }
      setNotice("Arquivo enviado. Salve o rascunho para vincular à campanha.");
    });
  }

  return (
    <div className="grid max-w-4xl gap-4">
      <Card title="Informações">
        <fieldset className="grid gap-3" disabled={busy}>
          <Field label="Título"><Input value={data.title} maxLength={160} onChange={(e) => update("title", e.target.value)} /></Field>
          <Field label="Frase de destaque"><Input value={data.highlight} maxLength={250} onChange={(e) => update("highlight", e.target.value)} /></Field>
          <Field label="Descrição"><Textarea rows={4} value={data.description} maxLength={3000} onChange={(e) => update("description", e.target.value)} /></Field>
          <Field label="Endereço da campanha"><Input value={slug} maxLength={80} disabled={Boolean(saved)} onChange={(e) => setSlug(e.target.value)} /></Field>
        </fieldset>
      </Card>
      <Card title="Fotos e mídia">
        <fieldset className="grid gap-3" disabled={busy}>
          {([
            ["cover", "Imagem de capa", "image/jpeg,image/png,image/webp,image/avif"],
            ["background", "Imagem de fundo opcional", "image/jpeg,image/png,image/webp,image/avif"],
            ["video", "Vídeo MP4", "video/mp4"],
          ] as const).map(([field, label, accept]) => (
            <div key={field}>
              <Field label={label}><Input type="file" accept={accept} onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void addMedia(field, file);
              }} /></Field>
              {data[field] && <div className="mt-1 flex items-center gap-3">
                <a className="underline" href={data[field]} target="_blank" rel="noreferrer">Abrir arquivo</a>
                <Btn onClick={() => update(field, "")}>Retirar</Btn>
              </div>}
            </div>
          ))}
        </fieldset>
      </Card>
      <Card title="Contatos">
        <fieldset className="grid gap-3" disabled={busy}>
          <Field label="Site"><Input type="url" value={data.website} onChange={(e) => update("website", e.target.value)} /></Field>
          <Field label="E-mail comercial"><Input type="email" value={data.email} onChange={(e) => update("email", e.target.value)} /></Field>
          <Field label="WhatsApp com 55 e DDD"><Input inputMode="tel" value={data.whatsapp} onChange={(e) => update("whatsapp", e.target.value.replace(/\D/g, ""))} /></Field>
        </fieldset>
      </Card>
      <Card title="Publicação">
        <div className="flex flex-wrap gap-2">
          <Btn disabled={busy} onClick={() => void save(false)}>Salvar rascunho</Btn>
          <Btn disabled={busy} onClick={() => setPreview(!preview)}>{preview ? "Fechar prévia" : "Ver prévia"}</Btn>
          <Btn disabled={busy} onClick={() => void save(true)}>{saved?.published ? "Atualizar no site" : "Publicar no site"}</Btn>
          {saved?.published && <Btn disabled={busy} onClick={() => void perform(async () => {
            await client.adminCampaigns.unpublish({ slug });
            await refresh();
            setNotice("Campanha retirada do site. O rascunho está salvo.");
          })}>Retirar do site</Btn>}
        </div>
        {saved?.published && <a className="mt-3 block underline" href={url} target="_blank" rel="noreferrer">Abrir página publicada</a>}
        <div className="mt-4">
          <Field label="Legenda para publicação manual nas redes"><Textarea rows={5} readOnly value={caption} /></Field>
          <Btn disabled={busy} onClick={() => void perform(async () => {
            await navigator.clipboard.writeText(caption);
            setNotice("Legenda copiada.");
          })}>Copiar legenda</Btn>
        </div>
      </Card>
      {busy && <p role="status">Processando…</p>}
      {notice && <p role="status">{notice}</p>}
      {error && <ErrorNote message={error} />}
      {preview && <CampaignView data={data} />}
    </div>
  );
}

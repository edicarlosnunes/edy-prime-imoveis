import { useRef, useState } from "react";
import { ImagePlus, Images, Loader2, Trash2, X } from "lucide-react";
import { Btn, ErrorNote, Field, Input, Modal } from "../ui";
import { errorMessage, uploadImage } from "../../../lib/admin-session";
import { useMediaLibrary, useRemoveMedia, useUpdateMedia } from "../../../queries/admin-site";

function kb(size: number | null | undefined) {
  if (!size) return "—";
  if (size > 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.round(size / 1024)} KB`;
}

/** Biblioteca de imagens: escolher, enviar, renomear e excluir. */
export function MediaLibrary({
  onPick,
  onClose,
  open,
}: {
  onPick?: (url: string) => void;
  onClose: () => void;
  open: boolean;
}) {
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const media = useMediaLibrary(search);
  const removeMedia = useRemoveMedia();
  const updateMedia = useUpdateMedia();

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    setBusy(true);
    try {
      let last = "";
      for (const file of Array.from(files)) last = await uploadImage(file);
      await media.refetch();
      if (last && onPick) onPick(last);
    } catch (cause) {
      setError(errorMessage(cause, "Falha ao enviar a imagem"));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      await removeMedia.mutateAsync({ id });
    } catch (cause) {
      setError(errorMessage(cause, "Não foi possível excluir"));
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Imagens e mídia" wide>
      <div className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Buscar" className="min-w-48 flex-1">
            <Input
              value={search}
              placeholder="nome do arquivo"
              onChange={(event) => setSearch(event.target.value)}
            />
          </Field>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif"
            multiple
            hidden
            onChange={(event) => upload(event.target.files)}
          />
          <Btn tone="brass" disabled={busy} onClick={() => inputRef.current?.click()}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
            Enviar imagem
          </Btn>
        </div>

        <ErrorNote message={error} />

        {media.isLoading && <p className="text-sm text-muted">Carregando…</p>}

        <div className="grid max-h-[60vh] gap-4 overflow-y-auto sm:grid-cols-3 lg:grid-cols-4">
          {media.data?.map((item) => {
            const used = item.usedInProperties || item.usedInSite;
            return (
              <div key={item.id} className="rounded-[3px] border border-line bg-white p-2">
                <button
                  type="button"
                  onClick={() => onPick?.(item.url)}
                  className="block w-full overflow-hidden rounded-[2px] border border-line"
                  title={onPick ? "Usar esta imagem" : undefined}
                >
                  <img src={item.url} alt={item.alt ?? ""} className="aspect-[4/3] w-full object-cover" />
                </button>
                <input
                  value={item.name ?? ""}
                  placeholder="nome"
                  onChange={(event) =>
                    updateMedia.mutate({ id: item.id, name: event.target.value })
                  }
                  className="mt-2 w-full truncate border-none bg-transparent text-[11px] text-ink outline-none"
                />
                <div className="mt-1 flex items-center justify-between gap-2">
                  <span className="text-[10px] text-muted">
                    {kb(item.size)}
                    {used ? " · em uso" : ""}
                  </span>
                  <button
                    type="button"
                    aria-label="Excluir imagem"
                    onClick={() => remove(item.id)}
                    className="rounded-[3px] p-1 text-red-600 hover:bg-red-50"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {media.data?.length === 0 && !media.isLoading && (
          <p className="text-sm text-muted">Nenhuma imagem enviada ainda.</p>
        )}
      </div>
    </Modal>
  );
}

/** Campo de imagem: pré-visualização + upload + biblioteca + remover. */
export function ImagePicker({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  onChange: (url: string) => void;
  hint?: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function upload(file: File | undefined) {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      onChange(await uploadImage(file));
    } catch (cause) {
      setError(errorMessage(cause, "Falha ao enviar a imagem"));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div>
      <span className="label-xs text-muted">{label}</span>
      <div className="mt-1.5 flex flex-wrap items-start gap-3">
        <div className="relative h-20 w-28 shrink-0 overflow-hidden rounded-[3px] border border-line bg-bone/50">
          {value ? (
            <>
              <img src={value} alt="" className="h-full w-full object-cover" />
              <button
                type="button"
                aria-label="Remover imagem"
                onClick={() => onChange("")}
                className="absolute top-1 right-1 rounded-full bg-ink/70 p-1 text-white hover:bg-ink"
              >
                <X className="h-3 w-3" />
              </button>
            </>
          ) : (
            <span className="flex h-full items-center justify-center text-[10px] text-muted">
              sem imagem
            </span>
          )}
        </div>
        <div className="flex min-w-48 flex-1 flex-col gap-2">
          <Input
            value={value}
            placeholder="URL da imagem"
            onChange={(event) => onChange(event.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/avif"
              hidden
              onChange={(event) => upload(event.target.files?.[0])}
            />
            <Btn tone="outline" disabled={busy} onClick={() => inputRef.current?.click()}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
              Enviar
            </Btn>
            <Btn tone="outline" onClick={() => setOpen(true)}>
              <Images className="h-3.5 w-3.5" /> Biblioteca
            </Btn>
          </div>
          {hint && <p className="text-[11px] text-muted">{hint}</p>}
          <ErrorNote message={error} />
        </div>
      </div>

      <MediaLibrary
        open={open}
        onClose={() => setOpen(false)}
        onPick={(url) => {
          onChange(url);
          setOpen(false);
        }}
      />
    </div>
  );
}

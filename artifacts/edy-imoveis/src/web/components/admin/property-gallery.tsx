/**
 * Galeria de fotos do cadastro de imóveis.
 *
 * Só apresentação e reordenação — o upload continua sendo feito pelo
 * formulário (`uploadImage`). Cada item carrega `originalUrl` intacto para que
 * a foto sem marca d'água nunca se perca ao salvar.
 */
import { ArrowLeft, ArrowRight, Camera, Star, Trash2, Upload } from "lucide-react";
import { Btn } from "./ui";

export interface GalleryImage {
  url: string;
  /** foto sem marca d'água — carregada do banco e devolvida sem alteração */
  originalUrl?: string | null;
  isPrimary?: boolean;
}

export function PropertyGallery({
  images,
  uploading,
  onPick,
  onMove,
  onSetPrimary,
  onRemove,
}: {
  images: GalleryImage[];
  uploading: boolean;
  onPick: (files: FileList | null) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  onSetPrimary: (index: number) => void;
  onRemove: (index: number) => void;
}) {
  const primaryIndex = images.findIndex((image) => image.isPrimary);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-line bg-white px-4 py-3">
        <div className="flex items-center gap-2 text-sm text-deep">
          <Camera className="h-4 w-4 text-brass" />
          <span className="font-medium">
            {images.length === 0
              ? "Nenhuma foto"
              : `${images.length} ${images.length === 1 ? "foto" : "fotos"}`}
          </span>
          {images.length > 0 && (
            <span className="text-[11px] text-muted">
              · capa: {primaryIndex >= 0 ? `foto ${primaryIndex + 1}` : "primeira da lista"}
            </span>
          )}
        </div>

        <label className="inline-flex cursor-pointer items-center gap-2 rounded-[3px] border border-line bg-white px-4 py-2.5 text-xs tracking-wide uppercase hover:bg-bone/50">
          <Upload className="h-3.5 w-3.5" />
          {uploading ? "Enviando…" : "Adicionar fotos"}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif"
            multiple
            className="hidden"
            onChange={(event) => {
              onPick(event.target.files);
              event.target.value = "";
            }}
          />
        </label>
      </div>

      {images.length === 0 ? (
        <div className="rounded-[10px] border border-dashed border-line px-6 py-12 text-center">
          <Camera className="mx-auto h-6 w-6 text-muted" />
          <p className="mt-3 text-sm text-deep">Este imóvel ainda não tem fotos</p>
          <p className="mt-1 text-[11px] text-muted">
            A primeira foto enviada vira a capa automaticamente. Você pode trocar a capa e a ordem
            depois.
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {images.map((image, index) => (
            <li
              key={`${image.url}-${index}`}
              className="overflow-hidden rounded-[10px] border border-line bg-white"
            >
              <div className="relative aspect-[4/3] bg-bone">
                <img src={image.url} alt="" className="h-full w-full object-cover" />
                <span className="absolute top-1.5 right-1.5 rounded-full bg-ink/70 px-2 py-0.5 text-[10px] text-white">
                  {index + 1}
                </span>
                {image.isPrimary && (
                  <span className="absolute top-1.5 left-1.5 rounded-full bg-brass px-2 py-0.5 text-[10px] font-medium tracking-wide text-white uppercase">
                    capa
                  </span>
                )}
              </div>

              <div className="flex items-center justify-between gap-1 border-t border-line px-2 py-2">
                <button
                  type="button"
                  onClick={() => onMove(index, -1)}
                  disabled={index === 0}
                  aria-label="Mover para trás"
                  className="rounded p-1 disabled:opacity-30"
                >
                  <ArrowLeft className="h-3.5 w-3.5 text-muted hover:text-deep" />
                </button>
                <button
                  type="button"
                  onClick={() => onSetPrimary(index)}
                  aria-label="Definir como capa"
                  title="Definir como capa"
                  className="rounded p-1"
                >
                  <Star
                    className={
                      image.isPrimary ? "h-3.5 w-3.5 text-brass" : "h-3.5 w-3.5 text-muted"
                    }
                  />
                </button>
                <button
                  type="button"
                  onClick={() => onRemove(index)}
                  aria-label="Remover foto"
                  title="Remover foto"
                  className="rounded p-1"
                >
                  <Trash2 className="h-3.5 w-3.5 text-red-500" />
                </button>
                <button
                  type="button"
                  onClick={() => onMove(index, 1)}
                  disabled={index === images.length - 1}
                  aria-label="Mover para frente"
                  className="rounded p-1 disabled:opacity-30"
                >
                  <ArrowRight className="h-3.5 w-3.5 text-muted hover:text-deep" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {images.length > 0 && (
        <div className="flex justify-end">
          <Btn tone="ghost" className="pointer-events-none opacity-70">
            Ordem das setas = ordem no site
          </Btn>
        </div>
      )}
    </div>
  );
}

import { useRef, useState } from "react";
import { Droplets, ImageUp, RotateCcw } from "lucide-react";
import { AdminGuard } from "../../components/admin/guard";
import { AdminLayout } from "../../components/admin/layout";
import {
  Btn,
  Card,
  Empty,
  ErrorNote,
  Field,
  Input,
  Select,
  Stat,
} from "../../components/admin/ui";
import { errorMessage, uploadBlob, uploadImage } from "../../lib/admin-session";
import { composeWatermark } from "../../lib/watermark";
import {
  useApplyWatermarkResult,
  useRestoreOriginal,
  useSaveWatermark,
  useWatermark,
  useWatermarkQueue,
} from "../../queries/integrations";

const POSITIONS = [
  { value: "bottom-right", label: "Inferior direito" },
  { value: "bottom-left", label: "Inferior esquerdo" },
  { value: "bottom-center", label: "Inferior centro" },
  { value: "center", label: "Centro" },
  { value: "top-right", label: "Superior direito" },
  { value: "top-left", label: "Superior esquerdo" },
  { value: "top-center", label: "Superior centro" },
] as const;

type Position = (typeof POSITIONS)[number]["value"];

function WatermarkPage() {
  const query = useWatermark();
  const save = useSaveWatermark();
  const queue = useWatermarkQueue();
  const apply = useApplyWatermarkResult();
  const restore = useRestoreOriginal();
  const fileInput = useRef<HTMLInputElement>(null);

  const settings = query.data?.settings;
  const [form, setForm] = useState<{
    enabled: boolean;
    logoUrl: string;
    size: number;
    opacity: number;
    margin: number;
    position: Position;
    applyToNewUploads: boolean;
  } | null>(null);

  const state = form ?? {
    enabled: settings?.enabled ?? false,
    logoUrl: settings?.logoUrl ?? "",
    size: settings?.size ?? 22,
    opacity: settings?.opacity ?? 70,
    margin: settings?.margin ?? 4,
    position: (settings?.position ?? "bottom-right") as Position,
    applyToNewUploads: settings?.applyToNewUploads ?? true,
  };

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  async function guard(action: () => Promise<string | void>) {
    setError(null);
    setNotice(null);
    try {
      const message = await action();
      if (message) setNotice(message);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  /** Processa a fila: lê a ORIGINAL, compõe no navegador, sobe a derivada. */
  async function processQueue(mode: "faltantes" | "todas") {
    setError(null);
    setNotice(null);
    if (!state.logoUrl) {
      setError("Envie o logo antes de aplicar a marca d'água.");
      return;
    }
    try {
      const result = await queue.mutateAsync({ mode, limit: 20 });
      if (result.pending.length === 0) {
        setNotice("Nenhuma foto pendente.");
        return;
      }
      let done = 0;
      for (const item of result.pending) {
        setProgress(`Processando ${done + 1} de ${result.pending.length}…`);
        const blob = await composeWatermark(item.sourceUrl, {
          logoUrl: state.logoUrl,
          size: state.size,
          opacity: state.opacity,
          margin: state.margin,
          position: state.position,
        });
        const originalId = item.sourceUrl.split("/").pop() ?? "";
        const url = await uploadBlob(blob, "foto-marcada.jpg", {
          variant: "watermarked",
          originalId,
        });
        await apply.mutateAsync({
          imageId: item.imageId,
          watermarkedUrl: url,
          originalUrl: item.sourceUrl,
        });
        done += 1;
      }
      setProgress(null);
      setNotice(
        `${done} foto(s) processada(s). As originais continuam guardadas e podem ser restauradas.`,
      );
      await query.refetch();
    } catch (caught) {
      setProgress(null);
      setError(errorMessage(caught));
    }
  }

  return (
    <AdminLayout
      title="Marca d'água"
      subtitle="A foto original nunca é alterada — a versão com marca é um arquivo novo."
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Fotos cadastradas" value={query.data?.stats.totalImages ?? "—"} />
        <Stat label="Com marca" value={query.data?.stats.withWatermark ?? "—"} />
        <Stat label="Sem marca" value={query.data?.stats.withoutWatermark ?? "—"} />
      </div>

      <ErrorNote message={error} />
      {notice && (
        <p className="mt-3 rounded-[3px] border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          {notice}
        </p>
      )}
      {progress && (
        <p className="mt-3 rounded-[3px] border border-line bg-bone/40 px-3 py-2 text-xs text-ink">
          {progress}
        </p>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card title="Configuração">
          <div className="space-y-4">
            <Field label="Logo da marca d'água" hint="PNG com fundo transparente funciona melhor.">
              <div className="flex flex-wrap items-center gap-3">
                {state.logoUrl && (
                  <img
                    src={state.logoUrl}
                    alt="Logo da marca d'água"
                    className="h-12 w-auto rounded-[3px] border border-line bg-bone/40 p-1"
                  />
                )}
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/png,image/webp,image/jpeg"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    void guard(async () => {
                      const url = await uploadImage(file);
                      setForm({ ...state, logoUrl: url });
                      return "Logo enviado.";
                    });
                  }}
                />
                <Btn tone="outline" onClick={() => fileInput.current?.click()}>
                  <ImageUp className="h-3.5 w-3.5" /> Enviar logo
                </Btn>
              </div>
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Posição">
                <Select
                  value={state.position}
                  onChange={(event) =>
                    setForm({ ...state, position: event.target.value as Position })
                  }
                >
                  {POSITIONS.map((position) => (
                    <option key={position.value} value={position.value}>
                      {position.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Tamanho (% da largura)">
                <Input
                  type="number"
                  min={5}
                  max={60}
                  value={state.size}
                  onChange={(event) =>
                    setForm({ ...state, size: Number(event.target.value) || 22 })
                  }
                />
              </Field>
              <Field label="Opacidade (%)">
                <Input
                  type="number"
                  min={10}
                  max={100}
                  value={state.opacity}
                  onChange={(event) =>
                    setForm({ ...state, opacity: Number(event.target.value) || 70 })
                  }
                />
              </Field>
              <Field label="Margem (% da largura)">
                <Input
                  type="number"
                  min={0}
                  max={20}
                  value={state.margin}
                  onChange={(event) =>
                    setForm({ ...state, margin: Number(event.target.value) || 0 })
                  }
                />
              </Field>
            </div>

            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={state.applyToNewUploads}
                onChange={(event) => setForm({ ...state, applyToNewUploads: event.target.checked })}
              />
              Aplicar automaticamente nas próximas fotos enviadas
            </label>

            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={state.enabled}
                onChange={(event) => setForm({ ...state, enabled: event.target.checked })}
              />
              Marca d'água ativa
            </label>

            <Btn
              disabled={save.isPending}
              onClick={() =>
                guard(async () => {
                  await save.mutateAsync({
                    enabled: state.enabled,
                    logoUrl: state.logoUrl || null,
                    size: state.size,
                    opacity: state.opacity,
                    margin: state.margin,
                    position: state.position,
                    applyToNewUploads: state.applyToNewUploads,
                  });
                  return "Configuração salva.";
                })
              }
            >
              Salvar configuração
            </Btn>
          </div>
        </Card>

        <div className="space-y-4">
          <Card title="Aplicar nas fotos já cadastradas">
            <p className="text-xs leading-relaxed text-muted">
              O processamento acontece aqui no navegador, em lotes de 20 fotos. A foto original é
              sempre a fonte — nunca aplicamos marca sobre uma foto já marcada.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Btn
                tone="brass"
                disabled={queue.isPending || Boolean(progress)}
                onClick={() => void processQueue("faltantes")}
              >
                <Droplets className="h-3.5 w-3.5" /> Aplicar nas que faltam
              </Btn>
              <Btn
                tone="outline"
                disabled={queue.isPending || Boolean(progress)}
                onClick={() => void processQueue("todas")}
              >
                <RotateCcw className="h-3.5 w-3.5" /> Regerar todas a partir da original
              </Btn>
            </div>
          </Card>

          <Card title="Como a original é protegida">
            {query.isLoading ? (
              <Empty>Carregando…</Empty>
            ) : (
              <ul className="space-y-2 text-xs leading-relaxed text-muted">
                <li>• A foto enviada fica guardada como “original” e nunca é sobrescrita.</li>
                <li>• A versão com marca entra como arquivo novo, ligado à original.</li>
                <li>
                  • É possível restaurar a original de uma foto ou de um imóvel inteiro a qualquer
                  momento, e desligar a marca d'água só para um imóvel na aba de publicação.
                </li>
                <li>• Cada canal/portal escolhe se recebe a original ou a versão com marca.</li>
              </ul>
            )}
            <Btn
              tone="outline"
              className="mt-3"
              disabled={restore.isPending}
              onClick={() =>
                guard(async () => {
                  const id = window.prompt("ID da foto para restaurar a original:");
                  const parsed = Number(id);
                  if (!parsed) return;
                  const result = await restore.mutateAsync({ imageId: parsed });
                  return result.message ?? "Original restaurada.";
                })
              }
            >
              Restaurar original de uma foto
            </Btn>
          </Card>
        </div>
      </div>
    </AdminLayout>
  );
}

export default function AdminWatermark() {
  return (
    <AdminGuard>
      <WatermarkPage />
    </AdminGuard>
  );
}

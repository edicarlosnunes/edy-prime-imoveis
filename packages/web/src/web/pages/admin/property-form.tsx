import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Sparkles, Star, Trash2, Upload } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { orpc } from "../../lib/api";
import { Btn, ErrorNote, Field, Input, Modal, Select, Textarea } from "../../components/admin/ui";
import {
  propertyStatusLabel,
  propertyStatuses,
  propertyTypeLabel,
  propertyTypes,
  purposeLabel,
  purposes,
} from "../../components/admin/labels";
import { errorMessage, uploadImage } from "../../lib/admin-session";
import {
  useGeneratePropertyContent,
  useOwnerOptions,
  useSaveProperty,
} from "../../queries/admin";
import { FeaturesPicker } from "../../components/admin/features-picker";
import {
  PropertyAiPanel,
  type GeneratedContent,
  type GeneratedField,
} from "./property-ai-panel";

interface ImageItem {
  url: string;
  isPrimary?: boolean;
}

interface FormState {
  code: string;
  title: string;
  purpose: (typeof purposes)[number];
  type: (typeof propertyTypes)[number];
  price: string;
  condoFee: string;
  iptu: string;
  district: string;
  city: string;
  address: string;
  bedrooms: string;
  suites: string;
  bathrooms: string;
  parking: string;
  areaUtil: string;
  areaTotal: string;
  description: string;
  highlight: string;
  features: string[];
  status: (typeof propertyStatuses)[number];
  published: boolean;
  featured: boolean;
  ownerId: string;
}

const empty: FormState = {
  code: "",
  title: "",
  purpose: "venda",
  type: "apartamento",
  price: "",
  condoFee: "",
  iptu: "",
  district: "",
  city: "Praia Grande",
  address: "",
  bedrooms: "0",
  suites: "0",
  bathrooms: "0",
  parking: "0",
  areaUtil: "0",
  areaTotal: "",
  description: "",
  highlight: "",
  features: [],
  status: "disponivel",
  published: true,
  featured: false,
  ownerId: "",
};

function num(value: string) {
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function optionalNum(value: string) {
  if (!value.trim()) return null;
  return num(value);
}

export function PropertyForm({
  propertyId,
  onClose,
}: {
  propertyId: number | null;
  onClose: () => void;
}) {
  const [form, setForm] = useState<FormState>(empty);
  const [images, setImages] = useState<ImageItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiContent, setAiContent] = useState<GeneratedContent | null>(null);
  const [aiUsedFields, setAiUsedFields] = useState<string[]>([]);

  const generate = useGeneratePropertyContent();
  const owners = useOwnerOptions();
  const save = useSaveProperty(propertyId ? "update" : "create");

  const detail = useQuery({
    ...orpc.adminProperties.get.queryOptions({ input: { id: propertyId ?? 0 } }),
    enabled: propertyId !== null,
  });

  useEffect(() => {
    const row = detail.data;
    if (!row) return;
    let features: string[] = [];
    try {
      features = row.features ? (JSON.parse(row.features) as string[]) : [];
    } catch {
      features = [];
    }
    setForm({
      code: row.code,
      title: row.title,
      purpose: row.purpose as FormState["purpose"],
      type: row.type as FormState["type"],
      price: String(row.price ?? ""),
      condoFee: row.condoFee === null ? "" : String(row.condoFee),
      iptu: row.iptu === null ? "" : String(row.iptu),
      district: row.district,
      city: row.city,
      address: row.address ?? "",
      bedrooms: String(row.bedrooms),
      suites: String(row.suites),
      bathrooms: String(row.bathrooms),
      parking: String(row.parking),
      areaUtil: String(row.areaUtil),
      areaTotal: row.areaTotal === null ? "" : String(row.areaTotal),
      description: row.description ?? "",
      highlight: row.highlight ?? "",
      features,
      status: row.status as FormState["status"],
      published: row.published === 1,
      featured: row.featured === 1,
      ownerId: row.ownerId ? String(row.ownerId) : "",
    });
    setImages(
      row.images.map((image) => ({ url: image.url, isPrimary: image.isPrimary === 1 })),
    );
  }, [detail.data]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function pickFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      const uploaded: ImageItem[] = [];
      for (const file of Array.from(fileList)) {
        const url = await uploadImage(file);
        uploaded.push({ url });
      }
      setImages((current) => {
        const next = [...current, ...uploaded];
        if (!next.some((image) => image.isPrimary) && next[0]) next[0].isPrimary = true;
        return next;
      });
    } catch (caught) {
      setError(errorMessage(caught, "Falha no upload"));
    } finally {
      setUploading(false);
    }
  }

  function move(index: number, direction: -1 | 1) {
    setImages((current) => {
      const next = [...current];
      const target = index + direction;
      if (target < 0 || target >= next.length) return current;
      const a = next[index];
      const b = next[target];
      if (!a || !b) return current;
      next[index] = b;
      next[target] = a;
      return next;
    });
  }

  function setPrimary(index: number) {
    setImages((current) => current.map((image, i) => ({ ...image, isPrimary: i === index })));
  }

  function removeImage(index: number) {
    setImages((current) => {
      const next = current.filter((_, i) => i !== index);
      if (!next.some((image) => image.isPrimary) && next[0]) next[0].isPrimary = true;
      return next;
    });
  }

  /** Chama a IA com os dados que estão no formulário. Nada é salvo aqui. */
  async function runGenerate() {
    setAiError(null);
    setAiContent(null);
    setAiOpen(true);
    try {
      const result = await generate.mutateAsync({
        purpose: form.purpose,
        type: form.type,
        price: optionalNum(form.price),
        condoFee: optionalNum(form.condoFee),
        iptu: optionalNum(form.iptu),
        district: form.district.trim(),
        city: form.city.trim(),
        bedrooms: Math.trunc(num(form.bedrooms)),
        suites: Math.trunc(num(form.suites)),
        bathrooms: Math.trunc(num(form.bathrooms)),
        parking: Math.trunc(num(form.parking)),
        areaUtil: num(form.areaUtil),
        areaTotal: optionalNum(form.areaTotal),
        features: form.features.map((item) => item.trim()).filter((item) => item.length > 0),
        title: form.title.trim(),
      });
      setAiContent(result.content);
      setAiUsedFields(result.usedFields);
    } catch (caught) {
      setAiError(errorMessage(caught, "Não foi possível gerar o conteúdo"));
    }
  }

  /** Aplica um bloco no campo correspondente — só com clique do administrador. */
  function applyField(field: GeneratedField, value: string) {
    if (field === "title") set("title", value);
    if (field === "highlight") set("highlight", value);
    if (field === "description") set("description", value);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const payload = {
      code: form.code.trim(),
      title: form.title.trim(),
      purpose: form.purpose,
      type: form.type,
      price: num(form.price),
      condoFee: optionalNum(form.condoFee),
      iptu: optionalNum(form.iptu),
      district: form.district.trim(),
      city: form.city.trim() || "Praia Grande",
      address: form.address.trim() || null,
      bedrooms: Math.trunc(num(form.bedrooms)),
      suites: Math.trunc(num(form.suites)),
      bathrooms: Math.trunc(num(form.bathrooms)),
      parking: Math.trunc(num(form.parking)),
      areaUtil: num(form.areaUtil),
      areaTotal: optionalNum(form.areaTotal),
      description: form.description.trim() || null,
      highlight: form.highlight.trim() || null,
      features: form.features.map((item) => item.trim()).filter((item) => item.length > 0),
      status: form.status,
      published: form.published,
      featured: form.featured,
      ownerId: form.ownerId ? Number(form.ownerId) : null,
      images: images.map((image) => ({ url: image.url, isPrimary: image.isPrimary === true })),
    };

    try {
      if (propertyId) {
        await save.mutateAsync({ ...payload, id: propertyId });
      } else {
        await save.mutateAsync(payload);
      }
      onClose();
    } catch (caught) {
      setError(errorMessage(caught, "Não foi possível salvar o imóvel"));
    }
  }

  return (
    <Modal open onClose={onClose} wide title={propertyId ? "Editar imóvel" : "Novo imóvel"}>
      <form onSubmit={submit} className="space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Código">
            <Input value={form.code} onChange={(e) => set("code", e.target.value)} required placeholder="EP-1042" />
          </Field>
          <Field label="Finalidade">
            <Select value={form.purpose} onChange={(e) => set("purpose", e.target.value as FormState["purpose"])}>
              {purposes.map((value) => (
                <option key={value} value={value}>
                  {purposeLabel[value]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Tipo">
            <Select value={form.type} onChange={(e) => set("type", e.target.value as FormState["type"])}>
              {propertyTypes.map((value) => (
                <option key={value} value={value}>
                  {propertyTypeLabel[value]}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Título">
          <Input value={form.title} onChange={(e) => set("title", e.target.value)} required />
        </Field>

        <Field label="Frase de destaque (aparece no card do site)">
          <Input value={form.highlight} onChange={(e) => set("highlight", e.target.value)} />
        </Field>

        <div className="flex flex-wrap items-center gap-3 rounded-[10px] border border-brass/40 bg-brass/5 px-3 py-3">
          <Btn tone="brass" onClick={() => void runGenerate()} disabled={generate.isPending}>
            <Sparkles className="h-3.5 w-3.5" />
            {generate.isPending ? "Gerando…" : "Gerar conteúdo com IA"}
          </Btn>
          <p className="text-[11px] text-muted">
            Usa somente os dados já cadastrados deste imóvel. Você revisa antes de aplicar — nada é
            publicado automaticamente.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Preço (R$)">
            <Input value={form.price} onChange={(e) => set("price", e.target.value)} required inputMode="decimal" />
          </Field>
          <Field label="Condomínio (R$)">
            <Input value={form.condoFee} onChange={(e) => set("condoFee", e.target.value)} inputMode="decimal" />
          </Field>
          <Field label="IPTU (R$)">
            <Input value={form.iptu} onChange={(e) => set("iptu", e.target.value)} inputMode="decimal" />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Bairro">
            <Input value={form.district} onChange={(e) => set("district", e.target.value)} />
          </Field>
          <Field label="Cidade">
            <Input value={form.city} onChange={(e) => set("city", e.target.value)} />
          </Field>
          <Field label="Endereço (uso interno)">
            <Input value={form.address} onChange={(e) => set("address", e.target.value)} />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <Field label="Dormitórios">
            <Input value={form.bedrooms} onChange={(e) => set("bedrooms", e.target.value)} inputMode="numeric" />
          </Field>
          <Field label="Suítes">
            <Input value={form.suites} onChange={(e) => set("suites", e.target.value)} inputMode="numeric" />
          </Field>
          <Field label="Banheiros">
            <Input value={form.bathrooms} onChange={(e) => set("bathrooms", e.target.value)} inputMode="numeric" />
          </Field>
          <Field label="Vagas">
            <Input value={form.parking} onChange={(e) => set("parking", e.target.value)} inputMode="numeric" />
          </Field>
          <Field label="Área útil (m²)">
            <Input value={form.areaUtil} onChange={(e) => set("areaUtil", e.target.value)} inputMode="decimal" />
          </Field>
          <Field label="Área total (m²)">
            <Input value={form.areaTotal} onChange={(e) => set("areaTotal", e.target.value)} inputMode="decimal" />
          </Field>
        </div>

        <Field label="Descrição">
          <Textarea
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            className="min-h-32"
          />
        </Field>

        <div className="border-t border-line pt-4">
          <p className="label-xs text-muted">Características e diferenciais</p>
          <p className="mt-1 text-[11px] text-muted">
            Marque somente o que o imóvel realmente tem. Estes itens alimentam o site, os portais e
            a geração de conteúdo com IA.
          </p>
          <div className="mt-3">
            <FeaturesPicker
              value={form.features}
              onChange={(next) => set("features", next)}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Status">
            <Select value={form.status} onChange={(e) => set("status", e.target.value as FormState["status"])}>
              {propertyStatuses.map((value) => (
                <option key={value} value={value}>
                  {propertyStatusLabel[value]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Proprietário">
            <Select value={form.ownerId} onChange={(e) => set("ownerId", e.target.value)}>
              <option value="">Sem vínculo</option>
              {(owners.data ?? []).map((owner) => (
                <option key={owner.id} value={owner.id}>
                  {owner.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="flex flex-wrap gap-6">
          <label className="flex items-center gap-2 text-sm text-deep">
            <input
              type="checkbox"
              checked={form.published}
              onChange={(e) => set("published", e.target.checked)}
            />
            Publicado no site
          </label>
          <label className="flex items-center gap-2 text-sm text-deep">
            <input
              type="checkbox"
              checked={form.featured}
              onChange={(e) => set("featured", e.target.checked)}
            />
            Destaque na vitrine
          </label>
        </div>

        <div className="border-t border-line pt-4">
          <p className="label-xs text-muted">Galeria de fotos</p>
          <label className="mt-2 inline-flex cursor-pointer items-center gap-2 rounded-[3px] border border-line bg-white px-4 py-2.5 text-xs tracking-wide uppercase hover:bg-bone/50">
            <Upload className="h-3.5 w-3.5" />
            {uploading ? "Enviando…" : "Adicionar fotos"}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/avif"
              multiple
              className="hidden"
              onChange={(event) => {
                void pickFiles(event.target.files);
                event.target.value = "";
              }}
            />
          </label>

          {images.length > 0 && (
            <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {images.map((image, index) => (
                <li key={`${image.url}-${index}`} className="border border-line bg-white">
                  <div className="relative aspect-[4/3] bg-bone">
                    <img src={image.url} alt="" className="h-full w-full object-cover" />
                    {image.isPrimary && (
                      <span className="absolute top-1 left-1 bg-brass px-1.5 py-0.5 text-[10px] text-white">
                        principal
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-1 px-1.5 py-1.5">
                    <button type="button" onClick={() => move(index, -1)} aria-label="Mover para a esquerda">
                      <ArrowLeft className="h-3.5 w-3.5 text-muted hover:text-deep" />
                    </button>
                    <button type="button" onClick={() => setPrimary(index)} aria-label="Definir como principal">
                      <Star
                        className={image.isPrimary ? "h-3.5 w-3.5 text-brass" : "h-3.5 w-3.5 text-muted"}
                      />
                    </button>
                    <button type="button" onClick={() => removeImage(index)} aria-label="Remover foto">
                      <Trash2 className="h-3.5 w-3.5 text-red-500" />
                    </button>
                    <button type="button" onClick={() => move(index, 1)} aria-label="Mover para a direita">
                      <ArrowRight className="h-3.5 w-3.5 text-muted hover:text-deep" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <ErrorNote message={error} />

        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Btn tone="outline" onClick={onClose}>
            Cancelar
          </Btn>
          <Btn type="submit" tone="brass" disabled={save.isPending || uploading}>
            {save.isPending ? "Salvando…" : "Salvar imóvel"}
          </Btn>
        </div>
      </form>

      <PropertyAiPanel
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        loading={generate.isPending}
        error={aiError}
        content={aiContent}
        usedFields={aiUsedFields}
        onRegenerate={() => void runGenerate()}
        onApply={(field, value) => applyField(field, value)}
        onApplyAll={(content) => {
          set("title", content.title);
          set("highlight", content.highlight);
          set("description", content.description);
          setAiOpen(false);
        }}
      />
    </Modal>
  );
}

import { useEffect, useMemo, useState } from "react";
import {
  Banknote,
  Camera,
  FileText,
  Globe,
  MapPin,
  Ruler,
  Sparkles,
  User,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { orpc } from "../../lib/api";
import {
  Badge,
  Btn,
  CountInput,
  ErrorNote,
  Field,
  Input,
  Modal,
  MoneyInput,
  Select,
  Textarea,
} from "../../components/admin/ui";
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
  useAdminProperties,
  useGeneratePropertyContent,
  useOwnerOptions,
  useSaveProperty,
} from "../../queries/admin";
import { FeaturesPicker } from "../../components/admin/features-picker";
import {
  PropertyFormNav,
  type FormSection,
} from "../../components/admin/property-form-nav";
import { PropertyFormHeader } from "../../components/admin/property-form-header";
import {
  PropertyGallery,
  type GalleryImage,
} from "../../components/admin/property-gallery";
import { propertyProgress } from "../../lib/property-progress";
import { MoneyInputError, formatMoneyInput, parseMoneyInput } from "../../lib/money-input";
import {
  PropertyAiPanel,
  type GeneratedContent,
  type GeneratedField,
} from "./property-ai-panel";

const SECTIONS: readonly FormSection[] = [
  { id: "basico", label: "Informações básicas", short: "Básicas", icon: FileText },
  { id: "local", label: "Localização", short: "Local", icon: MapPin },
  { id: "caracteristicas", label: "Características", short: "Características", icon: Ruler },
  { id: "valores", label: "Valores", short: "Valores", icon: Banknote },
  { id: "proprietario", label: "Proprietário", short: "Proprietário", icon: User },
  { id: "descricao", label: "Descrição e diferenciais", short: "Descrição", icon: Sparkles },
  { id: "fotos", label: "Fotos e mídia", short: "Fotos", icon: Camera },
  { id: "publicacao", label: "Publicação", short: "Publicação", icon: Globe },
];

interface FormState {
  code: string;
  title: string;
  purpose: (typeof purposes)[number];
  type: (typeof propertyTypes)[number];
  /** texto em padrão BR — convertido com parseMoneyInput ao salvar */
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
  /** marca d'água desligada só neste imóvel */
  watermarkOff: boolean;
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
  watermarkOff: false,
};

function num(value: string) {
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function optionalNum(value: string) {
  if (!value.trim()) return null;
  return num(value);
}

/** Leitura tolerante para a IA: valor inválido não interrompe a geração. */
function softMoney(value: string) {
  try {
    return parseMoneyInput(value);
  } catch {
    return null;
  }
}

export function PropertyForm({
  propertyId,
  onClose,
}: {
  propertyId: number | null;
  onClose: () => void;
}) {
  const [form, setForm] = useState<FormState>(empty);
  const [images, setImages] = useState<GalleryImage[]>([]);
  const [section, setSection] = useState<string>("basico");
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiContent, setAiContent] = useState<GeneratedContent | null>(null);
  const [aiUsedFields, setAiUsedFields] = useState<string[]>([]);

  const generate = useGeneratePropertyContent();
  const owners = useOwnerOptions();
  const save = useSaveProperty(propertyId ? "update" : "create");
  const allProperties = useAdminProperties();

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
      price: formatMoneyInput(row.price),
      condoFee: row.condoFee === null ? "" : formatMoneyInput(row.condoFee),
      iptu: row.iptu === null ? "" : formatMoneyInput(row.iptu),
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
      watermarkOff: row.watermarkOff === 1,
    });
    setImages(
      row.images.map((image) => ({
        url: image.url,
        // preserva a foto sem marca d'água — o save reescreve a tabela inteira
        originalUrl: image.originalUrl ?? null,
        isPrimary: image.isPrimary === 1,
      })),
    );
  }, [detail.data]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  /** Bairros já usados na cidade selecionada — sugestão, nunca normalização. */
  const districtSuggestions = useMemo(() => {
    const city = form.city.trim().toLowerCase();
    const seen = new Set<string>();
    for (const row of allProperties.data ?? []) {
      if (city && row.city.trim().toLowerCase() !== city) continue;
      const value = row.district.trim();
      if (value) seen.add(value);
    }
    return [...seen].sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [allProperties.data, form.city]);

  const citySuggestions = useMemo(() => {
    const seen = new Set<string>();
    for (const row of allProperties.data ?? []) {
      const value = row.city.trim();
      if (value) seen.add(value);
    }
    return [...seen].sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [allProperties.data]);

  const progress = useMemo(
    () =>
      propertyProgress({
        code: form.code,
        title: form.title,
        city: form.city,
        district: form.district,
        price: form.price,
        bedrooms: form.bedrooms,
        bathrooms: form.bathrooms,
        areaUtil: form.areaUtil,
        description: form.description,
        highlight: form.highlight,
        features: form.features,
        ownerId: form.ownerId,
        imageCount: images.length,
      }),
    [form, images.length],
  );

  const pendingBySection = useMemo(() => {
    const map: Record<string, number> = {};
    for (const item of progress.missing) {
      map[item.section] = (map[item.section] ?? 0) + 1;
    }
    return map;
  }, [progress.missing]);

  const ownerName = owners.data?.find((owner) => String(owner.id) === form.ownerId)?.name ?? null;

  async function pickFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      const uploaded: GalleryImage[] = [];
      for (const file of Array.from(fileList)) {
        const url = await uploadImage(file);
        uploaded.push({ url, originalUrl: null });
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
        price: softMoney(form.price),
        condoFee: softMoney(form.condoFee),
        iptu: softMoney(form.iptu),
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

  /**
   * Como só a seção ativa fica montada, a validação nativa do HTML não alcança
   * os campos das outras seções. A checagem é feita aqui e leva o usuário até
   * a seção do problema.
   */
  function fail(target: string, message: string) {
    setSection(target);
    setError(message);
    return null;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (!form.code.trim()) return void fail("basico", "Informe o código do imóvel.");
    if (form.title.trim().length < 3) {
      return void fail("basico", "Informe um título com pelo menos 3 caracteres.");
    }

    let price: number | null;
    let condoFee: number | null;
    let iptu: number | null;
    try {
      price = parseMoneyInput(form.price, "Preço");
      condoFee = parseMoneyInput(form.condoFee, "Condomínio");
      iptu = parseMoneyInput(form.iptu, "IPTU");
    } catch (caught) {
      const message =
        caught instanceof MoneyInputError
          ? caught.message
          : errorMessage(caught, "Valor monetário inválido");
      return void fail("valores", message);
    }
    if (price === null) return void fail("valores", "Informe o preço do imóvel.");

    const payload = {
      code: form.code.trim(),
      title: form.title.trim(),
      purpose: form.purpose,
      type: form.type,
      price,
      condoFee,
      iptu,
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
      watermarkOff: form.watermarkOff,
      images: images.map((image) => ({
        url: image.url,
        originalUrl: image.originalUrl ?? null,
        isPrimary: image.isPrimary === true,
      })),
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

  const activeSection = SECTIONS.find((item) => item.id === section) ?? SECTIONS[0]!;

  return (
    <Modal
      open
      onClose={onClose}
      widthClass="max-w-6xl"
      bodyClass="px-4 py-4 sm:px-5 sm:py-5"
      title={propertyId ? "Editar imóvel" : "Novo imóvel"}
    >
      <form onSubmit={submit} className="space-y-4">
        <PropertyFormHeader
          isNew={propertyId === null}
          code={form.code}
          typeLabel={propertyTypeLabel[form.type] ?? ""}
          district={form.district}
          statusLabel={propertyStatusLabel[form.status] ?? ""}
          ownerLinked={form.ownerId !== ""}
          imageCount={images.length}
          percent={progress.percent}
        />

        <div className="lg:grid lg:grid-cols-[220px_1fr] lg:gap-5">
          <div className="lg:sticky lg:top-0 lg:self-start">
            <PropertyFormNav
              sections={SECTIONS}
              active={section}
              onSelect={setSection}
              pendingBySection={pendingBySection}
            />
          </div>

          <div className="min-w-0 rounded-[10px] border border-line bg-white p-4 sm:p-5">
            <h3 className="label-xs text-deep">{activeSection.label}</h3>
            <div className="mt-4 space-y-5">
              {section === "basico" && (
                <>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <Field label="Código">
                      <Input
                        value={form.code}
                        onChange={(e) => set("code", e.target.value)}
                        placeholder="EP-1042"
                      />
                    </Field>
                    <Field label="Finalidade">
                      <Select
                        value={form.purpose}
                        onChange={(e) => set("purpose", e.target.value as FormState["purpose"])}
                      >
                        {purposes.map((value) => (
                          <option key={value} value={value}>
                            {purposeLabel[value]}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Tipo">
                      <Select
                        value={form.type}
                        onChange={(e) => set("type", e.target.value as FormState["type"])}
                      >
                        {propertyTypes.map((value) => (
                          <option key={value} value={value}>
                            {propertyTypeLabel[value]}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  </div>

                  <Field label="Título">
                    <Input value={form.title} onChange={(e) => set("title", e.target.value)} />
                  </Field>

                  <Field
                    label="Frase de destaque"
                    hint="Aparece no card do imóvel dentro do site."
                  >
                    <Input
                      value={form.highlight}
                      onChange={(e) => set("highlight", e.target.value)}
                    />
                  </Field>

                  <p className="text-[11px] text-muted">
                    Status, publicação e destaque ficam na seção{" "}
                    <button
                      type="button"
                      className="text-brass underline underline-offset-2"
                      onClick={() => setSection("publicacao")}
                    >
                      Publicação
                    </button>
                    .
                  </p>
                </>
              )}

              {section === "local" && (
                <>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field label="Cidade">
                      <Input
                        value={form.city}
                        list="edy-city-options"
                        onChange={(e) => set("city", e.target.value)}
                      />
                      <datalist id="edy-city-options">
                        {citySuggestions.map((value) => (
                          <option key={value} value={value} />
                        ))}
                      </datalist>
                    </Field>
                    <Field
                      label="Bairro"
                      hint={
                        districtSuggestions.length > 0
                          ? "Sugestões vêm dos imóveis já cadastrados nesta cidade."
                          : undefined
                      }
                    >
                      <Input
                        value={form.district}
                        list="edy-district-options"
                        onChange={(e) => set("district", e.target.value)}
                      />
                      <datalist id="edy-district-options">
                        {districtSuggestions.map((value) => (
                          <option key={value} value={value} />
                        ))}
                      </datalist>
                    </Field>
                  </div>

                  <Field
                    label="Endereço"
                    hint="Uso interno. Não aparece no site nem nos portais."
                  >
                    <Input value={form.address} onChange={(e) => set("address", e.target.value)} />
                  </Field>
                </>
              )}

              {section === "caracteristicas" && (
                <>
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                    <Field label="Dormitórios">
                      <CountInput
                        label="dormitórios"
                        value={form.bedrooms}
                        onChange={(next) => set("bedrooms", next)}
                      />
                    </Field>
                    <Field label="Suítes">
                      <CountInput
                        label="suítes"
                        value={form.suites}
                        onChange={(next) => set("suites", next)}
                      />
                    </Field>
                    <Field label="Banheiros">
                      <CountInput
                        label="banheiros"
                        value={form.bathrooms}
                        onChange={(next) => set("bathrooms", next)}
                      />
                    </Field>
                    <Field label="Vagas">
                      <CountInput
                        label="vagas"
                        value={form.parking}
                        onChange={(next) => set("parking", next)}
                      />
                    </Field>
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field label="Área útil (m²)">
                      <Input
                        value={form.areaUtil}
                        onChange={(e) => set("areaUtil", e.target.value)}
                        inputMode="decimal"
                      />
                    </Field>
                    <Field label="Área total (m²)">
                      <Input
                        value={form.areaTotal}
                        onChange={(e) => set("areaTotal", e.target.value)}
                        inputMode="decimal"
                      />
                    </Field>
                  </div>
                </>
              )}

              {section === "valores" && (
                <>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <Field label="Preço">
                      <MoneyInput
                        value={form.price}
                        onChange={(next) => set("price", next)}
                        placeholder="320.000,00"
                      />
                    </Field>
                    <Field label="Condomínio">
                      <MoneyInput
                        value={form.condoFee}
                        onChange={(next) => set("condoFee", next)}
                        placeholder="0,00"
                      />
                    </Field>
                    <Field label="IPTU">
                      <MoneyInput
                        value={form.iptu}
                        onChange={(next) => set("iptu", next)}
                        placeholder="0,00"
                      />
                    </Field>
                  </div>
                  <p className="text-[11px] text-muted">
                    Digite como preferir — 320000, 320000,00 ou 320.000,00. O valor é formatado ao
                    sair do campo e enviado como número.
                  </p>
                </>
              )}

              {section === "proprietario" && (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={form.ownerId ? "green" : "amber"}>
                      {form.ownerId ? "Proprietário vinculado" : "Proprietário pendente"}
                    </Badge>
                    {ownerName && <span className="text-sm text-deep">{ownerName}</span>}
                  </div>

                  <Field
                    label="Proprietário"
                    hint="Somente proprietários já cadastrados. Nenhum registro novo é criado aqui."
                  >
                    <Select
                      value={form.ownerId}
                      onChange={(e) => set("ownerId", e.target.value)}
                    >
                      <option value="">Sem vínculo</option>
                      {(owners.data ?? []).map((owner) => (
                        <option key={owner.id} value={owner.id}>
                          {owner.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </>
              )}

              {section === "descricao" && (
                <>
                  <div className="flex flex-wrap items-center gap-3 rounded-[10px] border border-brass/40 bg-brass/5 px-3 py-3">
                    <Btn tone="brass" onClick={() => void runGenerate()} disabled={generate.isPending}>
                      <Sparkles className="h-3.5 w-3.5" />
                      {generate.isPending ? "Gerando…" : "Gerar conteúdo com IA"}
                    </Btn>
                    <p className="text-[11px] text-muted">
                      Usa somente os dados já cadastrados deste imóvel. Você revisa antes de
                      aplicar — nada é publicado automaticamente.
                    </p>
                  </div>

                  <Field label="Descrição">
                    <Textarea
                      value={form.description}
                      onChange={(e) => set("description", e.target.value)}
                      className="min-h-40"
                    />
                  </Field>

                  <div className="border-t border-line pt-4">
                    <p className="label-xs text-muted">Características e diferenciais</p>
                    <p className="mt-1 text-[11px] text-muted">
                      Marque somente o que o imóvel realmente tem. Estes itens alimentam o site, os
                      portais e a geração de conteúdo com IA.
                    </p>
                    <div className="mt-3">
                      <FeaturesPicker
                        value={form.features}
                        onChange={(next) => set("features", next)}
                      />
                    </div>
                  </div>
                </>
              )}

              {section === "fotos" && (
                <PropertyGallery
                  images={images}
                  uploading={uploading}
                  onPick={(files) => void pickFiles(files)}
                  onMove={move}
                  onSetPrimary={setPrimary}
                  onRemove={removeImage}
                />
              )}

              {section === "publicacao" && (
                <>
                  <Field label="Status">
                    <Select
                      value={form.status}
                      onChange={(e) => set("status", e.target.value as FormState["status"])}
                    >
                      {propertyStatuses.map((value) => (
                        <option key={value} value={value}>
                          {propertyStatusLabel[value]}
                        </option>
                      ))}
                    </Select>
                  </Field>

                  <div className="space-y-3 border-t border-line pt-4">
                    <label className="flex items-start gap-3 text-sm text-deep">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={form.published}
                        onChange={(e) => set("published", e.target.checked)}
                      />
                      <span>
                        Publicado no site
                        <span className="mt-0.5 block text-[11px] text-muted">
                          Desmarcado, o imóvel some do site e das buscas do agente de IA.
                        </span>
                      </span>
                    </label>

                    <label className="flex items-start gap-3 text-sm text-deep">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={form.featured}
                        onChange={(e) => set("featured", e.target.checked)}
                      />
                      <span>
                        Destaque na vitrine
                        <span className="mt-0.5 block text-[11px] text-muted">
                          Aparece no bloco de destaques da página inicial.
                        </span>
                      </span>
                    </label>

                    <label className="flex items-start gap-3 text-sm text-deep">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={form.watermarkOff}
                        onChange={(e) => set("watermarkOff", e.target.checked)}
                      />
                      <span>
                        Não aplicar marca d'água neste imóvel
                        <span className="mt-0.5 block text-[11px] text-muted">
                          Vale só para este cadastro. A configuração global da marca d'água não é
                          alterada.
                        </span>
                      </span>
                    </label>
                  </div>

                  <p className="border-t border-line pt-4 text-[11px] text-muted">
                    Envio para portais/XML continua sendo controlado na tela Portais.
                  </p>
                </>
              )}
            </div>
          </div>
        </div>

        <ErrorNote message={error} />

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          <p className="text-[11px] text-muted">
            {progress.missing.length === 0
              ? "Cadastro completo."
              : `Faltam: ${progress.missing.map((item) => item.label).join(", ")}.`}
          </p>
          <div className="flex gap-2">
            <Btn tone="outline" onClick={onClose}>
              Cancelar
            </Btn>
            <Btn type="submit" tone="brass" disabled={save.isPending || uploading}>
              {save.isPending ? "Salvando…" : "Salvar imóvel"}
            </Btn>
          </div>
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

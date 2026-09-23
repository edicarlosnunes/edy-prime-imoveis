import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { useLocation, useParams, useSearch } from "wouter";
import {
  Banknote,
  CalendarClock,
  Camera,
  FileText,
  Globe,
  MapPin,
  Ruler,
  ShieldCheck,
  Sparkles,
  User,
  Plus,
  Loader2,
  Check
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { orpc } from "../../lib/api";
import { AdminGuard } from "../../components/admin/guard";
import { AdminLayout } from "../../components/admin/layout";
import {
  Badge,
  Btn,
  CountInput,
  ErrorNote,
  Field,
  Input,
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
  useCapture,
  useGeneratePropertyContent,
  useMarkCaptureConverted,
  useOwnerOptions,
  useSaveProperty,
  useSaveOwner,
} from "../../queries/admin";
import {
  galleryFromOwnerPhotos,
  initConversion,
  planConversion,
  type ConversionState,
  readCaptureId,
} from "../../lib/capture-conversion-flow";
import { parseChecklist } from "../../../api/lib/capture-checklist";
import { checkConversionStart } from "../../../api/lib/capture-rules";
import { formatUnitAddress } from "../../../api/lib/capture-address";
import { parseComplements } from "../../../api/lib/capture-intake";
import { FeaturesPicker } from "../../components/admin/features-picker";
import { PropertyFormHeader } from "../../components/admin/property-form-header";
import { PropertyDocsSection } from "../../components/admin/property-docs-section";
import { PropertyRevalidationSection } from "../../components/admin/property-revalidation-section";
import {
  PropertyGallery,
  type GalleryImage,
} from "../../components/admin/property-gallery";
import { propertyProgress } from "../../lib/property-progress";
import { MoneyInputError, formatMoneyInput, parseMoneyInput } from "../../lib/money-input";
import { lookupCep } from "../../../api/lib/cep-lookup";
import {
  PropertyAiPanel,
  type GeneratedContent,
  type GeneratedField,
} from "./property-ai-panel";

interface FormState {
  code: string;
  title: string;
  purpose: (typeof purposes)[number];
  type: (typeof propertyTypes)[number];
  price: string;
  salePrice: string;
  rentPrice: string;
  condoFee: string;
  iptu: string;
  iptuPeriod: string;
  cep: string;
  state: string;
  city: string;
  district: string;
  address: string;
  street: string;
  number: string;
  complement: string;
  condominiumName: string;
  latitude: string;
  longitude: string;
  proximities: string[];
  bedrooms: string;
  suites: string;
  bathrooms: string;
  parking: string;
  kitchens: string;
  livingRooms: string;
  areaUtil: string;
  areaTotal: string;
  landArea: string;
  frontage: string;
  depth: string;
  hectares: string;
  floor: string;
  totalFloors: string;
  constructionYear: string;
  solarPosition: string;
  seaDistance: string;
  negotiationTerms: string;
  internalNotes: string;
  description: string;
  highlight: string;
  features: string[];
  status: (typeof propertyStatuses)[number];
  published: boolean;
  featured: boolean;
  ownerId: string;
  watermarkOff: boolean;
  youtubeUrl: string;
}

const empty: FormState = {
  code: "",
  title: "",
  purpose: "venda",
  type: "apartamento",
  price: "",
  salePrice: "",
  rentPrice: "",
  condoFee: "",
  iptu: "",
  iptuPeriod: "mensal",
  cep: "",
  state: "SP",
  city: "Praia Grande",
  district: "",
  address: "",
  street: "",
  number: "",
  complement: "",
  condominiumName: "",
  latitude: "",
  longitude: "",
  proximities: [],
  bedrooms: "0",
  suites: "0",
  bathrooms: "0",
  parking: "0",
  kitchens: "0",
  livingRooms: "0",
  areaUtil: "0",
  areaTotal: "",
  landArea: "",
  frontage: "",
  depth: "",
  hectares: "",
  floor: "",
  totalFloors: "",
  constructionYear: "",
  solarPosition: "",
  seaDistance: "",
  negotiationTerms: "",
  internalNotes: "",
  description: "",
  highlight: "",
  features: [],
  status: "disponivel",
  published: true,
  featured: false,
  ownerId: "",
  watermarkOff: false,
  youtubeUrl: "",
};

function num(value: string) {
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function optionalNum(value: string) {
  if (!value.trim()) return null;
  return num(value);
}

function softMoney(value: string) {
  try {
    return parseMoneyInput(value);
  } catch {
    return null;
  }
}

export default function PropertyFormPage() {
  return (
    <AdminGuard>
      <Content />
    </AdminGuard>
  );
}

function Content() {
  const [location, navigate] = useLocation();
  const params = useParams();
  const searchParams = useSearch();
  const captureId = readCaptureId(searchParams);
  
  const isNew = !params.id || params.id === "new";
  const propertyId = isNew ? null : Number(params.id);

  const [form, setForm] = useState<FormState>(empty);
  const [images, setImages] = useState<GalleryImage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiContent, setAiContent] = useState<GeneratedContent | null>(null);
  const [aiUsedFields, setAiUsedFields] = useState<string[]>([]);
  const [cepLoading, setCepLoading] = useState(false);

  // Owner inline creation state
  const [isCreatingOwner, setIsCreatingOwner] = useState(false);
  const [newOwnerName, setNewOwnerName] = useState("");
  const [newOwnerPhone, setNewOwnerPhone] = useState("");
  const [newOwnerDocument, setNewOwnerDocument] = useState("");
  const [newOwnerEmail, setNewOwnerEmail] = useState("");
  const saveOwner = useSaveOwner("create");

  const [ownerSearch, setOwnerSearch] = useState("");

  const capture = useCapture(captureId);
  const markConverted = useMarkCaptureConverted();
  const [conversion, setConversion] = useState<ConversionState>(() => initConversion(captureId));
  const [prefilled, setPrefilled] = useState(false);

  const captureBlock =
    captureId !== null && capture.data
      ? (() => {
          const check = checkConversionStart({
            stage: capture.data.stage,
            docStatus: capture.data.docStatus,
            estimatedPrice: capture.data.estimatedPrice,
            convertedPropertyId: capture.data.convertedPropertyId,
          });
          return check.ok ? null : check.message;
        })()
      : null;

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
    
    let proximities: string[] = [];
    try {
      proximities = (row as any).proximities ? JSON.parse((row as any).proximities) : [];
    } catch {
      proximities = [];
    }

    setForm({
      code: row.code,
      title: row.title,
      purpose: row.purpose as FormState["purpose"],
      type: row.type as FormState["type"],
      price: formatMoneyInput(row.price),
      salePrice: (row as any).salePrice !== null ? formatMoneyInput((row as any).salePrice) : "",
      rentPrice: (row as any).rentPrice !== null ? formatMoneyInput((row as any).rentPrice) : "",
      condoFee: row.condoFee === null ? "" : formatMoneyInput(row.condoFee),
      iptu: row.iptu === null ? "" : formatMoneyInput(row.iptu),
      iptuPeriod: (row as any).iptuPeriod ?? "mensal",
      cep: (row as any).cep ?? "",
      state: (row as any).state ?? "SP",
      city: row.city,
      district: row.district,
      address: row.address ?? "",
      street: (row as any).street ?? "",
      number: (row as any).number ?? "",
      complement: (row as any).complement ?? "",
      condominiumName: (row as any).condominiumName ?? "",
      latitude: (row as any).latitude ? String((row as any).latitude) : "",
      longitude: (row as any).longitude ? String((row as any).longitude) : "",
      proximities,
      bedrooms: String(row.bedrooms),
      suites: String(row.suites),
      bathrooms: String(row.bathrooms),
      parking: String(row.parking),
      kitchens: String((row as any).kitchens ?? 0),
      livingRooms: String((row as any).livingRooms ?? 0),
      areaUtil: String(row.areaUtil),
      areaTotal: row.areaTotal === null ? "" : String(row.areaTotal),
      landArea: (row as any).landArea === null || (row as any).landArea === undefined ? "" : String((row as any).landArea),
      frontage: (row as any).frontage === null || (row as any).frontage === undefined ? "" : String((row as any).frontage),
      depth: (row as any).depth === null || (row as any).depth === undefined ? "" : String((row as any).depth),
      hectares: (row as any).hectares === null || (row as any).hectares === undefined ? "" : String((row as any).hectares),
      floor: (row as any).floor ?? "",
      totalFloors: (row as any).totalFloors === null || (row as any).totalFloors === undefined ? "" : String((row as any).totalFloors),
      constructionYear: (row as any).constructionYear === null || (row as any).constructionYear === undefined ? "" : String((row as any).constructionYear),
      solarPosition: (row as any).solarPosition ?? "",
      seaDistance: (row as any).seaDistance === null || (row as any).seaDistance === undefined ? "" : String((row as any).seaDistance),
      negotiationTerms: (row as any).negotiationTerms ?? "",
      internalNotes: (row as any).internalNotes ?? "",
      description: row.description ?? "",
      highlight: row.highlight ?? "",
      features,
      status: row.status as FormState["status"],
      published: row.published === 1,
      featured: row.featured === 1,
      ownerId: row.ownerId ? String(row.ownerId) : "",
      watermarkOff: row.watermarkOff === 1,
      youtubeUrl: row.youtubeUrl ?? "",
    });
    setImages(
      row.images.map((image) => ({
        url: image.url,
        originalUrl: image.originalUrl ?? null,
        isPrimary: image.isPrimary === 1,
      })),
    );
  }, [detail.data]);

  useEffect(() => {
    if (propertyId !== null || captureId === null || prefilled) return;
    const row = capture.data;
    if (!row) return;
    setPrefilled(true);
    const price = row.estimatedPrice ?? row.askingPrice ?? null;
    setForm((current) => ({
      ...current,
      purpose: purposes.includes(row.intention as FormState["purpose"])
        ? (row.intention as FormState["purpose"])
        : current.purpose,
      type: propertyTypes.includes(row.propertyType as FormState["type"])
        ? (row.propertyType as FormState["type"])
        : current.type,
      price: current.price || (price === null ? "" : formatMoneyInput(price)),
      code: current.code || String(row.serial ?? "").trim(),
      cep: row.cep || current.cep,
      state: row.state || current.state,
      city: row.city || current.city,
      district: row.district || current.district,
      street: row.street || current.street,
      number: row.number || current.number,
      address:
        formatUnitAddress(
          {
            cep: row.cep,
            street: row.street,
            number: row.number,
            district: row.district,
            city: row.city,
            state: row.state,
          },
          parseComplements(row.complements),
        ) || (row.address ?? current.address),
      ownerId: row.ownerId ? String(row.ownerId) : current.ownerId,
      published: false,
    }));

    const inherited = galleryFromOwnerPhotos(row.ownerPhotos);
    if (inherited.length > 0) {
      setImages((current) => (current.length > 0 ? current : inherited));
    }
  }, [capture.data, captureId, prefilled, propertyId]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

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

  const ownerName = owners.data?.find((owner) => String(owner.id) === form.ownerId)?.name ?? null;

  const filteredOwners = useMemo(() => {
    if (!owners.data) return [];
    if (!ownerSearch.trim()) return owners.data;
    const term = ownerSearch.toLowerCase().trim();
    return owners.data.filter(
      (o) =>
        o.name.toLowerCase().includes(term) ||
        (o.phone && o.phone.toLowerCase().includes(term)) ||
        (o.email && o.email.toLowerCase().includes(term)) ||
        (o.document && o.document.toLowerCase().includes(term))
    );
  }, [owners.data, ownerSearch]);

  const progress = useMemo(
    () =>
      propertyProgress({
        code: form.code,
        title: form.title,
        city: form.city,
        district: form.district,
        price: form.price,
        salePrice: form.salePrice,
        rentPrice: form.rentPrice,
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

  async function handleCepLookup() {
    if (!form.cep || form.cep.replace(/\D/g, '').length !== 8) return;
    setCepLoading(true);
    try {
      const result = await lookupCep(form.cep);
      if (result.ok) {
        setForm(cur => ({
          ...cur,
          street: result.address.street || cur.street,
          district: result.address.district || cur.district,
          city: result.address.city || cur.city,
          state: result.address.state || cur.state,
        }));
      }
    } catch (e) {
      // Ignore
    } finally {
      setCepLoading(false);
    }
  }

  async function handleCreateOwner() {
    if (!newOwnerName.trim()) {
      setError("Informe o nome do proprietário.");
      return;
    }
    setError(null);
    try {
      const res = await saveOwner.mutateAsync({
        name: newOwnerName.trim(),
        phone: newOwnerPhone.trim() || null,
        document: newOwnerDocument.trim() || null,
        email: newOwnerEmail.trim() || null,
      });
      setForm(cur => ({ ...cur, ownerId: String(res.id) }));
      setIsCreatingOwner(false);
      setNewOwnerName("");
      setNewOwnerPhone("");
      setNewOwnerDocument("");
      setNewOwnerEmail("");
    } catch (caught) {
      setError(errorMessage(caught, "Não foi possível criar o proprietário"));
    }
  }

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

  function applyField(field: GeneratedField, value: string) {
    if (field === "title") set("title", value);
    if (field === "highlight") set("highlight", value);
    if (field === "description") set("description", value);
  }

  async function submit(event?: React.FormEvent) {
    if (event) event.preventDefault();
    setError(null);

    if (captureBlock) {
      setError(captureBlock);
      window.scrollTo(0, 0);
      return;
    }

    if (!form.code.trim()) {
      setError("Informe o código do imóvel.");
      window.scrollTo(0, 0);
      return;
    }
    if (form.title.trim().length < 3) {
      setError("Informe um título com pelo menos 3 caracteres.");
      window.scrollTo(0, 0);
      return;
    }

    let price: number | null;
    let salePrice: number | null = null;
    let rentPrice: number | null = null;
    let condoFee: number | null;
    let iptu: number | null;
    try {
      price = parseMoneyInput(form.price, "Preço");
      if (form.salePrice) salePrice = parseMoneyInput(form.salePrice, "Preço Venda");
      if (form.rentPrice) rentPrice = parseMoneyInput(form.rentPrice, "Preço Locação");
      condoFee = parseMoneyInput(form.condoFee, "Condomínio");
      iptu = parseMoneyInput(form.iptu, "IPTU");
    } catch (caught) {
      const message =
        caught instanceof MoneyInputError
          ? caught.message
          : errorMessage(caught, "Valor monetário inválido");
      setError(message);
      return;
    }
    if (price === null && salePrice === null && rentPrice === null) {
      setError("Informe pelo menos um preço para o imóvel.");
      return;
    }

    const payload = {
      code: form.code.trim(),
      title: form.title.trim(),
      purpose: form.purpose,
      type: form.type,
      price: price ?? salePrice ?? rentPrice ?? 0,
      salePrice,
      rentPrice,
      condoFee,
      iptu,
      iptuPeriod: form.iptuPeriod || "mensal",
      cep: form.cep.replace(/\D/g, "") || null,
      state: form.state.trim() || null,
      district: form.district.trim(),
      city: form.city.trim() || "Praia Grande",
      address: form.address.trim() || null,
      street: form.street.trim() || null,
      number: form.number.trim() || null,
      complement: form.complement.trim() || null,
      condominiumName: form.condominiumName.trim() || null,
      latitude: form.latitude ? Number(form.latitude) : null,
      longitude: form.longitude ? Number(form.longitude) : null,
      proximities: form.proximities,
      bedrooms: Math.trunc(num(form.bedrooms)),
      suites: Math.trunc(num(form.suites)),
      bathrooms: Math.trunc(num(form.bathrooms)),
      parking: Math.trunc(num(form.parking)),
      kitchens: Math.trunc(num(form.kitchens)),
      livingRooms: Math.trunc(num(form.livingRooms)),
      areaUtil: num(form.areaUtil),
      areaTotal: optionalNum(form.areaTotal),
      landArea: optionalNum(form.landArea),
      frontage: optionalNum(form.frontage),
      depth: optionalNum(form.depth),
      hectares: optionalNum(form.hectares),
      floor: form.floor.trim() ? Math.trunc(num(form.floor)) : null,
      totalFloors: optionalNum(form.totalFloors),
      constructionYear: optionalNum(form.constructionYear),
      solarPosition: form.solarPosition.trim() || null,
      seaDistance: optionalNum(form.seaDistance),
      negotiationTerms: form.negotiationTerms.trim() || null,
      internalNotes: form.internalNotes.trim() || null,
      description: form.description.trim() || null,
      highlight: form.highlight.trim() || null,
      features: form.features.map((item) => item.trim()).filter((item) => item.length > 0),
      status: form.status,
      published: form.published,
      featured: form.featured,
      ownerId: form.ownerId ? Number(form.ownerId) : null,
      watermarkOff: form.watermarkOff,
      youtubeUrl: form.youtubeUrl.trim() || null,
      images: images.map((image) => ({
        url: image.url,
        originalUrl: image.originalUrl ?? null,
        isPrimary: image.isPrimary === true,
      })),
      captureId,
    };

    try {
      if (propertyId) {
        await save.mutateAsync({ ...payload, id: propertyId });
      } else {
        const created = await save.mutateAsync(payload);
        const plan = planConversion(conversion, {
          type: "property_created",
          propertyId: created.id,
        });
        setConversion(plan.state);
        if (plan.action === "mark" && captureId !== null && plan.propertyId !== null) {
          try {
            await markConverted.mutateAsync({ id: captureId, propertyId: plan.propertyId });
            setConversion((current) => planConversion(current, { type: "mark_ok" }).state);
          } catch (caught) {
            setConversion((current) => planConversion(current, { type: "mark_failed" }).state);
            return void setError(
              errorMessage(
                caught,
                "Imóvel criado, mas não foi possível marcar a captação como captada",
              ),
            );
          }
        }
      }
      navigate("/admin/imoveis");
    } catch (caught) {
      setError(errorMessage(caught, "Não foi possível salvar o imóvel"));
      window.scrollTo(0, 0);
    }
  }

  const isRural = ["chacara", "sitio", "fazenda", "gleba", "rural"].includes(form.type);
  const isTerrain = ["terreno", "lote", "gleba"].includes(form.type);
  const isCommercial = ["sala_comercial", "comercial", "loja", "galpao"].includes(form.type);

  return (
    <AdminLayout
      title="Cadastro de Imóvel"
      subtitle="Preencha os dados para publicar nos portais e gerenciar no CRM"
      actions={
        <>
          <Btn tone="outline" onClick={() => navigate("/admin/imoveis")}>Cancelar</Btn>
          <Btn tone="brass" onClick={() => submit()} disabled={save.isPending}>
            {save.isPending ? "Salvando..." : "Salvar Imóvel"}
          </Btn>
        </>
      }
    >
      <form onSubmit={submit} className="mx-auto max-w-4xl space-y-8">
        <ErrorNote message={error} />
        
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

        {captureId !== null && capture.data && (
          <div className="rounded-[10px] border border-line bg-bone/40 p-4 text-sm">
            <div className="label-xs text-deep">
              Captação #{captureId} · {capture.data.owner?.name ?? "proprietário"}
            </div>
            {capture.data.serial && (
              <div className="mt-1 font-mono text-xs text-deep">
                Serial {capture.data.serial}
              </div>
            )}
            <p className="mt-2 whitespace-pre-line text-muted">
              {parseChecklist(capture.data.notes).text || "Sem observações na captação."}
            </p>
            {captureBlock && (
              <p className="mt-3 font-medium text-red-700">{captureBlock}</p>
            )}
          </div>
        )}

        <div className="space-y-6 rounded-[10px] border border-line bg-white p-5 sm:p-6 shadow-sm">
          <div className="flex items-center gap-2 border-b border-line pb-3">
            <FileText className="h-5 w-5 text-brass" />
            <h2 className="text-lg font-medium text-deep">Informações básicas</h2>
          </div>
          
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

          <Field label="Frase de destaque" hint="Aparece no card do imóvel dentro do site.">
            <Input value={form.highlight} onChange={(e) => set("highlight", e.target.value)} />
          </Field>
        </div>

        <div className="space-y-6 rounded-[10px] border border-line bg-white p-5 sm:p-6 shadow-sm">
          <div className="flex items-center gap-2 border-b border-line pb-3">
            <MapPin className="h-5 w-5 text-brass" />
            <h2 className="text-lg font-medium text-deep">Localização</h2>
          </div>
          
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            <Field label="CEP" className="sm:col-span-1">
              <div className="flex gap-2">
                <Input
                  value={form.cep}
                  onChange={(e) => set("cep", e.target.value)}
                  onBlur={handleCepLookup}
                  placeholder="00000-000"
                />
                {cepLoading && <Loader2 className="mt-2 h-5 w-5 animate-spin text-muted" />}
              </div>
            </Field>
            <Field label="Estado (UF)" className="sm:col-span-1">
               <Input value={form.state} onChange={(e) => set("state", e.target.value)} maxLength={2} />
            </Field>
            <Field label="Cidade" className="sm:col-span-2">
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
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Bairro">
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
            <Field label="Logradouro">
              <Input value={form.street} onChange={(e) => set("street", e.target.value)} placeholder="Rua / Avenida" />
            </Field>
          </div>
          
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
             <Field label="Número">
               <Input value={form.number} onChange={(e) => set("number", e.target.value)} />
             </Field>
             <Field label="Complemento">
               <Input value={form.complement} onChange={(e) => set("complement", e.target.value)} placeholder="Apto, Bloco, Sala..." />
             </Field>
             <Field label="Condomínio">
               <Input value={form.condominiumName} onChange={(e) => set("condominiumName", e.target.value)} />
             </Field>
          </div>

          <Field label="Endereço Formatado (Uso interno)" hint="Texto livre compatível com legados.">
            <Input value={form.address} onChange={(e) => set("address", e.target.value)} />
          </Field>
          
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
             <Field label="Latitude (opcional)">
               <Input value={form.latitude} onChange={(e) => set("latitude", e.target.value)} />
             </Field>
             <Field label="Longitude (opcional)">
               <Input value={form.longitude} onChange={(e) => set("longitude", e.target.value)} />
             </Field>
          </div>
          
          <Field label="Proximidades" hint="Separe por vírgula. Ex: Praia, Mercado, Escola...">
            <Input 
              value={form.proximities.join(", ")} 
              onChange={(e) => set("proximities", e.target.value.split(",").map(s => s.trim()).filter(Boolean))} 
            />
          </Field>
        </div>

        <div className="space-y-6 rounded-[10px] border border-line bg-white p-5 sm:p-6 shadow-sm">
          <div className="flex items-center gap-2 border-b border-line pb-3">
            <Ruler className="h-5 w-5 text-brass" />
            <h2 className="text-lg font-medium text-deep">Características</h2>
          </div>
          
          {!isTerrain && (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Field label="Dormitórios">
                <CountInput label="dormitórios" value={form.bedrooms} onChange={(next) => set("bedrooms", next)} />
              </Field>
              <Field label="Suítes">
                <CountInput label="suítes" value={form.suites} onChange={(next) => set("suites", next)} />
              </Field>
              <Field label="Banheiros">
                <CountInput label="banheiros" value={form.bathrooms} onChange={(next) => set("bathrooms", next)} />
              </Field>
              <Field label="Vagas">
                <CountInput label="vagas" value={form.parking} onChange={(next) => set("parking", next)} />
              </Field>
            </div>
          )}
          
          {!isTerrain && !isCommercial && (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 mt-4">
               <Field label="Cozinhas">
                  <CountInput label="cozinhas" value={form.kitchens} onChange={(next) => set("kitchens", next)} />
               </Field>
               <Field label="Salas">
                  <CountInput label="salas" value={form.livingRooms} onChange={(next) => set("livingRooms", next)} />
               </Field>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Field label="Área Útil (m²)">
              <Input
                value={form.areaUtil}
                inputMode="decimal"
                onChange={(e) => set("areaUtil", e.target.value)}
                placeholder="Ex: 80"
              />
            </Field>
            <Field label="Área Total (m²)">
              <Input
                value={form.areaTotal}
                inputMode="decimal"
                onChange={(e) => set("areaTotal", e.target.value)}
                placeholder="Ex: 120"
              />
            </Field>
            {(isTerrain || isRural) && (
              <Field label="Hectares">
                <Input
                  value={form.hectares}
                  inputMode="decimal"
                  onChange={(e) => set("hectares", e.target.value)}
                />
              </Field>
            )}
             <Field label="Área do Terreno (m²)">
              <Input
                value={form.landArea}
                inputMode="decimal"
                onChange={(e) => set("landArea", e.target.value)}
              />
            </Field>
          </div>
          
          {(isTerrain || isRural) && (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Field label="Frente (m)">
                <Input value={form.frontage} inputMode="decimal" onChange={(e) => set("frontage", e.target.value)} />
              </Field>
              <Field label="Fundo (m)">
                <Input value={form.depth} inputMode="decimal" onChange={(e) => set("depth", e.target.value)} />
              </Field>
            </div>
          )}
          
          {!isTerrain && !isRural && (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
               <Field label="Andar">
                 <Input value={form.floor} onChange={(e) => set("floor", e.target.value)} />
               </Field>
               <Field label="Total de Andares">
                 <Input value={form.totalFloors} inputMode="numeric" onChange={(e) => set("totalFloors", e.target.value)} />
               </Field>
               <Field label="Ano Construção">
                 <Input value={form.constructionYear} inputMode="numeric" onChange={(e) => set("constructionYear", e.target.value)} />
               </Field>
            </div>
          )}
          
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Field label="Posição Solar">
              <Input value={form.solarPosition} onChange={(e) => set("solarPosition", e.target.value)} placeholder="Norte, Sul..." />
            </Field>
            <Field label="Distância do Mar (m)">
              <Input value={form.seaDistance} inputMode="numeric" onChange={(e) => set("seaDistance", e.target.value)} />
            </Field>
          </div>

          <Field label="Amenidades e Comodidades">
            <FeaturesPicker
              selected={form.features}
              onChange={(next) => set("features", next)}
            />
          </Field>
        </div>

        <div className="space-y-6 rounded-[10px] border border-line bg-white p-5 sm:p-6 shadow-sm">
          <div className="flex items-center gap-2 border-b border-line pb-3">
            <Banknote className="h-5 w-5 text-brass" />
            <h2 className="text-lg font-medium text-deep">Valores</h2>
          </div>
          
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Preço (Compatibilidade)">
              <MoneyInput value={form.price} onChange={(value) => set("price", value)} />
            </Field>
            <Field label="Preço de Venda">
              <MoneyInput value={form.salePrice} onChange={(value) => set("salePrice", value)} />
            </Field>
            <Field label="Preço de Locação">
              <MoneyInput value={form.rentPrice} onChange={(value) => set("rentPrice", value)} />
            </Field>
            <Field label="Condomínio">
              <MoneyInput value={form.condoFee} onChange={(value) => set("condoFee", value)} />
            </Field>
            <Field label="IPTU">
              <MoneyInput value={form.iptu} onChange={(value) => set("iptu", value)} />
            </Field>
            <Field label="Período do IPTU">
              <Select value={form.iptuPeriod} onChange={(e) => set("iptuPeriod", e.target.value)}>
                <option value="mensal">Mensal</option>
                <option value="anual">Anual</option>
              </Select>
            </Field>
          </div>
          
          <Field label="Condições de Negociação" hint="Ex: Aceita permuta, financiamento bancário...">
            <Input value={form.negotiationTerms} onChange={(e) => set("negotiationTerms", e.target.value)} />
          </Field>
        </div>

        <div className="space-y-6 rounded-[10px] border border-line bg-white p-5 sm:p-6 shadow-sm">
          <div className="flex items-center gap-2 border-b border-line pb-3">
            <User className="h-5 w-5 text-brass" />
            <h2 className="text-lg font-medium text-deep">Proprietário</h2>
          </div>
          
          {!isCreatingOwner ? (
            <div className="space-y-4">
               <div className="flex gap-4">
                 <div className="flex-1">
                   <Field label="Buscar proprietário" hint="Filtre por nome, e-mail, CPF ou telefone.">
                     <Input
                       value={ownerSearch}
                       onChange={(e) => setOwnerSearch(e.target.value)}
                       placeholder="Buscar..."
                     />
                   </Field>
                 </div>
                 <div className="flex-1">
                   <Field label="Vincular proprietário" hint="Selecione na lista abaixo.">
                     <Select
                       value={form.ownerId}
                       onChange={(e) => set("ownerId", e.target.value)}
                     >
                       <option value="">(sem proprietário vinculado)</option>
                       {filteredOwners.map((owner) => (
                         <option key={owner.id} value={owner.id}>
                           {owner.name} {owner.phone ? `(${owner.phone})` : ""}
                         </option>
                       ))}
                     </Select>
                   </Field>
                 </div>
               </div>
               
               <Btn tone="outline" onClick={() => setIsCreatingOwner(true)}>
                 <Plus className="h-4 w-4" /> Novo Proprietário
               </Btn>
            </div>
          ) : (
            <div className="space-y-4 rounded bg-bone/30 p-4">
               <h3 className="text-sm font-medium text-deep">Cadastrar Novo Proprietário</h3>
               <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                 <Field label="Nome Completo">
                   <Input value={newOwnerName} onChange={e => setNewOwnerName(e.target.value)} />
                 </Field>
                 <Field label="Telefone">
                   <Input value={newOwnerPhone} onChange={e => setNewOwnerPhone(e.target.value)} placeholder="(11) 99999-9999" />
                 </Field>
                 <Field label="Documento (CPF/CNPJ)">
                   <Input value={newOwnerDocument} onChange={e => setNewOwnerDocument(e.target.value)} />
                 </Field>
                 <Field label="E-mail (opcional)">
                   <Input value={newOwnerEmail} onChange={e => setNewOwnerEmail(e.target.value)} />
                 </Field>
               </div>
               <div className="flex gap-2">
                 <Btn tone="ghost" onClick={() => setIsCreatingOwner(false)}>Cancelar</Btn>
                 <Btn tone="brass" onClick={handleCreateOwner} disabled={saveOwner.isPending}>
                    {saveOwner.isPending ? "Salvando..." : "Salvar e Vincular"}
                 </Btn>
               </div>
            </div>
          )}
        </div>

        <div className="space-y-6 rounded-[10px] border border-line bg-white p-5 sm:p-6 shadow-sm">
          <div className="flex items-center gap-2 border-b border-line pb-3">
            <Sparkles className="h-5 w-5 text-brass" />
            <h2 className="text-lg font-medium text-deep">Descrição e Diferenciais</h2>
          </div>
          
          <div className="flex justify-between items-center bg-bone/20 p-3 rounded-lg border border-line">
            <div className="text-sm text-deep">
              Deixe a IA escrever um texto atrativo com base nos dados que você já preencheu.
            </div>
            <Btn tone="outline" onClick={runGenerate} disabled={generate.isPending}>
              <Sparkles className="h-4 w-4" /> 
              {generate.isPending ? "Gerando..." : "Gerar com IA"}
            </Btn>
          </div>
          
          {aiOpen && (
            <PropertyAiPanel
              loading={generate.isPending}
              error={aiError}
              content={aiContent}
              usedFields={aiUsedFields}
              onClose={() => setAiOpen(false)}
              onApply={applyField}
            />
          )}

          <Field label="Texto da descrição" hint="Aparece na página do imóvel no site.">
            <Textarea
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              className="min-h-48"
            />
          </Field>
          
          <Field label="Anotações Internas" hint="Uso exclusivo do CRM. Não vai pro site.">
            <Textarea
              value={form.internalNotes}
              onChange={(e) => set("internalNotes", e.target.value)}
              className="min-h-24"
            />
          </Field>
        </div>

        <div className="space-y-6 rounded-[10px] border border-line bg-white p-5 sm:p-6 shadow-sm">
          <div className="flex items-center gap-2 border-b border-line pb-3">
            <Camera className="h-5 w-5 text-brass" />
            <h2 className="text-lg font-medium text-deep">Fotos e Mídia</h2>
          </div>
          
          <PropertyGallery
            images={images}
            uploading={uploading}
            onPick={pickFiles}
            onMove={move}
            onSetPrimary={setPrimary}
            onRemove={removeImage}
          />

          <Field label="Vídeo do YouTube (URL)" hint="Link completo do vídeo (ex: https://www.youtube.com/watch?v=...)">
            <Input
              value={form.youtubeUrl}
              onChange={(e) => set("youtubeUrl", e.target.value)}
              placeholder="https://www.youtube.com/watch?v=..."
            />
          </Field>
        </div>

        <div className="space-y-6 rounded-[10px] border border-line bg-white p-5 sm:p-6 shadow-sm">
          <div className="flex items-center gap-2 border-b border-line pb-3">
            <ShieldCheck className="h-5 w-5 text-brass" />
            <h2 className="text-lg font-medium text-deep">Documentação</h2>
          </div>
          
          <PropertyDocsSection propertyId={propertyId} />
        </div>
        
        <div className="space-y-6 rounded-[10px] border border-line bg-white p-5 sm:p-6 shadow-sm">
          <div className="flex items-center gap-2 border-b border-line pb-3">
            <CalendarClock className="h-5 w-5 text-brass" />
            <h2 className="text-lg font-medium text-deep">Revalidação</h2>
          </div>
          
          <PropertyRevalidationSection propertyId={propertyId} />
        </div>

        <div className="space-y-6 rounded-[10px] border border-line bg-white p-5 sm:p-6 shadow-sm">
          <div className="flex items-center gap-2 border-b border-line pb-3">
            <Globe className="h-5 w-5 text-brass" />
            <h2 className="text-lg font-medium text-deep">Publicação</h2>
          </div>
          
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <Field label="Status da Negociação">
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

            <div className="flex flex-col justify-center gap-3">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.published}
                  onChange={(e) => set("published", e.target.checked)}
                  className="h-4 w-4 rounded border-line text-brass focus:ring-brass bg-white"
                />
                <span className="text-sm text-deep">Publicar no site</span>
              </label>

              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.featured}
                  onChange={(e) => set("featured", e.target.checked)}
                  className="h-4 w-4 rounded border-line text-brass focus:ring-brass bg-white"
                />
                <span className="text-sm text-deep">Destaque na página inicial</span>
              </label>

              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.watermarkOff}
                  onChange={(e) => set("watermarkOff", e.target.checked)}
                  className="h-4 w-4 rounded border-line text-brass focus:ring-brass bg-white"
                />
                <span className="text-sm text-deep">Remover marca d'água das fotos</span>
              </label>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-6 border-t border-line">
          <Btn tone="outline" onClick={() => navigate("/admin/imoveis")}>Cancelar</Btn>
          <Btn tone="brass" onClick={() => submit()} disabled={save.isPending}>
            {save.isPending ? "Salvando..." : "Salvar Imóvel"}
          </Btn>
        </div>
      </form>
    </AdminLayout>
  );
}

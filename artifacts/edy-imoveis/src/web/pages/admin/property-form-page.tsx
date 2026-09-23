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

import {
  CompactCard,
  CompactField,
  CompactInput,
  CompactSelect,
  CompactTextarea,
  CompactMoneyInput,
  CompactCountInput
} from "./property-form-local-ui";
import { Crosshair, Link as LinkIcon, DollarSign, Image as ImageIcon } from "lucide-react";

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
      
      
      <form onSubmit={submit} className="mx-auto max-w-[1100px] space-y-4 pb-24">
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
          <div className="rounded-[10px] border border-white/10 bg-black/20 p-4 text-sm">
            <div className="text-[11px] font-medium text-slate-300 mb-1 block uppercase tracking-wider">
              Captação #{captureId} · {capture.data.owner?.name ?? "proprietário"}
            </div>
            {capture.data.serial && (
              <div className="mt-1 font-mono text-xs text-white">
                Serial {capture.data.serial}
              </div>
            )}
            <p className="mt-2 whitespace-pre-line text-slate-400">
              {parseChecklist(capture.data.notes).text || "Sem observações na captação."}
            </p>
            {captureBlock && (
              <p className="mt-3 font-medium text-red-500">{captureBlock}</p>
            )}
          </div>
        )}

        <CompactCard icon={<FileText className="h-4 w-4 text-brass" />} title="Informações Básicas">
          <div className="space-y-4">
            <CompactField label="Título do anúncio" required>
              <CompactInput value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="Ex: Apartamento 3 quartos com vista para o mar" />
            </CompactField>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <CompactField label="Tipo de imóvel" required>
                <CompactSelect value={form.type} onChange={(e) => set("type", e.target.value as FormState["type"])}>
                  {propertyTypes.map((value) => (
                    <option key={value} value={value}>{propertyTypeLabel[value]}</option>
                  ))}
                </CompactSelect>
              </CompactField>
              <CompactField label="Finalidade" required>
                <CompactSelect value={form.purpose} onChange={(e) => set("purpose", e.target.value as FormState["purpose"])}>
                  {purposes.map((value) => (
                    <option key={value} value={value}>{purposeLabel[value]}</option>
                  ))}
                </CompactSelect>
              </CompactField>
              <CompactField label="Código interno" optional>
                <CompactInput value={form.code} onChange={(e) => set("code", e.target.value)} placeholder="Ex: AP2000" />
              </CompactField>
            </div>

            <CompactField label="Descrição detalhada">
              <div className="relative">
                <CompactTextarea value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="Descreva os detalhes do imóvel ou use a IA para criar um texto profissional com base nos dados preenchidos." className="pb-12 min-h-[140px]" />
                <div className="absolute bottom-2 right-2">
                  <button type="button" onClick={runGenerate} className="flex items-center gap-1.5 text-[11px] font-medium text-brass border border-brass/30 bg-brass/10 hover:bg-brass/20 rounded-[4px] px-3 py-1.5 transition-colors">
                    <Sparkles className="h-3 w-3" /> Gerar com IA
                  </button>
                </div>
              </div>
            </CompactField>
            
            <CompactField label="Frase de destaque" optional>
              <CompactInput value={form.highlight} onChange={(e) => set("highlight", e.target.value)} placeholder="Aparece no card do imóvel dentro do site." />
            </CompactField>
          </div>
        </CompactCard>

        <div className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-4">
          <CompactCard icon={<MapPin className="h-4 w-4 text-red-500" />} title="Localização">
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr_80px] gap-4">
                <CompactField label="CEP">
                  <div className="flex gap-2">
                    <CompactInput value={form.cep} onChange={(e) => set("cep", e.target.value)} placeholder="00000-000" className="w-[110px]" />
                    <button type="button" onClick={handleCepLookup} disabled={cepLoading} className="rounded border border-white/10 bg-black/20 px-3 text-brass hover:text-white transition-colors">
                      {cepLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
                    </button>
                  </div>
                </CompactField>
                <CompactField label="Cidade">
                  <CompactInput value={form.city} onChange={(e) => set("city", e.target.value)} list="edy-city-options" />
                  <datalist id="edy-city-options">
                    {citySuggestions.map((c) => <option key={c} value={c} />)}
                  </datalist>
                </CompactField>
                <CompactField label="UF">
                  <CompactInput value={form.state} onChange={(e) => set("state", e.target.value)} maxLength={2} />
                </CompactField>
              </div>

              <CompactField label="Bairro">
                <CompactInput value={form.district} onChange={(e) => set("district", e.target.value)} list="districts" />
                <datalist id="districts">
                  {districtSuggestions.map((d) => <option key={d} value={d} />)}
                </datalist>
              </CompactField>

              <div className="grid grid-cols-1 sm:grid-cols-[1fr_100px] gap-4">
                <CompactField label="Logradouro (Rua, Avenida, etc.)">
                  <CompactInput value={form.street} onChange={(e) => set("street", e.target.value)} />
                </CompactField>
                <CompactField label="Número">
                  <CompactInput value={form.number} onChange={(e) => set("number", e.target.value)} />
                </CompactField>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <CompactField label="Complemento (apto, bloco, etc.)">
                  <CompactInput value={form.complement} onChange={(e) => set("complement", e.target.value)} />
                </CompactField>
                <CompactField label="Condomínio / Empreendimento">
                  <CompactInput value={form.condominiumName} onChange={(e) => set("condominiumName", e.target.value)} />
                </CompactField>
              </div>

              <CompactField label="Endereço Formatado Completo (Legacy)" optional>
                <CompactTextarea value={form.address} onChange={(e) => set("address", e.target.value)} className="min-h-[60px]" />
              </CompactField>
            </div>
          </CompactCard>

          <CompactCard icon={<Crosshair className="h-4 w-4 text-red-500" />} title="Geolocalização" action={<span className="text-[11px] text-slate-500 font-normal">(opcional)</span>}>
            <div className="space-y-4">
               <div className="grid grid-cols-2 gap-4">
                 <CompactField label="Latitude">
                   <CompactInput value={form.latitude} onChange={(e) => set("latitude", e.target.value)} placeholder="-23.5505" />
                 </CompactField>
                 <CompactField label="Longitude">
                   <CompactInput value={form.longitude} onChange={(e) => set("longitude", e.target.value)} placeholder="-46.6333" />
                 </CompactField>
               </div>
               <CompactField label="Proximidades">
                  <CompactInput value={form.proximities.join(', ')} onChange={(e) => set("proximities", e.target.value.split(',').map(s=>s.trim()).filter(Boolean))} placeholder="Ex: Praia, mercado, escola, shopping..." />
               </CompactField>
               
               <CompactField label="Distância do Mar (metros)" optional>
                 <CompactInput value={form.seaDistance} onChange={(e) => set("seaDistance", e.target.value)} />
               </CompactField>
            </div>
          </CompactCard>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_0.8fr] gap-4">
          <CompactCard icon={<Ruler className="h-4 w-4 text-emerald-400" />} title="Características">
            <div className="space-y-4">
              {!isTerrain && !isCommercial && (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <CompactField label="Quartos">
                    <CompactCountInput value={form.bedrooms} onChange={(v) => set("bedrooms", v)} />
                  </CompactField>
                  <CompactField label="Suítes">
                    <CompactCountInput value={form.suites} onChange={(v) => set("suites", v)} />
                  </CompactField>
                  <CompactField label="Banheiros">
                    <CompactCountInput value={form.bathrooms} onChange={(v) => set("bathrooms", v)} />
                  </CompactField>
                  <CompactField label="Vagas">
                    <CompactCountInput value={form.parking} onChange={(v) => set("parking", v)} />
                  </CompactField>
                </div>
              )}

              {!isTerrain && !isCommercial && (
                <div className="grid grid-cols-2 gap-4">
                  <CompactField label="Salas">
                    <CompactCountInput value={form.livingRooms} onChange={(v) => set("livingRooms", v)} />
                  </CompactField>
                  <CompactField label="Cozinhas">
                    <CompactCountInput value={form.kitchens} onChange={(v) => set("kitchens", v)} />
                  </CompactField>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                {!isTerrain && !isRural && (
                  <CompactField label="Área Útil (m²)">
                    <CompactInput value={form.areaUtil} onChange={(e) => set("areaUtil", e.target.value)} />
                  </CompactField>
                )}
                <CompactField label="Área Total (m²)">
                  <CompactInput value={form.areaTotal} onChange={(e) => set("areaTotal", e.target.value)} />
                </CompactField>
                <CompactField label="Área do Terreno (m²)">
                  <CompactInput value={form.landArea} onChange={(e) => set("landArea", e.target.value)} />
                </CompactField>
                {(isTerrain || isRural) && (
                  <CompactField label="Hectares">
                    <CompactInput value={form.hectares} onChange={(e) => set("hectares", e.target.value)} />
                  </CompactField>
                )}
              </div>

              {(isTerrain || isRural) && (
                <div className="grid grid-cols-2 gap-4">
                  <CompactField label="Frente (m)">
                    <CompactInput value={form.frontage} onChange={(e) => set("frontage", e.target.value)} />
                  </CompactField>
                  <CompactField label="Fundo (m)">
                    <CompactInput value={form.depth} onChange={(e) => set("depth", e.target.value)} />
                  </CompactField>
                </div>
              )}

              {!isTerrain && !isRural && (
                <div className="grid grid-cols-3 gap-4">
                  <CompactField label="Andar">
                    <CompactInput value={form.floor} onChange={(e) => set("floor", e.target.value)} />
                  </CompactField>
                  <CompactField label="Total Andares">
                    <CompactInput value={form.totalFloors} onChange={(e) => set("totalFloors", e.target.value)} />
                  </CompactField>
                  <CompactField label="Ano Construção">
                    <CompactInput value={form.constructionYear} onChange={(e) => set("constructionYear", e.target.value)} />
                  </CompactField>
                </div>
              )}
              
              {!isTerrain && !isRural && (
                <CompactField label="Posição solar">
                  <CompactSelect value={form.solarPosition} onChange={(e) => set("solarPosition", e.target.value)}>
                    <option value="">Selecione</option>
                    <option value="N">Norte</option>
                    <option value="S">Sul</option>
                    <option value="L">Leste</option>
                    <option value="O">Oeste</option>
                    <option value="NE">Nordeste</option>
                    <option value="NO">Noroeste</option>
                    <option value="SE">Sudeste</option>
                    <option value="SO">Sudoeste</option>
                  </CompactSelect>
                </CompactField>
              )}
            </div>
          </CompactCard>

          <CompactCard title="Áreas comuns e Diferenciais">
            <FeaturesPicker value={form.features} onChange={(v) => set("features", v)} />
          </CompactCard>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-4">
          <CompactCard icon={<DollarSign className="h-4 w-4 text-yellow-400" />} title="Valores">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <CompactField label="Preço (Compatibilidade)">
                <CompactMoneyInput value={form.price} onChange={(v) => set("price", v)} />
              </CompactField>
              <CompactField label="Preço de Venda">
                <CompactMoneyInput value={form.salePrice} onChange={(v) => set("salePrice", v)} />
              </CompactField>
              <CompactField label="Preço de Locação">
                <CompactMoneyInput value={form.rentPrice} onChange={(v) => set("rentPrice", v)} />
              </CompactField>
              <CompactField label="Condomínio (R$)">
                <CompactMoneyInput value={form.condoFee} onChange={(v) => set("condoFee", v)} />
              </CompactField>
            </div>
            
            <div className="grid grid-cols-2 gap-4 mt-4">
              <CompactField label="IPTU (R$)">
                <CompactMoneyInput value={form.iptu} onChange={(v) => set("iptu", v)} />
              </CompactField>
              <CompactField label="Período IPTU">
                <CompactSelect value={form.iptuPeriod} onChange={(e) => set("iptuPeriod", e.target.value)}>
                  <option value="mensal">Mensal</option>
                  <option value="anual">Anual</option>
                </CompactSelect>
              </CompactField>
            </div>
          </CompactCard>

          <CompactCard title="Forma de negociação">
            <CompactField label="Observações de negociação (Analisa proposta, etc)">
               <CompactTextarea value={form.negotiationTerms} onChange={(e) => set("negotiationTerms", e.target.value)} placeholder="Ex: Aceita permuta, financiamento bancário..." className="min-h-[72px]" />
            </CompactField>
          </CompactCard>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_0.8fr] gap-4">
          <CompactCard icon={<ImageIcon className="h-4 w-4 text-blue-400" />} title="Fotos e Vídeos">
            <PropertyGallery
              images={images}
              uploading={uploading}
              onPick={pickFiles}
              onMove={move}
              onSetPrimary={setPrimary}
              onRemove={removeImage}
            />
          </CompactCard>
          
          <CompactCard icon={<LinkIcon className="h-4 w-4 text-blue-400" />} title="Mídia externa">
            <CompactField label="Link do vídeo (YouTube, Instagram, etc.)">
              <CompactInput value={form.youtubeUrl} onChange={(e) => set("youtubeUrl", e.target.value)} placeholder="Cole o link público do vídeo" />
            </CompactField>
            
            <div className="mt-4 pt-4 border-t border-white/10">
              <CompactField label="Marca d'água">
                <label className="flex cursor-pointer items-center gap-2 mt-2">
                  <input
                    type="checkbox"
                    checked={form.watermarkOff}
                    onChange={(e) => set("watermarkOff", e.target.checked)}
                    className="rounded border-white/10 bg-black/20 text-brass focus:ring-brass focus:ring-offset-0 h-4 w-4"
                  />
                  <span className="text-sm text-slate-300">Remover marca d'água das fotos</span>
                </label>
              </CompactField>
            </div>
          </CompactCard>
        </div>

        <CompactCard icon={<User className="h-4 w-4 text-blue-300" />} title="Dados do Proprietário" action={
          <label className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" checked={isCreatingOwner} onChange={(e) => setIsCreatingOwner(e.target.checked)} className="rounded border-white/10 bg-black/20 text-brass focus:ring-brass h-4 w-4" />
            <span className="text-xs text-brass">Cadastrar novo proprietário</span>
          </label>
        }>
          {isCreatingOwner ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <CompactField label="Nome completo" required>
                  <CompactInput value={newOwnerName} onChange={(e) => setNewOwnerName(e.target.value)} />
                </CompactField>
                <CompactField label="CPF / CNPJ">
                  <CompactInput value={newOwnerDocument} onChange={(e) => setNewOwnerDocument(e.target.value)} />
                </CompactField>
                <CompactField label="Telefone">
                  <CompactInput value={newOwnerPhone} onChange={(e) => setNewOwnerPhone(e.target.value)} placeholder="(00) 00000-0000" />
                </CompactField>
                <CompactField label="E-mail" optional>
                  <CompactInput value={newOwnerEmail} onChange={(e) => setNewOwnerEmail(e.target.value)} placeholder="email@exemplo.com" />
                </CompactField>
              </div>
              <div className="flex justify-end">
                <button type="button" onClick={handleCreateOwner} disabled={saveOwner.isPending} className="rounded bg-brass px-4 py-2 text-xs font-medium text-white hover:bg-brass/90 transition-colors">
                  {saveOwner.isPending ? "Salvando..." : "Salvar Proprietário"}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <CompactField label="Buscar proprietário existente">
                <div className="relative">
                   <CompactInput value={ownerSearch} onChange={(e) => setOwnerSearch(e.target.value)} placeholder="Digite o nome, telefone ou e-mail..." />
                   <div className="mt-2 max-h-40 overflow-y-auto rounded border border-white/10 bg-black/20">
                     {filteredOwners.length === 0 ? (
                       <div className="p-3 text-xs text-slate-500">Nenhum proprietário encontrado</div>
                     ) : (
                       filteredOwners.map(o => (
                         <label key={o.id} className="flex items-center gap-3 p-3 hover:bg-white/10 cursor-pointer border-b border-white/10 last:border-0 transition-colors">
                           <input type="radio" name="owner" value={o.id} checked={form.ownerId === String(o.id)} onChange={() => set("ownerId", String(o.id))} className="text-brass focus:ring-brass bg-white/5 border-white/10 h-4 w-4" />
                           <div>
                             <div className="text-sm font-medium text-slate-200">{o.name}</div>
                             <div className="text-xs text-slate-400">{o.phone} {o.email ? ` · ${o.email}` : ''}</div>
                           </div>
                         </label>
                       ))
                     )}
                   </div>
                </div>
              </CompactField>
              {ownerName && (
                <div className="text-xs text-emerald-400 flex items-center gap-1.5 mt-2">
                  <Check className="h-3.5 w-3.5" />
                  Proprietário selecionado: <span className="font-medium text-white">{ownerName}</span>
                </div>
              )}
            </div>
          )}
        </CompactCard>

        <CompactCard icon={<FileText className="h-4 w-4 text-slate-300" />} title="Observações Internas e Publicação">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div>
               <CompactField label="Observações internas (para a equipe)">
                 <CompactTextarea value={form.internalNotes} onChange={(e) => set("internalNotes", e.target.value)} placeholder="Informações adicionais, chaves, visitas, documentos, etc." className="min-h-[140px]" />
               </CompactField>
            </div>
            
            <div className="space-y-4">
              <CompactField label="Status de Publicação">
                <CompactSelect value={form.status} onChange={(e) => set("status", e.target.value as FormState["status"])}>
                  {propertyStatuses.map((value) => (
                    <option key={value} value={value}>{propertyStatusLabel[value]}</option>
                  ))}
                </CompactSelect>
              </CompactField>
              
              <CompactField label="Visibilidade no Site">
                <label className="flex cursor-pointer items-center gap-2 mt-1">
                  <input
                    type="checkbox"
                    checked={form.published}
                    onChange={(e) => set("published", e.target.checked)}
                    className="rounded border-white/10 bg-black/20 text-brass focus:ring-brass h-4 w-4"
                  />
                  <span className="text-sm text-slate-300">Publicado e visível para clientes</span>
                </label>
              </CompactField>
              
              <CompactField label="Destaque">
                <label className="flex cursor-pointer items-center gap-2 mt-1">
                  <input
                    type="checkbox"
                    checked={form.featured}
                    onChange={(e) => set("featured", e.target.checked)}
                    className="rounded border-white/10 bg-black/20 text-brass focus:ring-brass h-4 w-4"
                  />
                  <span className="text-sm text-slate-300">Aparecer na seção de destaques da página inicial</span>
                </label>
              </CompactField>
            </div>
          </div>
        </CompactCard>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <CompactCard icon={<ShieldCheck className="h-4 w-4 text-emerald-400" />} title="Documentação">
            <PropertyDocsSection propertyId={propertyId} />
          </CompactCard>
          <CompactCard icon={<CalendarClock className="h-4 w-4 text-blue-400" />} title="Revalidação">
            <PropertyRevalidationSection propertyId={propertyId} />
          </CompactCard>
        </div>
        
        <PropertyAiPanel
          open={aiOpen}
          onClose={() => setAiOpen(false)}
          loading={generate.isPending}
          error={aiError}
          content={aiContent}
          usedFields={aiUsedFields}
          onApply={applyField}
        />
      </form>
    </AdminLayout>
  );
}

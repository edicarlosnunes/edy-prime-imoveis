import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Badge, Btn, ErrorNote, Field, Input, Select, Textarea, dateTimeLabel } from "./ui";
import { ScoreBadge, ScoreReasons } from "./score-badge";
import { errorMessage } from "../../lib/admin-session";
import {
  useLeadProfile,
  useRecalcLeadScore,
  useUpdateLeadProfile,
} from "../../queries/lead-profile";

/**
 * Necessidade do lead (editável) + timeline comercial.
 * O que o corretor edita aqui vira origem "manual" e nunca é sobrescrito
 * pela qualificação automática.
 */

interface NeedsForm {
  purpose: string;
  propertyType: string;
  city: string;
  districts: string;
  budgetMin: string;
  budgetMax: string;
  bedrooms: string;
  suites: string;
  parking: string;
  areaMin: string;
  financing: string;
  fgts: string;
  tradeIn: string;
  timeframe: string;
  contactPreference: string;
  contactWindow: string;
  summary: string;
}

const emptyForm: NeedsForm = {
  purpose: "",
  propertyType: "",
  city: "",
  districts: "",
  budgetMin: "",
  budgetMax: "",
  bedrooms: "",
  suites: "",
  parking: "",
  areaMin: "",
  financing: "",
  fgts: "",
  tradeIn: "",
  timeframe: "",
  contactPreference: "",
  contactWindow: "",
  summary: "",
};

const num = (value: string) => {
  const parsed = Number.parseFloat(value.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
};
const int = (value: string) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
};
const text = (value: string) => (value.trim() ? value.trim() : null);

const ACTOR: Record<string, string> = {
  cliente: "Cliente",
  ia: "IA",
  corretor: "Corretor",
  sistema: "Sistema",
};

export function LeadNeeds({ leadId }: { leadId: number }) {
  const detail = useLeadProfile(leadId);
  const update = useUpdateLeadProfile();
  const recalc = useRecalcLeadScore();
  const [form, setForm] = useState<NeedsForm>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const profile = detail.data?.profile ?? null;
  const score = detail.data?.score;

  useEffect(() => {
    if (!profile) {
      setForm(emptyForm);
      return;
    }
    setForm({
      purpose: profile.purpose ?? "",
      propertyType: profile.propertyType ?? "",
      city: profile.city ?? "",
      districts: (profile.districts ?? []).join(", "),
      budgetMin: profile.budgetMin ? String(profile.budgetMin) : "",
      budgetMax: profile.budgetMax ? String(profile.budgetMax) : "",
      bedrooms: profile.bedrooms === null ? "" : String(profile.bedrooms),
      suites: profile.suites === null ? "" : String(profile.suites),
      parking: profile.parking === null ? "" : String(profile.parking),
      areaMin: profile.areaMin === null ? "" : String(profile.areaMin),
      financing: profile.financing ?? "",
      fgts: profile.fgts ?? "",
      tradeIn: profile.tradeIn ?? "",
      timeframe: profile.timeframe ?? "",
      contactPreference: profile.contactPreference ?? "",
      contactWindow: profile.contactWindow ?? "",
      summary: profile.summary ?? "",
    });
  }, [profile]);

  const set = <K extends keyof NeedsForm>(key: K, value: NeedsForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  async function save() {
    setError(null);
    try {
      await update.mutateAsync({
        leadId,
        purpose: text(form.purpose),
        propertyType: text(form.propertyType),
        city: text(form.city),
        districts: form.districts
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
          .slice(0, 12),
        budgetMin: num(form.budgetMin),
        budgetMax: num(form.budgetMax),
        bedrooms: int(form.bedrooms),
        suites: int(form.suites),
        parking: int(form.parking),
        areaMin: num(form.areaMin),
        financing: (text(form.financing) as "sim" | "nao" | "nao_sei" | null) ?? null,
        fgts: (text(form.fgts) as "sim" | "nao" | "nao_sei" | null) ?? null,
        tradeIn: (text(form.tradeIn) as "sim" | "nao" | "nao_sei" | null) ?? null,
        timeframe:
          (text(form.timeframe) as "imediato" | "30_dias" | "90_dias" | "sem_pressa" | null) ?? null,
        contactPreference:
          (text(form.contactPreference) as "whatsapp" | "ligacao" | "email" | null) ?? null,
        contactWindow: text(form.contactWindow),
        summary: text(form.summary),
      });
    } catch (caught) {
      setError(errorMessage(caught, "Não foi possível salvar a necessidade"));
    }
  }

  return (
    <div className="space-y-4 border-t border-line pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <p className="label-xs text-muted">Qualificação</p>
          {score && <ScoreBadge score={score.score} tier={score.tier} />}
          {profile && <Badge tone="neutral">{profile.completeness}% completo</Badge>}
        </div>
        <div className="flex gap-2">
          <Btn tone="outline" onClick={() => setOpen(!open)}>
            {open ? "Ocultar necessidade" : "Editar necessidade"}
          </Btn>
          <Btn
            tone="outline"
            disabled={recalc.isPending}
            onClick={() => void recalc.mutateAsync({ leadId })}
          >
            <RefreshCw className="h-3.5 w-3.5" /> Recalcular
          </Btn>
        </div>
      </div>

      {score && <ScoreReasons reasons={score.reasons} />}
      {score?.scoreAt && (
        <p className="text-xs text-muted">Score calculado em {dateTimeLabel(score.scoreAt)}</p>
      )}

      {open && (
        <div className="space-y-3 rounded-[4px] border border-line bg-bone/30 p-3">
          <p className="text-xs text-muted">
            O que você corrigir aqui tem precedência: a qualificação automática nunca sobrescreve
            campo editado pelo corretor. Campo vazio significa “não informado”.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Finalidade">
              <Select value={form.purpose} onChange={(e) => set("purpose", e.target.value)}>
                <option value="">Não informado</option>
                <option value="comprar">Comprar</option>
                <option value="alugar">Alugar</option>
                <option value="investir">Investir</option>
                <option value="vender">Vender</option>
              </Select>
            </Field>
            <Field label="Tipo de imóvel">
              <Input
                value={form.propertyType}
                onChange={(e) => set("propertyType", e.target.value)}
              />
            </Field>
            <Field label="Cidade">
              <Input value={form.city} onChange={(e) => set("city", e.target.value)} />
            </Field>
            <Field label="Bairros (separados por vírgula)">
              <Input value={form.districts} onChange={(e) => set("districts", e.target.value)} />
            </Field>
            <Field label="Orçamento mínimo (R$)">
              <Input value={form.budgetMin} onChange={(e) => set("budgetMin", e.target.value)} />
            </Field>
            <Field label="Orçamento máximo (R$)">
              <Input value={form.budgetMax} onChange={(e) => set("budgetMax", e.target.value)} />
            </Field>
            <Field label="Dormitórios">
              <Input value={form.bedrooms} onChange={(e) => set("bedrooms", e.target.value)} />
            </Field>
            <Field label="Suítes">
              <Input value={form.suites} onChange={(e) => set("suites", e.target.value)} />
            </Field>
            <Field label="Vagas">
              <Input value={form.parking} onChange={(e) => set("parking", e.target.value)} />
            </Field>
            <Field label="Área mínima (m²)">
              <Input value={form.areaMin} onChange={(e) => set("areaMin", e.target.value)} />
            </Field>
            <Field label="Financiamento">
              <Select value={form.financing} onChange={(e) => set("financing", e.target.value)}>
                <option value="">Não informado</option>
                <option value="sim">Sim</option>
                <option value="nao">Não</option>
                <option value="nao_sei">Não sei</option>
              </Select>
            </Field>
            <Field label="FGTS">
              <Select value={form.fgts} onChange={(e) => set("fgts", e.target.value)}>
                <option value="">Não informado</option>
                <option value="sim">Sim</option>
                <option value="nao">Não</option>
                <option value="nao_sei">Não sei</option>
              </Select>
            </Field>
            <Field label="Permuta">
              <Select value={form.tradeIn} onChange={(e) => set("tradeIn", e.target.value)}>
                <option value="">Não informado</option>
                <option value="sim">Sim</option>
                <option value="nao">Não</option>
                <option value="nao_sei">Não sei</option>
              </Select>
            </Field>
            <Field label="Prazo">
              <Select value={form.timeframe} onChange={(e) => set("timeframe", e.target.value)}>
                <option value="">Não informado</option>
                <option value="imediato">Imediato</option>
                <option value="30_dias">Até 30 dias</option>
                <option value="90_dias">Até 90 dias</option>
                <option value="sem_pressa">Sem pressa</option>
              </Select>
            </Field>
            <Field label="Contato preferido">
              <Select
                value={form.contactPreference}
                onChange={(e) => set("contactPreference", e.target.value)}
              >
                <option value="">Não informado</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="ligacao">Ligação</option>
                <option value="email">E-mail</option>
              </Select>
            </Field>
            <Field label="Melhor horário">
              <Input
                value={form.contactWindow}
                onChange={(e) => set("contactWindow", e.target.value)}
              />
            </Field>
          </div>
          <Field label="Resumo da necessidade">
            <Textarea value={form.summary} onChange={(e) => set("summary", e.target.value)} />
          </Field>
          <ErrorNote message={error} />
          <div className="flex justify-end">
            <Btn tone="brass" disabled={update.isPending} onClick={() => void save()}>
              Salvar necessidade
            </Btn>
          </div>
        </div>
      )}

      <div>
        <p className="label-xs text-muted">Timeline</p>
        <ul className="mt-2 divide-y divide-line">
          {(detail.data?.events ?? []).map((event) => (
            <li key={event.id} className="py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="neutral">{event.kind}</Badge>
                <p className="text-sm text-deep">{event.title}</p>
              </div>
              {event.detail && <p className="text-xs text-muted">{event.detail}</p>}
              <p className="text-xs text-muted">
                {ACTOR[event.actorType] ?? event.actorType}
                {event.actorName ? ` · ${event.actorName}` : ""} · {dateTimeLabel(event.createdAt)}
              </p>
            </li>
          ))}
          {(detail.data?.events ?? []).length === 0 && (
            <li className="py-2.5 text-xs text-muted">Nada registrado ainda.</li>
          )}
        </ul>
      </div>
    </div>
  );
}

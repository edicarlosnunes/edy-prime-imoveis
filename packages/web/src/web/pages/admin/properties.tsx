import { useEffect, useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { Archive, Eye, EyeOff, Pencil, Plus, RotateCcw, Star, Trash2 } from "lucide-react";
import { AdminGuard } from "../../components/admin/guard";
import { AdminLayout } from "../../components/admin/layout";
import {
  Badge,
  Btn,
  Card,
  Empty,
  ErrorNote,
  Input,
  Select,
  money,
} from "../../components/admin/ui";
import {
  labelOf,
  propertyStatusLabel,
  propertyStatuses,
  propertyTypeLabel,
  purposeLabel,
} from "../../components/admin/labels";
import { errorMessage } from "../../lib/admin-session";
import {
  useAdminProperties,
  usePatchProperty,
  useRemoveProperty,
  useRestoreProperty,
  useResumePropertyPause,
  useSetCommercialStatus,
} from "../../queries/admin";
import { epiLabel } from "../../../api/lib/epi-code";
import {
  COMMERCIAL_STATUSES,
  COMMERCIAL_STATUS_LABEL,
  COMMERCIAL_STATUS_TONE,
  type CommercialStatus,
} from "../../../api/lib/commercial-status";
import { PropertyForm } from "./property-form";
import { readCaptureId } from "../../lib/capture-conversion-flow";

type StatusFilter = (typeof propertyStatuses)[number] | "";

/**
 * ARQUIVO MORTO — as duas visões da tela.
 *
 * Nunca misturadas: "ativos" é a operação do dia a dia e não mostra nada
 * arquivado; "arquivo" é só o Arquivo Morto, de onde a ficha volta inteira
 * pelo restaurar, com o MESMO código EPI.
 */
type View = "ativos" | "arquivo";

/** Data do arquivamento em português, curta, para o cartão do Arquivo Morto. */
function archivedAtLabel(value: Date | string | number | null | undefined): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/* Item 9 — tons do eixo comercial traduzidos para os tons da UI. */
const COMM_TONE: Record<"ok" | "info" | "neutral" | "warn", "green" | "brass" | "neutral" | "amber"> = {
  ok: "green",
  info: "brass",
  neutral: "neutral",
  warn: "amber",
};

export default function AdminProperties() {
  return (
    <AdminGuard>
      <Content />
    </AdminGuard>
  );
}

function Content() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("");
  const [view, setView] = useState<View>("ativos");
  const [editing, setEditing] = useState<number | "new" | null>(null);
  /**
   * O Radar abre o Cadastro Premium por rota: /admin/imoveis/novo?capture_id=<id>.
   * Ler da rota (e não de estado em memória) faz o prefill sobreviver a refresh.
   */
  const search_ = useSearch();
  const [, navigate] = useLocation();
  const captureId = readCaptureId(search_);
  useEffect(() => {
    if (captureId !== null) setEditing("new");
  }, [captureId]);
  const [error, setError] = useState<string | null>(null);

  const archivedView = view === "arquivo";
  const filters = useMemo(
    () => ({
      search: search.trim() || undefined,
      /* No Arquivo Morto o status comercial não filtra nada: o que importa
         ali é achar a ficha pelo EPI e trazê-la de volta. */
      status: archivedView ? undefined : status || undefined,
      archived: archivedView || undefined,
    }),
    [search, status, archivedView],
  );
  const { data, isLoading } = useAdminProperties(filters);
  const patch = usePatchProperty();
  const remove = useRemoveProperty();
  const restore = useRestoreProperty();
  const commercial = useSetCommercialStatus();
  const resume = useResumePropertyPause();

  async function run(action: Promise<unknown>) {
    setError(null);
    try {
      await action;
    } catch (caught) {
      setError(errorMessage(caught, "Não foi possível salvar"));
    }
  }

  return (
    <AdminLayout
      title="Imóveis"
      subtitle={
        archivedView
          ? "Arquivo Morto — nada foi apagado do banco"
          : "Cadastro que alimenta a vitrine do site"
      }
      actions={
        archivedView ? undefined : (
          <Btn tone="brass" onClick={() => setEditing("new")}>
            <Plus className="h-3.5 w-3.5" /> Novo imóvel
          </Btn>
        )
      }
    >
      <div className="space-y-4">
        {/* ARQUIVO MORTO — troca de visão, nunca listagem misturada. */}
        <div className="flex flex-wrap gap-2">
          <Btn
            tone={archivedView ? "outline" : "brass"}
            onClick={() => setView("ativos")}
          >
            Imóveis ativos
          </Btn>
          <Btn
            tone={archivedView ? "brass" : "outline"}
            onClick={() => setView("arquivo")}
          >
            <Archive className="h-3.5 w-3.5" /> Arquivo Morto
          </Btn>
        </div>

        <Card>
          <div
            className={
              archivedView
                ? "grid grid-cols-1 gap-3"
                : "grid grid-cols-1 gap-3 sm:grid-cols-[1fr_220px]"
            }
          >
            <Input
              placeholder="Buscar por EPI, código, título ou bairro"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            {!archivedView && (
              <Select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)}>
                <option value="">Todos os status</option>
                {propertyStatuses.map((value) => (
                  <option key={value} value={value}>
                    {propertyStatusLabel[value]}
                  </option>
                ))}
              </Select>
            )}
          </div>
        </Card>

        <ErrorNote message={error} />

        {isLoading && <Empty>Carregando imóveis…</Empty>}
        {!isLoading && (data?.length ?? 0) === 0 && (
          <Empty>
            {archivedView
              ? "O Arquivo Morto está vazio. Nenhum imóvel foi arquivado."
              : "Nenhum imóvel encontrado. Clique em “Novo imóvel” para cadastrar."}
          </Empty>
        )}

        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {(data ?? []).map((property) => (
            <Card key={property.id} className="flex gap-4">
              <div className="h-24 w-28 shrink-0 overflow-hidden bg-bone sm:h-28 sm:w-36">
                {property.cover ? (
                  <img src={property.cover} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-[10px] text-muted">
                    sem foto
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  {/* CÓDIGO UNIVERSAL EPI — código oficial do imóvel, somente
                      leitura. O `code` legado continua visível ao lado, porque
                      é o que está impresso no material antigo. */}
                  <Badge tone={property.epiCode ? "deep" : "neutral"}>
                    {epiLabel(property.epiCode)}
                  </Badge>
                  <Badge tone="neutral">{property.code}</Badge>
                  <Badge
                    tone={
                      property.status === "disponivel"
                        ? "green"
                        : property.status === "reservado"
                          ? "amber"
                          : "neutral"
                    }
                  >
                    {labelOf(propertyStatusLabel, property.status)}
                  </Badge>
                  {property.featured === 1 && <Badge tone="brass">destaque</Badge>}
                  <Badge tone={property.published === 1 ? "green" : "red"}>
                    {property.published === 1 ? "publicado" : "oculto"}
                  </Badge>
                  {/* Item 9 — eixo comercial, ao lado do status antigo. */}
                  <Badge tone={COMM_TONE[COMMERCIAL_STATUS_TONE[property.commercialStatus]]}>
                    {COMMERCIAL_STATUS_LABEL[property.commercialStatus]}
                  </Badge>
                  {/* Item 11 — o que não aparece na vitrine ativa do site. */}
                  {!property.showcaseVisible && <Badge tone="red">fora da vitrine</Badge>}
                </div>
                {/* Itens 10 e 11 — regra dos 12 meses: pausa automática, volta humana. */}
                {property.lifecycle.state === "ja_pausado" && (
                  <div className="mt-2 rounded border border-red-400 bg-red-600 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-white">
                    {property.pauseReason || property.lifecycle.label}
                  </div>
                )}
                {property.lifecycle.state === "pausa_devida" && (
                  <div className="mt-2 rounded border border-amber-400 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
                    {property.lifecycle.label} — sairá da vitrine na próxima abertura desta lista.
                  </div>
                )}
                {property.lifecycle.state === "pausa_proxima" && (
                  <div className="mt-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
                    {property.lifecycle.label}
                  </div>
                )}
                {!property.showcaseVisible && property.showcaseReason && (
                  <p className="mt-1 text-[11px] text-muted">{property.showcaseReason}</p>
                )}
                <p className="mt-2 truncate text-sm font-medium text-deep">{property.title}</p>
                <p className="text-xs text-muted">
                  {labelOf(propertyTypeLabel, property.type)} ·{" "}
                  {labelOf(purposeLabel, property.purpose)} · {property.district}, {property.city}
                </p>
                <p className="display mt-1 text-xl text-deep">{money(property.price)}</p>
                <p className="mt-1 text-xs text-muted">
                  {property.bedrooms} dorm · {property.suites} suíte(s) · {property.bathrooms} banh ·{" "}
                  {property.parking} vaga(s) · {property.areaUtil} m² · {property.imageCount} foto(s) ·{" "}
                  {property.views} visitas
                </p>

                {/* ARQUIVO MORTO — por que e quando saiu da operação. */}
                {property.archivedAt && (
                  <div className="mt-2 rounded border border-stone-300 bg-stone-100 px-3 py-2 text-[11px] text-stone-700">
                    Arquivado
                    {archivedAtLabel(property.archivedAt) && ` em ${archivedAtLabel(property.archivedAt)}`}
                    {property.archivedBy && ` por ${property.archivedBy}`}
                    {property.archiveReason ? ` — ${property.archiveReason}` : "."}{" "}
                    Nada foi apagado: restaurar devolve a ficha com o mesmo código.
                  </div>
                )}

                <div className="mt-3 flex flex-wrap gap-2">
                  {archivedView && (
                    <Btn
                      tone="brass"
                      disabled={restore.isPending}
                      onClick={() => {
                        if (
                          !window.confirm(
                            `Restaurar ${epiLabel(property.epiCode)} do Arquivo Morto? A ficha volta com o mesmo código.`,
                          )
                        )
                          return;
                        void run(restore.mutateAsync({ id: property.id }));
                      }}
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> Restaurar
                    </Btn>
                  )}
                  {!archivedView && (
                  <>
                  <Btn tone="outline" onClick={() => setEditing(property.id)}>
                    <Pencil className="h-3.5 w-3.5" /> Editar
                  </Btn>
                  <Btn
                    tone="outline"
                    onClick={() =>
                      run(
                        patch.mutateAsync({
                          id: property.id,
                          published: property.published !== 1,
                        }),
                      )
                    }
                  >
                    {property.published === 1 ? (
                      <>
                        <EyeOff className="h-3.5 w-3.5" /> Despublicar
                      </>
                    ) : (
                      <>
                        <Eye className="h-3.5 w-3.5" /> Publicar
                      </>
                    )}
                  </Btn>
                  <Btn
                    tone="outline"
                    onClick={() =>
                      run(patch.mutateAsync({ id: property.id, featured: property.featured !== 1 }))
                    }
                  >
                    <Star className="h-3.5 w-3.5" />
                    {property.featured === 1 ? "Remover destaque" : "Destacar"}
                  </Btn>
                  <Select
                    className="w-auto py-1.5 text-xs"
                    value={property.status}
                    onChange={(event) =>
                      run(
                        patch.mutateAsync({
                          id: property.id,
                          status: event.target.value as (typeof propertyStatuses)[number],
                        }),
                      )
                    }
                  >
                    {propertyStatuses.map((value) => (
                      <option key={value} value={value}>
                        {propertyStatusLabel[value]}
                      </option>
                    ))}
                  </Select>
                  {/* Item 9 — status comercial; não toca o status antigo nem `published`. */}
                  <Select
                    className="w-auto py-1.5 text-xs"
                    value={property.commercialStatus}
                    disabled={commercial.isPending}
                    onChange={(event) =>
                      run(
                        commercial.mutateAsync({
                          id: property.id,
                          status: event.target.value as CommercialStatus,
                        }),
                      )
                    }
                  >
                    {COMMERCIAL_STATUSES.map((value) => (
                      <option key={value} value={value}>
                        {COMMERCIAL_STATUS_LABEL[value]}
                      </option>
                    ))}
                  </Select>
                  {/* Item 10 — reativar é sempre decisão humana e reinicia a contagem. */}
                  {property.lifecycle.state === "ja_pausado" && (
                    <Btn
                      tone="outline"
                      disabled={resume.isPending}
                      onClick={() => {
                        if (
                          !window.confirm(
                            `Reativar ${property.code}? A contagem dos 12 meses começa de novo hoje.`,
                          )
                        )
                          return;
                        void run(resume.mutateAsync({ id: property.id }));
                      }}
                    >
                      Reativar na vitrine
                    </Btn>
                  )}
                  {/* "Excluir" = ARQUIVAR. Não existe mais exclusão física:
                      a ficha vai para o Arquivo Morto e pode voltar inteira. */}
                  <Btn
                    tone="danger"
                    disabled={remove.isPending}
                    onClick={() => {
                      const reason = window.prompt(
                        `Excluir ${epiLabel(property.epiCode)} (${property.code})?\n\nA ficha NÃO é apagada: vai para o Arquivo Morto e pode ser restaurada com o mesmo código.\n\nMotivo (opcional):`,
                        "",
                      );
                      /* Cancelar no prompt cancela o arquivamento. */
                      if (reason === null) return;
                      void run(
                        remove.mutateAsync({ id: property.id, reason: reason.trim() || undefined }),
                      );
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Excluir
                  </Btn>
                  </>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>

      {editing !== null && (
        <PropertyForm
          propertyId={editing === "new" ? null : editing}
          captureId={editing === "new" ? captureId : null}
          onClose={() => {
            setEditing(null);
            /* Sai do fluxo de captação: a query string não fica presa na tela. */
            if (captureId !== null) navigate("/admin/imoveis");
          }}
        />
      )}
    </AdminLayout>
  );
}

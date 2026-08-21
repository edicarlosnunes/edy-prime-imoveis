import { useMemo, useState } from "react";
import { Eye, EyeOff, Pencil, Plus, Star, Trash2 } from "lucide-react";
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
} from "../../queries/admin";
import { PropertyForm } from "./property-form";

type StatusFilter = (typeof propertyStatuses)[number] | "";

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
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filters = useMemo(
    () => ({
      search: search.trim() || undefined,
      status: status || undefined,
    }),
    [search, status],
  );
  const { data, isLoading } = useAdminProperties(filters);
  const patch = usePatchProperty();
  const remove = useRemoveProperty();

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
      subtitle="Cadastro que alimenta a vitrine do site"
      actions={
        <Btn tone="brass" onClick={() => setEditing("new")}>
          <Plus className="h-3.5 w-3.5" /> Novo imóvel
        </Btn>
      }
    >
      <div className="space-y-4">
        <Card>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_220px]">
            <Input
              placeholder="Buscar por código, título ou bairro"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <Select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)}>
              <option value="">Todos os status</option>
              {propertyStatuses.map((value) => (
                <option key={value} value={value}>
                  {propertyStatusLabel[value]}
                </option>
              ))}
            </Select>
          </div>
        </Card>

        <ErrorNote message={error} />

        {isLoading && <Empty>Carregando imóveis…</Empty>}
        {!isLoading && (data?.length ?? 0) === 0 && (
          <Empty>Nenhum imóvel encontrado. Clique em “Novo imóvel” para cadastrar.</Empty>
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
                  <Badge tone="deep">{property.code}</Badge>
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
                </div>
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

                <div className="mt-3 flex flex-wrap gap-2">
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
                  <Btn
                    tone="danger"
                    onClick={() => {
                      if (!window.confirm(`Excluir o imóvel ${property.code}?`)) return;
                      void run(remove.mutateAsync({ id: property.id }));
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Excluir
                  </Btn>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>

      {editing !== null && (
        <PropertyForm
          propertyId={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </AdminLayout>
  );
}

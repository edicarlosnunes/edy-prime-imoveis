import { Search, X } from "lucide-react";
import { useProperties } from "../../queries/properties";
import { hasAnyFilter, optionsFrom, useSearch, type SearchFilters } from "./search-store";

const priceOptions = [
  { value: "400000", label: "Até R$ 400 mil" },
  { value: "700000", label: "Até R$ 700 mil" },
  { value: "1000000", label: "Até R$ 1 milhão" },
  { value: "1500000", label: "Até R$ 1,5 milhão" },
  { value: "3000000", label: "Até R$ 3 milhões" },
];

const bedroomOptions = [
  { value: "1", label: "1+ dorm." },
  { value: "2", label: "2+ dorm." },
  { value: "3", label: "3+ dorm." },
  { value: "4", label: "4+ dorm." },
];

const purposeLabels: Record<string, string> = {
  venda: "Comprar",
  locacao: "Alugar",
  "locação": "Alugar",
  temporada: "Temporada",
};

function Field({
  label,
  value,
  onChange,
  options,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  placeholder: string;
}) {
  const id = `busca-${label.toLowerCase().replace(/[^a-z]/g, "")}`;
  return (
    <div className="min-w-0">
      <label
        htmlFor={id}
        className="label-xs block text-[10.5px] text-white/45"
      >
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1.5 w-full cursor-pointer truncate border-0 border-b border-white/15 bg-transparent pt-0.5 pb-2 text-[14px] text-white outline-none transition-colors focus:border-brass-soft"
      >
        <option value="" className="bg-deep text-white">
          {placeholder}
        </option>
        {options.map((option) => (
          <option key={option.value} value={option.value} className="bg-deep text-white">
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * Busca do hero. Filtra em memória a vitrine já carregada — sem chamada nova
 * de API e sem inventar opção que não exista nos imóveis publicados.
 */
export function PropertySearch() {
  const properties = useProperties();
  const { filters, setFilter, apply, reset } = useSearch();
  const list = properties.data ?? [];
  const options = optionsFrom(list);
  const active = hasAnyFilter(filters);

  const asOptions = (values: string[], labels?: Record<string, string>) =>
    values.map((value) => ({
      value,
      label: labels?.[value.toLowerCase()] ?? value.charAt(0).toUpperCase() + value.slice(1),
    }));

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    apply();
    document.getElementById("imoveis")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const change = (key: keyof SearchFilters) => (value: string) => setFilter(key, value);

  if (properties.isError) return null;

  return (
    <form
      onSubmit={submit}
      aria-label="Buscar imóveis"
      className="grain relative border border-white/12 bg-deep/75 p-6 backdrop-blur-md sm:p-7"
    >
      <div className="grid gap-x-7 gap-y-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Field
          label="Finalidade"
          value={filters.purpose}
          onChange={change("purpose")}
          options={asOptions(options.purposes, purposeLabels)}
          placeholder="Todas"
        />
        <Field
          label="Cidade"
          value={filters.city}
          onChange={change("city")}
          options={asOptions(options.cities)}
          placeholder="Todas"
        />
        <Field
          label="Bairro"
          value={filters.district}
          onChange={change("district")}
          options={asOptions(options.districts)}
          placeholder="Todos"
        />
        <Field
          label="Tipo"
          value={filters.type}
          onChange={change("type")}
          options={asOptions(options.types)}
          placeholder="Todos"
        />
        <Field
          label="Dormitórios"
          value={filters.bedrooms}
          onChange={change("bedrooms")}
          options={bedroomOptions}
          placeholder="Indiferente"
        />
        <Field
          label="Faixa de preço"
          value={filters.priceMax}
          onChange={change("priceMax")}
          options={priceOptions}
          placeholder="Indiferente"
        />
      </div>

      <div className="mt-7 flex flex-wrap items-center gap-3">
        <button type="submit" data-t="button" className="site-btn site-btn-dark w-full sm:w-auto">
          <Search className="h-3.5 w-3.5" strokeWidth={1.6} />
          Encontrar meu imóvel
        </button>
        {active && (
          <button
            type="button"
            onClick={reset}
            className="label-xs flex items-center gap-1.5 text-white/55 transition-colors hover:text-brass-soft"
          >
            <X className="h-3.5 w-3.5" strokeWidth={1.6} />
            Limpar
          </button>
        )}
      </div>
    </form>
  );
}

/**
 * Navegação por seções do cadastro de imóveis.
 *
 * Livre: qualquer seção pode ser aberta a qualquer momento. Não existe etapa
 * obrigatória — o preenchimento é progressivo e o salvamento é único.
 */
import type { LucideIcon } from "lucide-react";
import { cn } from "../../lib/utils";

export interface FormSection {
  id: string;
  label: string;
  short: string;
  icon: LucideIcon;
}

export function PropertyFormNav({
  sections,
  active,
  onSelect,
  pendingBySection,
}: {
  sections: readonly FormSection[];
  active: string;
  onSelect: (id: string) => void;
  /** quantidade de itens pendentes por seção, só como sinal visual */
  pendingBySection: Record<string, number>;
}) {
  return (
    <nav aria-label="Seções do cadastro">
      {/* mobile / tablet: faixa rolável, sem overflow horizontal quebrado */}
      <ul className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2 lg:hidden">
        {sections.map((section, index) => {
          const selected = section.id === active;
          const pending = pendingBySection[section.id] ?? 0;
          return (
            <li key={section.id} className="shrink-0">
              <button
                type="button"
                onClick={() => onSelect(section.id)}
                aria-current={selected ? "step" : undefined}
                className={cn(
                  "flex items-center gap-2 rounded-full border px-3 py-2 text-xs whitespace-nowrap transition-colors",
                  selected
                    ? "border-brass bg-brass text-white"
                    : "border-line bg-white text-deep hover:bg-bone/50",
                )}
              >
                <span className={cn("text-[10px]", selected ? "text-white/80" : "text-muted")}>
                  {index + 1}
                </span>
                {section.short}
                {pending > 0 && !selected && (
                  <span className="h-1.5 w-1.5 rounded-full bg-brass" aria-hidden />
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {/* desktop: lista lateral */}
      <ul className="hidden lg:block lg:space-y-1">
        {sections.map((section, index) => {
          const selected = section.id === active;
          const pending = pendingBySection[section.id] ?? 0;
          const Icon = section.icon;
          return (
            <li key={section.id}>
              <button
                type="button"
                onClick={() => onSelect(section.id)}
                aria-current={selected ? "step" : undefined}
                className={cn(
                  "flex w-full items-center gap-3 rounded-[10px] border px-3 py-2.5 text-left text-sm transition-colors",
                  selected
                    ? "border-brass/50 bg-brass/10 text-deep"
                    : "border-transparent text-muted hover:border-line hover:bg-white",
                )}
              >
                <span
                  className={cn(
                    "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px]",
                    selected ? "bg-brass text-white" : "bg-bone/70 text-muted",
                  )}
                >
                  {index + 1}
                </span>
                <Icon className={cn("h-4 w-4 shrink-0", selected ? "text-brass" : "text-muted")} />
                <span className="flex-1 truncate">{section.label}</span>
                {pending > 0 && (
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-brass"
                    title={`${pending} item(ns) por preencher`}
                  />
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

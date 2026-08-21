import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Btn, Field, Input, Textarea } from "../ui";
import type { SiteContent } from "../../../lib/site-content";

/** Aplica uma alteração no conteúdo em edição (imutável, feita no editor). */
export type Patch = (recipe: (draft: SiteContent) => void) => void;

export interface TabProps {
  content: SiteContent;
  patch: Patch;
}

export function Row({ children, cols = 2 }: { children: ReactNode; cols?: 1 | 2 | 3 }) {
  const grid = cols === 1 ? "" : cols === 2 ? "sm:grid-cols-2" : "sm:grid-cols-3";
  return <div className={`grid gap-4 ${grid}`}>{children}</div>;
}

export function Group({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[4px] border border-line bg-white/80 p-5">
      <header className="mb-4">
        <h3 className="display text-xl text-deep">{title}</h3>
        {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
      </header>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

export function TextRow({
  label,
  value,
  onChange,
  hint,
  placeholder,
  lines,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  placeholder?: string;
  lines?: number;
}) {
  return (
    <Field label={label} hint={hint}>
      {lines ? (
        <Textarea
          value={value}
          rows={lines}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <Input
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  );
}

export function NumberRow({
  label,
  value,
  onChange,
  min,
  max,
  step,
  hint,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={min}
          max={max}
          step={step ?? 1}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          className="h-1 flex-1 accent-[color:var(--color-brass)]"
        />
        <span className="w-14 shrink-0 text-right text-sm text-muted">{value}</span>
      </div>
    </Field>
  );
}

export function ColorRow({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : "#000000"}
          onChange={(event) => onChange(event.target.value)}
          className="h-10 w-12 shrink-0 cursor-pointer rounded-[3px] border border-line bg-white p-1"
        />
        <Input value={value} onChange={(event) => onChange(event.target.value)} />
      </div>
    </Field>
  );
}

export function Toggle({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  hint?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-[3px] border border-line bg-white px-3 py-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 accent-[color:var(--color-brass)]"
      />
      <span>
        <span className="block text-sm text-ink">{label}</span>
        {hint && <span className="mt-0.5 block text-[11px] text-muted">{hint}</span>}
      </span>
    </label>
  );
}

/** Lista editável genérica: reordenar, remover e adicionar itens. */
export function ListBlock<T extends { id: string }>({
  items,
  onChange,
  onAdd,
  render,
  addLabel,
  itemLabel,
}: {
  items: T[];
  onChange: (items: T[]) => void;
  onAdd: () => void;
  render: (item: T, update: (patch: Partial<T>) => void, index: number) => ReactNode;
  addLabel: string;
  itemLabel?: (item: T, index: number) => string;
}) {
  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    onChange(next);
  }

  return (
    <div className="space-y-3">
      {items.map((item, index) => (
        <div key={item.id} className="rounded-[3px] border border-line bg-paper/60 p-4">
          <header className="mb-3 flex items-center justify-between gap-2">
            <span className="label-xs text-muted">
              {itemLabel ? itemLabel(item, index) : `Item ${index + 1}`}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label="Mover para cima"
                onClick={() => move(index, -1)}
                className="rounded-[3px] p-1.5 text-muted hover:bg-bone/60 hover:text-deep"
              >
                <ArrowUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                aria-label="Mover para baixo"
                onClick={() => move(index, 1)}
                className="rounded-[3px] p-1.5 text-muted hover:bg-bone/60 hover:text-deep"
              >
                <ArrowDown className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                aria-label="Remover item"
                onClick={() => onChange(items.filter((_, i) => i !== index))}
                className="rounded-[3px] p-1.5 text-red-600 hover:bg-red-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </header>
          <div className="space-y-3">
            {render(
              item,
              (partial) =>
                onChange(items.map((current, i) => (i === index ? { ...current, ...partial } : current))),
              index,
            )}
          </div>
        </div>
      ))}
      <Btn tone="outline" onClick={onAdd}>
        <Plus className="h-3.5 w-3.5" /> {addLabel}
      </Btn>
    </div>
  );
}

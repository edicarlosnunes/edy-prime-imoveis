import { ReactNode } from "react";
import { cn } from "../../lib/utils";
import { parseMoneyInput, formatMoneyInput } from "../../lib/money-input";
import { Minus, Plus } from "lucide-react";

export function CompactCard({ icon, title, children, action }: { icon?: ReactNode, title: string, children: ReactNode, action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4 border-b border-white/10 pb-3">
        <div className="flex items-center gap-2">
          {icon}
          <h2 className="text-sm font-semibold text-white">{title}</h2>
        </div>
        {action && <div>{action}</div>}
      </div>
      {children}
    </div>
  );
}

export function CompactField({ label, required, optional, children, className }: { label: string, required?: boolean, optional?: boolean, children: ReactNode, className?: string }) {
  return (
    <label className={cn("block", className)}>
      <span className="text-[11px] font-medium text-slate-300 mb-1.5 block">
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
        {optional && <span className="text-slate-500 font-normal ml-1">(opcional)</span>}
      </span>
      {children}
    </label>
  );
}

const inputBase = "block w-full bg-black/20 border border-white/10 rounded text-xs text-slate-200 focus:border-brass focus:ring-1 focus:ring-brass/20 px-3 py-2 outline-none placeholder:text-slate-500 transition-colors";

export function CompactInput(props: React.ComponentProps<"input">) {
  return <input {...props} className={cn(inputBase, props.className)} />;
}

export function CompactSelect(props: React.ComponentProps<"select">) {
  return <select {...props} className={cn(inputBase, "appearance-none pr-8 bg-[url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20width%3D%2224%22%20height%3D%2224%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20fill%3D%22none%22%20stroke%3D%22%2394a3b8%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpolyline%20points%3D%226%209%2012%2015%2018%209%22%2F%3E%3C%2Fsvg%3E')] bg-[length:1em_1em] bg-no-repeat bg-[position:right_0.5rem_center]", props.className)} />;
}

export function CompactTextarea(props: React.ComponentProps<"textarea">) {
  return <textarea {...props} className={cn(inputBase, "min-h-[80px] resize-y", props.className)} />;
}

export function CompactMoneyInput({
  value,
  onChange,
  className,
  ...rest
}: Omit<React.ComponentProps<"input">, "value" | "onChange"> & {
  value: string;
  onChange: (next: string) => void;
}) {
  function reformat() {
    if (!value.trim()) return;
    try {
      const parsed = parseMoneyInput(value);
      if (parsed !== null) onChange(formatMoneyInput(parsed));
    } catch {
      // ignore
    }
  }
  return (
    <div className="relative">
      <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-xs text-slate-500 font-medium">
        R$
      </span>
      <input
        {...rest}
        value={value}
        inputMode="decimal"
        onChange={(event) => onChange(event.target.value)}
        onBlur={reformat}
        className={cn(inputBase, "pl-8 text-right tabular-nums", className)}
      />
    </div>
  );
}

export function CompactCountInput({
  value,
  onChange,
  max = 40,
}: {
  value: string;
  onChange: (next: string) => void;
  max?: number;
}) {
  const current = Math.trunc(Number(value.replace(",", ".")));
  const safe = Number.isFinite(current) ? current : 0;

  function step(delta: 1 | -1) {
    const next = Math.min(max, Math.max(0, safe + delta));
    onChange(String(next));
  }

  return (
    <div className="flex items-stretch gap-1">
      <button
        type="button"
        onClick={() => step(-1)}
        disabled={safe <= 0}
        className="flex w-7 shrink-0 items-center justify-center rounded border border-white/10 bg-white/5 text-slate-400 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"
      >
        <Minus className="h-3 w-3" />
      </button>
      <input
        value={value}
        inputMode="numeric"
        onChange={(event) => onChange(event.target.value)}
        className={cn(inputBase, "min-w-0 flex-1 px-1 text-center tabular-nums !py-1.5")}
      />
      <button
        type="button"
        onClick={() => step(1)}
        disabled={safe >= max}
        className="flex w-7 shrink-0 items-center justify-center rounded border border-white/10 bg-white/5 text-slate-400 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"
      >
        <Plus className="h-3 w-3" />
      </button>
    </div>
  );
}

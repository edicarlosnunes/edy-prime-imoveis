import type { ReactNode } from "react";
import { useEffect } from "react";
import { X } from "lucide-react";
import { cn } from "../../lib/utils";

/* ------------------------------------------------------------- formatação */

export function money(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  });
}

export function shortMoney(value: number | null | undefined) {
  if (!value) return "R$ 0";
  if (value >= 1_000_000) return `R$ ${(value / 1_000_000).toFixed(2).replace(".", ",")} mi`;
  if (value >= 1000) return `R$ ${Math.round(value / 1000)} mil`;
  return money(value);
}

export function dateLabel(value: Date | string | number | null | undefined) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function dateTimeLabel(value: Date | string | number | null | undefined) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** yyyy-MM-ddTHH:mm para inputs datetime-local */
export function toInputDateTime(value: Date | string | number | null | undefined) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function digits(value: string) {
  return value.replace(/\D/g, "");
}

export function waLink(phone: string, message?: string) {
  const raw = digits(phone);
  const withCountry = raw.startsWith("55") ? raw : `55${raw}`;
  const text = message ? `?text=${encodeURIComponent(message)}` : "";
  return `https://wa.me/${withCountry}${text}`;
}

/* --------------------------------------------------------------- blocos */

export function Card({
  children,
  className,
  title,
  action,
}: {
  children: ReactNode;
  className?: string;
  title?: string;
  action?: ReactNode;
}) {
  return (
    <section
      className={cn(
        "rounded-[4px] border border-line bg-white p-5 shadow-[0_1px_0_rgba(18,20,15,0.06)]",
        className,
      )}
    >
      {(title || action) && (
        <header className="mb-4 flex items-center justify-between gap-3">
          {title && <h2 className="label-xs text-deep">{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
}) {
  return (
    <div className="rounded-[4px] border border-line bg-white px-4 py-4">
      <p className="label-xs text-muted">{label}</p>
      <p className="admin-stat display mt-2 text-3xl text-deep">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

const badgeTones: Record<string, string> = {
  neutral: "bg-bone/70 text-deep",
  green: "bg-emerald-100 text-emerald-800",
  amber: "bg-amber-100 text-amber-800",
  red: "bg-red-100 text-red-700",
  brass: "bg-brass/20 text-brass",
  deep: "bg-deep text-white",
};

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: keyof typeof badgeTones;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium whitespace-nowrap",
        badgeTones[tone],
      )}
    >
      {children}
    </span>
  );
}

const buttonTones = {
  primary: "bg-deep text-white hover:bg-deep/85",
  brass: "bg-brass text-white hover:bg-brass/85",
  outline: "border border-line bg-white text-deep hover:bg-bone/50",
  danger: "border border-red-200 bg-white text-red-700 hover:bg-red-50",
  ghost: "text-deep hover:bg-bone/60",
};

export function Btn({
  children,
  tone = "primary",
  className,
  ...rest
}: React.ComponentProps<"button"> & { tone?: keyof typeof buttonTones }) {
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-[3px] px-4 py-2.5 text-xs font-medium tracking-wide uppercase transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        buttonTones[tone],
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Field({
  label,
  children,
  hint,
  className,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  className?: string;
}) {
  return (
    <label className={cn("block", className)}>
      <span className="label-xs text-muted">{label}</span>
      <div className="mt-1.5">{children}</div>
      {hint && <span className="mt-1 block text-[11px] text-muted">{hint}</span>}
    </label>
  );
}

const controlClass =
  "w-full rounded-[3px] border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none transition-colors placeholder:text-muted focus:border-brass";

export function Input({ className, ...rest }: React.ComponentProps<"input">) {
  return <input {...rest} className={cn(controlClass, className)} />;
}

export function Textarea({ className, ...rest }: React.ComponentProps<"textarea">) {
  return <textarea {...rest} className={cn(controlClass, "min-h-24 resize-y", className)} />;
}

export function Select({ className, children, ...rest }: React.ComponentProps<"select">) {
  return (
    <select {...rest} className={cn(controlClass, "appearance-none pr-8", className)}>
      {children}
    </select>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/50 p-4 sm:p-8">
      <div
        className={cn(
          "w-full rounded-[4px] border border-line bg-paper shadow-xl",
          wide ? "max-w-4xl" : "max-w-xl",
        )}
      >
        <header className="flex items-center justify-between gap-4 border-b border-line px-5 py-4">
          <h2 className="display text-2xl text-deep">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-full p-1.5 text-muted hover:bg-bone/60 hover:text-deep"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="px-5 py-5">{children}</div>
      </div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-[4px] border border-dashed border-line px-6 py-10 text-center text-sm text-muted">
      {children}
    </div>
  );
}

export function ErrorNote({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <p className="rounded-[3px] border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
      {message}
    </p>
  );
}

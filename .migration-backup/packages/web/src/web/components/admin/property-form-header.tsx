/**
 * Cabeçalho do cadastro de imóveis.
 *
 * Resumo dinâmico do que já foi preenchido — puramente derivado do estado do
 * formulário, sem nenhuma chamada extra.
 */
import { Badge } from "./ui";
import { cn } from "../../lib/utils";

export function PropertyFormHeader({
  isNew,
  code,
  typeLabel,
  district,
  statusLabel,
  ownerLinked,
  imageCount,
  percent,
}: {
  isNew: boolean;
  code: string;
  typeLabel: string;
  district: string;
  statusLabel: string;
  ownerLinked: boolean;
  imageCount: number;
  percent: number;
}) {
  const line = [code.trim().toUpperCase(), typeLabel, district.trim()].filter(
    (part) => part.length > 0,
  );

  const meta = [
    statusLabel,
    ownerLinked ? "Proprietário vinculado" : "Proprietário pendente",
    `${imageCount} ${imageCount === 1 ? "foto" : "fotos"}`,
    `Cadastro ${percent}%`,
  ];

  return (
    <header className="rounded-[10px] border border-line bg-white px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="display truncate text-xl text-deep sm:text-2xl">
            {isNew && line.length === 0 ? "Novo imóvel" : line.join(" · ") || "Novo imóvel"}
          </p>
          <p className="mt-1.5 text-[11px] text-muted sm:text-xs">{meta.join(" · ")}</p>
        </div>

        <div className="flex items-center gap-2">
          <Badge tone={ownerLinked ? "green" : "amber"}>
            {ownerLinked ? "Proprietário vinculado" : "Proprietário pendente"}
          </Badge>
          <Badge tone="brass">{percent}%</Badge>
        </div>
      </div>

      <div
        className="mt-3.5 h-1 w-full overflow-hidden rounded-full bg-bone/70"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Preenchimento do cadastro"
      >
        <div
          className={cn("h-full rounded-full bg-brass transition-[width] duration-300")}
          style={{ width: `${percent}%` }}
        />
      </div>
    </header>
  );
}

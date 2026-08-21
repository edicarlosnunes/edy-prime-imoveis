/** Selo do Lead Score (F4.1). Score determinístico, motivos explicáveis. */

export type Tier = "quente" | "morno" | "frio" | string;

const TONE: Record<string, string> = {
  quente: "border-red-200 bg-red-50 text-red-700",
  morno: "border-amber-200 bg-amber-50 text-amber-700",
  frio: "border-line bg-bone/60 text-muted",
};

export const tierLabel: Record<string, string> = {
  quente: "Quente",
  morno: "Morno",
  frio: "Frio",
};

export function ScoreBadge({
  score,
  tier,
  title,
}: {
  score: number;
  tier: Tier;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-[3px] border px-2 py-0.5 text-xs font-medium ${
        TONE[tier] ?? TONE.frio
      }`}
    >
      <span className="tabular-nums">{score}</span>
      <span className="uppercase tracking-wide">{tierLabel[tier] ?? tier}</span>
    </span>
  );
}

/** Lista de motivos do score, do jeito que o corretor lê. */
export function ScoreReasons({ reasons }: { reasons: string[] }) {
  if (reasons.length === 0) {
    return <p className="text-xs text-muted">Sem dados suficientes para pontuar.</p>;
  }
  return (
    <ul className="space-y-1">
      {reasons.map((reason) => (
        <li key={reason} className="text-xs text-muted">
          · {reason}
        </li>
      ))}
    </ul>
  );
}

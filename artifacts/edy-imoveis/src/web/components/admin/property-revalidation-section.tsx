/**
 * Seção "Revalidação" do cadastro de imóveis (V2).
 *
 * Regras que esta tela protege:
 * - o ciclo de 4 meses nasce da ENTRADA NA CARTEIRA, nunca do Radar nem de
 *   pré-captação;
 * - registrar um desfecho NUNCA altera `properties.status` — a API só sugere,
 *   a mudança de status continua sendo decisão humana na seção Publicação;
 * - "sem resposta" não apaga nada: reagenda curto e segue pendente;
 * - só imóveis disponíveis participam do ciclo.
 *
 * Grava direto na API, fora do botão "Salvar imóvel".
 */
import { useMemo, useState } from "react";
import { CalendarClock, History } from "lucide-react";
import { Badge, Btn, Empty, ErrorNote, Field, Input, Select, dateLabel } from "./ui";
import { errorMessage } from "../../lib/admin-session";
import {
  REVALIDATION_OUTCOMES,
  REVALIDATION_OUTCOME_LABEL,
  type RevalidationOutcome,
  type RevalidationState,
  revalidationView,
  suggestedStatusChange,
} from "../../lib/property-revalidation";
import {
  usePropertyDocs,
  useRegisterRevalidation,
  useSetPortfolioEntry,
} from "../../queries/admin";

/** oRPC devolve Date, mas normalizamos para aceitar string/number também. */
function toDate(value: Date | string | number | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** yyyy-mm-dd em horário local, para o <input type="date">. */
function toDateInput(value: Date | null): string {
  if (!value) return "";
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${value.getFullYear()}-${month}-${day}`;
}

const STATE_TONE: Record<RevalidationState, "neutral" | "amber" | "green" | "red" | "brass"> = {
  nao_definida: "amber",
  fora_do_ciclo: "neutral",
  encerrada: "neutral",
  pendente_sem_resposta: "amber",
  em_dia: "green",
  vence_em_breve: "amber",
  vencida: "red",
};

export function PropertyRevalidationSection({ propertyId }: { propertyId: number | null }) {
  const docs = usePropertyDocs(propertyId);
  const setPortfolioEntry = useSetPortfolioEntry();
  const registerRevalidation = useRegisterRevalidation();

  const [error, setError] = useState<string | null>(null);
  const [entryDate, setEntryDate] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<RevalidationOutcome>("disponivel");
  const [note, setNote] = useState("");
  const [suggestion, setSuggestion] = useState<string | null>(null);

  const data = docs.data;
  const revalidation = data?.revalidation;

  const portfolioEntryAt = toDate(revalidation?.portfolioEntryAt);
  const lastOutcome = (revalidation?.revalidationStatus as RevalidationOutcome | null) ?? null;

  const view = useMemo(
    () =>
      revalidationView(
        {
          status: revalidation?.status ?? "disponivel",
          portfolioEntryAt,
          lastRevalidationAt: toDate(revalidation?.lastRevalidationAt),
          nextRevalidationAt: toDate(revalidation?.nextRevalidationAt),
          lastOutcome,
        },
        new Date(),
      ),
    [
      revalidation?.status,
      revalidation?.lastRevalidationAt,
      revalidation?.nextRevalidationAt,
      portfolioEntryAt,
      lastOutcome,
    ],
  );

  if (propertyId === null) {
    return (
      <Empty>
        Salve o imóvel primeiro. O ciclo de revalidação começa a contar a partir da entrada na
        carteira, informada aqui depois que o cadastro existe.
      </Empty>
    );
  }

  if (docs.isLoading) return <p className="text-sm text-muted">Carregando revalidação…</p>;

  const entryValue = entryDate ?? toDateInput(portfolioEntryAt);

  async function saveEntry(value: string | null) {
    setError(null);
    try {
      await setPortfolioEntry.mutateAsync({ propertyId: propertyId!, date: value });
    } catch (caught) {
      setError(errorMessage(caught, "Não foi possível salvar a entrada na carteira"));
    }
  }

  async function register() {
    setError(null);
    setSuggestion(null);
    try {
      await registerRevalidation.mutateAsync({
        propertyId: propertyId!,
        outcome,
        note: note.trim() || null,
      });
      setNote("");
      const suggested = suggestedStatusChange(outcome);
      if (suggested) {
        setSuggestion(
          `Desfecho registrado. O status do imóvel NÃO foi alterado automaticamente — se fizer sentido, mude para “${suggested}” na seção Publicação.`,
        );
      }
    } catch (caught) {
      setError(errorMessage(caught, "Não foi possível registrar a revalidação"));
    }
  }

  return (
    <div className="space-y-6">
      <ErrorNote message={error} />

      {/* -------------------------------------------------------- estado */}
      <div className="rounded-[10px] border border-line bg-bone/30 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <CalendarClock className="h-4 w-4 text-muted" />
          <Badge tone={STATE_TONE[view.state]}>{view.label}</Badge>
          {view.dueAt && (
            <span className="text-[11px] text-muted">Próxima: {dateLabel(view.dueAt)}</span>
          )}
        </div>
        <dl className="mt-3 grid grid-cols-1 gap-2 text-[11px] text-muted sm:grid-cols-3">
          <div>
            <dt className="label-xs">Entrada na carteira</dt>
            <dd className="text-deep">{portfolioEntryAt ? dateLabel(portfolioEntryAt) : "—"}</dd>
          </div>
          <div>
            <dt className="label-xs">Última revalidação</dt>
            <dd className="text-deep">
              {revalidation?.lastRevalidationAt
                ? dateLabel(toDate(revalidation.lastRevalidationAt))
                : "—"}
            </dd>
          </div>
          <div>
            <dt className="label-xs">Último desfecho</dt>
            <dd className="text-deep">
              {lastOutcome ? (REVALIDATION_OUTCOME_LABEL[lastOutcome] ?? lastOutcome) : "—"}
            </dd>
          </div>
        </dl>
      </div>

      {/* ------------------------------------------------------- carteira */}
      <div className="border-t border-line pt-4">
        <p className="label-xs text-muted">Entrada na carteira</p>
        <p className="mt-1 text-[11px] text-muted">
          Origem do ciclo de 4 meses. Imóveis antigos ficam sem data até alguém informar — nada é
          preenchido automaticamente para não vencer a carteira inteira de uma vez.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <Field label="Data de entrada" className="w-full sm:w-56">
            <Input
              type="date"
              value={entryValue}
              onChange={(e) => setEntryDate(e.target.value)}
            />
          </Field>
          <Btn
            tone="outline"
            disabled={setPortfolioEntry.isPending || !entryValue}
            onClick={() => void saveEntry(entryValue || null)}
          >
            Salvar entrada
          </Btn>
          {portfolioEntryAt && (
            <Btn
              tone="ghost"
              disabled={setPortfolioEntry.isPending}
              onClick={() => {
                setEntryDate("");
                void saveEntry(null);
              }}
            >
              Limpar
            </Btn>
          )}
        </div>
      </div>

      {/* ----------------------------------------------------- desfecho */}
      <div className="border-t border-line pt-4">
        <p className="label-xs text-muted">Registrar contato de revalidação</p>
        <p className="mt-1 text-[11px] text-muted">
          O status do imóvel nunca muda sozinho aqui. Disponível e “alterou condições” reiniciam os
          4 meses; “retornar depois” reagenda 2 meses; “sem resposta” volta em 15 dias e segue
          pendente; vendido e “não deseja vender” encerram o ciclo preservando o histórico.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Desfecho">
            <Select
              value={outcome}
              onChange={(e) => setOutcome(e.target.value as RevalidationOutcome)}
            >
              {REVALIDATION_OUTCOMES.map((value) => (
                <option key={value} value={value}>
                  {REVALIDATION_OUTCOME_LABEL[value]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Observação (opcional)">
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="O que o proprietário respondeu"
            />
          </Field>
        </div>
        <div className="mt-3">
          <Btn
            tone="brass"
            disabled={registerRevalidation.isPending}
            onClick={() => void register()}
          >
            {registerRevalidation.isPending ? "Registrando…" : "Registrar revalidação"}
          </Btn>
        </div>
        {suggestion && (
          <p className="mt-3 rounded-[10px] border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-900">
            {suggestion}
          </p>
        )}
      </div>

      {/* ----------------------------------------------------- histórico */}
      <div className="border-t border-line pt-4">
        <p className="flex items-center gap-2 label-xs text-muted">
          <History className="h-3.5 w-3.5" />
          Histórico de revalidações
        </p>
        {(data?.revalidations ?? []).length === 0 ? (
          <div className="mt-3">
            <Empty>Nenhuma revalidação registrada até agora.</Empty>
          </div>
        ) : (
          <ul className="mt-3 space-y-2">
            {(data?.revalidations ?? []).map((row) => {
              const key = row.outcome as RevalidationOutcome;
              return (
                <li key={row.id} className="rounded-[10px] border border-line p-3">
                  <p className="flex flex-wrap items-center gap-2 text-sm text-deep">
                    <Badge>{REVALIDATION_OUTCOME_LABEL[key] ?? row.outcome}</Badge>
                    <span className="text-[11px] text-muted">
                      {dateLabel(toDate(row.revalidatedAt))}
                      {row.userName ? ` · ${row.userName}` : ""}
                    </span>
                  </p>
                  {row.note && <p className="mt-1 text-[11px] text-muted">{row.note}</p>}
                  <p className="mt-1 text-[11px] text-muted">
                    {row.nextDueAt
                      ? `Próxima em ${dateLabel(toDate(row.nextDueAt))}`
                      : "Ciclo encerrado"}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

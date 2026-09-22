/**
 * Seção "Documentação" do cadastro de imóveis (V2).
 *
 * Regras que esta tela protege:
 * - checklist e documento são independentes: dá para responder tudo sem anexar
 *   um único arquivo;
 * - RECEBIDO não é REGULAR — o status do documento é sempre explícito;
 * - blocos condicionais só aparecem quando a condição correspondente está
 *   ligada. "Pertence a condomínio?" é pergunta independente: casa fora de
 *   condomínio nunca vê o bloco de condomínio;
 * - documentos NUNCA usam a galeria de fotos (/api/media/:id é rota pública).
 *   Aqui tudo passa por /api/admin/doc-upload e /api/admin/doc/:id.
 *
 * Diferente do resto do formulário, esta seção grava direto na API a cada
 * ação — não espera o botão "Salvar imóvel".
 */
import { useMemo, useState } from "react";
import { AlertTriangle, FileText, Paperclip, Trash2 } from "lucide-react";
import { Badge, Btn, Empty, ErrorNote, Field, Input, Select } from "./ui";
import { cn } from "../../lib/utils";
import { errorMessage, uploadDocument } from "../../lib/admin-session";
import {
  CHECKLIST_ANSWERS,
  CHECKLIST_ANSWER_LABEL,
  CHECKLIST_BLOCK_LABEL,
  DOC_CATEGORIES,
  DOC_CATEGORY_LABEL,
  DOC_STATUSES,
  DOC_STATUS_LABEL,
  type BlockConditions,
  type ChecklistAnswer,
  type ChecklistBlock,
  type DocCategory,
  type DocStatus,
  checklistAlerts,
  documentSummary,
  visibleBlocks,
  visibleChecklistItems,
} from "../../lib/property-docs-catalog";
import {
  useCreatePropertyDocument,
  useDeletePropertyDocument,
  usePropertyDocs,
  useSaveChecklistItem,
  useSaveDocConditions,
  useUpdateDocumentStatus,
} from "../../queries/admin";

/** int do SQLite (0/1/null) -> tri-state. */
function toTri(value: number | null | undefined): boolean | null {
  if (value === null || value === undefined) return null;
  return value === 1;
}

const CONDITION_KEYS = [
  "inCondominium",
  "hasHeranca",
  "hasPosse",
  "hasFinanciamento",
  "hasAluguel",
] as const;
type ConditionKey = (typeof CONDITION_KEYS)[number];

const CONDITION_LABEL: Record<ConditionKey, string> = {
  inCondominium: "O imóvel pertence a um condomínio?",
  hasHeranca: "Envolve herança, espólio ou inventário?",
  hasPosse: "A negociação é de posse / cessão de direitos?",
  hasFinanciamento: "Existe financiamento ou alienação fiduciária?",
  hasAluguel: "O imóvel está ocupado ou alugado?",
};

const CONDITION_HINT: Record<ConditionKey, string> = {
  inCondominium: "Pergunta independente do tipo: casa fora de condomínio responde NÃO.",
  hasHeranca: "Liga o bloco de herança no checklist.",
  hasPosse: "Liga o bloco de posse no checklist.",
  hasFinanciamento: "Liga o bloco de financiamento no checklist.",
  hasAluguel: "Liga o bloco de ocupação / locação no checklist.",
};

const DOC_STATUS_TONE: Record<DocStatus, "neutral" | "amber" | "green" | "red" | "brass"> = {
  recebido: "neutral",
  aguardando_analise: "amber",
  analisado: "brass",
  regular: "green",
  pendencia: "red",
};

type TriState = boolean | null;

function TriToggle({
  value,
  onChange,
  disabled,
}: {
  value: TriState;
  onChange: (next: TriState) => void;
  disabled?: boolean;
}) {
  const options: { label: string; value: TriState }[] = [
    { label: "SIM", value: true },
    { label: "NÃO", value: false },
    { label: "NÃO SABE", value: null },
  ];
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((option) => (
        <button
          key={option.label}
          type="button"
          disabled={disabled}
          onClick={() => onChange(option.value)}
          className={cn(
            "rounded-full border px-3 py-1.5 text-[11px] font-medium transition-colors disabled:opacity-50",
            value === option.value
              ? "border-brass bg-brass text-white"
              : "border-line bg-white text-muted hover:bg-bone/60",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function PropertyDocsSection({ propertyId }: { propertyId: number | null }) {
  const docs = usePropertyDocs(propertyId);
  const saveConditions = useSaveDocConditions();
  const saveChecklistItem = useSaveChecklistItem();
  const createDocument = useCreatePropertyDocument();
  const updateDocumentStatus = useUpdateDocumentStatus();
  const deleteDocument = useDeletePropertyDocument();

  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [newCategory, setNewCategory] = useState<DocCategory>("matricula");
  const [newTitle, setNewTitle] = useState("");
  const [newFile, setNewFile] = useState<File | null>(null);

  const data = docs.data;

  const conditions: BlockConditions = useMemo(() => {
    const raw = data?.conditions;
    return {
      inCondominium: toTri(raw?.inCondominium) === true,
      heranca: toTri(raw?.hasHeranca) === true,
      posse: toTri(raw?.hasPosse) === true,
      financiamento: toTri(raw?.hasFinanciamento) === true,
      aluguel: toTri(raw?.hasAluguel) === true,
    };
  }, [data?.conditions]);

  const answers = useMemo(() => {
    const map: Record<string, ChecklistAnswer | undefined> = {};
    for (const row of data?.checklist ?? []) {
      map[row.itemKey] = row.answer as ChecklistAnswer;
    }
    return map;
  }, [data?.checklist]);

  const notes = useMemo(() => {
    const map: Record<string, string> = {};
    for (const row of data?.checklist ?? []) {
      if (row.note) map[row.itemKey] = row.note;
    }
    return map;
  }, [data?.checklist]);

  const items = useMemo(() => visibleChecklistItems(conditions), [conditions]);
  const alerts = useMemo(() => checklistAlerts(conditions, answers), [conditions, answers]);
  const blocks = useMemo(() => visibleBlocks(conditions), [conditions]);

  const summary = useMemo(
    () =>
      documentSummary(
        (data?.documents ?? []).map((doc) => ({
          status: doc.status as DocStatus,
          hasFile: Boolean(doc.fileId),
        })),
      ),
    [data?.documents],
  );

  if (propertyId === null) {
    return (
      <Empty>
        Salve o imóvel primeiro. A documentação e a revalidação ficam vinculadas ao cadastro e são
        gravadas separadamente, fora do botão “Salvar imóvel”.
      </Empty>
    );
  }

  if (docs.isLoading) return <p className="text-sm text-muted">Carregando documentação…</p>;

  const busy = saveConditions.isPending || saveChecklistItem.isPending;

  async function changeCondition(key: ConditionKey, next: TriState) {
    setError(null);
    const raw = data?.conditions;
    const current: Record<ConditionKey, TriState> = {
      inCondominium: toTri(raw?.inCondominium),
      hasHeranca: toTri(raw?.hasHeranca),
      hasPosse: toTri(raw?.hasPosse),
      hasFinanciamento: toTri(raw?.hasFinanciamento),
      hasAluguel: toTri(raw?.hasAluguel),
    };
    current[key] = next;
    try {
      await saveConditions.mutateAsync({ propertyId: propertyId!, ...current });
    } catch (caught) {
      setError(errorMessage(caught, "Não foi possível salvar as condições"));
    }
  }

  async function answer(itemKey: string, value: ChecklistAnswer) {
    setError(null);
    try {
      await saveChecklistItem.mutateAsync({
        propertyId: propertyId!,
        itemKey,
        answer: value,
        note: notes[itemKey] ?? null,
      });
    } catch (caught) {
      setError(errorMessage(caught, "Não foi possível salvar a resposta"));
    }
  }

  async function saveNote(itemKey: string, note: string) {
    const current = answers[itemKey];
    if (!current) return;
    if ((notes[itemKey] ?? "") === note.trim()) return;
    setError(null);
    try {
      await saveChecklistItem.mutateAsync({
        propertyId: propertyId!,
        itemKey,
        answer: current,
        note: note.trim() || null,
      });
    } catch (caught) {
      setError(errorMessage(caught, "Não foi possível salvar a observação"));
    }
  }

  async function addDocument() {
    setError(null);
    setUploading(true);
    try {
      let fileId: string | null = null;
      let fileName: string | null = null;
      if (newFile) {
        const uploaded = await uploadDocument(newFile);
        fileId = uploaded.id;
        fileName = uploaded.name;
      }
      await createDocument.mutateAsync({
        propertyId: propertyId!,
        category: newCategory,
        title: newTitle.trim() || null,
        fileId,
        fileName,
        status: "recebido",
      });
      setNewTitle("");
      setNewFile(null);
    } catch (caught) {
      setError(errorMessage(caught, "Não foi possível registrar o documento"));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-6">
      <ErrorNote message={error} />

      {/* ------------------------------------------------------ condições */}
      <div>
        <p className="label-xs text-muted">Condições do imóvel</p>
        <p className="mt-1 text-[11px] text-muted">
          Estas respostas decidem quais blocos do checklist aparecem. São salvas na hora.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
          {CONDITION_KEYS.map((key) => {
            const raw = data?.conditions as Record<string, number | null> | undefined;
            const value = toTri(raw?.[key]);
            return (
              <div key={key} className="rounded-[10px] border border-line bg-bone/30 p-3">
                <p className="text-sm text-deep">{CONDITION_LABEL[key]}</p>
                <p className="mt-0.5 text-[11px] text-muted">{CONDITION_HINT[key]}</p>
                <div className="mt-2">
                  <TriToggle
                    value={value}
                    disabled={busy}
                    onChange={(next) => void changeCondition(key, next)}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ------------------------------------------------------- alertas */}
      {alerts.length > 0 && (
        <div className="rounded-[10px] border border-amber-200 bg-amber-50 p-3">
          <p className="flex items-center gap-2 text-xs font-medium text-amber-900">
            <AlertTriangle className="h-4 w-4" />
            {alerts.length} ponto(s) de atenção na documentação
          </p>
          <ul className="mt-2 space-y-1 text-[11px] text-amber-900">
            {alerts.map((item) => (
              <li key={item.key}>• {item.label}</li>
            ))}
          </ul>
        </div>
      )}

      {/* ----------------------------------------------------- checklist */}
      <div className="space-y-4 border-t border-line pt-4">
        <div>
          <p className="label-xs text-muted">Checklist documental</p>
          <p className="mt-1 text-[11px] text-muted">
            Responder o checklist não exige anexar nada. Anexo é opcional e vive na lista de
            documentos, logo abaixo.
          </p>
        </div>

        {blocks.map((block: ChecklistBlock) => {
          const blockItems = items.filter((item) => item.block === block);
          if (blockItems.length === 0) return null;
          return (
            <div key={block} className="rounded-[10px] border border-line">
              <p className="border-b border-line bg-bone/40 px-3 py-2 text-xs font-medium text-deep">
                {CHECKLIST_BLOCK_LABEL[block]}
              </p>
              <ul className="divide-y divide-line">
                {blockItems.map((item) => {
                  const current = answers[item.key];
                  const flagged =
                    current && item.alertOn ? item.alertOn.includes(current) : false;
                  return (
                    <li key={item.key} className="p-3">
                      <p className="text-sm text-deep">{item.label}</p>
                      {item.hint && (
                        <p className="mt-0.5 text-[11px] text-muted">{item.hint}</p>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {CHECKLIST_ANSWERS.map((option) => (
                          <button
                            key={option}
                            type="button"
                            disabled={busy}
                            onClick={() => void answer(item.key, option)}
                            className={cn(
                              "rounded-full border px-3 py-1.5 text-[11px] font-medium transition-colors disabled:opacity-50",
                              current === option
                                ? flagged
                                  ? "border-amber-400 bg-amber-100 text-amber-900"
                                  : "border-brass bg-brass text-white"
                                : "border-line bg-white text-muted hover:bg-bone/60",
                            )}
                          >
                            {CHECKLIST_ANSWER_LABEL[option]}
                          </button>
                        ))}
                      </div>
                      {current && (
                        <div className="mt-2">
                          <Input
                            defaultValue={notes[item.key] ?? ""}
                            placeholder="Observação (opcional)"
                            onBlur={(e) => void saveNote(item.key, e.target.value)}
                          />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>

      {/* ---------------------------------------------------- documentos */}
      <div className="space-y-3 border-t border-line pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="label-xs text-muted">Documentos anexados</p>
          <div className="flex flex-wrap gap-1.5">
            <Badge>{summary.total} registro(s)</Badge>
            <Badge tone="amber">{summary.emAnalise} em análise</Badge>
            <Badge tone="green">{summary.regulares} regular(es)</Badge>
            <Badge tone="red">{summary.pendencias} pendência(s)</Badge>
          </div>
        </div>
        <p className="text-[11px] text-muted">
          Arquivos privados: não vão para o site, não entram na galeria de fotos e só abrem para
          quem está logado no painel. PDF, JPG, PNG, WEBP ou AVIF, até 8 MB.
        </p>

        <div className="grid grid-cols-1 gap-3 rounded-[10px] border border-line bg-bone/30 p-3 sm:grid-cols-[1fr_1fr_auto]">
          <Field label="Categoria">
            <Select
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value as DocCategory)}
            >
              {DOC_CATEGORIES.map((value) => (
                <option key={value} value={value}>
                  {DOC_CATEGORY_LABEL[value]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Identificação (opcional)">
            <Input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Ex.: matrícula 42.187 — 2º RI"
            />
          </Field>
          <Field label="Arquivo (opcional)" className="sm:col-span-3">
            <input
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp,image/avif"
              onChange={(e) => setNewFile(e.target.files?.[0] ?? null)}
              className="block w-full text-xs text-muted file:mr-3 file:rounded-[3px] file:border file:border-line file:bg-white file:px-3 file:py-2 file:text-xs file:text-deep"
            />
          </Field>
          <div className="sm:col-span-3">
            <Btn
              tone="outline"
              disabled={uploading || createDocument.isPending}
              onClick={() => void addDocument()}
            >
              {uploading ? "Enviando…" : "Registrar documento"}
            </Btn>
          </div>
        </div>

        {(data?.documents ?? []).length === 0 ? (
          <Empty>Nenhum documento registrado ainda.</Empty>
        ) : (
          <ul className="space-y-2">
            {(data?.documents ?? []).map((doc) => {
              const status = doc.status as DocStatus;
              return (
                <li
                  key={doc.id}
                  className="rounded-[10px] border border-line p-3 sm:flex sm:items-center sm:gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-sm text-deep">
                      <FileText className="h-4 w-4 shrink-0 text-muted" />
                      <span className="truncate">
                        {DOC_CATEGORY_LABEL[doc.category as DocCategory] ?? doc.category}
                        {doc.title ? ` — ${doc.title}` : ""}
                      </span>
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted">
                      <Badge tone={DOC_STATUS_TONE[status]}>{DOC_STATUS_LABEL[status]}</Badge>
                      {doc.fileId ? (
                        <a
                          href={`/api/admin/doc/${doc.fileId}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-brass underline underline-offset-2"
                        >
                          <Paperclip className="h-3 w-3" />
                          {doc.fileName ?? "abrir arquivo"}
                        </a>
                      ) : (
                        <span>sem arquivo anexado</span>
                      )}
                    </p>
                  </div>
                  <div className="mt-2 flex items-center gap-2 sm:mt-0">
                    <Select
                      value={status}
                      className="w-auto"
                      disabled={updateDocumentStatus.isPending}
                      onChange={(e) => {
                        setError(null);
                        updateDocumentStatus
                          .mutateAsync({ id: doc.id, status: e.target.value as DocStatus })
                          .catch((caught: unknown) =>
                            setError(errorMessage(caught, "Não foi possível mudar o status")),
                          );
                      }}
                    >
                      {DOC_STATUSES.map((value) => (
                        <option key={value} value={value}>
                          {DOC_STATUS_LABEL[value]}
                        </option>
                      ))}
                    </Select>
                    <Btn
                      tone="danger"
                      disabled={deleteDocument.isPending}
                      onClick={() => {
                        setError(null);
                        deleteDocument
                          .mutateAsync({ id: doc.id })
                          .catch((caught: unknown) =>
                            setError(errorMessage(caught, "Não foi possível remover")),
                          );
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Btn>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

import { useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { Btn, Field, Input, Select } from "./ui";
import { cn } from "../../lib/utils";
import {
  CHECKLIST_ANSWERS,
  CHECKLIST_ANSWER_LABEL,
  CHECKLIST_BLOCK_LABEL,
  DOC_CATEGORIES,
  DOC_CATEGORY_LABEL,
  type BlockConditions,
  type ChecklistAnswer,
  type ChecklistBlock,
  type DocCategory,
  checklistAlerts,
  visibleBlocks,
  visibleChecklistItems,
} from "../../lib/property-docs-catalog";

export type DraftDocument = {
  key: string;
  category: DocCategory;
  title: string;
  file: File | null;
};

export type PropertyDocumentationDraft = {
  conditions: {
    inCondominium: boolean | null;
    hasHeranca: boolean | null;
    hasPosse: boolean | null;
    hasFinanciamento: boolean | null;
    hasAluguel: boolean | null;
  };
  checklist: Record<string, { answer: ChecklistAnswer; note: string }>;
  documents: DraftDocument[];
};

export const EMPTY_PROPERTY_DOCUMENTATION_DRAFT: PropertyDocumentationDraft = {
  conditions: {
    inCondominium: null,
    hasHeranca: null,
    hasPosse: null,
    hasFinanciamento: null,
    hasAluguel: null,
  },
  checklist: {},
  documents: [],
};

type ConditionKey = keyof PropertyDocumentationDraft["conditions"];

const CONDITION_LABEL: Record<ConditionKey, string> = {
  inCondominium: "O imóvel pertence a um condomínio?",
  hasHeranca: "Envolve herança, espólio ou inventário?",
  hasPosse: "A negociação é de posse / cessão de direitos?",
  hasFinanciamento: "Existe financiamento ou alienação fiduciária?",
  hasAluguel: "O imóvel está ocupado ou alugado?",
};

function TriToggle({
  value,
  onChange,
}: {
  value: boolean | null;
  onChange: (next: boolean | null) => void;
}) {
  const options: { label: string; value: boolean | null }[] = [
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
          onClick={() => onChange(option.value)}
          className={cn(
            "rounded-full border px-3 py-1.5 text-[11px] font-medium transition-colors",
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

export function PropertyDocsDraftSection({
  value,
  onChange,
}: {
  value: PropertyDocumentationDraft;
  onChange: (next: PropertyDocumentationDraft) => void;
}) {
  const [category, setCategory] = useState<DocCategory>("matricula");
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const blockConditions: BlockConditions = useMemo(
    () => ({
      inCondominium: value.conditions.inCondominium === true,
      heranca: value.conditions.hasHeranca === true,
      posse: value.conditions.hasPosse === true,
      financiamento: value.conditions.hasFinanciamento === true,
      aluguel: value.conditions.hasAluguel === true,
    }),
    [value.conditions],
  );

  const items = useMemo(() => visibleChecklistItems(blockConditions), [blockConditions]);
  const blocks = useMemo(() => visibleBlocks(blockConditions), [blockConditions]);
  const answers = useMemo(() => {
    const result: Record<string, ChecklistAnswer | undefined> = {};
    for (const [key, entry] of Object.entries(value.checklist)) result[key] = entry.answer;
    return result;
  }, [value.checklist]);
  const alerts = useMemo(() => checklistAlerts(blockConditions, answers), [blockConditions, answers]);

  function setCondition(key: ConditionKey, next: boolean | null) {
    onChange({
      ...value,
      conditions: { ...value.conditions, [key]: next },
    });
  }

  function setAnswer(key: string, answer: ChecklistAnswer) {
    onChange({
      ...value,
      checklist: {
        ...value.checklist,
        [key]: { answer, note: value.checklist[key]?.note ?? "" },
      },
    });
  }

  function setNote(key: string, note: string) {
    const current = value.checklist[key];
    if (!current) return;
    onChange({
      ...value,
      checklist: {
        ...value.checklist,
        [key]: { ...current, note },
      },
    });
  }

  function addDocument() {
    if (!file && !title.trim()) return;
    const key = `draft-${Date.now()}-${value.documents.length}`;
    onChange({
      ...value,
      documents: [...value.documents, { key, category, title: title.trim(), file }],
    });
    setTitle("");
    setFile(null);
  }

  return (
    <div className="space-y-6">
      <div className="rounded-[10px] border border-brass/30 bg-brass/5 p-3">
        <p className="text-sm text-deep">Checklist do cadastro novo</p>
        <p className="mt-1 text-[11px] text-muted">
          Nada desta etapa é gravado agora. Tudo será enviado junto quando você clicar em
          “Finalizar cadastro” na última etapa.
        </p>
      </div>

      <div>
        <p className="label-xs text-muted">Condições do imóvel</p>
        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
          {(Object.keys(CONDITION_LABEL) as ConditionKey[]).map((key) => (
            <div key={key} className="rounded-[10px] border border-line bg-bone/30 p-3">
              <p className="text-sm text-deep">{CONDITION_LABEL[key]}</p>
              <div className="mt-2">
                <TriToggle value={value.conditions[key]} onChange={(next) => setCondition(key, next)} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {alerts.length > 0 && (
        <div className="rounded-[10px] border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-900">
          {alerts.length} ponto(s) de atenção na documentação.
        </div>
      )}

      <div className="space-y-4 border-t border-line pt-4">
        <div>
          <p className="label-xs text-muted">Checklist documental</p>
          <p className="mt-1 text-[11px] text-muted">
            Responda normalmente. As respostas ficam nesta ficha até a finalização.
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
                  const current = value.checklist[item.key];
                  return (
                    <li key={item.key} className="p-3">
                      <p className="text-sm text-deep">{item.label}</p>
                      {item.hint && <p className="mt-0.5 text-[11px] text-muted">{item.hint}</p>}
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {CHECKLIST_ANSWERS.map((answer) => (
                          <button
                            key={answer}
                            type="button"
                            onClick={() => setAnswer(item.key, answer)}
                            className={cn(
                              "rounded-full border px-3 py-1.5 text-[11px] font-medium transition-colors",
                              current?.answer === answer
                                ? "border-brass bg-brass text-white"
                                : "border-line bg-white text-muted hover:bg-bone/60",
                            )}
                          >
                            {CHECKLIST_ANSWER_LABEL[answer]}
                          </button>
                        ))}
                      </div>
                      {current && (
                        <div className="mt-2">
                          <Input
                            value={current.note}
                            placeholder="Observação (opcional)"
                            onChange={(event) => setNote(item.key, event.target.value)}
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

      <div className="space-y-3 border-t border-line pt-4">
        <div>
          <p className="label-xs text-muted">Documentos (opcional)</p>
          <p className="mt-1 text-[11px] text-muted">
            O arquivo fica apenas selecionado nesta ficha e só será enviado na finalização.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 rounded-[10px] border border-line bg-bone/30 p-3 sm:grid-cols-2">
          <Field label="Categoria">
            <Select value={category} onChange={(event) => setCategory(event.target.value as DocCategory)}>
              {DOC_CATEGORIES.map((item) => (
                <option key={item} value={item}>
                  {DOC_CATEGORY_LABEL[item]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Identificação (opcional)">
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Ex.: matrícula 42.187 — 2º RI"
            />
          </Field>
          <Field label="Arquivo (opcional)" className="sm:col-span-2">
            <input
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp,image/avif"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              className="block w-full text-xs text-muted file:mr-3 file:rounded-[3px] file:border file:border-line file:bg-white file:px-3 file:py-2 file:text-xs file:text-deep"
            />
          </Field>
          <div className="sm:col-span-2">
            <Btn type="button" tone="outline" onClick={addDocument}>
              Adicionar ao cadastro
            </Btn>
          </div>
        </div>

        {value.documents.length > 0 && (
          <ul className="space-y-2">
            {value.documents.map((doc) => (
              <li key={doc.key} className="flex items-center gap-3 rounded-[10px] border border-line p-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-deep">
                    {DOC_CATEGORY_LABEL[doc.category]}
                    {doc.title ? ` — ${doc.title}` : ""}
                  </p>
                  <p className="text-[11px] text-muted">{doc.file?.name ?? "Sem arquivo"}</p>
                </div>
                <Btn
                  type="button"
                  tone="danger"
                  onClick={() =>
                    onChange({
                      ...value,
                      documents: value.documents.filter((item) => item.key !== doc.key),
                    })
                  }
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Btn>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

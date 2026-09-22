/**
 * Seleção de características e diferenciais do imóvel.
 * Lista fixa por grupo (checkbox) + itens personalizados em chips.
 * Só o que está marcado aqui vira dado real do cadastro.
 */
import { useState } from "react";
import { Plus, X } from "lucide-react";
import { FEATURE_GROUPS, isCustomFeature } from "./property-features";
import { Btn, Input } from "./ui";

export function FeaturesPicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const selected = new Set(value.map((item) => item.trim().toLowerCase()));
  const custom = value.filter((item) => item.trim() && isCustomFeature(item));

  function toggle(item: string) {
    if (selected.has(item.toLowerCase())) {
      onChange(value.filter((current) => current.trim().toLowerCase() !== item.toLowerCase()));
      return;
    }
    onChange([...value, item]);
  }

  function addCustom() {
    const item = draft.trim();
    if (!item) return;
    if (selected.has(item.toLowerCase())) {
      setDraft("");
      return;
    }
    onChange([...value, item]);
    setDraft("");
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {FEATURE_GROUPS.map((group) => (
          <div key={group.label} className="rounded-[10px] border border-line p-3">
            <p className="label-xs text-muted">{group.label}</p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
              {group.items.map((item) => (
                <label
                  key={item}
                  className="flex cursor-pointer items-center gap-2 text-xs text-deep"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(item.toLowerCase())}
                    onChange={() => toggle(item)}
                  />
                  {item}
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div>
        <p className="label-xs text-muted">Item personalizado</p>
        <div className="mt-1.5 flex gap-2">
          <Input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Ex: Sala com pé-direito duplo"
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              addCustom();
            }}
          />
          <Btn tone="outline" onClick={addCustom} className="shrink-0">
            <Plus className="h-3.5 w-3.5" /> Adicionar
          </Btn>
        </div>
        {custom.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-2">
            {custom.map((item) => (
              <li
                key={item}
                className="flex items-center gap-1.5 rounded-full border border-brass/50 bg-brass/10 px-3 py-1 text-xs text-deep"
              >
                {item}
                <button
                  type="button"
                  onClick={() => toggle(item)}
                  aria-label={`Remover ${item}`}
                  className="text-muted hover:text-red-500"
                >
                  <X className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-[11px] text-muted">
        {value.filter((item) => item.trim()).length} característica(s) selecionada(s). A IA usa
        apenas estes itens — nada além disso é mencionado nos textos.
      </p>
    </div>
  );
}

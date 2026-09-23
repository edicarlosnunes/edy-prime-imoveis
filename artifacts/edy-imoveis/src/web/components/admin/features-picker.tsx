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
    <div className="space-y-6">
      <div className="space-y-4">
        {FEATURE_GROUPS.map((group) => (
          <div key={group.label}>
            <p className="text-[11px] font-medium text-slate-400 mb-2 uppercase tracking-wide">{group.label}</p>
            <div className="flex flex-wrap gap-2">
              {group.items.map((item) => {
                const isActive = selected.has(item.toLowerCase());
                return (
                  <button
                    key={item}
                    type="button"
                    onClick={() => toggle(item)}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors ${isActive ? 'border-brass bg-brass/10 text-brass' : 'border-white/10 bg-black/20 text-slate-300 hover:border-white/20 hover:text-white'}`}
                  >
                    {isActive ? <X className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
                    {item}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="pt-4 border-t border-white/10">
        <p className="text-[11px] font-medium text-slate-400 mb-2 uppercase tracking-wide">Item personalizado</p>
        <div className="flex gap-2">
          <Input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Ex: Sala com pé-direito duplo"
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              addCustom();
            }}
            className="!bg-black/20 !border-white/10 !text-slate-200 !text-xs !py-1.5 !h-8"
          />
          <Btn tone="outline" onClick={addCustom} className="shrink-0 !h-8 !py-0 !text-xs !border-white/10 !text-slate-300 hover:!text-white hover:!bg-white/5">
            <Plus className="h-3.5 w-3.5" /> Adicionar
          </Btn>
        </div>
        {custom.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {custom.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => toggle(item)}
                className="inline-flex items-center gap-1.5 rounded-full border border-brass bg-brass/10 px-3 py-1.5 text-xs text-brass transition-colors hover:bg-brass/20"
              >
                <X className="h-3 w-3" />
                {item}
              </button>
            ))}
          </div>
        )}
      </div>

      <p className="text-[11px] text-slate-500">
        {value.filter((item) => item.trim()).length} característica(s) selecionada(s).
      </p>
    </div>
  );

}

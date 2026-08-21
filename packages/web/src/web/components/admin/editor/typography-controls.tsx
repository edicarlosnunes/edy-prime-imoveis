import { RotateCcw } from "lucide-react";
import { Badge, Btn, Field, Input, Select } from "../ui";
import { BODY_FONTS, HEADING_FONTS } from "../../../lib/site-content";
import {
  ALIGN_OPTIONS,
  BASELINE_SIZE,
  CASE_OPTIONS,
  ITALIC_OPTIONS,
  LETTER_SPACING_RANGE,
  LINE_HEIGHT_RANGE,
  SIZE_LIMITS,
  TEXT_KIND_HINTS,
  TEXT_KIND_LABELS,
  WEIGHT_OPTIONS,
  autoMobileSize,
  emptyTypographyStyle,
  isStyleEmpty,
  type TextKind,
  type TypographyStyle,
} from "../../../lib/site-typography";

const FONT_OPTIONS = [...new Set([...HEADING_FONTS, ...BODY_FONTS])];

/** Slider com caixa "usar padrão": quando desmarcada, o valor vira "". */
function SliderRow({
  label,
  value,
  fallback,
  min,
  max,
  step,
  suffix,
  hint,
  onChange,
}: {
  label: string;
  value: string;
  fallback: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  hint?: string;
  onChange: (value: string) => void;
}) {
  const custom = value.trim() !== "";
  const current = custom ? Number(value.replace(",", ".")) : fallback;
  const shown = Number.isFinite(current) ? current : fallback;

  return (
    <Field label={label} hint={hint}>
      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={custom}
          aria-label={`Personalizar ${label}`}
          onChange={(event) => onChange(event.target.checked ? String(shown) : "")}
          className="h-4 w-4 shrink-0 accent-[color:var(--color-brass)]"
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={shown}
          disabled={!custom}
          onChange={(event) => onChange(event.target.value)}
          className="h-1 flex-1 accent-[color:var(--color-brass)] disabled:opacity-40"
        />
        <span className="w-20 shrink-0 text-right text-xs text-muted">
          {custom ? `${shown}${suffix}` : "padrão"}
        </span>
      </div>
    </Field>
  );
}

function SelectRow({
  label,
  value,
  options,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  hint?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      <Select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    </Field>
  );
}

export function TypographyControls({
  kind,
  style,
  inherited,
  scoped,
  onChange,
  onReset,
}: {
  kind: TextKind;
  style: TypographyStyle;
  /** Estilo global já aplicado (só na aba de seção), para explicar a herança. */
  inherited?: TypographyStyle;
  /** true quando estamos editando uma seção específica. */
  scoped?: boolean;
  onChange: (patch: Partial<TypographyStyle>) => void;
  onReset: () => void;
}) {
  const custom = !isStyleEmpty(style);
  const limits = SIZE_LIMITS[kind];
  const desktopFallback = Number(inherited?.size || "") || BASELINE_SIZE[kind];
  const desktopSize = Number(style.size || inherited?.size || "") || 0;
  const mobileFallback = desktopSize > 0 ? autoMobileSize(desktopSize, kind) : BASELINE_SIZE[kind];

  return (
    <div className="rounded-[3px] border border-line bg-white p-4">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-medium text-deep">{TEXT_KIND_LABELS[kind]}</h4>
          <p className="mt-0.5 text-[11px] text-muted">{TEXT_KIND_HINTS[kind]}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={custom ? "brass" : "neutral"}>
            {custom ? (scoped ? "Personalizado nesta seção" : "Personalizado") : scoped ? "Usando o global" : "Padrão do site"}
          </Badge>
          <Btn tone="ghost" onClick={onReset} disabled={!custom} title="Restaurar padrão">
            <RotateCcw className="h-3.5 w-3.5" /> Restaurar
          </Btn>
        </div>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <SelectRow
          label="Fonte"
          value={style.fontFamily}
          onChange={(value) => onChange({ fontFamily: value })}
          options={[
            { value: "", label: scoped ? "Usar o global" : "Padrão do site" },
            ...FONT_OPTIONS.map((font) => ({ value: font, label: font })),
          ]}
        />
        <SelectRow
          label="Peso"
          value={style.weight}
          onChange={(value) => onChange({ weight: value })}
          options={WEIGHT_OPTIONS}
        />
        <SliderRow
          label="Tamanho no computador"
          value={style.size}
          fallback={desktopFallback}
          min={limits.desktop[0]}
          max={limits.desktop[1]}
          step={1}
          suffix=" px"
          hint={`Entre ${limits.desktop[0]} e ${limits.desktop[1]} px.`}
          onChange={(value) => onChange({ size: value })}
        />
        <SliderRow
          label="Tamanho no celular"
          value={style.sizeMobile}
          fallback={mobileFallback}
          min={limits.mobile[0]}
          max={limits.mobile[1]}
          step={1}
          suffix=" px"
          hint={
            style.sizeMobile.trim() === ""
              ? "Calculado automaticamente a partir do tamanho no computador."
              : `Entre ${limits.mobile[0]} e ${limits.mobile[1]} px.`
          }
          onChange={(value) => onChange({ sizeMobile: value })}
        />
        <SelectRow
          label="Estilo"
          value={style.italic}
          onChange={(value) => onChange({ italic: value })}
          options={ITALIC_OPTIONS}
        />
        <SelectRow
          label="Alinhamento"
          value={style.align}
          onChange={(value) => onChange({ align: value })}
          options={ALIGN_OPTIONS}
        />
        <SliderRow
          label="Altura da linha"
          value={style.lineHeight}
          fallback={1.4}
          min={LINE_HEIGHT_RANGE[0]}
          max={LINE_HEIGHT_RANGE[1]}
          step={0.05}
          suffix=""
          onChange={(value) => onChange({ lineHeight: value })}
        />
        <SliderRow
          label="Espaçamento entre letras"
          value={style.letterSpacing}
          fallback={0}
          min={LETTER_SPACING_RANGE[0]}
          max={LETTER_SPACING_RANGE[1]}
          step={0.01}
          suffix=" em"
          onChange={(value) => onChange({ letterSpacing: value })}
        />
        <SelectRow
          label="Caixa"
          value={style.uppercase}
          onChange={(value) => onChange({ uppercase: value })}
          options={CASE_OPTIONS}
        />
        <Field label="Cor" hint="Deixe em branco para manter a cor atual do site.">
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={/^#[0-9a-fA-F]{6}$/.test(style.color) ? style.color : "#17231f"}
              onChange={(event) => onChange({ color: event.target.value })}
              className="h-10 w-12 shrink-0 cursor-pointer rounded-[3px] border border-line bg-white p-1"
            />
            <Input
              value={style.color}
              placeholder="padrão"
              onChange={(event) => onChange({ color: event.target.value })}
            />
            <Btn
              tone="outline"
              onClick={() => onChange({ color: "" })}
              disabled={style.color.trim() === ""}
            >
              Limpar
            </Btn>
          </div>
        </Field>
      </div>
    </div>
  );
}

export function emptyStyle() {
  return emptyTypographyStyle();
}

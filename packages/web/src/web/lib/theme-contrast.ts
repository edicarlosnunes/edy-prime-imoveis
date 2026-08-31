/**
 * Legibilidade automática do tema do Editor do Site.
 *
 * O tema publicado no CMS pode ficar ilegível (ex.: fundo quase preto com
 * texto quase preto). Estas funções são PURAS e só calculam cores de
 * apresentação: nada é gravado no banco e nada muda no painel /admin.
 *
 * Regra: uma cor vinda do CMS só é substituída quando NÃO atinge o contraste
 * mínimo sobre os fundos do site. Cores legíveis passam intactas — é assim que
 * as personalizações válidas do Editor do Site são preservadas.
 */

export type ThemeColorInput = {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  text: string;
  muted: string;
  surface: string;
};

export type ReadableTheme = {
  /** Cor de títulos (`text-deep`) legível sobre os fundos do site. */
  heading: string;
  /** Cor de texto corrido (`text-ink` e cor herdada do shell). */
  body: string;
  /** Cor de textos secundários (`text-muted`). */
  muted: string;
  /** Cor de texto para ilhas claras (cards `bg-white` do chat/formulários). */
  onLight: string;
  /** Cor de bordas (`--color-line`) coerente com o texto final. */
  line: string;
  adjustedHeading: boolean;
  adjustedBody: boolean;
  adjustedMuted: boolean;
  /** true quando alguma cor precisou ser ajustada. */
  adjusted: boolean;
};

/** Contraste mínimo: títulos são texto grande (WCAG AA large = 3:1). */
export const HEADING_MIN = 3;
/** Texto corrido: WCAG AA normal = 4.5:1. */
export const TEXT_MIN = 4.5;
/** Texto secundário: limiar mais tolerante (3:1) para não alterar
    personalizações quase-conformes; o caso ilegível fica em ~1:1. */
export const MUTED_MIN = 3;

/* Paleta de substituição alinhada à identidade Edy Prime (off-white/champanhe).
   O dourado (`--color-brass` / `--color-brass-soft`) nunca é tocado aqui. */
const LIGHT_HEADING = ["#f4f1ea", "#efe3c9", "#ffffff"];
const LIGHT_BODY = ["#ece8df", "#f4f1ea", "#ffffff"];
const LIGHT_MUTED = ["#b8b6ae", "#c8c5bc", "#d9d6cd"];
/** Cinza claro premium definido para os textos secundários do site em fundo
    escuro. Vale só para TEXTO secundário (`text-muted`); botões, ícones, links,
    detalhes, CTAs e bordas de destaque seguem no dourado/champanhe. */
export const PREMIUM_MUTED = "#b8b6ae";
const DARK_HEADING = ["#17231f", "#12140f"];
const DARK_BODY = ["#12140f", "#0b0c09"];
const DARK_MUTED = ["#6b6a62", "#4c4b45", "#33322e"];

export function parseHex(value: string): { r: number; g: number; b: number } | null {
  const clean = (value ?? "").trim();
  if (!/^#[0-9a-fA-F]{3,8}$/.test(clean)) return null;
  let hex = clean.slice(1);
  if (hex.length === 3 || hex.length === 4) {
    hex = hex
      .slice(0, 3)
      .split("")
      .map((ch) => ch + ch)
      .join("");
  } else if (hex.length === 6 || hex.length === 8) {
    hex = hex.slice(0, 6);
  } else {
    return null;
  }
  const int = Number.parseInt(hex, 16);
  if (!Number.isFinite(int)) return null;
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

function channel(value: number) {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Luminância relativa (WCAG 2.1) ou null quando o hex é inválido. */
export function relativeLuminance(color: string): number | null {
  const rgb = parseHex(color);
  if (!rgb) return null;
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

/** Razão de contraste WCAG entre duas cores (1 a 21). 0 se alguma for inválida. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (la === null || lb === null) return 0;
  const light = Math.max(la, lb);
  const dark = Math.min(la, lb);
  return (light + 0.05) / (dark + 0.05);
}

/** Menor contraste da cor contra todos os fundos usados pelo site. */
function worstContrast(color: string, backgrounds: string[]) {
  return backgrounds.reduce((min, bg) => Math.min(min, contrastRatio(color, bg)), Number.POSITIVE_INFINITY);
}

function pick(current: string, backgrounds: string[], min: number, candidates: string[]) {
  if (worstContrast(current, backgrounds) >= min) return { color: current, adjusted: false };
  let best = candidates[0];
  let bestScore = -1;
  for (const candidate of candidates) {
    const score = worstContrast(candidate, backgrounds);
    if (score >= min) return { color: candidate, adjusted: true };
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return { color: best, adjusted: true };
}

function withAlpha(hex: string, suffix: string, fallback: string) {
  return /^#[0-9a-fA-F]{6}$/.test(hex) ? `${hex}${suffix}` : fallback;
}

/**
 * Calcula as cores de texto legíveis para o tema informado.
 * Cores já legíveis são devolvidas sem alteração.
 */
export function readableTheme(theme: ThemeColorInput): ReadableTheme {
  const backgrounds = [theme.background, theme.surface].filter((c) => relativeLuminance(c) !== null);
  if (backgrounds.length === 0) backgrounds.push("#ffffff");

  const avg = backgrounds.reduce((sum, bg) => sum + (relativeLuminance(bg) ?? 1), 0) / backgrounds.length;
  const dark = avg < 0.45;

  const heading = pick(theme.primary, backgrounds, HEADING_MIN, dark ? LIGHT_HEADING : DARK_HEADING);
  const body = pick(theme.text, backgrounds, TEXT_MIN, dark ? LIGHT_BODY : DARK_BODY);
  /* Em fundo escuro o texto secundário usa o cinza claro premium — ainda
     validado pelo mesmo cálculo de contraste; se não passasse, cairia na
     escada de candidatos normal. */
  const mutedTarget = dark && worstContrast(PREMIUM_MUTED, backgrounds) >= MUTED_MIN ? PREMIUM_MUTED : theme.muted;
  const muted = pick(mutedTarget, backgrounds, MUTED_MIN, dark ? LIGHT_MUTED : DARK_MUTED);

  const onLight = contrastRatio(theme.text, "#ffffff") >= TEXT_MIN ? theme.text : "#12140f";
  const line = body.adjusted
    ? withAlpha(body.color, "26", "rgba(255,255,255,0.15)")
    : withAlpha(theme.text, "1f", "rgba(18,20,15,0.12)");

  return {
    heading: heading.color,
    body: body.color,
    muted: muted.color,
    onLight,
    line,
    adjustedHeading: heading.adjusted,
    adjustedBody: body.adjusted,
    adjustedMuted: muted.adjusted || muted.color !== theme.muted,
    adjusted: heading.adjusted || body.adjusted || muted.adjusted,
  };
}

/**
 * CSS de correção, escopado em `.site-shell` (o painel /admin nunca é afetado).
 * Só sobrescreve COR DE TEXTO: `bg-deep`, `bg-ink`, botões sólidos e o dourado
 * continuam exatamente como estão.
 */
export function contrastCss(readable: ReadableTheme) {
  if (!readable.adjusted) return "";
  const rules: string[] = [];
  if (readable.adjustedBody) rules.push(`.site-shell{color:${readable.body};}`);
  if (readable.adjustedHeading) rules.push(`.site-shell .text-deep{color:${readable.heading};}`);
  if (readable.adjustedBody) rules.push(`.site-shell .text-ink{color:${readable.body};}`);
  if (readable.adjustedMuted) rules.push(`.site-shell .text-muted{color:${readable.muted};}`);
  /* Ilhas claras (cards `bg-white` do chat e dos formulários) mantêm texto escuro. */
  rules.push(
    `.site-shell .bg-white{color:${readable.onLight};}`,
    `.site-shell .bg-white .text-deep,.site-shell .bg-white.text-deep,` +
      `.site-shell .bg-white .text-ink,.site-shell .bg-white.text-ink,` +
      `.site-shell .bg-white .text-muted,.site-shell .bg-white.text-muted{color:${readable.onLight};}`,
  );
  return rules.join("\n");
}

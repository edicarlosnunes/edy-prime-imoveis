/**
 * Tipografia editável do site (Editor do Site → aba "Textos").
 *
 * Regras do modelo:
 * - Todo valor é STRING. String vazia ("") significa **herdar** — do global e,
 *   por fim, do próprio site (nenhum CSS é gerado). Por isso, com tudo em branco
 *   o site renderiza exatamente como foi entregue.
 * - A cascata é: padrão do site → global (por tipo de texto) → seção específica.
 * - Todos os números passam por limites de segurança (clamp) tanto no editor
 *   quanto na geração do CSS, para o layout nunca quebrar.
 */

export interface TypographyStyle {
  /** família da fonte ("" = herda) */
  fontFamily: string;
  /** tamanho no computador, em px ("" = padrão do site) */
  size: string;
  /** tamanho no celular, em px ("" = automático a partir do desktop) */
  sizeMobile: string;
  /** 300 | 400 | 500 | 600 | 700 ("" = herda) */
  weight: string;
  /** "" | "yes" | "no" */
  italic: string;
  /** "" | "left" | "center" | "right" */
  align: string;
  /** cor em hexadecimal ("" = herda) */
  color: string;
  /** altura da linha ("" = herda) */
  lineHeight: string;
  /** espaçamento entre letras, em em ("" = herda) */
  letterSpacing: string;
  /** "" | "yes" (MAIÚSCULAS) | "no" (normal) */
  uppercase: string;
}

export const TEXT_KINDS = [
  "heading",
  "subheading",
  "body",
  "menu",
  "button",
  "card",
  "price",
  "features",
  "info",
  "form",
  "faq",
  "footer",
  "caption",
] as const;

export type TextKind = (typeof TEXT_KINDS)[number];

export const TEXT_KIND_LABELS: Record<TextKind, string> = {
  heading: "Títulos",
  subheading: "Subtítulos",
  body: "Textos e parágrafos",
  menu: "Menu / navegação",
  button: "Botões e chamadas (CTA)",
  card: "Cards da vitrine",
  price: "Preços e valores",
  features: "Características do imóvel",
  info: "Informações e listas",
  form: "Formulários",
  faq: "Perguntas do FAQ",
  footer: "Rodapé",
  caption: "Textos pequenos / legendas",
};

export const TEXT_KIND_HINTS: Record<TextKind, string> = {
  heading: "Título principal de cada seção e da capa.",
  subheading: "Frase de apoio abaixo do título e títulos menores.",
  body: "Parágrafos corridos do site.",
  menu: "Itens do menu do topo.",
  button: "Texto dentro dos botões e links de ação.",
  card: "Título e resumo dos cards de imóvel.",
  price: "Valores exibidos na vitrine e na página do imóvel.",
  features: "Lista de características (dorm., vagas, área, itens).",
  info: "Endereço, dados de contato e listas de apoio.",
  form: "Campos e textos dos formulários.",
  faq: "Perguntas das dúvidas frequentes.",
  footer: "Links e textos do rodapé.",
  caption: "Etiquetas, selos e observações em letra pequena.",
};

export const TYPO_SCOPES = [
  "hero",
  "menu",
  "diferenciais",
  "imoveis",
  "ctaFinal",
  "comoFunciona",
  "sobre",
  "faq",
  "contato",
  "footer",
  "imovel",
] as const;

export type TypoScope = (typeof TYPO_SCOPES)[number];

export const TYPO_SCOPE_LABELS: Record<TypoScope, string> = {
  hero: "Capa",
  menu: "Menu do topo",
  diferenciais: "Diferenciais",
  imoveis: "Vitrine de imóveis",
  ctaFinal: "CTA final",
  comoFunciona: "Como funciona",
  sobre: "Sobre",
  faq: "FAQ / Dúvidas",
  contato: "Contato",
  footer: "Rodapé",
  imovel: "Página do imóvel",
};

/** Limites seguros de tamanho por tipo de texto: [mínimo, máximo] em px. */
export const SIZE_LIMITS: Record<TextKind, { desktop: [number, number]; mobile: [number, number] }> = {
  heading: { desktop: [24, 72], mobile: [18, 44] },
  subheading: { desktop: [14, 40], mobile: [13, 28] },
  body: { desktop: [12, 22], mobile: [12, 20] },
  menu: { desktop: [10, 20], mobile: [10, 18] },
  button: { desktop: [10, 20], mobile: [10, 18] },
  card: { desktop: [13, 32], mobile: [13, 26] },
  price: { desktop: [14, 48], mobile: [13, 32] },
  features: { desktop: [11, 20], mobile: [11, 18] },
  info: { desktop: [11, 20], mobile: [11, 18] },
  form: { desktop: [12, 20], mobile: [12, 18] },
  faq: { desktop: [13, 30], mobile: [12, 24] },
  footer: { desktop: [10, 20], mobile: [10, 18] },
  caption: { desktop: [9, 16], mobile: [9, 15] },
};

/** Valor de referência usado como ponto de partida ao personalizar um tamanho. */
export const BASELINE_SIZE: Record<TextKind, number> = {
  heading: 48,
  subheading: 20,
  body: 16,
  menu: 13,
  button: 12,
  card: 22,
  price: 28,
  features: 14,
  info: 14,
  form: 14,
  faq: 20,
  footer: 14,
  caption: 11,
};

export const LINE_HEIGHT_RANGE: [number, number] = [1, 2.2];
export const LETTER_SPACING_RANGE: [number, number] = [-0.05, 0.3];

export const WEIGHT_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Padrão" },
  { value: "300", label: "Leve" },
  { value: "400", label: "Normal" },
  { value: "500", label: "Médio" },
  { value: "600", label: "Semi-negrito" },
  { value: "700", label: "Negrito" },
];

export const ALIGN_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Padrão" },
  { value: "left", label: "Esquerda" },
  { value: "center", label: "Centro" },
  { value: "right", label: "Direita" },
];

export const ITALIC_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Padrão" },
  { value: "no", label: "Normal" },
  { value: "yes", label: "Itálico" },
];

export const CASE_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Padrão" },
  { value: "no", label: "Normal" },
  { value: "yes", label: "MAIÚSCULAS" },
];

export function emptyTypographyStyle(): TypographyStyle {
  return {
    fontFamily: "",
    size: "",
    sizeMobile: "",
    weight: "",
    italic: "",
    align: "",
    color: "",
    lineHeight: "",
    letterSpacing: "",
    uppercase: "",
  };
}

export type TypographyMap = Record<TextKind, TypographyStyle>;
export type TypographyScopeMap = Record<TypoScope, TypographyMap>;

export function createTypographyMap(): TypographyMap {
  const map = {} as TypographyMap;
  for (const kind of TEXT_KINDS) map[kind] = emptyTypographyStyle();
  return map;
}

export function createTypographyScopeMap(): TypographyScopeMap {
  const map = {} as TypographyScopeMap;
  for (const scope of TYPO_SCOPES) map[scope] = createTypographyMap();
  return map;
}

export function isStyleEmpty(style: TypographyStyle | undefined): boolean {
  if (!style) return true;
  return Object.values(style).every((value) => (value ?? "").trim() === "");
}

export function isScopeEmpty(map: TypographyMap | undefined): boolean {
  if (!map) return true;
  return TEXT_KINDS.every((kind) => isStyleEmpty(map[kind]));
}

/** Junta global + seção: o valor da seção vence quando preenchido. */
export function mergeStyles(global: TypographyStyle, scoped?: TypographyStyle): TypographyStyle {
  const base = { ...emptyTypographyStyle(), ...(global ?? {}) };
  if (!scoped) return base;
  const result = { ...base };
  for (const key of Object.keys(base) as (keyof TypographyStyle)[]) {
    const value = (scoped[key] ?? "").trim();
    if (value !== "") result[key] = value;
  }
  return result;
}

/* ------------------------------------------------------------------ CSS */

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function num(value: string, range: [number, number]): number | null {
  const parsed = Number(String(value ?? "").replace(",", "."));
  if (!Number.isFinite(parsed)) return null;
  return clamp(parsed, range[0], range[1]);
}

export function safeSize(value: string, kind: TextKind, mobile = false): number | null {
  const limits = SIZE_LIMITS[kind][mobile ? "mobile" : "desktop"];
  if (String(value ?? "").trim() === "") return null;
  const parsed = num(value, limits);
  return parsed === null ? null : Math.round(parsed);
}

/** Tamanho de celular automático quando só o desktop foi definido. */
export function autoMobileSize(desktop: number, kind: TextKind): number {
  const limits = SIZE_LIMITS[kind].mobile;
  const target = desktop <= 24 ? desktop : desktop * 0.7;
  return Math.round(clamp(target, limits[0], limits[1]));
}

function fontFamilyValue(name: string) {
  const clean = (name ?? "").trim();
  if (!/^[A-Za-z][A-Za-z0-9 ]{1,39}$/.test(clean)) return null;
  return `"${clean}",ui-sans-serif,system-ui,sans-serif`;
}

function colorValue(value: string) {
  const clean = (value ?? "").trim();
  return /^#[0-9a-fA-F]{3,8}$/.test(clean) ? clean : null;
}

/** Declarações CSS (sem font-size) de um estilo já resolvido. */
function declarations(style: TypographyStyle): string[] {
  const out: string[] = [];
  const family = fontFamilyValue(style.fontFamily);
  if (family) out.push(`font-family:${family}`);
  if (/^(300|400|500|600|700)$/.test(style.weight.trim())) out.push(`font-weight:${style.weight.trim()}`);
  if (style.italic === "yes") out.push("font-style:italic");
  if (style.italic === "no") out.push("font-style:normal");
  if (/^(left|center|right)$/.test(style.align.trim())) out.push(`text-align:${style.align.trim()}`);
  const color = colorValue(style.color);
  if (color) out.push(`color:${color}`);
  const lineHeight = style.lineHeight.trim() === "" ? null : num(style.lineHeight, LINE_HEIGHT_RANGE);
  if (lineHeight !== null) out.push(`line-height:${lineHeight}`);
  const letterSpacing =
    style.letterSpacing.trim() === "" ? null : num(style.letterSpacing, LETTER_SPACING_RANGE);
  if (letterSpacing !== null) out.push(`letter-spacing:${letterSpacing}em`);
  if (style.uppercase === "yes") out.push("text-transform:uppercase");
  if (style.uppercase === "no") out.push("text-transform:none");
  return out;
}

function rule(selector: string, decls: string[]) {
  return decls.length === 0 ? "" : `${selector}{${decls.join(";")};}`;
}

/**
 * Gera o CSS da tipografia.
 * `root` permite reutilizar a mesma lógica na pré-visualização do editor.
 */
export function typographyCss(
  global: TypographyMap | undefined,
  scopes: TypographyScopeMap | undefined,
  root = ".site-shell",
): string {
  const globalMap = global ?? createTypographyMap();
  const scopeMap = scopes ?? createTypographyScopeMap();
  const desktop: string[] = [];
  const mobile: string[] = [];

  const emit = (selector: string, style: TypographyStyle, kind: TextKind) => {
    desktop.push(rule(selector, declarations(style)));
    const size = safeSize(style.size, kind);
    if (size !== null) desktop.push(rule(selector, [`font-size:${size}px`]));
    const explicitMobile = safeSize(style.sizeMobile, kind, true);
    const mobileSize = explicitMobile ?? (size !== null ? autoMobileSize(size, kind) : null);
    if (mobileSize !== null) mobile.push(rule(selector, [`font-size:${mobileSize}px`]));
  };

  for (const kind of TEXT_KINDS) {
    const style = globalMap[kind];
    if (isStyleEmpty(style)) continue;
    emit(`${root} [data-t="${kind}"]`, mergeStyles(style), kind);
  }

  for (const scope of TYPO_SCOPES) {
    for (const kind of TEXT_KINDS) {
      const scoped = scopeMap[scope]?.[kind];
      if (isStyleEmpty(scoped)) continue;
      const resolved = mergeStyles(globalMap[kind] ?? emptyTypographyStyle(), scoped);
      // o escopo pode estar num elemento interno OU no próprio `.site-shell`
      // (é o caso da página do imóvel), por isso as duas formas do seletor.
      const selector = [
        `${root} [data-sec="${scope}"] [data-t="${kind}"]`,
        `${root}[data-sec="${scope}"] [data-t="${kind}"]`,
      ].join(",");
      emit(selector, resolved, kind);
    }
  }

  const desktopCss = desktop.filter(Boolean).join("\n");
  const mobileCss = mobile.filter(Boolean).join("\n");
  if (!desktopCss && !mobileCss) return "";
  return `${desktopCss}\n${mobileCss ? `@media (max-width:767px){\n${mobileCss}\n}` : ""}`;
}

/** Fontes usadas pela tipografia (para carregar do Google Fonts). */
export function typographyFonts(
  global: TypographyMap | undefined,
  scopes: TypographyScopeMap | undefined,
): string[] {
  const names = new Set<string>();
  const add = (value?: string) => {
    const clean = (value ?? "").trim();
    if (clean && /^[A-Za-z][A-Za-z0-9 ]{1,39}$/.test(clean)) names.add(clean);
  };
  for (const kind of TEXT_KINDS) add(global?.[kind]?.fontFamily);
  for (const scope of TYPO_SCOPES) {
    for (const kind of TEXT_KINDS) add(scopes?.[scope]?.[kind]?.fontFamily);
  }
  return [...names];
}

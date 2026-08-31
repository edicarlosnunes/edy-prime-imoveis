import { createContext, useContext, useEffect, useMemo } from "react";
import { defaultSiteContent, mergeSiteContent, type SiteContent } from "../../lib/site-content";
import { upgradeSiteCopy } from "../../lib/site-copy";
import { contrastCss, readableTheme } from "../../lib/theme-contrast";
import { typographyCss, typographyFonts } from "../../lib/site-typography";
import { configureSite } from "../../lib/site";
import { usePublishedContent, useDraftContent } from "../../queries/site";

/* ------------------------------------------------------------------ *
 * Contexto do conteúdo editável.                                      *
 * O site sempre renderiza: se não houver nada publicado (ou a API      *
 * falhar), `mergeSiteContent` devolve exatamente os padrões.           *
 * ------------------------------------------------------------------ */

const SiteContentContext = createContext<SiteContent>(defaultSiteContent);

export function useSiteContent() {
  return useContext(SiteContentContext);
}

export function isPreviewMode() {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("preview") === "1";
}

interface RawContent {
  data?: unknown;
}

export function SiteContentProvider({ children }: { children: React.ReactNode }) {
  const preview = isPreviewMode();
  const published = usePublishedContent();
  const draft = useDraftContent(preview);

  const raw = preview
    ? ((draft.data?.draft as RawContent | null)?.data ??
      (draft.data?.published as RawContent | null)?.data ??
      published.data?.data)
    : published.data?.data;

  // configureSite precisa rodar ANTES do primeiro render dos componentes,
  // senão os links de WhatsApp saem com o número padrão.
  const content = useMemo(() => {
    /* upgradeSiteCopy só troca textos legados exatos por sua versão nova;
       qualquer texto editado no painel passa intacto. Nada é gravado. */
    const merged = upgradeSiteCopy(mergeSiteContent(raw));
    configureSite(merged.company);
    return merged;
  }, [raw]);

  return <SiteContentContext.Provider value={content}>{children}</SiteContentContext.Provider>;
}

/* --------------------------------------------------------------- tema */

function color(value: string, fallback: string) {
  const clean = (value ?? "").trim();
  return /^#[0-9a-fA-F]{3,8}$/.test(clean) ? clean : fallback;
}

function font(value: string, fallback: string) {
  const clean = (value ?? "").trim();
  return /^[A-Za-z][A-Za-z0-9 ]{1,39}$/.test(clean) ? clean : fallback;
}

function alpha(hex: string, suffix: string, fallback: string) {
  return /^#[0-9a-fA-F]{6}$/.test(hex) ? `${hex}${suffix}` : fallback;
}

function number(value: unknown, min: number, max: number, fallback: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

/** CSS escopado em `.site-shell` para não afetar o painel /admin. */
export function themeCss(theme: SiteContent["theme"]) {
  const d = defaultSiteContent.theme;
  const primary = color(theme.primary, d.primary);
  const secondary = color(theme.secondary, d.secondary);
  const accent = color(theme.accent, d.accent);
  const background = color(theme.background, d.background);
  const text = color(theme.text, d.text);
  const muted = color(theme.muted, d.muted);
  const surface = color(theme.surface, d.surface);
  const headingFont = font(theme.headingFont, d.headingFont);
  const bodyFont = font(theme.bodyFont, d.bodyFont);
  const scale = number(theme.headingScale, 0.7, 1.6, 1);
  const radius = number(theme.buttonRadius, 0, 40, 0);
  /* Correção de contraste: só cores de TEXTO e apenas quando o tema do CMS
     ficaria ilegível. As variáveis de fundo (`--color-deep`, `--color-ink`,
     `--color-paper`, `--color-bone`) e o dourado seguem exatamente iguais. */
  const readable = readableTheme({ primary, secondary, accent, background, text, muted, surface });
  const fix = contrastCss(readable);

  return `.site-shell{
  --color-deep:${primary};
  --color-brass:${secondary};
  --color-brass-soft:${accent};
  --color-paper:${background};
  --color-ink:${text};
  --color-muted:${muted};
  --color-bone:${surface};
  --color-line:${readable.line};
  --font-display:"${headingFont}",ui-serif,Georgia,serif;
  --font-sans:"${bodyFont}",ui-sans-serif,system-ui,sans-serif;
  --h-scale:${scale};
  --btn-radius:${radius}px;
  --btn-transform:${theme.buttonUppercase === false ? "none" : "uppercase"};
  background-color:${background};
  color:${text};
  font-family:"${bodyFont}",ui-sans-serif,system-ui,sans-serif;
}
.site-shell .display{font-family:"${headingFont}",ui-serif,Georgia,serif;}${fix ? `\n${fix}` : ""}`;
}

/** Tema + tipografia editável, na ordem correta (tipografia sobrepõe o tema). */
export function siteCss(content: SiteContent) {
  const typo = typographyCss(content.typography, content.typographyScopes);
  return typo ? `${themeCss(content.theme)}\n${typo}` : themeCss(content.theme);
}

export function googleFontsHref(content: SiteContent) {
  const theme = content.theme;
  const d = defaultSiteContent.theme;
  const heading = font(theme.headingFont, d.headingFont);
  const body = font(theme.bodyFont, d.bodyFont);
  // Pesos exatamente como antes quando a tipografia não foi personalizada:
  // assim o site permanece idêntico ao publicado hoje.
  const extras = typographyFonts(content.typography, content.typographyScopes);
  const wide = extras.length > 0 || typographyUsesItalic(content);
  const axis = typographyUsesItalic(content)
    ? "ital,wght@0,300;0,400;0,500;0,600;0,700;1,400;1,600"
    : "wght@300;400;500;600;700";
  const families = wide
    ? [heading, body, ...extras.filter((name) => name !== heading && name !== body)].map(
        (name) => `${name.replace(/ /g, "+")}:${axis}`,
      )
    : [`${heading.replace(/ /g, "+")}:wght@300;400;500;600`, `${body.replace(/ /g, "+")}:wght@300;400;500`];
  return `https://fonts.googleapis.com/css2?family=${families.join("&family=")}&display=swap`;
}

/** Alguma configuração pede itálico? Só então carregamos as variantes itálicas. */
function typographyUsesItalic(content: SiteContent) {
  const maps = [content.typography, ...Object.values(content.typographyScopes ?? {})];
  return maps.some((map) => Object.values(map ?? {}).some((style) => style?.italic === "yes"));
}

function setMeta(selector: string, attr: "name" | "property", key: string, value: string) {
  let tag = document.head.querySelector<HTMLMetaElement>(selector);
  if (!tag) {
    tag = document.createElement("meta");
    tag.setAttribute(attr, key);
    document.head.appendChild(tag);
  }
  tag.setAttribute("content", value);
}

/**
 * Aplica tema, fontes, favicon e SEO — renderizado SOMENTE na página pública,
 * para não mexer no título/ícone do painel administrativo.
 */
export function SiteChrome() {
  const content = useSiteContent();
  const { seo, theme } = content;
  const css = useMemo(() => siteCss(content), [content]);
  const fontsHref = useMemo(() => googleFontsHref(content), [content]);

  useEffect(() => {
    if (seo.title.trim()) document.title = seo.title.trim();
    if (seo.description.trim()) {
      setMeta('meta[name="description"]', "name", "description", seo.description.trim());
    }
    const shareTitle = seo.shareTitle.trim() || seo.title.trim();
    if (shareTitle) setMeta('meta[property="og:title"]', "property", "og:title", shareTitle);
    const shareDescription = seo.shareDescription.trim() || seo.description.trim();
    if (shareDescription) {
      setMeta('meta[property="og:description"]', "property", "og:description", shareDescription);
    }
    if (seo.ogImageUrl.trim()) {
      setMeta('meta[property="og:image"]', "property", "og:image", seo.ogImageUrl.trim());
    }
    setMeta('meta[name="robots"]', "name", "robots", seo.noindex ? "noindex,nofollow" : "index,follow");
  }, [seo]);

  useEffect(() => {
    const url = theme.faviconUrl.trim();
    if (!url) return;
    let link = document.head.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    const previous = link.href;
    link.href = url;
    return () => {
      if (link) link.href = previous;
    };
  }, [theme.faviconUrl]);

  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = fontsHref;
    document.head.appendChild(link);
    return () => link.remove();
  }, [fontsHref]);

  return <style>{css}</style>;
}

/** Faixa fixa avisando que o conteúdo exibido é o rascunho. */
export function PreviewBanner() {
  if (!isPreviewMode()) return null;
  return (
    <div className="fixed inset-x-0 bottom-0 z-[60] flex flex-wrap items-center justify-center gap-3 bg-amber-500 px-4 py-2 text-center text-[11px] font-medium tracking-[0.14em] text-black uppercase">
      Pré-visualização do rascunho — não publicado
      <a href="/admin/editor" className="underline">
        Voltar ao editor
      </a>
    </div>
  );
}

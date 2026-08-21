import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, RotateCcw } from "lucide-react";
import { Badge, Btn } from "../ui";
import { Group, type TabProps } from "./parts";
import { TypographyControls } from "./typography-controls";
import { googleFontsHref, themeCss } from "../../site/content";
import {
  TEXT_KINDS,
  TEXT_KIND_LABELS,
  TYPO_SCOPES,
  TYPO_SCOPE_LABELS,
  createTypographyMap,
  emptyTypographyStyle,
  isScopeEmpty,
  isStyleEmpty,
  typographyCss,
  type TextKind,
  type TypoScope,
  type TypographyStyle,
} from "../../../lib/site-typography";

type Pane = "global" | TypoScope;

const PREVIEW_ROOT = ".typo-preview";

/** Carrega no painel as fontes escolhidas, para a amostra ficar fiel. */
function useEditorFonts(href: string) {
  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    document.head.appendChild(link);
    return () => {
      link.remove();
    };
  }, [href]);
}

function Preview({ scope, css }: { scope: Pane; css: string }) {
  const sec = scope === "global" ? undefined : scope;
  return (
    <div className="rounded-[3px] border border-line bg-white p-4">
      <p className="label-xs mb-3 text-muted">Pré-visualização</p>
      <style>{css}</style>
      <div className="typo-preview">
        <div className="site-shell rounded-[3px] px-5 py-6" data-sec={sec}>
          <p data-t="caption" className="text-xs opacity-70">
            Praia Grande · SP
          </p>
          <h3 data-t="heading" className="display mt-1 text-4xl">
            Imóveis selecionados com curadoria
          </h3>
          <p data-t="subheading" className="mt-2 text-lg opacity-90">
            Assessoria completa, do primeiro contato às chaves.
          </p>
          <p data-t="body" className="mt-3 text-sm opacity-80">
            Textos e parágrafos do site aparecem assim. Ajuste tamanho, peso, cor e espaçamento
            e veja o resultado antes de publicar.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-4">
            <span data-t="menu" className="text-xs">
              Imóveis
            </span>
            <span data-t="price" className="font-medium">
              R$ 1.250.000
            </span>
            <span data-t="features" className="text-xs opacity-80">
              3 dorm. · 2 vagas · 118 m²
            </span>
            <span
              data-t="button"
              className="inline-flex rounded-[3px] border border-current px-4 py-2 text-xs"
            >
              Falar no WhatsApp
            </span>
          </div>
          <p data-t="card" className="mt-3">
            Cobertura frente-mar no Canto do Forte
          </p>
          <p data-t="faq" className="mt-3">
            Vocês acompanham a documentação?
          </p>
          <p data-t="info" className="mt-2 text-sm opacity-80">
            Av. Presidente Costa e Silva, 1000 — Boqueirão
          </p>
          <p data-t="form" className="mt-2 text-sm opacity-80">
            Nome completo
          </p>
          <p data-t="footer" className="mt-2 text-sm opacity-80">
            Início · Imóveis · Contato
          </p>
        </div>
      </div>
    </div>
  );
}

function KindBlock({
  kind,
  style,
  inherited,
  scoped,
  onChange,
  onReset,
}: {
  kind: TextKind;
  style: TypographyStyle;
  inherited?: TypographyStyle;
  scoped: boolean;
  onChange: (patch: Partial<TypographyStyle>) => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const custom = !isStyleEmpty(style);

  return (
    <div className="rounded-[3px] border border-line bg-paper/50">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2 text-sm text-deep">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          {TEXT_KIND_LABELS[kind]}
        </span>
        <Badge tone={custom ? "brass" : "neutral"}>
          {custom ? "Personalizado" : scoped ? "Global" : "Padrão"}
        </Badge>
      </button>
      {open && (
        <div className="px-3 pb-3">
          <TypographyControls
            kind={kind}
            style={style}
            inherited={inherited}
            scoped={scoped}
            onChange={onChange}
            onReset={onReset}
          />
        </div>
      )}
    </div>
  );
}

export function TabTypography({ content, patch }: TabProps) {
  const [pane, setPane] = useState<Pane>("global");

  const previewCss = useMemo(
    () =>
      `${themeCss(content.theme).replace(/\.site-shell/g, `${PREVIEW_ROOT} .site-shell`)}\n${typographyCss(
        content.typography,
        content.typographyScopes,
        PREVIEW_ROOT,
      )}`,
    [content],
  );
  useEditorFonts(useMemo(() => googleFontsHref(content), [content]));

  const scoped = pane !== "global";

  function updateStyle(kind: TextKind, value: Partial<TypographyStyle>) {
    patch((draft) => {
      if (pane === "global") {
        draft.typography[kind] = { ...emptyTypographyStyle(), ...draft.typography[kind], ...value };
      } else {
        const map = draft.typographyScopes[pane];
        map[kind] = { ...emptyTypographyStyle(), ...map[kind], ...value };
      }
    });
  }

  function resetKind(kind: TextKind) {
    patch((draft) => {
      if (pane === "global") draft.typography[kind] = emptyTypographyStyle();
      else draft.typographyScopes[pane][kind] = emptyTypographyStyle();
    });
  }

  function resetPane() {
    patch((draft) => {
      if (pane === "global") draft.typography = createTypographyMap();
      else draft.typographyScopes[pane] = createTypographyMap();
    });
  }

  const paneStyles = pane === "global" ? content.typography : content.typographyScopes[pane];
  const paneCustom = !isScopeEmpty(paneStyles);

  return (
    <div className="space-y-5">
      <Group
        title="Textos do site"
        hint="Escolha fonte, tamanho, peso, cor e espaçamento de cada tipo de texto. O ajuste global vale para o site inteiro; o de uma seção vence o global apenas ali. Nada vai ao ar antes de publicar."
      >
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setPane("global")}
            className={`rounded-[3px] border px-3 py-2 text-xs ${
              pane === "global"
                ? "border-deep bg-deep text-white"
                : "border-line bg-white text-deep hover:bg-bone/60"
            }`}
          >
            Global (todos os textos)
            {!isScopeEmpty(content.typography) && " •"}
          </button>
          {TYPO_SCOPES.map((scope) => (
            <button
              key={scope}
              type="button"
              onClick={() => setPane(scope)}
              className={`rounded-[3px] border px-3 py-2 text-xs ${
                pane === scope
                  ? "border-deep bg-deep text-white"
                  : "border-line bg-white text-deep hover:bg-bone/60"
              }`}
            >
              {TYPO_SCOPE_LABELS[scope]}
              {!isScopeEmpty(content.typographyScopes[scope]) && " •"}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
          <p className="text-xs text-muted">
            {pane === "global"
              ? "Estes ajustes valem para o site inteiro, inclusive a página do imóvel."
              : `Ajustes só da seção “${TYPO_SCOPE_LABELS[pane]}”. O que ficar em branco segue o global.`}
          </p>
          <Btn tone="outline" onClick={resetPane} disabled={!paneCustom}>
            <RotateCcw className="h-3.5 w-3.5" />
            {pane === "global" ? "Restaurar tudo" : "Restaurar esta seção"}
          </Btn>
        </div>

        <Preview scope={pane} css={previewCss} />

        <div className="space-y-2">
          {TEXT_KINDS.map((kind) => (
            <KindBlock
              key={`${pane}-${kind}`}
              kind={kind}
              scoped={scoped}
              style={paneStyles[kind] ?? emptyTypographyStyle()}
              inherited={scoped ? content.typography[kind] : undefined}
              onChange={(value) => updateStyle(kind, value)}
              onReset={() => resetKind(kind)}
            />
          ))}
        </div>
      </Group>
    </div>
  );
}

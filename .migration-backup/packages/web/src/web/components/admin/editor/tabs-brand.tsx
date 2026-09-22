import { Select } from "../ui";
import { Field } from "../ui";
import { BODY_FONTS, EDY_PRIME_PALETTE, HEADING_FONTS } from "../../../lib/site-content";
import { ImagePicker } from "./image-picker";
import { ColorRow, Group, NumberRow, Row, TextRow, Toggle, type TabProps } from "./parts";

/** Aba Identidade visual: logo, favicon, cores, tipografia e botões. */
export function TabIdentity({ content, patch }: TabProps) {
  const theme = content.theme;

  return (
    <div className="space-y-5">
      <Group title="Logo e ícone" hint="A logo aparece no menu e no rodapé. Sem logo, o site usa o nome escrito.">
        <ImagePicker
          label="Logo"
          value={theme.logoUrl}
          onChange={(url) => patch((draft) => void (draft.theme.logoUrl = url))}
          hint="PNG com fundo transparente funciona melhor."
        />
        <NumberRow
          label="Altura da logo (px)"
          value={theme.logoHeight}
          min={16}
          max={80}
          onChange={(value) => patch((draft) => void (draft.theme.logoHeight = value))}
        />
        <ImagePicker
          label="Favicon (ícone da aba do navegador)"
          value={theme.faviconUrl}
          onChange={(url) => patch((draft) => void (draft.theme.faviconUrl = url))}
          hint="Imagem quadrada, 64x64 ou maior."
        />
      </Group>

      <Group title="Cores" hint="Alterar aqui muda o site inteiro — o painel administrativo não é afetado.">
        <Row cols={2}>
          <ColorRow
            label="Cor principal"
            value={theme.primary}
            hint="Faixas escuras, menu e botões."
            onChange={(value) => patch((draft) => void (draft.theme.primary = value))}
          />
          <ColorRow
            label="Cor secundária"
            value={theme.secondary}
            hint="Ícones, links e detalhes."
            onChange={(value) => patch((draft) => void (draft.theme.secondary = value))}
          />
          <ColorRow
            label="Cor de destaque"
            value={theme.accent}
            hint="Títulos em itálico e realces sobre fundo escuro."
            onChange={(value) => patch((draft) => void (draft.theme.accent = value))}
          />
          <ColorRow
            label="Cor de fundo"
            value={theme.background}
            onChange={(value) => patch((draft) => void (draft.theme.background = value))}
          />
          <ColorRow
            label="Cor dos textos"
            value={theme.text}
            onChange={(value) => patch((draft) => void (draft.theme.text = value))}
          />
          <ColorRow
            label="Cor dos textos secundários"
            value={theme.muted}
            onChange={(value) => patch((draft) => void (draft.theme.muted = value))}
          />
          <ColorRow
            label="Cor das faixas claras"
            value={theme.surface}
            onChange={(value) => patch((draft) => void (draft.theme.surface = value))}
          />
        </Row>
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button
            type="button"
            className="cursor-pointer rounded-[3px] border border-line bg-white px-4 py-2 text-xs font-medium tracking-wide uppercase transition-colors hover:bg-paper/60"
            onClick={() => {
              const ok = window.confirm(
                "Restaurar a paleta oficial Edy Prime? Isso troca apenas as 7 cores do site. Textos, imagens, logo, seções e tipografia não são alterados.",
              );
              if (!ok) return;
              patch((draft) => {
                Object.assign(draft.theme, EDY_PRIME_PALETTE);
              });
            }}
          >
            Restaurar paleta Edy Prime
          </button>
          <span className="text-xs text-muted">
            Troca só as cores. Publique depois para valer no site.
          </span>
        </div>
      </Group>

      <Group title="Tipografia">
        <Row cols={2}>
          <Field label="Fonte dos títulos">
            <Select
              value={theme.headingFont}
              onChange={(event) => patch((draft) => void (draft.theme.headingFont = event.target.value))}
            >
              {HEADING_FONTS.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Fonte dos textos">
            <Select
              value={theme.bodyFont}
              onChange={(event) => patch((draft) => void (draft.theme.bodyFont = event.target.value))}
            >
              {BODY_FONTS.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </Select>
          </Field>
        </Row>
        <NumberRow
          label="Tamanho dos títulos"
          value={Math.round(theme.headingScale * 100)}
          min={80}
          max={130}
          step={5}
          hint="100 = tamanho original."
          onChange={(value) => patch((draft) => void (draft.theme.headingScale = value / 100))}
        />
      </Group>

      <Group title="Botões">
        <Row cols={2}>
          <Field label="Estilo">
            <Select
              value={theme.buttonStyle}
              onChange={(event) =>
                patch(
                  (draft) =>
                    void (draft.theme.buttonStyle = event.target.value === "outline" ? "outline" : "solid"),
                )
              }
            >
              <option value="solid">Preenchido</option>
              <option value="outline">Contorno</option>
            </Select>
          </Field>
          <NumberRow
            label="Arredondamento (px)"
            value={theme.buttonRadius}
            min={0}
            max={40}
            onChange={(value) => patch((draft) => void (draft.theme.buttonRadius = value))}
          />
        </Row>
        <Toggle
          label="Texto dos botões em CAIXA ALTA"
          checked={theme.buttonUppercase}
          onChange={(value) => patch((draft) => void (draft.theme.buttonUppercase = value))}
        />
      </Group>
    </div>
  );
}

/** Aba SEO e compartilhamento. */
export function TabSeo({ content, patch }: TabProps) {
  const seo = content.seo;

  return (
    <div className="space-y-5">
      <Group title="Busca no Google">
        <TextRow
          label="Título da página"
          value={seo.title}
          hint="Até ~60 caracteres aparecem no Google."
          onChange={(value) => patch((draft) => void (draft.seo.title = value))}
        />
        <TextRow
          label="Descrição (meta description)"
          value={seo.description}
          lines={3}
          hint="Até ~160 caracteres."
          onChange={(value) => patch((draft) => void (draft.seo.description = value))}
        />
        <Toggle
          label="Não indexar o site nos buscadores"
          hint="Use apenas se o site estiver em construção."
          checked={seo.noindex}
          onChange={(value) => patch((draft) => void (draft.seo.noindex = value))}
        />
      </Group>

      <Group title="Compartilhamento (WhatsApp, Instagram, Facebook)">
        <TextRow
          label="Título de compartilhamento"
          value={seo.shareTitle}
          onChange={(value) => patch((draft) => void (draft.seo.shareTitle = value))}
        />
        <TextRow
          label="Descrição de compartilhamento"
          value={seo.shareDescription}
          lines={3}
          onChange={(value) => patch((draft) => void (draft.seo.shareDescription = value))}
        />
        <ImagePicker
          label="Imagem de compartilhamento (Open Graph)"
          value={seo.ogImageUrl}
          hint="Recomendado 1200x630."
          onChange={(url) => patch((draft) => void (draft.seo.ogImageUrl = url))}
        />
      </Group>
    </div>
  );
}

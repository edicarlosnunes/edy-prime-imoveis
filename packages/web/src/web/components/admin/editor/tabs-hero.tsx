import { Field, Input, Select } from "../ui";
import { newId } from "../../../lib/site-content";
import { ImagePicker } from "./image-picker";
import { Group, ListBlock, NumberRow, Row, TextRow, Toggle, type TabProps } from "./parts";

/** Aba Capa (hero). */
export function TabHero({ content, patch }: TabProps) {
  const hero = content.hero;

  return (
    <div className="space-y-5">
      <Group title="Imagem de fundo">
        <ImagePicker
          label="Imagem da capa"
          value={hero.imageUrl}
          onChange={(url) => patch((draft) => void (draft.hero.imageUrl = url))}
          hint="Horizontal, no mínimo 1600px de largura."
        />
        <NumberRow
          label="Escurecimento da imagem"
          value={hero.overlay}
          min={0}
          max={100}
          step={5}
          hint="Quanto maior, mais legível o texto."
          onChange={(value) => patch((draft) => void (draft.hero.overlay = value))}
        />
      </Group>

      <Group title="Textos">
        <TextRow
          label="Linha de apoio (acima do título)"
          value={hero.eyebrow}
          onChange={(value) => patch((draft) => void (draft.hero.eyebrow = value))}
        />
        <TextRow
          label="Título"
          value={hero.title}
          lines={3}
          hint="Use Enter para quebrar a linha."
          onChange={(value) => patch((draft) => void (draft.hero.title = value))}
        />
        <TextRow
          label="Fim do título em destaque (itálico)"
          value={hero.titleAccent}
          onChange={(value) => patch((draft) => void (draft.hero.titleAccent = value))}
        />
        <TextRow
          label="Subtítulo"
          value={hero.subtitle}
          lines={4}
          onChange={(value) => patch((draft) => void (draft.hero.subtitle = value))}
        />
        <TextRow
          label="Texto de apoio"
          value={hero.supportText}
          lines={2}
          hint="Opcional — aparece menor, abaixo do subtítulo."
          onChange={(value) => patch((draft) => void (draft.hero.supportText = value))}
        />
      </Group>

      <Group title="Botões da capa" hint="Deixe o texto vazio para esconder o botão.">
        <Row cols={2}>
          <TextRow
            label="Botão principal — texto"
            value={hero.primaryCtaLabel}
            onChange={(value) => patch((draft) => void (draft.hero.primaryCtaLabel = value))}
          />
          <TextRow
            label="Botão principal — link"
            value={hero.primaryCtaHref}
            placeholder="#imoveis"
            onChange={(value) => patch((draft) => void (draft.hero.primaryCtaHref = value))}
          />
          <TextRow
            label="Botão secundário — texto"
            value={hero.secondaryCtaLabel}
            onChange={(value) => patch((draft) => void (draft.hero.secondaryCtaLabel = value))}
          />
          <TextRow
            label="Botão secundário — link"
            value={hero.secondaryCtaHref}
            placeholder="#contato"
            onChange={(value) => patch((draft) => void (draft.hero.secondaryCtaHref = value))}
          />
        </Row>
      </Group>

      <Group title="Posição e alinhamento">
        <Row cols={2}>
          <Field label="Alinhamento do texto">
            <Select
              value={hero.align}
              onChange={(event) =>
                patch((draft) => void (draft.hero.align = event.target.value === "center" ? "center" : "left"))
              }
            >
              <option value="left">À esquerda</option>
              <option value="center">Centralizado</option>
            </Select>
          </Field>
          <Field label="Lado do texto na capa">
            <Select
              value={hero.contentSide}
              onChange={(event) =>
                patch(
                  (draft) =>
                    void (draft.hero.contentSide = event.target.value === "right" ? "right" : "left"),
                )
              }
            >
              <option value="left">Texto à esquerda, formulário à direita</option>
              <option value="right">Texto à direita, formulário à esquerda</option>
            </Select>
          </Field>
        </Row>
      </Group>

      <Group title="Formulário na capa">
        <Toggle
          label="Mostrar formulário de contato na capa"
          checked={hero.showForm}
          onChange={(value) => patch((draft) => void (draft.hero.showForm = value))}
        />
        <TextRow
          label="Linha de apoio do formulário"
          value={hero.formEyebrow}
          onChange={(value) => patch((draft) => void (draft.hero.formEyebrow = value))}
        />
        <TextRow
          label="Título do formulário"
          value={hero.formTitle}
          onChange={(value) => patch((draft) => void (draft.hero.formTitle = value))}
        />
        <TextRow
          label="Texto do formulário"
          value={hero.formText}
          lines={2}
          onChange={(value) => patch((draft) => void (draft.hero.formText = value))}
        />
      </Group>

      <Group title="Garantias listadas na capa">
        <ListBlock
          items={hero.assurances}
          addLabel="Adicionar garantia"
          onChange={(items) => patch((draft) => void (draft.hero.assurances = items))}
          onAdd={() =>
            patch((draft) => void draft.hero.assurances.push({ id: newId("a"), text: "" }))
          }
          render={(item, update) => (
            <Field label="Texto">
              <Input value={item.text} onChange={(event) => update({ text: event.target.value })} />
            </Field>
          )}
        />
      </Group>
    </div>
  );
}

/** Aba Menu. */
export function TabMenu({ content, patch }: TabProps) {
  const menu = content.menu;

  return (
    <div className="space-y-5">
      <Group title="Logo no menu">
        <Row cols={2}>
          <TextRow
            label="Nome"
            value={menu.logoText}
            onChange={(value) => patch((draft) => void (draft.menu.logoText = value))}
          />
          <TextRow
            label="Complemento"
            value={menu.logoSuffix}
            onChange={(value) => patch((draft) => void (draft.menu.logoSuffix = value))}
          />
        </Row>
        <ImagePicker
          label="Logo em imagem (opcional)"
          value={menu.logoUrl}
          hint="Se preenchida, substitui o nome escrito no menu e no rodapé."
          onChange={(url) => patch((draft) => void (draft.menu.logoUrl = url))}
        />
      </Group>

      <Group title="Itens do menu" hint="Arraste com as setas para reordenar. Desmarque para esconder.">
        <ListBlock
          items={menu.items}
          addLabel="Adicionar item"
          itemLabel={(item, index) => item.label || `Item ${index + 1}`}
          onChange={(items) => patch((draft) => void (draft.menu.items = items))}
          onAdd={() =>
            patch(
              (draft) =>
                void draft.menu.items.push({ id: newId("m"), label: "", href: "#", visible: true }),
            )
          }
          render={(item, update) => (
            <>
              <Row cols={2}>
                <Field label="Nome">
                  <Input
                    value={item.label}
                    onChange={(event) => update({ label: event.target.value })}
                  />
                </Field>
                <Field label="Link / âncora" hint="Ex: #imoveis ou https://…">
                  <Input
                    value={item.href}
                    onChange={(event) => update({ href: event.target.value })}
                  />
                </Field>
              </Row>
              <Toggle
                label="Mostrar no menu"
                checked={item.visible}
                onChange={(value) => update({ visible: value })}
              />
            </>
          )}
        />
      </Group>

      <Group title="Comportamento">
        <Toggle
          label="Mostrar botão de WhatsApp no menu"
          checked={menu.showWhatsapp}
          onChange={(value) => patch((draft) => void (draft.menu.showWhatsapp = value))}
        />
        <TextRow
          label="Texto do botão de WhatsApp"
          value={menu.whatsappLabel}
          onChange={(value) => patch((draft) => void (draft.menu.whatsappLabel = value))}
        />
        <Toggle
          label="Menu fixo no topo ao rolar a página"
          checked={menu.sticky}
          onChange={(value) => patch((draft) => void (draft.menu.sticky = value))}
        />
        <Field label="Menu no celular">
          <Select
            value={menu.mobileStyle}
            onChange={(event) =>
              patch(
                (draft) =>
                  void (draft.menu.mobileStyle =
                    event.target.value === "fullscreen" ? "fullscreen" : "panel"),
              )
            }
          >
            <option value="panel">Painel compacto</option>
            <option value="fullscreen">Tela cheia</option>
          </Select>
        </Field>
      </Group>
    </div>
  );
}

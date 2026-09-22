import { useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, Eye, EyeOff } from "lucide-react";
import { Field, Input, Textarea } from "../ui";
import { SECTION_KEYS, SECTION_LABELS, newId, type SectionKey } from "../../../lib/site-content";
import { ImagePicker } from "./image-picker";
import { Group, ListBlock, NumberRow, Row, TextRow, Toggle, type Patch, type TabProps } from "./parts";

type CommonField = "eyebrow" | "title" | "subtitle" | "text";

function setField(patch: Patch, key: SectionKey, field: string, value: unknown) {
  patch((draft) => {
    const target = draft.sections[key] as unknown as Record<string, unknown>;
    target[field] = value;
  });
}

function CommonFields({
  content,
  patch,
  sectionKey,
  fields,
  withImage,
  imageHint,
}: TabProps & {
  sectionKey: SectionKey;
  fields: CommonField[];
  withImage?: boolean;
  imageHint?: string;
}) {
  const data = content.sections[sectionKey];
  const labels: Record<CommonField, string> = {
    eyebrow: "Linha de apoio (acima do título)",
    title: "Título",
    subtitle: "Subtítulo",
    text: "Texto",
  };

  return (
    <>
      {fields.map((field) => (
        <Field key={field} label={labels[field]} hint={field === "title" ? "Use Enter para quebrar a linha." : undefined}>
          {field === "text" || field === "title" ? (
            <Textarea
              rows={field === "title" ? 2 : 3}
              value={data[field]}
              onChange={(event) => setField(patch, sectionKey, field, event.target.value)}
            />
          ) : (
            <Input
              value={data[field]}
              onChange={(event) => setField(patch, sectionKey, field, event.target.value)}
            />
          )}
        </Field>
      ))}
      {withImage && (
        <ImagePicker
          label="Imagem da seção"
          value={data.imageUrl}
          hint={imageHint}
          onChange={(url) => setField(patch, sectionKey, "imageUrl", url)}
        />
      )}
    </>
  );
}

function SectionBody({ content, patch, sectionKey }: TabProps & { sectionKey: SectionKey }) {
  const sections = content.sections;

  if (sectionKey === "diferenciais") {
    const data = sections.diferenciais;
    return (
      <>
        <CommonFields content={content} patch={patch} sectionKey={sectionKey} fields={["eyebrow", "title", "text"]} />
        <Toggle
          label="Mostrar a lista de bairros atendidos"
          hint="Os bairros são editados na aba Empresa."
          checked={data.showDistricts}
          onChange={(value) => setField(patch, sectionKey, "showDistricts", value)}
        />
        <TextRow
          label="Rótulo dos bairros"
          value={data.districtsLabel}
          onChange={(value) => setField(patch, sectionKey, "districtsLabel", value)}
        />
        <ListBlock
          items={data.items}
          addLabel="Adicionar diferencial"
          itemLabel={(item, index) => item.title || `Diferencial ${index + 1}`}
          onChange={(items) => setField(patch, sectionKey, "items", items)}
          onAdd={() =>
            setField(patch, sectionKey, "items", [...data.items, { id: newId("p"), title: "", text: "" }])
          }
          render={(item, update) => (
            <>
              <Field label="Título">
                <Input value={item.title} onChange={(event) => update({ title: event.target.value })} />
              </Field>
              <Field label="Texto">
                <Textarea rows={2} value={item.text} onChange={(event) => update({ text: event.target.value })} />
              </Field>
            </>
          )}
        />
      </>
    );
  }

  if (sectionKey === "imoveis") {
    const data = sections.imoveis;
    return (
      <>
        <CommonFields
          content={content}
          patch={patch}
          sectionKey={sectionKey}
          fields={["eyebrow", "title", "subtitle", "text"]}
        />
        <NumberRow
          label="Quantos imóveis mostrar"
          value={data.limit}
          min={3}
          max={48}
          step={3}
          hint="Os imóveis são cadastrados em /admin/imoveis."
          onChange={(value) => setField(patch, sectionKey, "limit", value)}
        />
      </>
    );
  }

  if (sectionKey === "ctaFinal") {
    const data = sections.ctaFinal;
    return (
      <>
        <CommonFields
          content={content}
          patch={patch}
          sectionKey={sectionKey}
          fields={["eyebrow", "title", "text"]}
          withImage
          imageHint="Opcional — entra como marca d'água atrás do texto."
        />
        <Row cols={2}>
          <TextRow
            label="Texto do botão"
            value={data.ctaLabel}
            onChange={(value) => setField(patch, sectionKey, "ctaLabel", value)}
          />
          <TextRow
            label="Link do botão"
            value={data.ctaHref}
            placeholder="vazio = WhatsApp"
            onChange={(value) => setField(patch, sectionKey, "ctaHref", value)}
          />
        </Row>
      </>
    );
  }

  if (sectionKey === "comoFunciona") {
    const data = sections.comoFunciona;
    return (
      <>
        <CommonFields
          content={content}
          patch={patch}
          sectionKey={sectionKey}
          fields={["eyebrow", "title", "text"]}
          withImage
          imageHint="Imagem de fundo da faixa escura."
        />
        <ListBlock
          items={data.items}
          addLabel="Adicionar etapa"
          itemLabel={(item, index) => item.title || `Etapa ${index + 1}`}
          onChange={(items) => setField(patch, sectionKey, "items", items)}
          onAdd={() =>
            setField(patch, sectionKey, "items", [
              ...data.items,
              { id: newId("s"), number: String(data.items.length + 1).padStart(2, "0"), title: "", text: "" },
            ])
          }
          render={(item, update) => (
            <>
              <Row cols={2}>
                <Field label="Número">
                  <Input value={item.number} onChange={(event) => update({ number: event.target.value })} />
                </Field>
                <Field label="Título">
                  <Input value={item.title} onChange={(event) => update({ title: event.target.value })} />
                </Field>
              </Row>
              <Field label="Texto">
                <Textarea rows={3} value={item.text} onChange={(event) => update({ text: event.target.value })} />
              </Field>
            </>
          )}
        />
      </>
    );
  }

  if (sectionKey === "sobre") {
    const data = sections.sobre;
    return (
      <>
        <CommonFields
          content={content}
          patch={patch}
          sectionKey={sectionKey}
          fields={["eyebrow", "title"]}
          withImage
          imageHint="Foto do corretor. Deixe vazio para esconder a foto."
        />
        <Row cols={2}>
          <TextRow
            label="Nome na etiqueta da foto"
            value={data.badgeName}
            onChange={(value) => setField(patch, sectionKey, "badgeName", value)}
          />
          <TextRow
            label="Legenda na etiqueta da foto"
            value={data.badgeCaption}
            onChange={(value) => setField(patch, sectionKey, "badgeCaption", value)}
          />
        </Row>
        <TextRow
          label="Texto do botão"
          value={data.ctaLabel}
          onChange={(value) => setField(patch, sectionKey, "ctaLabel", value)}
        />
        <Field label="Parágrafos">
          <ListBlock
            items={data.paragraphs}
            addLabel="Adicionar parágrafo"
            itemLabel={(_, index) => `Parágrafo ${index + 1}`}
            onChange={(items) => setField(patch, sectionKey, "paragraphs", items)}
            onAdd={() =>
              setField(patch, sectionKey, "paragraphs", [...data.paragraphs, { id: newId("t"), text: "" }])
            }
            render={(item, update) => (
              <Textarea rows={3} value={item.text} onChange={(event) => update({ text: event.target.value })} />
            )}
          />
        </Field>
        <Field label="Lista de compromissos">
          <ListBlock
            items={data.items}
            addLabel="Adicionar item"
            itemLabel={(_, index) => `Item ${index + 1}`}
            onChange={(items) => setField(patch, sectionKey, "items", items)}
            onAdd={() => setField(patch, sectionKey, "items", [...data.items, { id: newId("c"), text: "" }])}
            render={(item, update) => (
              <Input value={item.text} onChange={(event) => update({ text: event.target.value })} />
            )}
          />
        </Field>
      </>
    );
  }

  if (sectionKey === "faq") {
    const data = sections.faq;
    return (
      <>
        <CommonFields content={content} patch={patch} sectionKey={sectionKey} fields={["eyebrow", "title", "text"]} />
        <ListBlock
          items={data.items}
          addLabel="Adicionar pergunta"
          itemLabel={(item, index) => item.question || `Pergunta ${index + 1}`}
          onChange={(items) => setField(patch, sectionKey, "items", items)}
          onAdd={() =>
            setField(patch, sectionKey, "items", [...data.items, { id: newId("f"), question: "", answer: "" }])
          }
          render={(item, update) => (
            <>
              <Field label="Pergunta">
                <Input value={item.question} onChange={(event) => update({ question: event.target.value })} />
              </Field>
              <Field label="Resposta">
                <Textarea rows={4} value={item.answer} onChange={(event) => update({ answer: event.target.value })} />
              </Field>
            </>
          )}
        />
      </>
    );
  }

  const data = sections.contato;
  return (
    <>
      <CommonFields
        content={content}
        patch={patch}
        sectionKey={sectionKey}
        fields={["eyebrow", "title", "text"]}
        withImage
        imageHint="Imagem de fundo da faixa de contato."
      />
      <TextRow
        label="Fim do título em destaque (itálico)"
        value={data.titleAccent}
        onChange={(value) => setField(patch, sectionKey, "titleAccent", value)}
      />
      <Toggle
        label="Mostrar formulário de contato"
        checked={data.showForm}
        onChange={(value) => setField(patch, sectionKey, "showForm", value)}
      />
      <Row cols={2}>
        <TextRow
          label="Título do formulário"
          value={data.formTitle}
          onChange={(value) => setField(patch, sectionKey, "formTitle", value)}
        />
        <TextRow
          label="Texto do formulário"
          value={data.formText}
          onChange={(value) => setField(patch, sectionKey, "formText", value)}
        />
      </Row>
      <Row cols={3}>
        <TextRow
          label="Rótulo do endereço"
          value={data.officeLabel}
          onChange={(value) => setField(patch, sectionKey, "officeLabel", value)}
        />
        <TextRow
          label="Rótulo do e-mail"
          value={data.emailLabel}
          onChange={(value) => setField(patch, sectionKey, "emailLabel", value)}
        />
        <TextRow
          label="Rótulo do registro"
          value={data.creciLabel}
          onChange={(value) => setField(patch, sectionKey, "creciLabel", value)}
        />
      </Row>
    </>
  );
}

/** Aba Seções da Home: ordem, visibilidade e conteúdo de cada seção. */
export function TabSections({ content, patch }: TabProps) {
  const [open, setOpen] = useState<SectionKey | null>("imoveis");

  const ordered = [...SECTION_KEYS].sort(
    (a, b) => content.sections[a].order - content.sections[b].order,
  );

  function move(key: SectionKey, direction: -1 | 1) {
    const index = ordered.indexOf(key);
    const target = index + direction;
    if (target < 0 || target >= ordered.length) return;
    const next = [...ordered];
    next.splice(target, 0, ...next.splice(index, 1));
    patch((draft) => {
      next.forEach((item, position) => {
        draft.sections[item].order = position + 1;
      });
    });
  }

  return (
    <div className="space-y-3">
      {ordered.map((key, index) => {
        const section = content.sections[key];
        const expanded = open === key;
        return (
          <div key={key} className="rounded-[4px] border border-line bg-white/80">
            <header className="flex flex-wrap items-center gap-2 px-4 py-3">
              <button
                type="button"
                onClick={() => setOpen(expanded ? null : key)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
              >
                <ChevronDown
                  className={`h-4 w-4 shrink-0 text-muted transition-transform ${expanded ? "" : "-rotate-90"}`}
                />
                <span className="display truncate text-xl text-deep">{SECTION_LABELS[key]}</span>
                {!section.visible && (
                  <span className="label-xs shrink-0 text-muted">oculta</span>
                )}
              </button>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  aria-label="Subir seção"
                  disabled={index === 0}
                  onClick={() => move(key, -1)}
                  className="rounded-[3px] p-1.5 text-muted hover:bg-bone/60 hover:text-deep disabled:opacity-30"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  aria-label="Descer seção"
                  disabled={index === ordered.length - 1}
                  onClick={() => move(key, 1)}
                  className="rounded-[3px] p-1.5 text-muted hover:bg-bone/60 hover:text-deep disabled:opacity-30"
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  aria-label={section.visible ? "Ocultar seção" : "Mostrar seção"}
                  onClick={() => setField(patch, key, "visible", !section.visible)}
                  className="rounded-[3px] p-1.5 text-muted hover:bg-bone/60 hover:text-deep"
                >
                  {section.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                </button>
              </div>
            </header>
            {expanded && (
              <div className="border-t border-line px-4 py-4">
                <Group title={`Conteúdo — ${SECTION_LABELS[key]}`}>
                  <SectionBody content={content} patch={patch} sectionKey={key} />
                </Group>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

import { Field, Input, Textarea } from "../ui";
import { newId } from "../../../lib/site-content";
import { Group, ListBlock, Row, TextRow, Toggle, type TabProps } from "./parts";

/** Aba Empresa: dados de contato usados em todo o site. */
export function TabCompany({ content, patch }: TabProps) {
  const company = content.company;

  return (
    <div className="space-y-5">
      <Group
        title="Identificação"
        hint="Estes dados alimentam o site inteiro (menu, rodapé, contato) e as Configurações do painel ao publicar."
      >
        <Row cols={2}>
          <TextRow
            label="Nome comercial"
            value={company.name}
            onChange={(value) => patch((draft) => void (draft.company.name = value))}
          />
          <TextRow
            label="Complemento do nome"
            value={company.brandSuffix}
            onChange={(value) => patch((draft) => void (draft.company.brandSuffix = value))}
          />
          <TextRow
            label="Nome do corretor"
            value={company.broker}
            onChange={(value) => patch((draft) => void (draft.company.broker = value))}
          />
          <TextRow
            label="Cargo / descrição"
            value={company.role}
            onChange={(value) => patch((draft) => void (draft.company.role = value))}
          />
          <TextRow
            label="CRECI"
            value={company.creci}
            onChange={(value) => patch((draft) => void (draft.company.creci = value))}
          />
          <TextRow
            label="Horário de atendimento"
            value={company.hours}
            onChange={(value) => patch((draft) => void (draft.company.hours = value))}
          />
        </Row>
      </Group>

      <Group title="Contato">
        <Row cols={2}>
          <TextRow
            label="WhatsApp (só números, com DDI e DDD)"
            value={company.whatsapp}
            placeholder="5513997141174"
            hint="Usado em todos os botões de WhatsApp do site."
            onChange={(value) => patch((draft) => void (draft.company.whatsapp = value))}
          />
          <TextRow
            label="Telefone exibido"
            value={company.phone}
            placeholder="(13) 99714-1174"
            onChange={(value) => patch((draft) => void (draft.company.phone = value))}
          />
          <TextRow
            label="E-mail"
            value={company.email}
            onChange={(value) => patch((draft) => void (draft.company.email = value))}
          />
          <TextRow
            label="Endereço"
            value={company.address}
            onChange={(value) => patch((draft) => void (draft.company.address = value))}
          />
          <TextRow
            label="Instagram (URL)"
            value={company.instagram}
            onChange={(value) => patch((draft) => void (draft.company.instagram = value))}
          />
          <TextRow
            label="Facebook (URL)"
            value={company.facebook}
            onChange={(value) => patch((draft) => void (draft.company.facebook = value))}
          />
          <TextRow
            label="Cidade"
            value={company.city}
            onChange={(value) => patch((draft) => void (draft.company.city = value))}
          />
          <TextRow
            label="Estado (UF)"
            value={company.state}
            onChange={(value) => patch((draft) => void (draft.company.state = value))}
          />
        </Row>
      </Group>

      <Group title="Bairros atendidos" hint="Um por linha.">
        <Textarea
          rows={6}
          value={company.districts.join("\n")}
          onChange={(event) =>
            patch(
              (draft) =>
                void (draft.company.districts = event.target.value
                  .split("\n")
                  .map((item) => item.trim())
                  .filter(Boolean)),
            )
          }
        />
      </Group>
    </div>
  );
}

/** Aba Rodapé. */
export function TabFooter({ content, patch }: TabProps) {
  const footer = content.footer;

  return (
    <div className="space-y-5">
      <Group title="Texto institucional">
        <TextRow
          label="Sobre a imobiliária"
          value={footer.about}
          lines={3}
          hint="O CRECI é acrescentado automaticamente no fim."
          onChange={(value) => patch((draft) => void (draft.footer.about = value))}
        />
      </Group>

      <Group title="Colunas">
        <Row cols={2}>
          <TextRow
            label="Título da coluna de links"
            value={footer.navLabel}
            onChange={(value) => patch((draft) => void (draft.footer.navLabel = value))}
          />
          <TextRow
            label="Título da coluna de contato"
            value={footer.contactLabel}
            onChange={(value) => patch((draft) => void (draft.footer.contactLabel = value))}
          />
        </Row>
        <Toggle
          label="Mostrar Instagram e Facebook no rodapé"
          checked={footer.showSocial}
          onChange={(value) => patch((draft) => void (draft.footer.showSocial = value))}
        />
      </Group>

      <Group title="Links do rodapé">
        <ListBlock
          items={footer.links}
          addLabel="Adicionar link"
          itemLabel={(item, index) => item.label || `Link ${index + 1}`}
          onChange={(items) => patch((draft) => void (draft.footer.links = items))}
          onAdd={() =>
            patch((draft) => void draft.footer.links.push({ id: newId("l"), label: "", href: "#" }))
          }
          render={(item, update) => (
            <Row cols={2}>
              <Field label="Nome">
                <Input value={item.label} onChange={(event) => update({ label: event.target.value })} />
              </Field>
              <Field label="Link">
                <Input value={item.href} onChange={(event) => update({ href: event.target.value })} />
              </Field>
            </Row>
          )}
        />
      </Group>

      <Group title="Rodapé legal">
        <TextRow
          label="Aviso de copyright"
          value={footer.copyright}
          hint="O ano e o nome são acrescentados automaticamente antes deste texto."
          onChange={(value) => patch((draft) => void (draft.footer.copyright = value))}
        />
        <TextRow
          label="Observação"
          value={footer.note}
          lines={2}
          onChange={(value) => patch((draft) => void (draft.footer.note = value))}
        />
      </Group>
    </div>
  );
}

import { Suspense, lazy } from "react";
import { Header } from "../components/site/header";
import { Footer } from "../components/site/footer";
import { SiteChrome } from "../components/site/content";
import { site } from "../lib/site";
import { LegalPage, Paragraph, Section } from "../components/site/legal";

/* Mesmo widget da Home e da página de imóvel — um único ponto por página. */
const ChatWidget = lazy(() => import("../components/site/chat-widget"));

/* Dados registrais do controlador. Ficam aqui porque são de uso jurídico
   exclusivo desta página — o restante do site usa `site` (lib/site.ts). */
const CONTROLLER = {
  legalName: "EDY BOA SORTE LTDA",
  tradeName: "Edy Prime Imóveis",
  cnpj: "54.312.317/0001-92",
};

const LAST_UPDATE = "10 de setembro de 2026";

function Privacidade() {
  const mail = (
    <a href={`mailto:${site.email}`} className="text-brass underline-offset-4 hover:underline">
      {site.email}
    </a>
  );

  return (
    <div className="site-shell min-h-screen bg-paper">
      <SiteChrome />
      <Header />
      <main>
        <LegalPage
          title="Política de Privacidade"
          intro="Como os seus dados pessoais são coletados, usados, armazenados e protegidos quando você usa este site ou fala com a Edy Prime Imóveis."
        >
          <Section title="1. Quem é o controlador dos seus dados">
            <Paragraph>
              O controlador dos dados pessoais tratados neste site é a{" "}
              <strong>{CONTROLLER.legalName}</strong>, que atua sob o nome comercial{" "}
              <strong>{CONTROLLER.tradeName}</strong>, inscrita no CNPJ sob o nº{" "}
              <strong>{CONTROLLER.cnpj}</strong>, {site.creci}, com atendimento em {site.address}.
            </Paragraph>
            <Paragraph>
              Para qualquer assunto relacionado à privacidade e à proteção de dados — incluindo o
              exercício dos direitos previstos na Lei Geral de Proteção de Dados (Lei nº
              13.709/2018) — o canal de contato é o e-mail {mail}.
            </Paragraph>
          </Section>

          <Section title="2. Quais dados pessoais podem ser coletados">
            <Paragraph>
              Coletamos apenas os dados que você informa espontaneamente e os dados técnicos
              mínimos necessários para o site funcionar. Não compramos listas de contatos e não
              coletamos dados sensíveis.
            </Paragraph>
            <Paragraph>
              <strong>Formulários de contato e solicitações de atendimento.</strong> Nome, telefone,
              e-mail (opcional), a mensagem que você escreve e a indicação do imóvel ou do perfil de
              imóvel de interesse.
            </Paragraph>
            <Paragraph>
              <strong>Formulário de captação de imóveis (proprietários).</strong> Nome, telefone,
              e-mail (opcional) e as informações do imóvel que você deseja vender ou alugar: tipo,
              bairro, CEP, endereço e complementos (apartamento, bloco, torre, lote), características
              e observações que você acrescentar.
            </Paragraph>
            <Paragraph>
              <strong>Atendimento por WhatsApp e pelo assistente virtual do site.</strong> Seu
              número de telefone, o nome exibido no seu perfil e o conteúdo das mensagens trocadas
              durante o atendimento.
            </Paragraph>
            <Paragraph>
              <strong>Dados de proprietários, compradores e interessados ao longo da negociação.</strong>{" "}
              Quando a negociação avança e é preciso emitir documentos próprios da atividade
              imobiliária — como ficha técnica do imóvel ou autorização de venda — podem ser
              coletados dados de identificação do proprietário (documento) e dados do imóvel
              necessários ao documento. Esses dados são fornecidos por você nessa etapa e usados
              somente para essa finalidade.
            </Paragraph>
            <Paragraph>
              <strong>Dados técnicos de funcionamento.</strong> Informações básicas de acesso
              geradas automaticamente pelos servidores (como endereço IP e data/hora da
              requisição), usadas para segurança, prevenção de abuso e estabilidade do serviço.
            </Paragraph>
          </Section>

          <Section title="3. Para que os dados são usados (finalidades)">
            <Paragraph>
              Tratamos seus dados para: responder ao seu contato e prestar atendimento; apresentar
              imóveis compatíveis com o seu interesse; avaliar e cadastrar imóveis oferecidos por
              proprietários; agendar visitas; conduzir e documentar a negociação imobiliária; emitir
              os documentos próprios da intermediação; manter o histórico do relacionamento para dar
              continuidade ao atendimento; e cumprir obrigações legais e regulatórias da atividade
              de corretagem.
            </Paragraph>
            <Paragraph>
              As bases legais aplicáveis são, conforme o caso, a execução de contrato ou de
              procedimentos preliminares a ele, o cumprimento de obrigação legal ou regulatória, o
              legítimo interesse na prestação e na segurança do serviço, e o consentimento quando
              você nos procura espontaneamente por um dos nossos canais.
            </Paragraph>
          </Section>

          <Section title="4. Como funcionam os leads e o nosso CRM">
            <Paragraph>
              Cada contato feito pelos formulários, pelo WhatsApp ou pelo assistente virtual gera um
              registro de atendimento (lead) no nosso sistema interno de gestão imobiliária (CRM).
              Nele ficam guardados os dados que você informou, o histórico das mensagens e a
              evolução do atendimento, para que ninguém precise repetir a mesma informação duas
              vezes e nenhuma solicitação se perca.
            </Paragraph>
            <Paragraph>
              O sistema identifica contatos repetidos pelo número de telefone, para não duplicar seu
              cadastro, e cria tarefas internas de retorno para o corretor responsável. O CRM é uma
              área restrita, protegida por login, acessível apenas à Edy Prime Imóveis, e as ações
              realizadas nele ficam registradas para fins de auditoria interna.
            </Paragraph>
          </Section>

          <Section title="5. Atendimento e comunicação por WhatsApp (Meta)">
            <Paragraph>
              O atendimento por WhatsApp é realizado por meio da plataforma oficial de negócios da
              Meta (WhatsApp Business Platform). Isso significa que as mensagens trocadas com a Edy
              Prime Imóveis trafegam pela infraestrutura da Meta e também estão sujeitas às
              políticas de privacidade e aos termos dessa plataforma, além desta política.
            </Paragraph>
            <Paragraph>
              Da nossa parte, recebemos e armazenamos no CRM o seu número, o nome do seu perfil e o
              conteúdo das mensagens, exclusivamente para conduzir o atendimento e manter o
              histórico da negociação. Não usamos essas mensagens para nenhuma finalidade
              publicitária de terceiros.
            </Paragraph>
          </Section>

          <Section title="6. Serviços de terceiros necessários à operação">
            <Paragraph>
              Para funcionar, o site e o atendimento dependem de fornecedores de tecnologia que
              podem tratar dados em nosso nome, sempre limitados à finalidade contratada: serviço de
              hospedagem do site e da API; serviço de banco de dados em nuvem, onde os cadastros e
              os históricos ficam armazenados; a plataforma de mensagens da Meta, no atendimento por
              WhatsApp; serviço público de consulta de CEP, usado apenas para preencher o endereço a
              partir do CEP informado; provedor de modelo de inteligência artificial, quando o
              assistente virtual está ativo, para gerar as respostas do atendimento; e serviço de
              e-mail, para as comunicações por escrito.
            </Paragraph>
            <Paragraph>
              Esses fornecedores atuam como operadores de dados e não estão autorizados a usar suas
              informações para finalidades próprias.
            </Paragraph>
          </Section>

          <Section title="7. Cookies e tecnologias do site">
            <Paragraph>
              O site utiliza apenas cookies e armazenamento local necessários ao seu funcionamento,
              como a manutenção da sessão na área administrativa restrita e a preservação de
              preferências básicas de navegação. Não utilizamos cookies de publicidade
              comportamental nem vendemos dados de navegação. Você pode bloquear ou apagar cookies
              nas configurações do seu navegador; a navegação pública do site continua funcionando.
            </Paragraph>
          </Section>

          <Section title="8. Armazenamento e segurança">
            <Paragraph>
              Os dados são armazenados em banco de dados em nuvem, com acesso restrito por
              credencial. O tráfego entre o seu navegador e o site é criptografado (HTTPS), a área
              administrativa exige autenticação e as ações internas relevantes ficam registradas.
              Adotamos medidas técnicas e administrativas razoáveis para proteger seus dados contra
              acesso não autorizado, perda ou uso indevido.
            </Paragraph>
            <Paragraph>
              Guardamos seus dados enquanto durar o relacionamento de atendimento e pelo prazo
              necessário ao cumprimento de obrigações legais aplicáveis à atividade imobiliária.
              Encerrada a necessidade, os dados são eliminados ou anonimizados.
            </Paragraph>
          </Section>

          <Section title="9. Compartilhamento de dados">
            <Paragraph>
              Não vendemos, não alugamos e não cedemos seus dados pessoais para terceiros com
              finalidade comercial ou publicitária. O compartilhamento ocorre somente quando é
              necessário para prestar o serviço que você solicitou, nas seguintes situações: com o
              proprietário do imóvel de interesse ou com o interessado no imóvel, quando isso é
              indispensável para viabilizar a visita ou a negociação; com os fornecedores de
              tecnologia indicados no item 6, nos limites da finalidade contratada; e com
              autoridades públicas ou no âmbito judicial, quando houver obrigação legal ou
              requisição regular.
            </Paragraph>
          </Section>

          <Section title="10. Seus direitos como titular">
            <Paragraph>
              Conforme a LGPD, você pode solicitar a qualquer momento: a confirmação da existência
              de tratamento; o acesso aos seus dados; a correção de dados incompletos, inexatos ou
              desatualizados; a anonimização, o bloqueio ou a eliminação de dados desnecessários ou
              tratados em desconformidade com a lei; a portabilidade dos dados; a informação sobre
              com quem compartilhamos seus dados; a informação sobre a possibilidade de não fornecer
              consentimento e as consequências disso; e a revogação do consentimento.
            </Paragraph>
          </Section>

          <Section title="11. Como solicitar acesso, correção ou exclusão">
            <Paragraph>
              Basta enviar o pedido para {mail}, indicando o que você deseja e o telefone ou e-mail
              usado no contato com a Edy Prime Imóveis, para que possamos localizar o seu registro.
              Podemos solicitar informações adicionais para confirmar sua identidade antes de
              atender ao pedido — isso protege você contra solicitações feitas por terceiros.
              Respondemos no menor prazo possível.
            </Paragraph>
            <Paragraph>
              A exclusão pode não abranger dados que precisemos manter por obrigação legal ou para
              o exercício regular de direitos; nesse caso, informaremos a você o motivo da
              retenção.
            </Paragraph>
          </Section>

          <Section title="12. Alterações desta política">
            <Paragraph>
              Esta política pode ser atualizada para refletir mudanças no site, nos nossos processos
              de atendimento ou na legislação aplicável. A versão vigente é sempre a publicada nesta
              página, e recomendamos consultá-la periodicamente. Última atualização: {LAST_UPDATE}.
            </Paragraph>
          </Section>
        </LegalPage>
      </main>
      <Footer />
      <Suspense fallback={null}>
        <ChatWidget />
      </Suspense>
    </div>
  );
}

export default Privacidade;

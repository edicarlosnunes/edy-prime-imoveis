import { Suspense, lazy } from "react";
import { Link } from "wouter";
import { Header } from "../components/site/header";
import { Footer } from "../components/site/footer";
import { SiteChrome } from "../components/site/content";
import { site } from "../lib/site";
import { LegalPage, Paragraph, Section } from "../components/site/legal";

/* Mesmo widget da Home e da página de imóvel — um único ponto por página. */
const ChatWidget = lazy(() => import("../components/site/chat-widget"));

/* Dados registrais do controlador. Ficam aqui porque são de uso jurídico
   exclusivo das páginas legais — o restante do site usa `site` (lib/site.ts). */
const CONTROLLER = {
  legalName: "EDY BOA SORTE LTDA",
  tradeName: "Edy Prime Imóveis",
  cnpj: "54.312.317/0001-92",
};

const LAST_UPDATE = "10 de setembro de 2026";

function ExclusaoDeDados() {
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
          title="Exclusão de Dados Pessoais"
          intro="Como pedir a exclusão dos seus dados pessoais tratados pela Edy Prime Imóveis, o que informar no pedido e o que pode precisar ser mantido por obrigação legal."
        >
          <Section title="Quem trata os seus dados">
            <Paragraph>
              O controlador dos dados pessoais é a <strong>{CONTROLLER.legalName}</strong>, que atua
              sob o nome comercial <strong>{CONTROLLER.tradeName}</strong>, inscrita no CNPJ sob o nº{" "}
              <strong>{CONTROLLER.cnpj}</strong>, {site.creci}, com atendimento em {site.address}.
            </Paragraph>
            <Paragraph>
              Solicitações de exclusão devem ser enviadas para o e-mail {mail}. Esse é o canal
              oficial e não há custo para o titular.
            </Paragraph>
          </Section>

          <Section title="Como pedir a exclusão">
            <Paragraph>
              Envie um e-mail para {mail} com o assunto{" "}
              <strong>"Exclusão de dados"</strong>. O pedido pode ser feito com suas próprias
              palavras — não existe formulário obrigatório.
            </Paragraph>
            <Paragraph>
              Você não precisa criar conta, fazer login nem preencher cadastro para solicitar a
              exclusão.
            </Paragraph>
          </Section>

          <Section title="O que informar no pedido">
            <Paragraph>
              Pedimos apenas o mínimo necessário para localizar o seu registro com segurança e não
              excluir os dados da pessoa errada:
            </Paragraph>
            <Paragraph>
              <strong>1. Seu nome</strong>, como você o informou no contato.
              <br />
              <strong>2. O telefone e/ou o e-mail</strong> que você usou para falar com a Edy Prime
              Imóveis — é por eles que o seu registro é localizado.
              <br />
              <strong>3. Por qual canal você entrou em contato</strong>: formulário do site,
              WhatsApp ou assistente virtual.
              <br />
              <strong>4. O que você deseja excluir</strong>, se for algo específico (por exemplo,
              apenas o histórico de conversa) ou todos os seus dados.
            </Paragraph>
            <Paragraph>
              Não solicite nem envie documentos ou dados sensíveis por iniciativa própria. Se as
              informações acima não forem suficientes para confirmar que o pedido parte do próprio
              titular, poderemos pedir uma confirmação adicional — por exemplo, a resposta a partir
              do mesmo e-mail ou a confirmação pelo mesmo número de telefone usado no atendimento.
            </Paragraph>
          </Section>

          <Section title="O que acontece depois do pedido">
            <Paragraph>
              Confirmada a identificação, excluímos ou anonimizamos os seus dados pessoais dos
              nossos registros de atendimento — o cadastro de contato, o histórico de mensagens e as
              anotações relacionadas a você — e comunicamos a conclusão pelo mesmo canal do pedido.
              Respondemos no menor prazo possível, dentro dos prazos previstos na Lei Geral de
              Proteção de Dados (Lei nº 13.709/2018).
            </Paragraph>
            <Paragraph>
              A exclusão encerra o contato ativo: deixaremos de ter os seus dados para dar
              continuidade a atendimentos, buscas de imóvel ou negociações em andamento.
            </Paragraph>
          </Section>

          <Section title="O que pode precisar ser mantido">
            <Paragraph>
              A LGPD permite a conservação de determinados dados mesmo após um pedido de exclusão.
              Podemos precisar manter informações quando houver obrigação legal ou regulatória
              aplicável à atividade de corretagem, quando os dados constarem de documentos já
              emitidos no curso de uma negociação — como ficha técnica de imóvel ou autorização de
              venda —, quando forem necessários ao cumprimento de contrato ou ao exercício regular
              de direitos, inclusive em processo judicial, administrativo ou arbitral.
            </Paragraph>
            <Paragraph>
              Nessas hipóteses, a retenção fica limitada ao estritamente necessário e à finalidade
              que a justifica, e informaremos a você o motivo da manutenção ao responder o pedido.
            </Paragraph>
          </Section>

          <Section title="Conversas de WhatsApp">
            <Paragraph>
              As mensagens de WhatsApp trocadas com a Edy Prime Imóveis são apagadas dos nossos
              registros de atendimento junto com o restante dos seus dados. A cópia que existe no
              seu próprio aplicativo pertence a você e pode ser apagada por você a qualquer momento,
              diretamente no WhatsApp. O tratamento realizado pela plataforma de mensagens é regido
              pelas políticas do próprio provedor.
            </Paragraph>
          </Section>

          <Section title="Outros direitos">
            <Paragraph>
              Além da exclusão, você pode solicitar confirmação do tratamento, acesso, correção,
              anonimização, portabilidade e informação sobre compartilhamento, entre outros direitos
              previstos na LGPD. Todos podem ser exercidos pelo mesmo e-mail: {mail}. Mais detalhes
              sobre quais dados tratamos e por quê estão na nossa{" "}
              <Link
                href="/politica-de-privacidade"
                className="text-brass underline-offset-4 hover:underline"
              >
                Política de Privacidade
              </Link>
              .
            </Paragraph>
          </Section>

          <Section title="Atualizações desta página">
            <Paragraph>
              Estas instruções podem ser atualizadas para refletir mudanças nos nossos processos ou
              na legislação. A versão vigente é sempre a publicada nesta página. Última atualização:{" "}
              {LAST_UPDATE}.
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

export default ExclusaoDeDados;

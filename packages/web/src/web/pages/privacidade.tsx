import { Header } from "../components/site/header";
import { Footer } from "../components/site/footer";
import { SiteChrome } from "../components/site/content";
import { site } from "../lib/site";
import { LegalPage, Paragraph, Section } from "../components/site/legal";

function Privacidade() {
  return (
    <div className="site-shell min-h-screen bg-paper">
      <SiteChrome />
      <Header />
      <main>
        <LegalPage
          title="Política de Privacidade"
          intro="Como os seus dados são coletados, usados e protegidos quando você fala comigo pelo site."
        >
          <Section title="Quem trata os seus dados">
            <Paragraph>
              O responsável pelo tratamento é {site.broker} {site.brandSuffix} ({site.creci}),
              com atendimento em {site.address}. Dúvidas sobre privacidade podem ser enviadas para{" "}
              <a href={`mailto:${site.email}`} className="text-brass underline-offset-4 hover:underline">
                {site.email}
              </a>
              .
            </Paragraph>
          </Section>

          <Section title="Quais dados são coletados">
            <Paragraph>
              Coletamos apenas o que você informa espontaneamente nos formulários do site, no
              WhatsApp ou no assistente virtual: nome, telefone, e-mail e as informações sobre o
              imóvel que você procura ou pretende vender. Também registramos dados técnicos básicos
              de navegação (páginas visitadas e origem do acesso) para entender o desempenho do site.
            </Paragraph>
          </Section>

          <Section title="Para que os dados são usados">
            <Paragraph>
              As informações são usadas exclusivamente para responder ao seu contato, apresentar
              imóveis compatíveis com o seu perfil, agendar visitas e dar continuidade à
              negociação. Não vendemos, alugamos nem cedemos seus dados para terceiros com
              finalidade comercial.
            </Paragraph>
          </Section>

          <Section title="Compartilhamento">
            <Paragraph>
              Seus dados podem ser compartilhados apenas quando necessário para viabilizar o
              atendimento — por exemplo, com o proprietário do imóvel de interesse, com prestadores
              de serviço que hospedam o site e o sistema de atendimento, ou quando houver
              obrigação legal.
            </Paragraph>
          </Section>

          <Section title="Por quanto tempo guardamos">
            <Paragraph>
              Mantemos os dados enquanto durar o relacionamento de atendimento e pelo prazo
              necessário para cumprir obrigações legais. Depois disso, eles são excluídos ou
              anonimizados.
            </Paragraph>
          </Section>

          <Section title="Seus direitos">
            <Paragraph>
              Conforme a Lei Geral de Proteção de Dados (Lei 13.709/2018), você pode solicitar
              confirmação do tratamento, acesso, correção, portabilidade, anonimização ou exclusão
              dos seus dados, além de revogar o consentimento a qualquer momento. Basta escrever
              para {site.email} — respondemos no menor prazo possível.
            </Paragraph>
          </Section>

          <Section title="Cookies">
            <Paragraph>
              O site usa cookies e tecnologias equivalentes apenas para funcionamento básico e
              medição de audiência. Você pode bloqueá-los nas configurações do seu navegador, sem
              prejuízo à navegação.
            </Paragraph>
          </Section>

          <Section title="Atualizações">
            <Paragraph>
              Esta política pode ser atualizada para refletir mudanças no site ou na legislação. A
              versão vigente é sempre a publicada nesta página.
            </Paragraph>
          </Section>
        </LegalPage>
      </main>
      <Footer />
    </div>
  );
}

export default Privacidade;

import { Suspense, lazy } from "react";
import { Header } from "../components/site/header";
import { Footer } from "../components/site/footer";
import { SiteChrome } from "../components/site/content";
import { site } from "../lib/site";
import { LegalPage, Paragraph, Section } from "../components/site/legal";

/* Mesmo widget da Home e da página de imóvel — um único ponto por página. */
const ChatWidget = lazy(() => import("../components/site/chat-widget"));

function Termos() {
  return (
    <div className="site-shell min-h-screen bg-paper">
      <SiteChrome />
      <Header />
      <main>
        <LegalPage
          title="Termos de Uso"
          intro="As regras de uso deste site e o alcance das informações publicadas aqui."
        >
          <Section title="Sobre o site">
            <Paragraph>
              Este site é mantido por {site.broker} {site.brandSuffix} ({site.creci}) e tem
              finalidade informativa: apresentar imóveis disponíveis, os serviços de consultoria
              imobiliária e os canais de contato. A navegação implica concordância com estes termos.
            </Paragraph>
          </Section>

          <Section title="Informações dos imóveis">
            <Paragraph>
              Preços, metragens, características e disponibilidade são fornecidos pelos
              proprietários e podem mudar sem aviso prévio. As informações publicadas não
              constituem oferta vinculante nem proposta contratual. Antes de qualquer decisão,
              confirme os dados diretamente comigo e verifique a documentação do imóvel.
            </Paragraph>
          </Section>

          <Section title="Imagens">
            <Paragraph>
              As fotos dos imóveis são meramente ilustrativas e podem não refletir o estado atual
              ou a mobília do momento da visita. Imagens de cidades e de ambientes usadas em
              seções institucionais são ilustrativas e não representam imóveis específicos à venda.
            </Paragraph>
          </Section>

          <Section title="Uso do conteúdo">
            <Paragraph>
              Textos, layout, marca e materiais deste site são de uso exclusivo. Reprodução total
              ou parcial para fins comerciais depende de autorização prévia por escrito.
            </Paragraph>
          </Section>

          <Section title="Contato e atendimento">
            <Paragraph>
              O atendimento é feito por WhatsApp, e-mail e pelo assistente virtual do site. O
              assistente ajuda a entender o que você procura e encaminha o contato — ele não
              substitui a orientação do corretor nem formaliza negociações.
            </Paragraph>
          </Section>

          <Section title="Limitação de responsabilidade">
            <Paragraph>
              Trabalhamos para manter o site disponível e as informações corretas, mas não
              garantimos operação ininterrupta nem ausência total de erros. Não nos
              responsabilizamos por decisões tomadas exclusivamente com base no conteúdo do site,
              sem a devida verificação.
            </Paragraph>
          </Section>

          <Section title="Alterações e foro">
            <Paragraph>
              Estes termos podem ser atualizados a qualquer momento; vale sempre a versão publicada
              nesta página. Fica eleito o foro da comarca de {site.city}/{site.state} para dirimir
              eventuais controvérsias. Dúvidas: {site.email}.
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

export default Termos;

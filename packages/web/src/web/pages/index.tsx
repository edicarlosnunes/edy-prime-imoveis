import type { ReactNode } from "react";
import { useReveal } from "../hooks/use-reveal";
import { Header } from "../components/site/header";
import { Hero } from "../components/site/hero";
import { Proof } from "../components/site/proof";
import { Showcase } from "../components/site/showcase";
import { CtaFinal } from "../components/site/cta-final";
import { Process } from "../components/site/process";
import { About } from "../components/site/about";
import { Faq } from "../components/site/faq";
import { FinalCta } from "../components/site/final-cta";
import { Footer } from "../components/site/footer";
import { WhatsappFab } from "../components/site/whatsapp-fab";
import { PreviewBanner, SiteChrome, useSiteContent } from "../components/site/content";
import { orderedSections, type SectionKey } from "../lib/site-content";

const sectionComponents: Record<SectionKey, () => ReactNode> = {
  diferenciais: Proof,
  imoveis: Showcase,
  ctaFinal: CtaFinal,
  comoFunciona: Process,
  sobre: About,
  faq: Faq,
  contato: FinalCta,
};

function Index() {
  useReveal();
  const content = useSiteContent();
  const order = orderedSections(content);

  return (
    <div className="site-shell min-h-screen bg-paper">
      <SiteChrome />
      <Header />
      <main>
        <Hero />
        {order.map((key) => {
          const Section = sectionComponents[key];
          return <Section key={key} />;
        })}
      </main>
      <Footer />
      <WhatsappFab />
      <PreviewBanner />
    </div>
  );
}

export default Index;

import { useReveal } from "../hooks/use-reveal";
import { Header } from "../components/site/header";
import { Hero } from "../components/site/hero";
import { Proof } from "../components/site/proof";
import { Showcase } from "../components/site/showcase";
import { Process } from "../components/site/process";
import { About } from "../components/site/about";
import { Faq } from "../components/site/faq";
import { FinalCta } from "../components/site/final-cta";
import { Footer } from "../components/site/footer";
import { WhatsappFab } from "../components/site/whatsapp-fab";

function Index() {
  useReveal();

  return (
    <div className="min-h-screen bg-paper">
      <Header />
      <main>
        <Hero />
        <Proof />
        <Showcase />
        <Process />
        <About />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
      <WhatsappFab />
    </div>
  );
}

export default Index;

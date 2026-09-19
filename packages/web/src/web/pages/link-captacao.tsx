import { BadgeCheck, ArrowRight, MessageCircle } from "lucide-react";
import { useSiteContent } from "../components/site/content";

const START_MESSAGE = "Quero cadastrar meu imóvel";

function whatsappUrl(phone: string, message: string) {
  const digits = String(phone ?? "").replace(/\D/g, "");
  const normalized = digits.startsWith("55") ? digits : `55${digits}`;
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
}

export default function LinkCaptacao() {
  const content = useSiteContent();
  const whatsapp = content.company.whatsapp;

  const open = () => {
    window.location.href = whatsappUrl(whatsapp, START_MESSAGE);
  };

  return (
    <div className="site-shell min-h-screen bg-paper text-ink">
      <main className="mx-auto flex min-h-screen max-w-5xl items-center px-5 py-12">
        <section className="w-full overflow-hidden rounded-[24px] border border-line bg-white shadow-[0_24px_80px_rgba(18,20,15,.10)]">
          <div className="bg-deep px-6 py-8 text-white sm:px-10">
            <div className="label-xs mb-4 text-brass-soft">EDY PRIME · CAPTAÇÃO</div>
            <h1 className="display max-w-3xl text-4xl sm:text-5xl">Cadastre seu imóvel de forma rápida.</h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-white/75">
              O ED fará algumas perguntas objetivas pelo WhatsApp para iniciar o pré-cadastro.
            </p>
          </div>

          <div className="p-6 sm:p-10">
            <button
              type="button"
              onClick={open}
              className="group w-full rounded-[18px] border border-line bg-paper p-6 text-left transition hover:-translate-y-0.5 hover:border-brass"
            >
              <MessageCircle className="mb-8 h-8 w-8 text-brass" />
              <div className="label-xs text-muted">Link de Captação</div>
              <h2 className="mt-2 text-2xl font-medium text-deep">Iniciar cadastro pelo WhatsApp</h2>
              <p className="mt-3 text-sm leading-6 text-muted">
                Proprietário ou corretor: o atendimento identifica seu perfil e segue com as perguntas necessárias.
              </p>
              <span className="mt-8 inline-flex items-center gap-2 text-sm font-medium text-deep">
                Começar agora <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
              </span>
            </button>
          </div>

          <footer className="flex flex-col gap-3 border-t border-line px-6 py-5 text-xs text-muted sm:flex-row sm:items-center sm:justify-between sm:px-10">
            <span className="inline-flex items-center gap-2"><BadgeCheck className="h-4 w-4 text-brass" /> Atendimento imobiliário · dados usados para o cadastro solicitado.</span>
            <span>Edicarlos Nunes Santos Ferreira · Corretor de Imóveis · CRECI 134718-F</span>
          </footer>
        </section>
      </main>
    </div>
  );
}

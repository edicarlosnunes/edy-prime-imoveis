import { BadgeCheck, Link2 } from "lucide-react";

export default function LinkCaptacao() {
  return (
    <div className="site-shell min-h-screen bg-paper text-ink">
      <main className="mx-auto flex min-h-screen max-w-5xl items-center px-5 py-12">
        <section className="w-full overflow-hidden rounded-[24px] border border-line bg-white shadow-[0_24px_80px_rgba(18,20,15,.10)]">
          <div className="bg-deep px-6 py-8 text-white sm:px-10">
            <div className="label-xs mb-4 text-brass-soft">EDY PRIME · CAPTAÇÃO</div>
            <h1 className="display max-w-3xl text-4xl sm:text-5xl">Solicite seu link exclusivo.</h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-white/75">
              Cada link de captação corresponde ao cadastro de um único imóvel.
            </p>
          </div>

          <div className="p-6 sm:p-10">
            <div className="rounded-[18px] border border-line bg-paper p-6">
              <Link2 className="mb-8 h-8 w-8 text-brass" />
              <div className="label-xs text-muted">Link de Captação</div>
              <h2 className="mt-2 text-2xl font-medium text-deep">Solicite outro link para cadastro.</h2>
              <p className="mt-3 text-sm leading-6 text-muted">
                Peça à equipe da Edy Prime Imóveis um novo link exclusivo para o imóvel que deseja cadastrar. Este endereço não inicia uma nova ficha.
              </p>
            </div>
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

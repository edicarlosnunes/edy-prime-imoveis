import { useQuery } from "@tanstack/react-query";
import { useParams } from "wouter";
import { BadgeCheck, ArrowRight, MessageCircle } from "lucide-react";
import { orpc } from "../lib/api";

export default function LinkCaptacaoToken() {
  const { token = "" } = useParams<{ token: string }>();
  const link = useQuery({
    ...orpc.captureShareLinks.resolve.queryOptions({ input: { token } }),
    enabled: Boolean(token),
    retry: 1,
    staleTime: 0,
  });

  const invalid = !link.isLoading && !link.isError && !link.data?.valid;
  return (
    <div className="site-shell min-h-screen bg-paper text-ink">
      <main className="mx-auto flex min-h-screen max-w-5xl items-center px-5 py-12">
        <section className="w-full overflow-hidden rounded-[24px] border border-line bg-white shadow-[0_24px_80px_rgba(18,20,15,.10)]">
          <div className="bg-deep px-6 py-8 text-white sm:px-10">
            <div className="label-xs mb-4 text-brass-soft">E. SANTOS · CAPTAÇÃO EXCLUSIVA</div>
            <h1 className="display max-w-3xl text-4xl sm:text-5xl">Cadastre seu imóvel de forma rápida.</h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-white/75">
              O ED fará algumas perguntas objetivas pelo WhatsApp para iniciar o pré-cadastro.
            </p>
          </div>
          <div className="p-6 sm:p-10">
            {link.isLoading && <p role="status" className="text-sm text-muted">Validando seu link exclusivo…</p>}
            {link.isError && <p role="alert" className="text-sm text-red-700">Não foi possível validar este link. Verifique sua conexão e tente novamente.</p>}
            {invalid && <p role="alert" className="text-sm text-red-700">Este link de captação é inválido ou já foi utilizado. Peça um novo link à equipe.</p>}
            {link.data?.valid && (
              <a
                data-testid="link-open-whatsapp"
                href={`https://wa.me/${link.data.whatsapp}?text=${encodeURIComponent(link.data.message)}`}
                className="group w-full rounded-[18px] border border-line bg-paper p-6 text-left transition hover:-translate-y-0.5 hover:border-brass"
              >
                <MessageCircle className="mb-8 h-8 w-8 text-brass" />
                <div className="label-xs text-muted">Link exclusivo de captação</div>
                <h2 className="mt-2 text-2xl font-medium text-deep">Iniciar cadastro pelo WhatsApp</h2>
                <p className="mt-3 text-sm leading-6 text-muted">
                  Sua mensagem terá uma referência exclusiva para que a equipe identifique este atendimento.
                </p>
                <span className="mt-8 inline-flex items-center gap-2 text-sm font-medium text-deep">
                  Começar agora <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
                </span>
              </a>
            )}
          </div>
          <footer className="flex flex-col gap-3 border-t border-line px-6 py-5 text-xs text-muted sm:flex-row sm:items-center sm:justify-between sm:px-10">
            <span className="inline-flex items-center gap-2"><BadgeCheck className="h-4 w-4 text-brass" /> Atendimento imobiliário · dados usados para o cadastro solicitado.</span>
            <span>E. Santos · Gestor Imobiliário · CRECI 134718-F</span>
          </footer>
        </section>
      </main>
    </div>
  );
}
import { useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BadgeCheck, MessageCircle } from "lucide-react";
import { orpc } from "../lib/api";

const MESSAGE = "Vamos cadastrar seu imóvel?";
const AUTO_OPEN_KEY = "link-captacao-whatsapp-opened";
const AUTO_OPEN_COOLDOWN_MS = 8_000;

function normalizeWhatsapp(raw: string | undefined) {
  const digits = (raw ?? "").replace(/\D/g, "");
  const national = digits.startsWith("55") ? digits.slice(2) : digits;
  if (national.length < 10 || national.length > 11) return "";
  return `55${national}`;
}

export default function LinkCaptacao() {
  const settings = useQuery(orpc.siteConfig.get.queryOptions());
  const attemptedAutoOpen = useRef(false);
  const whatsapp = useMemo(
    () => normalizeWhatsapp(settings.data?.whatsapp),
    [settings.data?.whatsapp],
  );
  const whatsappHref = whatsapp
    ? `https://wa.me/${whatsapp}?text=${encodeURIComponent(MESSAGE)}`
    : "";

  useEffect(() => {
    if (!whatsappHref || attemptedAutoOpen.current) return;
    attemptedAutoOpen.current = true;

    try {
      const lastAttempt = window.sessionStorage.getItem(AUTO_OPEN_KEY);
      const now = Date.now();
      if (
        lastAttempt !== null &&
        Number.isFinite(Number(lastAttempt)) &&
        now - Number(lastAttempt) < AUTO_OPEN_COOLDOWN_MS
      ) {
        return;
      }
      window.sessionStorage.setItem(AUTO_OPEN_KEY, String(now));
    } catch {
      // The in-memory guard still prevents repeat attempts during this visit.
    }

    const timeout = window.setTimeout(() => {
      window.location.assign(whatsappHref);
    }, 600);
    return () => window.clearTimeout(timeout);
  }, [whatsappHref]);

  return (
    <div className="site-shell min-h-screen bg-paper text-ink">
      <main className="mx-auto flex min-h-screen max-w-5xl items-center px-5 py-12">
        <section className="w-full overflow-hidden rounded-[24px] border border-line bg-white shadow-[0_24px_80px_rgba(18,20,15,.10)]">
          <div className="bg-deep px-6 py-8 text-white sm:px-10">
            <div className="label-xs mb-4 text-brass-soft">EDY PRIME · CAPTAÇÃO</div>
            <h1 className="display max-w-3xl text-4xl sm:text-5xl">Vamos cadastrar seu imóvel?</h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-white/75">
              Fale com a equipe pelo WhatsApp para iniciar seu cadastro. Este é o caminho público e reutilizável.
            </p>
          </div>

          <div className="p-6 sm:p-10">
            <div className="rounded-[18px] border border-line bg-paper p-6 sm:p-8">
              <MessageCircle className="mb-6 h-8 w-8 text-brass" />
              <div className="label-xs text-muted">Cadastro pelo WhatsApp</div>
              <h2 className="mt-2 text-2xl font-medium text-deep">Comece uma conversa com a equipe.</h2>
              <p className="mt-3 text-sm leading-6 text-muted">
                {settings.isLoading
                  ? "Carregando o contato oficial da imobiliária…"
                  : settings.isError
                    ? "Não foi possível carregar o contato agora. Tente novamente ou use o atalho da equipe."
                    : !whatsapp
                      ? "O contato de WhatsApp não está disponível. Use o atalho da equipe para pedir ajuda."
                      : "A conversa será aberta com a mensagem preparada. Você ainda precisa tocar em Enviar no WhatsApp para falar com a equipe."}
              </p>
              {settings.isLoading && (
                <p role="status" data-testid="status-whatsapp-loading" className="mt-4 text-sm text-muted">
                  Preparando o link…
                </p>
              )}
              {settings.isError && (
                <p role="alert" data-testid="status-whatsapp-error" className="mt-4 text-sm text-red-700">
                  Não foi possível consultar as configurações públicas. Verifique sua conexão e tente novamente.
                </p>
              )}
              {!settings.isLoading && !settings.isError && !whatsapp && (
                <p role="alert" data-testid="status-whatsapp-unavailable" className="mt-4 text-sm text-red-700">
                  O número oficial não está configurado corretamente.
                </p>
              )}
              {whatsappHref && (
                <a
                  data-testid="link-open-public-whatsapp"
                  href={whatsappHref}
                  className="mt-7 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-deep px-5 py-3 text-center text-sm font-medium text-white transition hover:bg-deep/90 sm:w-auto"
                >
                  Abrir WhatsApp <ArrowRight className="h-4 w-4" />
                </a>
              )}
              {whatsappHref && (
                <p className="mt-4 text-xs leading-5 text-muted">
                  Se a abertura automática não funcionar, use o botão acima. A mensagem não é enviada sozinha: confira e toque em Enviar.
                </p>
              )}
              <a
                href="/admin/captacao"
                data-testid="link-team-captacao"
                className="mt-6 inline-flex items-center gap-2 rounded-lg border border-line bg-white px-4 py-3 text-sm font-medium text-deep transition hover:border-brass"
              >
                Atalho da equipe: painel de captação <ArrowRight className="h-4 w-4" />
              </a>
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

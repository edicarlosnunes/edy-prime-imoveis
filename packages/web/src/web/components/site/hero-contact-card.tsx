import { MessageCircle, ShieldCheck } from "lucide-react";
import { site, whatsappLink } from "../../lib/site";
import { CNAI } from "./sellers";

/**
 * Card de atendimento da capa. Usa sempre o WhatsApp configurado no Editor
 * do Site (via `whatsappLink`) — nenhum número escrito à mão aqui.
 */
export function HeroContactCard() {
  const href = whatsappLink(
    `Olá, ${site.broker}. Vi seu site e quero atendimento para encontrar um imóvel em ${site.city}.`,
  );

  return (
    <div className="grain relative border border-brass/30 bg-black/55 p-7 backdrop-blur-md lg:p-8">
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brass-soft to-transparent"
      />
      <p data-t="caption" className="label-xs text-brass-soft">
        Atendimento especializado
      </p>
      <p data-t="subheading" className="display mt-3 text-[26px] leading-[1.15] text-white">
        Fale direto com o corretor
      </p>
      <p data-t="body" className="mt-3 text-sm leading-relaxed text-white/70">
        Fale comigo e encontre uma opção alinhada ao que você procura.
      </p>

      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        data-t="button"
        className="site-btn site-btn-dark mt-6 w-full py-4"
      >
        <MessageCircle className="h-4 w-4" strokeWidth={1.6} />
        Falar no WhatsApp
      </a>

      {/* Telefone e credenciais em duas linhas: não aperta nem corta no mobile. */}
      <div className="mt-5 flex items-start gap-2 text-[11.5px] text-white/50">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brass-soft" strokeWidth={1.5} />
        <p className="min-w-0">
          <span className="block text-white/70">{site.whatsappLabel}</span>
          <span className="mt-0.5 block leading-relaxed">
            {site.creci} · {CNAI}
          </span>
        </p>
      </div>
    </div>
  );
}

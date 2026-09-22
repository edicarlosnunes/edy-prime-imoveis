import { ArrowUpRight, MapPinned, Ruler, ShieldCheck } from "lucide-react";
import { site, whatsappLink } from "../../lib/site";
import { OwnerForm } from "./owner-form";

/** Registro de perito avaliador. Credencial fixa da corretora, como `site.creci`. */
export const CNAI = "PERITO CNAI 55.918";

const benefits = [
  {
    icon: Ruler,
    title: "Avaliação com critério técnico",
    text: "Análise das características do imóvel, localização, padrão construtivo e referências reais do mercado para chegar a uma avaliação consistente.",
  },
  {
    icon: MapPinned,
    title: "Conhecimento do mercado local",
    text: "Experiência no litoral e acompanhamento do mercado para entender não apenas quanto estão pedindo, mas os valores praticados na região.",
  },
  {
    icon: ShieldCheck,
    title: "Segurança para tomar decisões",
    text: "Uma avaliação profissional ajuda proprietários, compradores e investidores a negociar com mais informação, segurança e clareza.",
  },
];

/**
 * Avaliação profissional de imóveis (captação de proprietários).
 * Autoridade técnica: Perito Avaliador Imobiliário — CRECI + CNAI.
 * Sem números, prazos ou promessas inventadas.
 */
export function Sellers() {
  const waHref = whatsappLink(
    `Olá, ${site.broker}. Quero avaliar meu imóvel em ${site.city} com um perito avaliador.`,
  );

  return (
    <section id="vender" data-sec="vender" className="bg-deep text-white">
      <div className="mx-auto grid max-w-[1240px] items-center gap-14 px-6 py-24 lg:grid-cols-2 lg:gap-20 lg:px-8 lg:py-32">
        <div className="reveal relative">
          <img
            src="/images/vender-imovel.jpg"
            alt="Sala ampla e bem iluminada de apartamento de alto padrão pronto para venda"
            loading="lazy"
            decoding="async"
            className="aspect-[4/5] w-full object-cover lg:aspect-[4/4.4]"
          />
          {/* Identificação profissional: discreta, ancorada na base da foto. */}
          <p
            data-t="caption"
            className="label-xs absolute inset-x-4 bottom-4 border border-brass-soft/40 bg-black/70 px-4 py-3 text-center leading-relaxed text-brass-soft backdrop-blur-sm sm:inset-x-6 sm:bottom-6 sm:px-5"
          >
            {CNAI}
          </p>
        </div>

        <div className="reveal" data-reveal-delay="80">
          <p data-t="caption" className="label-xs flex items-center gap-3 text-brass-soft">
            <span className="h-px w-10 bg-brass-soft/60" />
            Avaliação profissional
          </p>
          <h2
            data-t="heading"
            className="display mt-6 text-[calc(clamp(2rem,4vw,3.2rem)*var(--h-scale,1))]"
          >
            Descubra o valor real do seu imóvel
          </h2>
          <p data-t="subheading" className="mt-5 max-w-xl text-base leading-relaxed text-white/70">
            Uma boa negociação começa por uma avaliação bem fundamentada. Como Perito Avaliador
            Imobiliário, realizo análises com critérios técnicos, conhecimento do mercado local e
            atenção às características específicas de cada imóvel.
          </p>

          <ul className="mt-10 space-y-6 border-l border-white/15 pl-6">
            {benefits.map((item) => (
              <li key={item.title} data-t="info" className="flex items-start gap-4">
                <item.icon className="mt-1 h-4 w-4 shrink-0 text-brass-soft" strokeWidth={1.5} />
                <span>
                  <span className="display block text-xl">{item.title}</span>
                  <span className="mt-1.5 block text-sm leading-relaxed text-white/60">
                    {item.text}
                  </span>
                </span>
              </li>
            ))}
          </ul>

          {/* Credenciais: crédito de autoridade sem dominar a seção. */}
          <div className="mt-10 border-t border-white/15 pt-6">
            <p data-t="caption" className="label-xs text-brass-soft">
              {site.creci} · {CNAI}
            </p>
            <p data-t="body" className="mt-2 text-sm leading-relaxed text-white/55">
              Atuação em {site.city} e litoral de São Paulo.
            </p>
          </div>

          <div className="mt-8">
            <a
              href={waHref}
              target="_blank"
              rel="noreferrer"
              data-t="button"
              className="site-btn site-btn-dark w-full py-4 sm:w-auto sm:px-10"
            >
              Quero avaliar meu imóvel
            </a>
          </div>

          <div
            id="avaliacao"
            className="mt-10 scroll-mt-24 border-t border-white/15 pt-8"
          >
            <p data-t="caption" className="label-xs mb-5 text-brass-soft">
              Prefere enviar os dados do imóvel? Eu retorno com a avaliação
            </p>
            <OwnerForm />
            <a
              href={waHref}
              target="_blank"
              rel="noreferrer"
              data-t="button"
              className="label-xs mt-6 inline-flex items-center gap-2 border-b border-brass-soft/50 pb-1 text-brass-soft transition-colors hover:border-brass-soft hover:text-white"
            >
              Prefiro falar direto no WhatsApp
              <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={1.6} />
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

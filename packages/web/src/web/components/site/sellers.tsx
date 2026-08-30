import { ArrowUpRight, ClipboardCheck, Camera, Handshake } from "lucide-react";
import { site, whatsappLink } from "../../lib/site";
import { OwnerForm } from "./owner-form";

const steps = [
  {
    icon: ClipboardCheck,
    title: "Avaliação honesta",
    text: "Analiso o imóvel, o bairro e o que está realmente sendo negociado na região antes de sugerir um valor.",
  },
  {
    icon: Camera,
    title: "Apresentação à altura",
    text: "Fotos, descrição e anúncio bem feitos: o imóvel precisa parecer tão bom quanto ele é.",
  },
  {
    icon: Handshake,
    title: "Comprador certo",
    text: "Levo o imóvel a quem já está procurando esse perfil, filtro curiosos e conduzo a negociação até a assinatura.",
  },
];

/** Captação de proprietários. Sem números, prazos ou promessas inventadas. */
export function Sellers() {
  const waHref = whatsappLink(
    `Olá, ${site.broker}. Quero vender meu imóvel em ${site.city} e gostaria de uma avaliação.`,
  );

  return (
    <section id="vender" data-sec="vender" className="bg-deep text-white">
      <div className="mx-auto grid max-w-[1240px] items-center gap-14 px-6 py-24 lg:grid-cols-2 lg:gap-20 lg:px-8 lg:py-32">
        <div className="reveal">
          <img
            src="/images/vender-imovel.jpg"
            alt="Sala ampla e bem iluminada de apartamento de alto padrão pronto para venda"
            loading="lazy"
            decoding="async"
            className="aspect-[4/5] w-full object-cover lg:aspect-[4/4.4]"
          />
        </div>

        <div className="reveal" data-reveal-delay="80">
          <p data-t="caption" className="label-xs flex items-center gap-3 text-brass-soft">
            <span className="h-px w-10 bg-brass-soft/60" />
            Proprietários
          </p>
          <h2
            data-t="heading"
            className="display mt-6 text-[calc(clamp(2rem,4vw,3.2rem)*var(--h-scale,1))]"
          >
            Pensando em vender seu imóvel?
          </h2>
          <p data-t="subheading" className="mt-5 max-w-xl text-base leading-relaxed text-white/70">
            Imóvel parado quase sempre é preço fora da realidade ou apresentação fraca. Eu cuido dos
            dois — avaliação com base no que o mercado local está pagando, anúncio bem construído e
            negociação conduzida por alguém que fala com compradores todos os dias.
          </p>

          <ul className="mt-10 space-y-6 border-l border-white/15 pl-6">
            {steps.map((step) => (
              <li key={step.title} data-t="info" className="flex items-start gap-4">
                <step.icon className="mt-1 h-4 w-4 shrink-0 text-brass-soft" strokeWidth={1.5} />
                <span>
                  <span className="display block text-xl">{step.title}</span>
                  <span className="mt-1.5 block text-sm leading-relaxed text-white/60">
                    {step.text}
                  </span>
                </span>
              </li>
            ))}
          </ul>

          <div className="mt-10 border-t border-white/15 pt-8">
            <p data-t="caption" className="label-xs mb-5 text-brass-soft">
              Avaliação gratuita do seu imóvel
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

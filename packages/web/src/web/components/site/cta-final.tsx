import { ArrowUpRight } from "lucide-react";
import { site, whatsappLink } from "../../lib/site";
import { useSiteContent } from "./content";
import { Lines } from "./hero";

/**
 * Faixa de chamada final ("Não encontrou o que procurava?").
 * Editável em /admin/editor → Seções → CTA final.
 */
export function CtaFinal() {
  const { sections, theme } = useSiteContent();
  const data = sections.ctaFinal;
  const href =
    data.ctaHref.trim() ||
    whatsappLink(`Olá, ${site.broker}. Não encontrei no site o que procuro. Estou buscando: `);
  const external = href.startsWith("http");

  return (
    <section id="busca-personalizada" className="mx-auto max-w-[1240px] px-6 pb-24 lg:px-8">
      <div className="reveal relative overflow-hidden border border-line bg-white/60 px-8 py-10 text-center">
        {data.imageUrl.trim() && (
          <>
            <img
              src={data.imageUrl}
              alt=""
              className="absolute inset-0 h-full w-full object-cover opacity-15"
            />
            <div className="absolute inset-0 bg-paper/50" />
          </>
        )}
        <div className="relative">
          {data.eyebrow.trim() && (
            <p className="label-xs mb-4 text-brass">{data.eyebrow}</p>
          )}
          {data.title.trim() && (
            <h3 className="display text-[calc(1.875rem*var(--h-scale,1))] text-deep">
              <Lines text={data.title} />
            </h3>
          )}
          {data.text.trim() && (
            <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-muted">
              <Lines text={data.text} />
            </p>
          )}
          {data.ctaLabel.trim() && (
            <a
              href={href}
              target={external ? "_blank" : undefined}
              rel={external ? "noreferrer" : undefined}
              className="site-btn mt-7"
              data-btn={theme.buttonStyle}
            >
              {data.ctaLabel}
              <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={1.6} />
            </a>
          )}
        </div>
      </div>
    </section>
  );
}

import { ArrowUpRight, BadgeCheck, Clock, MapPin } from "lucide-react";
import { PropertySearch } from "./property-search";
import { HeroContactCard } from "./hero-contact-card";
import { useSiteContent } from "./content";

const icons = [MapPin, BadgeCheck, Clock];

/** Quebra de linha no conteúdo (\n) vira <br /> no site. */
export function Lines({ text }: { text: string }) {
  const parts = (text ?? "").split("\n");
  return (
    <>
      {parts.map((part, index) => (
        <span key={index}>
          {part}
          {index < parts.length - 1 && <br />}
        </span>
      ))}
    </>
  );
}

export function Hero() {
  const { hero, theme } = useSiteContent();
  const centered = hero.align === "center";
  const formSide = hero.contentSide === "right";
  const overlay = Math.min(100, Math.max(0, hero.overlay)) / 100;

  return (
    <section id="top" data-sec="hero" className="relative isolate overflow-hidden bg-black">
      {hero.imageUrl.trim() && (
        <img
          src={hero.imageUrl}
          alt="Orla e arquitetura do litoral de Praia Grande ao fim do dia"
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}

      {/* Camadas escuras: preto sólido à esquerda, imagem respirando à direita. */}
      <div
        className="absolute inset-0 bg-gradient-to-r from-black/90 via-black/55 to-transparent"
        style={{ opacity: Math.min(0.9, overlay + 0.08) }}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/30" />
      {/* Brilho champanhe discreto + fio dourado fechando a dobra. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-32 -right-24 h-[460px] w-[460px] rounded-full bg-brass/20 blur-[130px]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-brass/45 to-transparent"
      />

      <div className="relative mx-auto grid max-w-[1240px] items-start gap-12 px-6 pt-24 pb-8 sm:pt-28 lg:grid-cols-12 lg:gap-12 lg:px-8 lg:pt-32 lg:pb-6">
        <div
          className={`min-w-0 lg:col-span-7 ${formSide ? "lg:order-2 lg:col-start-6" : ""} ${
            centered ? "text-center" : ""
          }`}
        >
          {hero.eyebrow.trim() && (
            <p
              data-t="caption"
              className={`reveal label-xs flex items-center gap-3 text-brass-soft ${
                centered ? "justify-center" : ""
              }`}
            >
              <span className="h-px w-10 bg-brass-soft/70" />
              {hero.eyebrow}
            </p>
          )}

          <h1
            data-t="heading"
            className="reveal display mt-7 text-white text-[calc(clamp(2.4rem,5.6vw,4.4rem)*var(--h-scale,1))] leading-[1.04]"
            data-reveal-delay="80"
          >
            <Lines text={hero.title} />
            {hero.titleAccent.trim() && (
              <>
                {hero.title.trim() ? " " : null}
                <span className="text-brass-soft italic">
                  <Lines text={hero.titleAccent} />
                </span>
              </>
            )}
          </h1>

          {hero.subtitle.trim() && (
            <p
              data-t="subheading"
              className={`reveal mt-7 max-w-xl text-[17px] leading-relaxed text-white/75 ${
                centered ? "mx-auto" : ""
              }`}
              data-reveal-delay="160"
            >
              <Lines text={hero.subtitle} />
            </p>
          )}

          {hero.supportText.trim() && (
            <p
              data-t="body"
              className={`reveal mt-4 max-w-xl text-sm leading-relaxed text-white/55 ${
                centered ? "mx-auto" : ""
              }`}
              data-reveal-delay="180"
            >
              <Lines text={hero.supportText} />
            </p>
          )}

          {(hero.primaryCtaLabel.trim() || hero.secondaryCtaLabel.trim()) && (
            <div
              className={`reveal mt-9 flex flex-wrap gap-4 ${centered ? "justify-center" : ""}`}
              data-reveal-delay="200"
            >
              {hero.primaryCtaLabel.trim() && (
                <a
                  href={hero.primaryCtaHref || "#imoveis"}
                  className="site-btn site-btn-dark"
                  data-t="button"
                  data-btn={theme.buttonStyle}
                >
                  {hero.primaryCtaLabel}
                  <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={1.6} />
                </a>
              )}
              {hero.secondaryCtaLabel.trim() && (
                <a
                  href={hero.secondaryCtaHref || "#contato"}
                  className="site-btn site-btn-dark"
                  data-t="button"
                  data-btn="outline"
                >
                  {hero.secondaryCtaLabel}
                </a>
              )}
            </div>
          )}

          {/* Benefícios curtos: ícones dourados discretos, sem promessa inflada. */}
          {hero.assurances.length > 0 && (
            <ul
              className={`reveal mt-10 flex flex-wrap gap-3 ${centered ? "justify-center" : ""}`}
              data-reveal-delay="240"
            >
              {hero.assurances.map((item, index) => {
                const Icon = icons[index % icons.length];
                return (
                  <li
                    key={item.id}
                    data-t="info"
                    className="flex min-w-0 items-center gap-2.5 border border-white/12 bg-white/[0.04] px-4 py-2.5 text-[12.5px] leading-snug text-white/80 backdrop-blur-sm"
                  >
                    <Icon className="h-4 w-4 shrink-0 text-brass-soft" strokeWidth={1.5} />
                    {item.text}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div
          className={`reveal min-w-0 lg:col-span-5 ${formSide ? "lg:order-1 lg:col-start-1" : ""}`}
          data-reveal-delay="320"
        >
          <HeroContactCard />
        </div>
      </div>

      {/* Busca integrada: filtra a vitrine já carregada, sem nova chamada de API. */}
      <div className="relative mx-auto max-w-[1240px] px-6 pb-12 lg:px-8 lg:pb-14">
        <div className="reveal" data-reveal-delay="360">
          <PropertySearch />
        </div>
      </div>
    </section>
  );
}

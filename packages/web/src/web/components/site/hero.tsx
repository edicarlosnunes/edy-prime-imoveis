import { ShieldCheck, MapPin, Clock, ArrowUpRight } from "lucide-react";
import { LeadForm } from "./lead-form";
import { useSiteContent } from "./content";

const icons = [ShieldCheck, MapPin, Clock];

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
    <section id="top" data-sec="hero" className="relative min-h-screen overflow-hidden bg-deep">
      {hero.imageUrl.trim() && (
        <img
          src={hero.imageUrl}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
      <div
        className="absolute inset-0 bg-gradient-to-r from-deep via-deep/70 to-deep/20"
        style={{ opacity: overlay + 0.25 }}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-deep via-transparent to-transparent" />

      <div
        className={`relative mx-auto grid max-w-[1240px] gap-16 px-6 pt-36 pb-24 lg:grid-cols-12 lg:gap-10 lg:px-8 lg:pt-48 lg:pb-32`}
      >
        <div
          className={`lg:col-span-7 ${formSide ? "lg:order-2 lg:col-start-6" : ""} ${
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
            className="reveal display mt-8 text-white text-[calc(clamp(2.6rem,6vw,4.6rem)*var(--h-scale,1))]"
            data-reveal-delay="80"
          >
            <Lines text={hero.title} />
            {hero.titleAccent.trim() && (
              <>
                {hero.title.trim() && <br />}
                <span className="text-brass-soft italic">
                  <Lines text={hero.titleAccent} />
                </span>
              </>
            )}
          </h1>

          {hero.subtitle.trim() && (
            <p
              data-t="subheading"
              className={`reveal mt-8 max-w-xl text-lg leading-relaxed text-white/75 ${
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
              className={`reveal mt-10 flex flex-wrap gap-4 ${centered ? "justify-center" : ""}`}
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

          {hero.assurances.length > 0 && (
            <ul
              className={`reveal mt-12 space-y-4 ${
                centered ? "inline-block text-left" : "border-l border-white/15 pl-6"
              }`}
              data-reveal-delay="240"
            >
              {hero.assurances.map((item, index) => {
                const Icon = icons[index % icons.length];
                return (
                  <li key={item.id} data-t="info" className="flex items-start gap-3 text-sm text-white/70">
                    <Icon className="mt-0.5 h-4 w-4 shrink-0 text-brass-soft" strokeWidth={1.5} />
                    {item.text}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {hero.showForm && (
          <div
            className={`reveal lg:col-span-5 ${formSide ? "lg:order-1 lg:col-start-1" : ""}`}
            data-reveal-delay="320"
          >
            <div className="grain relative border border-white/12 bg-deep/70 p-8 backdrop-blur-md lg:p-10">
              {hero.formEyebrow.trim() && (
                <p data-t="caption" className="label-xs text-brass-soft">{hero.formEyebrow}</p>
              )}
              {hero.formTitle.trim() && (
                <h2 data-t="subheading" className="display mt-3 text-3xl text-white">{hero.formTitle}</h2>
              )}
              {hero.formText.trim() && (
                <p data-t="body" className="mt-3 mb-7 text-sm leading-relaxed text-white/60">{hero.formText}</p>
              )}
              <LeadForm tone="dark" source="hero" />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

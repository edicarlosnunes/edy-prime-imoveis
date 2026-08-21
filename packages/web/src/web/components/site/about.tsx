import { Check } from "lucide-react";
import { site, whatsappLink } from "../../lib/site";
import { useSiteContent } from "./content";
import { Lines } from "./hero";

export function About() {
  const { sections } = useSiteContent();
  const data = sections.sobre;

  return (
    <section id="sobre" className="mx-auto max-w-[1240px] px-6 py-24 lg:px-8 lg:py-32">
      <div className="grid items-center gap-14 lg:grid-cols-12 lg:gap-16">
        {data.imageUrl.trim() && (
          <div className="reveal lg:col-span-5">
            <div className="relative">
              <div className="absolute -top-5 -left-5 h-32 w-32 border-t border-l border-brass/50" />
              <img
                src={data.imageUrl}
                alt={`${site.broker} — ${site.role}`}
                className="relative w-full object-cover"
              />
              {(data.badgeName.trim() || data.badgeCaption.trim()) && (
                <div className="absolute -right-4 -bottom-6 bg-deep px-6 py-5 text-white">
                  <p className="display text-2xl">{data.badgeName}</p>
                  <p className="label-xs mt-1 text-brass-soft">{data.badgeCaption}</p>
                </div>
              )}
            </div>
          </div>
        )}

        <div className={data.imageUrl.trim() ? "lg:col-span-7" : "lg:col-span-12"}>
          {data.eyebrow.trim() && (
            <p className="reveal label-xs flex items-center gap-3 text-brass">
              <span className="h-px w-10 bg-brass/60" />
              {data.eyebrow}
            </p>
          )}
          {data.title.trim() && (
            <h2
              className="reveal display mt-6 text-[calc(clamp(2rem,4vw,3.2rem)*var(--h-scale,1))] text-deep"
              data-reveal-delay="80"
            >
              <Lines text={data.title} />
            </h2>
          )}
          {data.paragraphs.length > 0 && (
            <div
              className="reveal mt-7 space-y-5 text-base leading-relaxed text-muted"
              data-reveal-delay="140"
            >
              {data.paragraphs.map((item) => (
                <p key={item.id}>
                  <Lines text={item.text} />
                </p>
              ))}
            </div>
          )}

          {data.items.length > 0 && (
            <ul className="reveal mt-10 grid gap-4 sm:grid-cols-2" data-reveal-delay="200">
              {data.items.map((item) => (
                <li
                  key={item.id}
                  className="flex items-start gap-3 text-sm leading-relaxed text-ink"
                >
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-brass" strokeWidth={1.8} />
                  {item.text}
                </li>
              ))}
            </ul>
          )}

          {data.ctaLabel.trim() && (
            <a
              href={whatsappLink(`Olá, ${site.broker}. Quero conversar sobre imóveis em ${site.city}.`)}
              target="_blank"
              rel="noreferrer"
              className="site-btn reveal mt-12"
              data-btn="outline"
              data-reveal-delay="260"
            >
              {data.ctaLabel}
            </a>
          )}
        </div>
      </div>
    </section>
  );
}

import { ShieldCheck, MessageCircle, KeyRound, Award, Sparkles } from "lucide-react";
import { site } from "../../lib/site";
import { useSiteContent } from "./content";
import { Lines } from "./hero";

const icons = [ShieldCheck, MessageCircle, KeyRound, Award, Sparkles];

export function Proof() {
  const { sections } = useSiteContent();
  const data = sections.diferenciais;

  return (
    <section id="diferenciais" className="border-y border-line bg-bone">
      <div className="mx-auto max-w-[1240px] px-6 py-16 lg:px-8">
        {(data.eyebrow.trim() || data.title.trim() || data.text.trim()) && (
          <div className="reveal mb-12 max-w-2xl">
            {data.eyebrow.trim() && (
              <p className="label-xs flex items-center gap-3 text-brass">
                <span className="h-px w-10 bg-brass/60" />
                {data.eyebrow}
              </p>
            )}
            {data.title.trim() && (
              <h2 className="display mt-5 text-[calc(clamp(1.9rem,3.6vw,2.8rem)*var(--h-scale,1))] text-deep">
                <Lines text={data.title} />
              </h2>
            )}
            {data.text.trim() && (
              <p className="mt-4 text-sm leading-relaxed text-muted">
                <Lines text={data.text} />
              </p>
            )}
          </div>
        )}

        <div className="grid gap-10 md:grid-cols-3">
          {data.items.map((item, index) => {
            const Icon = icons[index % icons.length];
            return (
              <div
                key={item.id}
                className="reveal border-l border-brass/30 pl-5"
                data-reveal-delay={index * 70}
              >
                <Icon className="h-5 w-5 text-brass" strokeWidth={1.5} />
                <p className="display mt-4 text-2xl text-deep">{item.title}</p>
                <p className="mt-2 text-sm leading-relaxed text-muted">{item.text}</p>
              </div>
            );
          })}
        </div>

        {data.showDistricts && site.districts.length > 0 && (
          <div className="reveal label-xs mt-14 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line pt-8 text-muted">
            {data.districtsLabel.trim() && (
              <span className="text-brass">{data.districtsLabel}</span>
            )}
            {site.districts.map((district, index) => (
              <span key={district}>
                {district}
                {index < site.districts.length - 1 && <span className="ml-3 text-line">/</span>}
              </span>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

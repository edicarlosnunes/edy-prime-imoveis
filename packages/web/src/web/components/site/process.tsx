import { useSiteContent } from "./content";
import { Lines } from "./hero";

export function Process() {
  const { sections } = useSiteContent();
  const data = sections.comoFunciona;

  return (
    <section id="como-funciona" className="relative overflow-hidden bg-deep">
      {data.imageUrl.trim() && (
        <img
          src={data.imageUrl}
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-20"
        />
      )}
      <div className="absolute inset-0 bg-deep/80" />

      <div className="relative mx-auto max-w-[1240px] px-6 py-24 lg:px-8 lg:py-32">
        <div className="reveal max-w-2xl">
          {data.eyebrow.trim() && (
            <p className="label-xs flex items-center gap-3 text-brass-soft">
              <span className="h-px w-10 bg-brass-soft/60" />
              {data.eyebrow}
            </p>
          )}
          {data.title.trim() && (
            <h2 className="display mt-6 text-[calc(clamp(2rem,4vw,3.2rem)*var(--h-scale,1))] text-white">
              <Lines text={data.title} />
            </h2>
          )}
          {data.text.trim() && (
            <p className="mt-6 text-base leading-relaxed text-white/70">
              <Lines text={data.text} />
            </p>
          )}
        </div>

        <div className="mt-16 grid gap-px border border-white/10 md:grid-cols-3">
          {data.items.map((step, index) => (
            <div
              key={step.id}
              className="reveal border-white/10 bg-white/[0.03] p-10 md:border-r md:last:border-r-0"
              data-reveal-delay={index * 90}
            >
              <p className="display text-6xl text-brass-soft/40">{step.number}</p>
              <h3 className="display mt-6 text-2xl text-white">{step.title}</h3>
              <p className="mt-4 text-sm leading-relaxed text-white/65">{step.text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

import { useState } from "react";
import { Plus, Minus } from "lucide-react";
import { useSiteContent } from "./content";
import { Lines } from "./hero";

export function Faq() {
  const { sections } = useSiteContent();
  const data = sections.faq;
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section id="duvidas" className="mx-auto max-w-[1240px] px-6 py-24 lg:px-8 lg:py-32">
      <div className="grid gap-14 lg:grid-cols-12 lg:gap-16">
        <div className="reveal lg:col-span-4">
          {data.eyebrow.trim() && (
            <p className="label-xs flex items-center gap-3 text-brass">
              <span className="h-px w-10 bg-brass/60" />
              {data.eyebrow}
            </p>
          )}
          {data.title.trim() && (
            <h2 className="display mt-6 text-[calc(clamp(2rem,4vw,3rem)*var(--h-scale,1))] text-deep">
              <Lines text={data.title} />
            </h2>
          )}
          {data.text.trim() && (
            <p className="mt-5 text-sm leading-relaxed text-muted">
              <Lines text={data.text} />
            </p>
          )}
        </div>

        <div className="lg:col-span-8">
          {data.items.map((faq, index) => {
            const isOpen = open === index;
            return (
              <div
                key={faq.id}
                className="reveal border-b border-line"
                data-reveal-delay={index * 50}
              >
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : index)}
                  className="flex w-full items-center justify-between gap-6 py-6 text-left"
                >
                  <span className="display text-xl text-deep lg:text-2xl">{faq.question}</span>
                  {isOpen ? (
                    <Minus className="h-4 w-4 shrink-0 text-brass" strokeWidth={1.6} />
                  ) : (
                    <Plus className="h-4 w-4 shrink-0 text-brass" strokeWidth={1.6} />
                  )}
                </button>
                <div
                  className={`grid transition-all duration-500 ease-out ${
                    isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                  }`}
                >
                  <p className="overflow-hidden pr-10 text-sm leading-relaxed text-muted">
                    <span className="block pb-6">{faq.answer}</span>
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

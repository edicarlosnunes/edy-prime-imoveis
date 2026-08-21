import { site } from "../../lib/site";
import { LeadForm } from "./lead-form";
import { useSiteContent } from "./content";
import { Lines } from "./hero";

/** Seção de contato ("Vamos encontrar o seu endereço"). */
export function FinalCta() {
  const { sections } = useSiteContent();
  const data = sections.contato;

  return (
    <section id="contato" data-sec="contato" className="relative overflow-hidden bg-deep">
      {data.imageUrl.trim() && (
        <img
          src={data.imageUrl}
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-25"
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-r from-deep via-deep/90 to-deep/60" />

      <div className="relative mx-auto grid max-w-[1240px] gap-14 px-6 py-24 lg:grid-cols-12 lg:gap-16 lg:px-8 lg:py-32">
        <div className={`reveal ${data.showForm ? "lg:col-span-6" : "lg:col-span-8"}`}>
          {data.eyebrow.trim() && (
            <p data-t="caption" className="label-xs flex items-center gap-3 text-brass-soft">
              <span className="h-px w-10 bg-brass-soft/60" />
              {data.eyebrow}
            </p>
          )}
          {(data.title.trim() || data.titleAccent.trim()) && (
            <h2 data-t="heading" className="display mt-6 text-[calc(clamp(2.2rem,4.4vw,3.6rem)*var(--h-scale,1))] text-white">
              <Lines text={data.title} />
              {data.titleAccent.trim() && (
                <>
                  {data.title.trim() && <br />}
                  <span className="text-brass-soft italic">
                    <Lines text={data.titleAccent} />
                  </span>
                </>
              )}
            </h2>
          )}
          <p data-t="body" className="mt-8 max-w-md text-base leading-relaxed text-white/70">
            {data.text.trim() ? (
              <Lines text={data.text} />
            ) : (
              <>
                Preencha ao lado ou fale direto no WhatsApp {site.whatsappLabel}. Atendimento{" "}
                {site.hours.toLowerCase()}.
              </>
            )}
          </p>

          <dl data-t="info" className="mt-12 space-y-6 border-t border-white/12 pt-8 text-sm text-white/65">
            {data.officeLabel.trim() && (
              <div>
                <dt data-t="caption" className="label-xs text-brass-soft">{data.officeLabel}</dt>
                <dd className="mt-2">{site.address}</dd>
              </div>
            )}
            {data.emailLabel.trim() && (
              <div>
                <dt data-t="caption" className="label-xs text-brass-soft">{data.emailLabel}</dt>
                <dd className="mt-2">{site.email}</dd>
              </div>
            )}
            {data.creciLabel.trim() && (
              <div>
                <dt data-t="caption" className="label-xs text-brass-soft">{data.creciLabel}</dt>
                <dd className="mt-2">{site.creci}</dd>
              </div>
            )}
          </dl>
        </div>

        {data.showForm && (
          <div className="reveal lg:col-span-6 lg:col-start-7" data-reveal-delay="120">
            <div className="grain relative border border-white/12 bg-white/[0.04] p-8 backdrop-blur-md lg:p-10">
              {data.formTitle.trim() && (
                <h3 data-t="subheading" className="display text-3xl text-white">{data.formTitle}</h3>
              )}
              {data.formText.trim() && (
                <p data-t="body" className="mt-3 mb-7 text-sm leading-relaxed text-white/60">{data.formText}</p>
              )}
              <LeadForm tone="dark" source="cta-final" />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

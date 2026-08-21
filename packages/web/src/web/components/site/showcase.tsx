import { BedDouble, Car, Maximize, ArrowUpRight } from "lucide-react";
import { useProperties } from "../../queries/properties";
import { formatBRL, site, whatsappLink } from "../../lib/site";

const statusLabel: Record<string, string> = {
  disponivel: "Disponível",
  reservado: "Reservado",
  vendido: "Vendido",
  alugado: "Alugado",
};

function CardSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="aspect-[4/3] w-full bg-bone" />
      <div className="mt-5 h-3 w-24 bg-bone" />
      <div className="mt-3 h-5 w-full bg-bone" />
      <div className="mt-3 h-4 w-32 bg-bone" />
    </div>
  );
}

export function Showcase() {
  const properties = useProperties();

  return (
    <section id="imoveis" className="mx-auto max-w-[1240px] px-6 py-24 lg:px-8 lg:py-32">
      <div className="flex flex-wrap items-end justify-between gap-8">
        <div className="reveal max-w-2xl">
          <p className="label-xs flex items-center gap-3 text-brass">
            <span className="h-px w-10 bg-brass/60" />
            Seleção da semana
          </p>
          <h2 className="display mt-6 text-[clamp(2rem,4vw,3.2rem)] text-deep">
            Imóveis que já passaram
            <br />
            pelo meu filtro
          </h2>
        </div>
        <p className="reveal max-w-sm text-sm leading-relaxed text-muted" data-reveal-delay="80">
          Visitados pessoalmente, com documentação conferida e valor dentro da realidade do bairro.
          O portfólio completo tem mais opções — me diga o perfil e eu envio.
        </p>
      </div>

      <div className="mt-16 grid gap-x-8 gap-y-14 sm:grid-cols-2 lg:grid-cols-3">
        {properties.isLoading &&
          [0, 1, 2, 3, 4, 5].map((n) => <CardSkeleton key={n} />)}

        {properties.isError && (
          <p className="text-sm text-muted">
            Não foi possível carregar a vitrine agora. Fale comigo no WhatsApp {site.whatsappLabel}.
          </p>
        )}

        {properties.data?.map((property, index) => (
          <article
            key={property.code}
            className="reveal group flex flex-col"
            data-reveal-delay={(index % 3) * 80}
          >
            <div className="relative overflow-hidden">
              <img
                src={property.image}
                alt={property.title}
                className="aspect-[4/3] w-full object-cover transition-transform duration-[900ms] ease-out group-hover:scale-[1.05]"
              />
              <span className="absolute top-4 left-4 bg-deep/90 px-3 py-1.5 label-xs text-white">
                {statusLabel[property.status]}
              </span>
            </div>

            <p className="mt-5 label-xs text-brass">
              {property.district} · {property.code}
            </p>
            <h3 className="display mt-2 text-2xl leading-snug text-deep">{property.title}</h3>
            <p className="mt-2 text-sm text-muted">{property.highlight}</p>

            <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line pt-4 text-xs text-muted">
              <span className="flex items-center gap-1.5">
                <BedDouble className="h-3.5 w-3.5 text-brass" strokeWidth={1.5} />
                {property.bedrooms} dorm. · {property.suites} suíte
                {property.suites > 1 ? "s" : ""}
              </span>
              <span className="flex items-center gap-1.5">
                <Car className="h-3.5 w-3.5 text-brass" strokeWidth={1.5} />
                {property.parking} vaga{property.parking > 1 ? "s" : ""}
              </span>
              <span className="flex items-center gap-1.5">
                <Maximize className="h-3.5 w-3.5 text-brass" strokeWidth={1.5} />
                {property.area} m²
              </span>
            </div>

            <div className="mt-5 flex items-end justify-between gap-4">
              <p className="display text-3xl text-deep">{formatBRL(property.price)}</p>
              <a
                href={whatsappLink(
                  `Olá, ${site.broker}. Tenho interesse no imóvel ${property.code} (${property.district}, ${property.bedrooms} dormitórios). Pode me passar mais detalhes?`,
                )}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 border-b border-brass/50 pb-1 label-xs text-brass transition-colors hover:border-brass hover:text-deep"
              >
                Falar sobre este
                <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={1.6} />
              </a>
            </div>
          </article>
        ))}
      </div>

      <div className="reveal mt-20 border border-line bg-white/60 px-8 py-10 text-center">
        <h3 className="display text-3xl text-deep">Não encontrou o que procurava?</h3>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-muted">
          Boa parte dos imóveis de alto padrão não vai para portais. Me diga bairro, metragem e
          faixa de valor e eu busco nas carteiras fechadas da região.
        </p>
        <a
          href={whatsappLink(
            `Olá, ${site.broker}. Não encontrei no site o que procuro. Estou buscando: `,
          )}
          target="_blank"
          rel="noreferrer"
          className="mt-7 inline-flex items-center gap-2 bg-deep px-8 py-4 label-xs text-white transition-colors hover:bg-brass"
        >
          Pedir uma busca personalizada
          <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={1.6} />
        </a>
      </div>
    </section>
  );
}

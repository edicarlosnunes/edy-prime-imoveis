import { BedDouble, Car, Maximize, ArrowUpRight, SearchX } from "lucide-react";
import { Link } from "wouter";
import { useProperties } from "../../queries/properties";
import { formatBRL, site } from "../../lib/site";
import { useSiteContent } from "./content";
import { Lines } from "./hero";
import { site as brand, whatsappLink } from "../../lib/site";
import { filterProperties, hasAnyFilter, useSearch } from "./search-store";

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
  const { sections } = useSiteContent();
  const data = sections.imoveis;
  const limit = data.limit > 0 ? data.limit : 12;
  const { filters, applied, reset } = useSearch();
  const all = properties.data ?? [];
  /* Filtro só entra em cena depois que a busca do hero é aplicada. */
  const filtering = applied && hasAnyFilter(filters);
  const matched = filtering ? filterProperties(all, filters) : all;
  const list = matched.slice(0, limit);
  const empty = !properties.isLoading && !properties.isError && list.length === 0;

  return (
    <section id="imoveis" data-sec="imoveis" className="mx-auto max-w-[1240px] px-6 py-24 lg:px-8 lg:py-32">
      <div className="flex flex-wrap items-end justify-between gap-8">
        <div className="reveal max-w-2xl">
          {data.eyebrow.trim() && (
            <p data-t="caption" className="label-xs flex items-center gap-3 text-brass">
              <span className="h-px w-10 bg-brass/60" />
              {data.eyebrow}
            </p>
          )}
          {data.title.trim() && (
            <h2 data-t="heading" className="display mt-6 text-[calc(clamp(2rem,4vw,3.2rem)*var(--h-scale,1))] text-deep">
              <Lines text={data.title} />
            </h2>
          )}
          {data.subtitle.trim() && (
            <p data-t="subheading" className="mt-4 text-base leading-relaxed text-muted">
              <Lines text={data.subtitle} />
            </p>
          )}
        </div>
        {data.text.trim() && (
          <p data-t="body" className="reveal max-w-sm text-sm leading-relaxed text-muted" data-reveal-delay="80">
            <Lines text={data.text} />
          </p>
        )}
      </div>

      {filtering && !properties.isLoading && (
        <p data-t="caption" className="label-xs mt-10 flex flex-wrap items-center gap-3 text-muted">
          <span>
            {matched.length === 0
              ? "Nenhum imóvel publicado com esses filtros"
              : `${matched.length} ${matched.length === 1 ? "imóvel encontrado" : "imóveis encontrados"}`}
          </span>
          <button
            type="button"
            onClick={reset}
            data-t="button"
            className="border-b border-brass/50 pb-0.5 text-brass transition-colors hover:border-brass hover:text-deep"
          >
            Ver todos os imóveis
          </button>
        </p>
      )}

      <div className="mt-16 grid gap-x-8 gap-y-14 sm:grid-cols-2 lg:grid-cols-3">
        {properties.isLoading && [0, 1, 2, 3, 4, 5].map((n) => <CardSkeleton key={n} />)}

        {properties.isError && (
          <p className="text-sm text-muted">
            Não foi possível carregar a vitrine agora. Fale comigo no WhatsApp {site.whatsappLabel}.
          </p>
        )}

        {list.map((property, index) => (
          <article
            key={property.code}
            className="reveal group flex flex-col"
            data-reveal-delay={(index % 3) * 80}
          >
            <Link href={`/imovel/${property.slug}`} className="relative block overflow-hidden">
              <img
                src={property.image}
                alt={property.title}
                loading="lazy"
                decoding="async"
                className="aspect-[4/3] w-full object-cover transition-transform duration-[900ms] ease-out group-hover:scale-[1.05]"
              />
              <span data-t="caption" className="label-xs absolute top-4 left-4 bg-deep/90 px-3 py-1.5 text-white">
                {statusLabel[property.status]}
              </span>
            </Link>

            <p data-t="caption" className="label-xs mt-5 text-brass">
              {property.district} · {property.code}
            </p>
            <Link href={`/imovel/${property.slug}`}>
              <h3 data-t="card" className="display mt-2 text-2xl leading-snug text-deep transition-colors hover:text-brass">
                {property.title}
              </h3>
            </Link>
            <p data-t="card" className="mt-2 text-sm text-muted">{property.highlight}</p>

            <div data-t="features" className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line pt-4 text-xs text-muted">
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
              <p data-t="price" className="display text-3xl text-deep">{formatBRL(property.price)}</p>
              <Link
                href={`/imovel/${property.slug}`}
                data-t="button"
                className="label-xs flex items-center gap-1.5 border-b border-brass/50 pb-1 text-brass transition-colors hover:border-brass hover:text-deep"
              >
                Ver detalhes
                <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={1.6} />
              </Link>
            </div>
          </article>
        ))}
      </div>

      {empty && (
        <div className="border border-line bg-white/50 px-8 py-16 text-center">
          <SearchX className="mx-auto h-6 w-6 text-brass" strokeWidth={1.3} />
          <h3 data-t="card" className="display mt-5 text-2xl text-deep">
            Ainda não tenho um imóvel publicado com esse perfil
          </h3>
          <p data-t="body" className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted">
            Boa parte da minha carteira circula fora dos portais. Me diga o que você procura e eu
            busco pessoalmente — inclusive em Mongaguá, Itanhaém e Peruíbe.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-4">
            <a
              href={whatsappLink(
                `Olá, ${brand.broker}. Não encontrei no site o imóvel que procuro. Pode me ajudar?`,
              )}
              target="_blank"
              rel="noreferrer"
              data-t="button"
              className="site-btn"
            >
              Falar com um corretor
              <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={1.6} />
            </a>
            {filtering && (
              <button
                type="button"
                onClick={reset}
                data-t="button"
                className="label-xs border-b border-brass/50 pb-1 text-brass transition-colors hover:border-brass hover:text-deep"
              >
                Ver todos os imóveis
              </button>
            )}
          </div>
        </div>
      )}

      {!empty && !filtering && matched.length > limit && (
        <div className="mt-16 text-center">
          <p data-t="caption" className="label-xs text-muted">
            Mostrando {list.length} de {matched.length} imóveis publicados
          </p>
        </div>
      )}
    </section>
  );
}

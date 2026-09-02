import { ArrowUpRight } from "lucide-react";
import { useSearch } from "./search-store";

/**
 * Regiões atendidas no litoral sul. Cada card apenas aplica o filtro de cidade
 * na vitrine — nenhuma contagem de imóveis é exibida para não inventar dado.
 */
const regions = [
  {
    city: "Praia Grande",
    image: "/images/regiao-praia-grande.jpg",
    alt: "Orla de Praia Grande com prédios à beira-mar ao entardecer",
    text: "Orla contínua, bairros consolidados e a maior parte da minha carteira.",
  },
  {
    city: "Mongaguá",
    image: "/images/regiao-mongagua.jpg",
    alt: "Praia de Mongaguá com faixa de areia larga e mar calmo",
    text: "Ritmo tranquilo e metro quadrado mais acessível, ótimo para segunda casa.",
  },
  {
    city: "Itanhaém",
    image: "/images/regiao-itanhaem.jpg",
    alt: "Costa de Itanhaém com vegetação nativa e mar ao fundo",
    text: "Cidade histórica, praias amplas e boas oportunidades de terreno e casa.",
  },
  {
    city: "Peruíbe",
    image: "/images/regiao-peruibe.jpg",
    alt: "Praia de Peruíbe com mata atlântica junto à faixa de areia",
    text: "Natureza preservada e procura crescente por quem busca sossego.",
  },
  {
    city: "Guarujá",
    image: "/images/regiao-guaruja.jpg",
    alt: "Vista da orla do Guarujá com praia e morro ao fundo",
    text: "Praias badaladas e imóveis de veraneio com boa liquidez o ano todo.",
  },
  {
    city: "Santos",
    image: "/images/regiao-santos.jpg",
    alt: "Jardins da orla de Santos com prédios à beira-mar",
    text: "Infraestrutura completa, jardins da orla e bairros de alto padrão.",
  },
  {
    city: "São Vicente",
    image: "/images/regiao-sao-vicente.jpg",
    alt: "Praia do Itararé em São Vicente com a orla ao entardecer",
    text: "Acesso fácil, praia urbana e ótimo custo-benefício para morar.",
  },
  {
    city: "Cubatão",
    image: "/images/regiao-cubatao.jpg",
    alt: "Vista de Cubatão a partir da Serra do Mar",
    text: "Cidade estratégica na Baixada, forte procura por quem trabalha na região.",
  },
];

export function Regions() {
  const { setFilter, apply } = useSearch();

  const open = (city: string) => {
    setFilter("city", city);
    apply();
    document.getElementById("imoveis")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <section
      id="regioes"
      data-sec="regioes"
      className="mx-auto max-w-[1240px] px-6 py-24 lg:px-8 lg:py-32"
    >
      <div className="reveal max-w-2xl">
        <p data-t="caption" className="label-xs flex items-center gap-3 text-brass">
          <span className="h-px w-10 bg-brass/60" />
          Regiões
        </p>
        <h2
          data-t="heading"
          className="display mt-6 text-[calc(clamp(2rem,4vw,3.2rem)*var(--h-scale,1))] text-deep"
        >
          Encontre seu lugar no litoral
        </h2>
        <p data-t="subheading" className="mt-4 text-base leading-relaxed text-muted">
          Atendo o litoral sul paulista de ponta a ponta. Escolha a cidade e veja o que está
          disponível hoje — se ainda não houver imóvel publicado por lá, eu busco para você.
        </p>
      </div>

      <div className="mt-16 grid gap-x-8 gap-y-12 sm:grid-cols-2 lg:grid-cols-4">
        {regions.map((region, index) => (
          <button
            key={region.city}
            type="button"
            onClick={() => open(region.city)}
            data-t="button"
            className="reveal group flex flex-col text-left"
            data-reveal-delay={(index % 4) * 80}
          >
            <span className="relative block overflow-hidden">
              <img
                src={region.image}
                alt={region.alt}
                loading="lazy"
                decoding="async"
                className="aspect-[3/4] w-full object-cover transition-transform duration-[900ms] ease-out group-hover:scale-[1.05]"
              />
              <span className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent" />
              <span className="display absolute right-5 bottom-4 left-5 text-2xl text-white">
                {region.city}
              </span>
            </span>
            <span data-t="body" className="mt-5 text-sm leading-relaxed text-muted">
              {region.text}
            </span>
            <span className="label-xs mt-4 flex items-center gap-1.5 text-brass transition-colors group-hover:text-deep">
              Ver imóveis
              <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={1.6} />
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

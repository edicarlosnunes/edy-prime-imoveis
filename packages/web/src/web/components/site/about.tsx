import { Check } from "lucide-react";
import { site, whatsappLink } from "../../lib/site";

const commitments = [
  "Nenhum imóvel entra na minha lista sem visita e documentação conferida",
  "Você fala sempre comigo — não com um call center",
  "Assessoria de financiamento e escritura com parceiros da região",
  "Avaliação gratuita para quem quer vender ou colocar para locação",
];

export function About() {
  return (
    <section id="sobre" className="mx-auto max-w-[1240px] px-6 py-24 lg:px-8 lg:py-32">
      <div className="grid items-center gap-14 lg:grid-cols-12 lg:gap-16">
        <div className="reveal lg:col-span-5">
          <div className="relative">
            <div className="absolute -top-5 -left-5 h-32 w-32 border-t border-l border-brass/50" />
            <img
              src="/images/corretor.jpg"
              alt={`${site.broker}, consultor de imóveis em ${site.city}`}
              className="relative w-full object-cover"
            />
            <div className="absolute -right-4 -bottom-6 bg-deep px-6 py-5 text-white">
              <p className="display text-2xl">{site.broker}</p>
              <p className="mt-1 label-xs text-brass-soft">{site.creci}</p>
            </div>
          </div>
        </div>

        <div className="lg:col-span-7">
          <p className="reveal label-xs flex items-center gap-3 text-brass">
            <span className="h-px w-10 bg-brass/60" />
            Quem vai te atender
          </p>
          <h2
            className="reveal display mt-6 text-[clamp(2rem,4vw,3.2rem)] text-deep"
            data-reveal-delay="80"
          >
            Mais de uma década
            <br />
            vendendo no litoral
          </h2>
          <div
            className="reveal mt-7 space-y-5 text-base leading-relaxed text-muted"
            data-reveal-delay="140"
          >
            <p>
              Comecei como corretor autônomo em {site.city} e hoje conduzo uma equipe enxuta, focada
              em imóveis de médio e alto padrão na orla. A lógica continua a mesma: poucos clientes
              por vez, atendimento direto e nenhuma promessa que eu não possa cumprir.
            </p>
            <p>
              Conheço prédio por prédio da orla — quais têm vista permanente, quais têm taxa de
              condomínio alta, quais valorizam. É essa leitura que separa uma boa compra de um
              arrependimento caro.
            </p>
          </div>

          <ul className="reveal mt-10 grid gap-4 sm:grid-cols-2" data-reveal-delay="200">
            {commitments.map((item) => (
              <li key={item} className="flex items-start gap-3 text-sm leading-relaxed text-ink">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-brass" strokeWidth={1.8} />
                {item}
              </li>
            ))}
          </ul>

          <a
            href={whatsappLink(`Olá, ${site.broker}. Quero conversar sobre imóveis em ${site.city}.`)}
            target="_blank"
            rel="noreferrer"
            className="reveal mt-12 inline-flex items-center gap-2 border border-deep px-8 py-4 label-xs text-deep transition-colors hover:bg-deep hover:text-white"
            data-reveal-delay="260"
          >
            Conversar direto comigo
          </a>
        </div>
      </div>
    </section>
  );
}

import { ShieldCheck, MapPin, Clock } from "lucide-react";
import { site } from "../../lib/site";
import { LeadForm } from "./lead-form";

const assurances = [
  { icon: ShieldCheck, text: "Documentação e negociação acompanhadas do início ao fim" },
  { icon: MapPin, text: `Atuação em toda a orla de ${site.city} e região` },
  { icon: Clock, text: "Resposta no mesmo dia, em horário comercial" },
];

export function Hero() {
  return (
    <section id="top" className="relative min-h-screen overflow-hidden bg-deep">
      <img
        src="/images/hero.jpg"
        alt="Área de lazer com piscina de borda infinita e vista para o mar ao pôr do sol"
        className="absolute inset-0 h-full w-full object-cover"
      />
      <div className="absolute inset-0 bg-gradient-to-r from-deep/95 via-deep/75 to-deep/25" />
      <div className="absolute inset-0 bg-gradient-to-t from-deep via-transparent to-transparent" />

      <div className="relative mx-auto grid max-w-[1240px] gap-16 px-6 pt-36 pb-24 lg:grid-cols-12 lg:gap-10 lg:px-8 lg:pt-48 lg:pb-32">
        <div className="lg:col-span-7">
          <p className="reveal label-xs flex items-center gap-3 text-brass-soft">
            <span className="h-px w-10 bg-brass-soft/70" />
            {site.city} · {site.state} — médio e alto padrão
          </p>

          <h1 className="reveal display mt-8 text-white text-[clamp(2.6rem,6vw,4.6rem)]" data-reveal-delay="80">
            O imóvel certo
            <br />
            à beira-mar,
            <br />
            <span className="text-brass-soft italic">sem labirinto.</span>
          </h1>

          <p
            className="reveal mt-8 max-w-xl text-lg leading-relaxed text-white/75"
            data-reveal-delay="160"
          >
            Curadoria pessoal de apartamentos e coberturas em {site.city}. Você me diz o que
            procura, eu filtro o mercado e apresento só o que vale a sua visita — com segurança
            jurídica e negociação conduzida por quem mora aqui.
          </p>

          <ul className="reveal mt-12 space-y-4 border-l border-white/15 pl-6" data-reveal-delay="240">
            {assurances.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-3 text-sm text-white/70">
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-brass-soft" strokeWidth={1.5} />
                {text}
              </li>
            ))}
          </ul>
        </div>

        <div className="reveal lg:col-span-5" data-reveal-delay="320">
          <div className="grain relative border border-white/12 bg-deep/70 p-8 backdrop-blur-md lg:p-10">
            <p className="label-xs text-brass-soft">Consulta sem compromisso</p>
            <h2 className="display mt-3 text-3xl text-white">
              Diga o que você procura
            </h2>
            <p className="mt-3 mb-7 text-sm leading-relaxed text-white/60">
              Em até algumas horas você recebe uma seleção com valores, plantas e vídeos reais.
            </p>
            <LeadForm tone="dark" source="hero" />
          </div>
        </div>
      </div>
    </section>
  );
}

import { ShieldCheck, MessageCircle, KeyRound } from "lucide-react";
import { site } from "../../lib/site";

const pillars = [
  {
    icon: ShieldCheck,
    title: "Corretor registrado",
    text: `Atendimento conduzido por profissional com registro ativo — ${site.creci}.`,
  },
  {
    icon: MessageCircle,
    title: "Atendimento direto",
    text: "Você fala comigo do primeiro contato à entrega das chaves, sem intermediários.",
  },
  {
    icon: KeyRound,
    title: "Compra, venda e locação",
    text: `Imóveis de médio e alto padrão na orla de ${site.city} e bairros próximos.`,
  },
];

export function Proof() {
  return (
    <section className="border-y border-line bg-bone">
      <div className="mx-auto max-w-[1240px] px-6 py-16 lg:px-8">
        <div className="grid gap-10 md:grid-cols-3">
          {pillars.map(({ icon: Icon, title, text }, index) => (
            <div
              key={title}
              className="reveal border-l border-brass/30 pl-5"
              data-reveal-delay={index * 70}
            >
              <Icon className="h-5 w-5 text-brass" strokeWidth={1.5} />
              <p className="display mt-4 text-2xl text-deep">{title}</p>
              <p className="mt-2 text-sm leading-relaxed text-muted">{text}</p>
            </div>
          ))}
        </div>

        <div className="reveal mt-14 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line pt-8 label-xs text-muted">
          <span className="text-brass">Bairros atendidos:</span>
          {site.districts.map((district, index) => (
            <span key={district}>
              {district}
              {index < site.districts.length - 1 && <span className="ml-3 text-line">/</span>}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

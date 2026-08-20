const steps = [
  {
    number: "01",
    title: "Conversa inicial",
    text: "Entendo objetivo, faixa de valor, financiamento e prazo. Em 15 minutos de conversa já sei o que faz sentido mostrar — e o que não faz.",
  },
  {
    number: "02",
    title: "Seleção e visitas",
    text: "Você recebe uma lista curta com vídeos, plantas e valores reais. Agendamos as visitas em sequência, no mesmo dia, sem perder tempo.",
  },
  {
    number: "03",
    title: "Proposta e chaves",
    text: "Conduzo negociação, documentação e financiamento com assessoria jurídica. Você acompanha cada etapa até a entrega das chaves.",
  },
];

export function Process() {
  return (
    <section id="como-funciona" className="relative overflow-hidden bg-deep">
      <img
        src="/images/orla.jpg"
        alt="Vista aérea da orla de Praia Grande com edifícios ao fundo"
        className="absolute inset-0 h-full w-full object-cover opacity-20"
      />
      <div className="absolute inset-0 bg-deep/80" />

      <div className="relative mx-auto max-w-[1240px] px-6 py-24 lg:px-8 lg:py-32">
        <div className="reveal max-w-2xl">
          <p className="label-xs flex items-center gap-3 text-brass-soft">
            <span className="h-px w-10 bg-brass-soft/60" />
            Como funciona
          </p>
          <h2 className="display mt-6 text-[clamp(2rem,4vw,3.2rem)] text-white">
            Três etapas claras,
            <br />
            do primeiro contato às chaves
          </h2>
        </div>

        <div className="mt-16 grid gap-px border border-white/10 md:grid-cols-3">
          {steps.map((step, index) => (
            <div
              key={step.number}
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

const testimonials = [
  {
    quote:
      "Estávamos vendo apartamento há meses e sempre caíamos em anúncio desatualizado. Em duas visitas fechamos o nosso, com vista para o mar e dentro do orçamento.",
    name: "Fernanda e Ricardo",
    detail: "Compraram no Canto do Forte",
  },
  {
    quote:
      "Comprei para investir e ele foi honesto sobre o que valorizaria e o que não. Alugou em três semanas depois da entrega.",
    name: "Marcelo A.",
    detail: "Investidor · Boqueirão",
  },
  {
    quote:
      "Vendi meu apartamento em 40 dias pelo valor que eu queria. Cuidou de tudo, inclusive da papelada do inventário.",
    name: "Sandra M.",
    detail: "Vendeu na Guilhermina",
  },
];

export function Testimonials() {
  return (
    <section className="border-y border-line bg-bone">
      <div className="mx-auto max-w-[1240px] px-6 py-24 lg:px-8 lg:py-32">
        <div className="reveal max-w-xl">
          <p className="label-xs flex items-center gap-3 text-brass">
            <span className="h-px w-10 bg-brass/60" />
            Quem já comprou comigo
          </p>
          <h2 className="display mt-6 text-[clamp(2rem,4vw,3.2rem)] text-deep">
            Histórias que sustentam
            <br />
            minha indicação
          </h2>
        </div>

        <div className="mt-16 grid gap-8 md:grid-cols-3">
          {testimonials.map((item, index) => (
            <blockquote
              key={item.name}
              className="reveal flex h-full flex-col justify-between border-t border-brass/40 bg-paper/70 p-8"
              data-reveal-delay={index * 80}
            >
              <p className="display text-[1.35rem] leading-snug text-deep">“{item.quote}”</p>
              <footer className="mt-8">
                <p className="text-sm text-ink">{item.name}</p>
                <p className="mt-1 label-xs text-muted">{item.detail}</p>
              </footer>
            </blockquote>
          ))}
        </div>
      </div>
    </section>
  );
}

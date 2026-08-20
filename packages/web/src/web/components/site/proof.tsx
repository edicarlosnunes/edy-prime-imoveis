import { site } from "../../lib/site";

const stats = [
  { value: "+180", label: "Famílias atendidas" },
  { value: "12", label: "Anos no litoral paulista" },
  { value: "9", label: "Bairros com atuação direta" },
  { value: "4,9", label: "Avaliação média dos clientes" },
];

export function Proof() {
  return (
    <section className="border-y border-line bg-bone">
      <div className="mx-auto max-w-[1240px] px-6 py-16 lg:px-8">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((stat, index) => (
            <div
              key={stat.label}
              className="reveal border-l border-brass/30 pl-5"
              data-reveal-delay={index * 70}
            >
              <p className="display text-5xl text-deep">{stat.value}</p>
              <p className="mt-2 label-xs text-muted">{stat.label}</p>
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

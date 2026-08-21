import { useState } from "react";
import { Plus, Minus } from "lucide-react";

const faqs = [
  {
    question: "Trabalho com imóvel de qual faixa de valor?",
    answer:
      "Trabalho com apartamentos, coberturas e lançamentos de médio e alto padrão na orla e nos bairros próximos. Se o que você procura estiver fora do meu foco, indico com transparência quem pode atender melhor.",
  },
  {
    question: "Preciso pagar algo para ser atendido?",
    answer:
      "Não. A consultoria, as visitas e a análise de documentação não têm custo para o comprador. A comissão é paga pelo vendedor na conclusão da venda, conforme a tabela do CRECI.",
  },
  {
    question: "Consigo financiar? Vocês ajudam com o banco?",
    answer:
      "Sim. Faço a simulação inicial, organizo a documentação e acompanho o processo junto ao banco escolhido até a assinatura do contrato.",
  },
  {
    question: "Atende quem mora em outra cidade?",
    answer:
      "Sim. Gravo vídeos completos do imóvel e do prédio, faço videochamada ao vivo durante a visita e concentro as visitas presenciais em um único dia.",
  },
  {
    question: "Quero vender meu imóvel. Como funciona?",
    answer:
      "Começamos com uma avaliação gratuita, comparando os valores praticados no mesmo prédio e bairro. Definido o preço, cuido das fotos profissionais, da divulgação e da triagem dos interessados — você recebe só propostas reais.",
  },
  {
    question: "Em quanto tempo você responde?",
    answer:
      "No mesmo dia, em horário comercial. Mensagens enviadas à noite são respondidas na manhã seguinte, e sempre por mim ou por alguém da minha equipe direta.",
  },
];

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section id="duvidas" className="mx-auto max-w-[1240px] px-6 py-24 lg:px-8 lg:py-32">
      <div className="grid gap-14 lg:grid-cols-12 lg:gap-16">
        <div className="reveal lg:col-span-4">
          <p className="label-xs flex items-center gap-3 text-brass">
            <span className="h-px w-10 bg-brass/60" />
            Dúvidas frequentes
          </p>
          <h2 className="display mt-6 text-[clamp(2rem,4vw,3rem)] text-deep">
            Antes de
            <br />
            você perguntar
          </h2>
        </div>

        <div className="lg:col-span-8">
          {faqs.map((faq, index) => {
            const isOpen = open === index;
            return (
              <div key={faq.question} className="reveal border-b border-line" data-reveal-delay={index * 50}>
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : index)}
                  className="flex w-full items-center justify-between gap-6 py-6 text-left"
                >
                  <span className="display text-xl text-deep lg:text-2xl">{faq.question}</span>
                  {isOpen ? (
                    <Minus className="h-4 w-4 shrink-0 text-brass" strokeWidth={1.6} />
                  ) : (
                    <Plus className="h-4 w-4 shrink-0 text-brass" strokeWidth={1.6} />
                  )}
                </button>
                <div
                  className={`grid transition-all duration-500 ease-out ${
                    isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                  }`}
                >
                  <p className="overflow-hidden pr-10 text-sm leading-relaxed text-muted">
                    <span className="block pb-6">{faq.answer}</span>
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

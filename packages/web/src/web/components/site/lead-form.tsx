import { useState } from "react";
import { ArrowRight, Check, Loader2 } from "lucide-react";
import { useCreateLead } from "../../queries/leads";
import { site, whatsappLink } from "../../lib/site";

const interests = [
  "Comprar imóvel para morar",
  "Comprar imóvel para investir",
  "Apartamento frente mar",
  "Cobertura / alto padrão",
  "Lançamento na planta",
  "Vender ou avaliar meu imóvel",
];

interface LeadFormProps {
  /** "light" = sobre fundo claro, "dark" = sobre fundo escuro */
  tone?: "light" | "dark";
  source?: string;
  compact?: boolean;
}

export function LeadForm({ tone = "dark", source = "hero", compact = false }: LeadFormProps) {
  const createLead = useCreateLead();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [interest, setInterest] = useState(interests[0]);
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);

  const dark = tone === "dark";
  const fieldClass = dark
    ? "w-full border border-white/20 bg-white/5 px-4 py-3.5 text-sm text-white placeholder:text-white/40 outline-none transition-colors focus:border-brass-soft"
    : "w-full border border-line bg-white px-4 py-3.5 text-sm text-ink placeholder:text-muted/60 outline-none transition-colors focus:border-brass";

  function maskPhone(value: string) {
    const digits = value.replace(/\D/g, "").slice(0, 11);
    if (digits.length <= 2) return digits;
    if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
    if (digits.length <= 10)
      return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (createLead.isPending) return;
    try {
      await createLead.mutateAsync({
        name,
        phone,
        interest: interest ?? interests[0]!,
        message: message || undefined,
        source,
      });
      setDone(true);
    } catch {
      /* erro exibido abaixo */
    }
  }

  if (done) {
    return (
      <div className={`${dark ? "text-white" : "text-ink"} space-y-5`}>
        <div className="flex h-12 w-12 items-center justify-center border border-brass-soft/60 bg-brass/15">
          <Check className="h-5 w-5 text-brass-soft" strokeWidth={1.6} />
        </div>
        <h3 className="display text-3xl">Recebido, {name.split(" ")[0]}.</h3>
        <p className={`text-sm leading-relaxed ${dark ? "text-white/70" : "text-muted"}`}>
          Vou analisar o que você procura e retornar pelo WhatsApp com uma seleção de opções que
          fazem sentido — sem enxurrada de anúncios.
        </p>
        <a
          href={whatsappLink(
            `Olá, ${site.broker}. Acabei de preencher o formulário no site. Meu nome é ${name} e procuro: ${interest}.`,
          )}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 bg-brass px-7 py-4 label-xs text-white transition-colors hover:bg-brass-soft"
        >
          Adiantar pelo WhatsApp
          <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.6} />
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <input
        required
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Seu nome"
        className={fieldClass}
      />
      <input
        required
        inputMode="tel"
        value={phone}
        onChange={(e) => setPhone(maskPhone(e.target.value))}
        placeholder="WhatsApp com DDD"
        className={fieldClass}
      />
      <select
        value={interest}
        onChange={(e) => setInterest(e.target.value)}
        className={`${fieldClass} appearance-none`}
      >
        {interests.map((option) => (
          <option key={option} value={option} className="bg-deep text-white">
            {option}
          </option>
        ))}
      </select>
      {!compact && (
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={3}
          placeholder="Bairro, número de quartos, faixa de valor (opcional)"
          className={`${fieldClass} resize-none`}
        />
      )}

      <button
        type="submit"
        disabled={createLead.isPending}
        className="flex w-full items-center justify-center gap-2 bg-brass px-6 py-4 label-xs text-white transition-colors hover:bg-brass-soft disabled:opacity-60"
      >
        {createLead.isPending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.8} />
            Enviando
          </>
        ) : (
          <>
            Quero encontrar meu imóvel
            <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.6} />
          </>
        )}
      </button>

      {createLead.isError && (
        <p className="text-xs text-red-400">
          Não foi possível enviar agora. Tente novamente ou fale direto no WhatsApp {site.whatsappLabel}.
        </p>
      )}

      <p className={`text-[11px] leading-relaxed ${dark ? "text-white/45" : "text-muted"}`}>
        Atendimento pessoal, sem robô. Seus dados ficam só comigo.
      </p>
    </form>
  );
}

import { useState } from "react";
import { ArrowRight, Check, Loader2 } from "lucide-react";
import { useCreateOwner } from "../../queries/owners";
import { site, whatsappLink } from "../../lib/site";

const propertyTypes = [
  "Apartamento",
  "Casa",
  "Cobertura",
  "Terreno",
  "Comercial",
  "Outro",
];

/**
 * Captação de proprietários. Grava direto no CRM (tabela owners) e abre uma
 * tarefa de retorno — antes disso o CTA só abria o WhatsApp e nada era gravado.
 */
export function OwnerForm() {
  const createOwner = useCreateOwner();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [propertyType, setPropertyType] = useState(propertyTypes[0]);
  const [neighborhood, setNeighborhood] = useState("");
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);

  const fieldClass =
    "w-full border border-white/20 bg-white/5 px-4 py-3.5 text-sm text-white placeholder:text-white/40 outline-none transition-colors focus:border-brass-soft";

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
    if (createOwner.isPending) return;
    try {
      await createOwner.mutateAsync({
        name,
        phone,
        propertyType: propertyType ?? propertyTypes[0]!,
        neighborhood: neighborhood || undefined,
        message: message || undefined,
        source: "site_vender",
      });
      setDone(true);
    } catch {
      /* erro exibido abaixo */
    }
  }

  if (done) {
    return (
      <div className="space-y-5 text-white">
        <div className="flex h-12 w-12 items-center justify-center border border-brass-soft/60 bg-brass/15">
          <Check className="h-5 w-5 text-brass-soft" strokeWidth={1.6} />
        </div>
        <h3 data-t="subheading" className="display text-2xl">
          Recebido, {name.split(" ")[0]}.
        </h3>
        <p data-t="body" className="text-sm leading-relaxed text-white/70">
          Já registrei seu imóvel para avaliação. Vou levantar o que está sendo negociado na sua
          região e retorno pelo WhatsApp com uma faixa de preço realista.
        </p>
        <a
          href={whatsappLink(
            `Olá, ${site.broker}. Acabei de pedir a avaliação do meu imóvel no site. Meu nome é ${name} e o imóvel é ${propertyType}${neighborhood ? ` no bairro ${neighborhood}` : ""}.`,
          )}
          target="_blank"
          rel="noreferrer"
          data-t="button"
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
        data-t="form"
        className={fieldClass}
      />
      <input
        required
        inputMode="tel"
        value={phone}
        onChange={(e) => setPhone(maskPhone(e.target.value))}
        placeholder="WhatsApp com DDD"
        data-t="form"
        className={fieldClass}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <select
          value={propertyType}
          onChange={(e) => setPropertyType(e.target.value)}
          data-t="form"
          className={`${fieldClass} appearance-none`}
        >
          {propertyTypes.map((option) => (
            <option key={option} value={option} className="bg-deep text-white">
              {option}
            </option>
          ))}
        </select>
        <input
          value={neighborhood}
          onChange={(e) => setNeighborhood(e.target.value)}
          placeholder="Bairro do imóvel"
          data-t="form"
          className={fieldClass}
        />
      </div>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={2}
        placeholder="Quartos, metragem, se está alugado (opcional)"
        data-t="form"
        className={`${fieldClass} resize-none`}
      />

      <button
        type="submit"
        disabled={createOwner.isPending}
        data-t="button"
        className="flex w-full items-center justify-center gap-2 bg-brass px-6 py-4 label-xs text-white transition-colors hover:bg-brass-soft disabled:opacity-60"
      >
        {createOwner.isPending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.8} />
            Enviando
          </>
        ) : (
          <>
            Quero a avaliação do meu imóvel
            <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.6} />
          </>
        )}
      </button>

      {createOwner.isError && (
        <p className="text-xs text-red-400">
          Não foi possível enviar agora. Tente novamente ou fale direto no WhatsApp{" "}
          {site.whatsappLabel}.
        </p>
      )}

      <p data-t="caption" className="text-[11px] leading-relaxed text-white/45">
        Avaliação sem compromisso. Seus dados ficam só comigo.
      </p>
    </form>
  );
}

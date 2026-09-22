/**
 * Apresentação do imóvel VENDIDO — faixa diagonal e CTA de "imóvel semelhante".
 *
 * Fonte única para vitrine (cards) e página de detalhe: a regra de quando
 * mostrar (`isSold`) e a mensagem do WhatsApp continuam em lib/property-sold,
 * e o visual vive só aqui. Nada aqui lê banco nem altera dado de imóvel.
 */
import { MessageCircle } from "lucide-react";
import { soldCtaAriaLabel, soldSimilarLink } from "../../lib/property-sold";

type SoldProperty = {
  code?: string | null;
  district?: string | null;
  city?: string | null;
};

/** Card da vitrine tem foto pequena; a página de detalhe tem foto larga. */
type Size = "card" | "hero";

const RIBBON_BASE =
  "pointer-events-none absolute -rotate-45 bg-gradient-to-r from-[#063d23] via-[#0e7a41] to-[#063d23] text-center leading-none font-bold text-white uppercase ring-1 ring-white/25 ring-inset";

const RIBBON_SIZE: Record<Size, string> = {
  card: "top-[20%] -left-[12%] w-[64%] py-2 text-[0.68rem] tracking-[0.24em] shadow-[0_10px_24px_rgba(3,32,18,0.5)] sm:py-2.5 sm:text-[0.8rem] sm:tracking-[0.28em]",
  hero: "top-[24%] -left-[10%] w-[52%] py-2.5 text-[0.72rem] tracking-[0.26em] shadow-[0_12px_28px_rgba(3,32,18,0.5)] sm:py-3 sm:text-[0.95rem] sm:tracking-[0.32em]",
};

/**
 * Fica dentro do container `relative overflow-hidden` da foto: é recortada
 * pelas bordas da imagem e nunca vaza do card nem desloca o layout.
 */
export function SoldRibbon({ size = "card" }: { size?: Size }) {
  return (
    <>
      <span aria-hidden="true" className={`${RIBBON_BASE} ${RIBBON_SIZE[size]}`}>
        Vendido
      </span>
      <span className="sr-only">Imóvel vendido</span>
    </>
  );
}

/**
 * Substitui qualquer CTA de compra direta quando o imóvel já foi vendido.
 * Código e bairro entram na mensagem a partir do próprio imóvel.
 */
export function SoldSimilarCta({
  property,
  className = "",
}: {
  property: SoldProperty;
  className?: string;
}) {
  return (
    <div className={className}>
      <a
        href={soldSimilarLink(property)}
        target="_blank"
        rel="noreferrer"
        aria-label={soldCtaAriaLabel(property)}
        data-t="button"
        className="label-xs flex w-full items-center justify-center gap-2 bg-[#0f7a43] px-4 py-3.5 text-center text-[0.62rem] leading-snug tracking-[0.16em] text-white transition-colors hover:bg-[#0a5c33] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0f7a43] sm:text-[0.6875rem] sm:tracking-[0.2em]"
      >
        <MessageCircle className="h-4 w-4 shrink-0" strokeWidth={1.7} />
        Quero encontrar um imóvel semelhante
      </a>
      <p data-t="caption" className="label-xs mt-2 text-center text-[0.58rem] tracking-[0.16em] text-muted">
        Fale com um especialista no WhatsApp
      </p>
    </div>
  );
}

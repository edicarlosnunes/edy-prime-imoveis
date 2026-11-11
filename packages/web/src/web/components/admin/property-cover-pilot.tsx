import type { GalleryImage } from "./property-gallery";

type CoverData = {
  title: string;
  typeLabel: string;
  district: string;
  city: string;
  price: string;
  opportunityPrice: string;
  bedrooms: string;
  suites: string;
  bathrooms: string;
  parking: string;
  areaUtil: string;
  features: string[];
  code: string;
};

const phone = "(13) 99714-1174";

function isPositive(value: string) {
  const number = Number(String(value).replace(",", "."));
  return Number.isFinite(number) && number > 0;
}

function moneyLabel(raw: string) {
  const cleaned = raw.replace(/^R\$\s*/i, "").trim();
  return cleaned ? `R$ ${cleaned}` : "";
}

/**
 * Estrutura piloto da PRIMEIRA folha do Book.
 * A foto 1 é a capa; fotos 2, 3 e 4 são os três quadros inferiores.
 * NUNCA usa imagens de demonstração nem gera atributos que não estejam no cadastro.
 */
export function PropertyCoverPilot({ data, images }: { data: CoverData; images: GalleryImage[] }) {
  const photos = images.slice(0, 4);
  const cards = [
    { label: "Dormitórios", number: data.bedrooms },
    { label: "Suítes", number: data.suites },
    { label: "Banheiros", number: data.bathrooms },
    { label: "Vagas", number: data.parking },
  ].filter((item) => isPositive(item.number));

  if (isPositive(data.areaUtil)) cards.push({ label: "m² úteis", number: data.areaUtil });
  const highlights = data.features.filter(Boolean).slice(0, Math.max(0, 7 - cards.length));
  const title = data.title.trim() || data.typeLabel || "Imóvel";
  const location = [data.district, data.city].filter(Boolean).join(" • ");
  const price = moneyLabel(data.opportunityPrice || data.price);
  const previousPrice = data.opportunityPrice && data.price ? moneyLabel(data.price) : "";

  return (
    <section className="rounded-xl border border-brass/40 bg-[#0b182d] p-3 text-white sm:p-5" aria-label="Capa piloto automática do imóvel">
      <div className="mb-3">
        <p className="text-sm font-semibold text-white">Capa piloto automática do Book · Folha 1</p>
        <p className="text-xs text-white/65">Modelo fixo. Fotos 1–4 e informações do cadastro; não publica nem substitui suas fotos.</p>
      </div>
      <div className="mx-auto w-full max-w-[650px] overflow-hidden rounded-lg border border-amber-400/60 bg-[#061732] shadow-xl">
        <div className="relative aspect-square">
          {photos[0] ? (
            <img src={photos[0].url} alt="Foto principal real do imóvel" className="absolute inset-0 h-full w-full object-cover" />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center bg-[#122940] text-sm text-white/70">Adicione a primeira foto do imóvel</div>
          )}
          <div className="absolute inset-0 bg-gradient-to-b from-[#04132b]/80 via-transparent to-[#04132b]/70" />
          <div className="absolute left-0 top-0 max-w-[43%] rounded-br-3xl border-b-2 border-r-2 border-amber-400 bg-[#061631]/95 px-3 py-2 text-center shadow-[0_0_24px_rgba(250,204,21,0.4)] sm:px-6 sm:py-4">
            <div className="text-lg font-black leading-none text-yellow-400 sm:text-3xl">⌂</div>
            <div className="font-serif text-[13px] font-bold leading-none text-[#f8d06c] drop-shadow-[0_0_5px_#f6b800] sm:text-2xl">E. Santos</div>
            <div className="mt-1 text-[7px] font-bold tracking-wide text-yellow-200 sm:text-xs">GESTOR IMOBILIÁRIO</div>
            <div className="mt-1 h-[2px] rounded-full bg-gradient-to-r from-transparent via-yellow-300 to-transparent shadow-[0_0_8px_#ffd500]" />
          </div>
          <div className="absolute right-2 top-3 max-w-[60%] rounded-lg bg-[#061631]/85 px-2 py-2 text-right sm:right-4 sm:top-4 sm:px-4">
            <h3 className="text-[16px] font-black uppercase leading-tight tracking-tight text-white drop-shadow-lg sm:text-3xl">{title}</h3>
            {location && <p className="mt-1 text-[10px] font-semibold text-yellow-300 sm:text-sm">{location}</p>}
          </div>
          {price && (
            <div className="absolute bottom-3 left-3 max-w-[80%] -rotate-1 rounded-md bg-yellow-400 px-3 py-2 text-[#731307] shadow-[0_4px_22px_rgba(0,0,0,.35)] sm:bottom-5 sm:left-5 sm:px-5">
              {previousPrice && <p className="text-[9px] text-[#70120b] line-through sm:text-xs">De {previousPrice}</p>}
              <p className="text-lg font-black leading-none sm:text-3xl">{price}</p>
            </div>
          )}
        </div>
        <div className="grid grid-cols-3 gap-1.5 bg-[#04112b] p-1.5 sm:gap-2 sm:p-2">
          {[1, 2, 3].map((position) => (
            <div key={position} className="aspect-[1.35] overflow-hidden rounded-md border border-yellow-500/75 bg-[#142c47]">
              {photos[position] ? (
                <img src={photos[position].url} alt={`Foto real ${position + 1} do imóvel`} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center px-1 text-center text-[10px] text-white/60">Foto {position + 1} não cadastrada</div>
              )}
            </div>
          ))}
        </div>
        {(cards.length > 0 || highlights.length > 0) && (
          <div className="flex flex-wrap justify-center gap-1.5 bg-[#07182c] p-2 sm:gap-2 sm:p-3">
            {cards.map((item) => (
              <span key={item.label} className="rounded-lg border border-yellow-500/70 bg-[#102e53] px-2 py-1 text-[10px] font-bold text-yellow-100 sm:text-xs">
                {item.number} {item.label}
              </span>
            ))}
            {highlights.map((item, index) => (
              <span key={`${item}-${index}`} className="rounded-lg border border-yellow-500/70 bg-[#102e53] px-2 py-1 text-[10px] text-yellow-100 sm:text-xs">{item.replace(/[_-]/g, " ")}</span>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 bg-gradient-to-r from-[#06152a] to-[#0c2b57] px-3 py-2 sm:px-5">
          <span className="text-[11px] font-bold text-yellow-300 sm:text-sm">{data.code || "Código EPI após cadastro"}</span>
          <span className="rounded-md border border-yellow-500 bg-[#142d52] px-2 py-1 text-[11px] font-bold text-white sm:text-sm">☎ {phone}</span>
        </div>
      </div>
      {images.length < 4 && <p className="mt-3 text-xs text-yellow-200">Para completar esta capa, cadastre pelo menos 4 fotos reais na etapa Fotos e mídia.</p>}
      <p className="mt-2 text-xs text-white/60">Prévia do modelo fixo. O título preserva o tipo correto do cadastro (por exemplo, casa alta ou casa baixa). Só aparecem características informadas.</p>
    </section>
  );
}

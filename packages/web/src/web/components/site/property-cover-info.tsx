import { propertyPrice } from "../../../shared/property-price";
import { formatBRL } from "../../lib/site";

type CoverProperty = {
  title: string;
  highlight?: string | null;
  price: number;
  opportunityPrice?: number | null;
  district: string;
  city: string;
  bedrooms: number;
  suites: number;
  parking: number;
  area: number;
};

/** The photo stays untouched; this compact cover updates with the CRM data. */
export function PropertyCoverInfo({ property }: { property: CoverProperty }) {
  const price = propertyPrice(property);
  let headline = property.highlight?.trim() || property.title;
  // Location has its own row; avoid repeating a trailing neighborhood/city.
  for (const location of [property.district, property.city].filter(Boolean)) {
    for (const prefix of [" no bairro ", " no ", " na ", " em "]) {
      const suffix = `${prefix}${location.trim()}`;
      if (headline.toLocaleLowerCase("pt-BR").endsWith(suffix.toLocaleLowerCase("pt-BR"))) {
        headline = headline.slice(0, -suffix.length).trim();
      }
    }
  }
  const details = [
    property.bedrooms > 0 ? `${property.bedrooms} dorm.` : null,
    property.suites > 0 ? `${property.suites} suíte${property.suites > 1 ? "s" : ""}` : null,
    property.parking > 0 ? `${property.parking} vaga${property.parking > 1 ? "s" : ""}` : null,
    property.area > 0 ? `${property.area} m²` : null,
  ].filter(Boolean).join(" · ");

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 bottom-0 space-y-[1.4cqw] p-[5cqw] font-sans text-white"
      style={{ textShadow: "0 1px 3px rgba(0,0,0,.95), 0 0 1px rgba(0,0,0,.8)" }}
    >
      <p className="line-clamp-3 text-[clamp(17px,4.32cqw,24px)] font-bold leading-[1.15] tracking-[-0.015em]">
        {headline}
      </p>
      <div className="flex flex-wrap items-baseline gap-x-[2cqw] gap-y-1 leading-tight">
        {price.discounted && (
          <span className="text-[clamp(11px,2.8cqw,16px)]">De <span className="line-through">{formatBRL(price.original)}</span></span>
        )}
        <span className="text-[clamp(14px,3.45cqw,20px)] font-bold text-[#E8B44F]">
          {price.discounted ? "Por " : ""}{price.current > 0 ? formatBRL(price.current) : "Consulte o valor"}
        </span>
      </div>
      <p className="text-[clamp(11px,2.6cqw,15px)] font-medium leading-tight">
        {[property.district, property.city].filter(Boolean).join(" · ")}
      </p>
      {details && <p className="text-[clamp(11px,2.6cqw,15px)] font-medium leading-tight">{details}</p>}
    </div>
  );
}

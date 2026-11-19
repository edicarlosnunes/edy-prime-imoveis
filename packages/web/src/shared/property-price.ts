type PriceSource = { price?: number | null; opportunityPrice?: number | null; features?: string | string[] | null };

export function propertyPrice(source: PriceSource) {
  const rawOriginal = Number(source.price || 0);
  const original = Number.isFinite(rawOriginal) && rawOriginal > 0 ? rawOriginal : 0;
  let offer = source.opportunityPrice;
  if (offer == null && source.features) {
    try {
      const features = typeof source.features === "string" ? JSON.parse(source.features) : source.features;
      const marker = Array.isArray(features) ? features.find((item) => typeof item === "string" && item.startsWith("__opportunity_price:")) : null;
      offer = marker ? Number(marker.slice("__opportunity_price:".length)) : null;
    } catch { /* Older records may not have valid features JSON. */ }
  }
  const discounted = Number.isFinite(offer) && Number(offer) > 0 && Number(offer) < original;
  return { original, current: discounted ? Number(offer) : original, discounted };
}

export function formatPropertyPrice(source: PriceSource) {
  const { original, current, discounted } = propertyPrice(source);
  const money = (value: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(value);
  if (!current) return "Consulte o valor";
  return discounted ? `De ${money(original)} por ${money(current)}` : money(current);
}


/** Public display/export only: omit private owner settlement and debt details from legacy descriptions. */
export function publicPropertyDescription(raw: string | null | undefined): string {
  const text = String(raw ?? "").replace(/\r\n?/g, "\n");
  // Legacy descriptions may contain the internal negotiation block after marketing copy.
  // Treat the first sensitive heading as an end-of-public-description boundary.
  const boundary = /(?:condi[cç][oõ]es de pagamento e negocia[cç][aã]o|pagamento ao propriet[aá]rio\s*:|d[eé]bitos informados\s*:|detalhes dos d[eé]bitos\s*:|responsabilidade pelos d[eé]bitos\s*:|valor dos d[eé]bitos existentes\s*:)/i;
  const match = boundary.exec(text);
  const safe = match ? text.slice(0, match.index) : text;
  return safe.trim();
}

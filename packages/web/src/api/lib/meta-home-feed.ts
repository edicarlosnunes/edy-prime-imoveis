import type { FeedProperty } from './feed';

/** Column names copied from Meta's catalog_home_listing.csv template. */
export const META_HOME_COLUMNS = ['home_listing_id', 'name', 'description', 'availability', 'price', 'image[0].url', 'image[0].tag[0]', 'url', 'address.addr1', 'address.city', 'address.region', 'address.country', 'latitude', 'longitude', 'neighborhood[0]', 'num_baths', 'num_beds', 'parking_spaces'] as const;
export type MetaHomeProperty = FeedProperty & { latitude?: number | null; longitude?: number | null; region?: string | null };
const csv = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
const httpUrl = (value: string, baseUrl: string) => {
  try { const url = new URL(value, baseUrl); return ['https:', 'http:'].includes(url.protocol) ? url.href : ''; } catch { return ''; }
};

export function metaHomeFeed(properties: MetaHomeProperty[], baseUrl: string) {
  const issues: { code: string; missing: string[] }[] = [];
  const rows: string[][] = [];
  for (const p of properties) {
    if (!['disponivel', 'reservado'].includes(p.status)) continue;
    const cover = p.images.find(image => image.isPrimary) ?? p.images[0];
    const image = cover ? httpUrl(cover.originalUrl || cover.url, baseUrl) : '';
    const missing: string[] = [];
    if (!p.code.trim()) missing.push('home_listing_id');
    if (!p.title.trim()) missing.push('name');
    if (!(Number.isFinite(p.price) && p.price > 0)) missing.push('price');
    if (!image) missing.push('image[0].url');
    if (!p.address?.trim()) missing.push('address.addr1');
    if (!p.city.trim()) missing.push('address.city');
    if (!p.district?.trim()) missing.push('neighborhood[0]');
    if (!p.region?.trim()) missing.push('address.region');
    if (typeof p.latitude !== 'number' || !Number.isFinite(p.latitude) || Math.abs(p.latitude) > 90) missing.push('latitude');
    if (typeof p.longitude !== 'number' || !Number.isFinite(p.longitude) || Math.abs(p.longitude) > 180) missing.push('longitude');
    if (!['venda', 'locacao'].includes(p.purpose)) missing.push('finalidade única: venda ou locacao');
    if (missing.length) { issues.push({ code: p.code, missing }); continue; }
    rows.push([p.code, p.title, p.description.slice(0, 5000), p.status === 'reservado' ? 'sale_pending' : p.purpose === 'locacao' ? 'for_rent' : 'for_sale', `${p.price.toFixed(2)} BRL`, image, 'Property', new URL(`/imovel/${encodeURIComponent(p.slug)}`, baseUrl).href, p.address!, p.city, p.region!, 'Brazil', String(p.latitude), String(p.longitude), p.district, String(p.bathrooms), String(p.bedrooms), String(p.parking)]);
  }
  return { csv: '\ufeff' + [META_HOME_COLUMNS, ...rows].map(row => row.map(csv).join(',')).join('\r\n') + '\r\n', count: rows.length, issues };
}

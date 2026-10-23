import { z } from 'zod';
export const META_LOCATION_PREFIX = '__meta_location:';
export const metaLocationSchema = z.object({
  address: z.string().max(300).default(''),
  region: z.string().trim().toUpperCase().regex(/^$|^[A-Z]{2}$/).default(''),
  latitude: z.number().finite().min(-90).max(90).nullable().default(null),
  longitude: z.number().finite().min(-180).max(180).nullable().default(null),
});
export type MetaLocation = z.infer<typeof metaLocationSchema>;
export function readMetaLocation(raw: string | null | undefined): MetaLocation {
  try {
    const list = JSON.parse(raw || '[]');
    const marker = Array.isArray(list) ? list.find((v: unknown) => typeof v === 'string' && v.startsWith(META_LOCATION_PREFIX)) : null;
    return metaLocationSchema.parse(marker ? JSON.parse(decodeURIComponent(marker.slice(META_LOCATION_PREFIX.length))) : {});
  } catch { return metaLocationSchema.parse({}); }
}

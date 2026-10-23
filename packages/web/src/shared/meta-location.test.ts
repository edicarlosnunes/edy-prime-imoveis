import { expect, test } from 'bun:test';
import { META_LOCATION_PREFIX, metaLocationSchema, readMetaLocation } from './meta-location';
test('location round-trip preserves explicit public address and coordinates', () => {
 const location=metaLocationSchema.parse({address:'Rua pública, 12',region:'SP',latitude:-24.01,longitude:-46.41});
 expect(readMetaLocation(JSON.stringify(['Piscina',META_LOCATION_PREFIX+encodeURIComponent(JSON.stringify(location))]))).toEqual(location);
});
test('legacy and malformed metadata stays empty; no location inferred',()=>{
 expect(readMetaLocation('["Piscina"]')).toEqual({address:'',region:'',latitude:null,longitude:null});
 expect(readMetaLocation('broken')).toEqual(metaLocationSchema.parse({}));
 expect(metaLocationSchema.safeParse({latitude:91}).success).toBe(false);
});

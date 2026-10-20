import {test,expect,beforeEach,afterEach,mock} from 'bun:test';
import {createClient,type Client} from '@libsql/client';
import {drizzle} from 'drizzle-orm/libsql';
import {sql} from 'drizzle-orm';
import {Hono} from 'hono';
import type {AdminDb} from '../lib/admin-base';
let db:AdminDb,connection:Client,allowed=true,fail=false,conversions=0;
mock.module('../lib/auth',()=>({getDb:async()=>db,resolveSession:async()=>allowed?{id:1}:null,randomHex:()=>''}));
mock.module('../lib/book-video-normalize',()=>({normalizeBookAsset:async(_db:unknown,id:number,url:string)=>{conversions++;expect(id).toBe(16);expect(url).toContain('original.mp4');if(fail)throw new Error('Falha na conversão');return {url:'https://test.public.blob.vercel-storage.com/properties/16/book-youtube/fixed.mp4',pathname:'fixed.mp4',mime:'video/mp4',size:100,duration:60};}}));
const {registerPropertyVideoRoutes}=await import('./property-video-routes');
let app:Hono;
beforeEach(async()=>{
 allowed=true;fail=false;conversions=0;connection=createClient({url:':memory:'});db=drizzle(connection) as unknown as AdminDb;app=new Hono();registerPropertyVideoRoutes(app);
 await app.request('/api/admin/property-videos/16');
 await db.run(sql`INSERT INTO property_videos(property_id,kind,url,mime,created_at,updated_at) VALUES(16,'book_complete','https://test.public.blob.vercel-storage.com/properties/16/book-youtube/original.mp4','video/mp4',0,0)`);
});
afterEach(()=>connection.close());
const prepare=(id=16)=>app.request(`/api/admin/property-videos/${id}/prepare-book`,{method:'POST'});
test('prepares the saved full Book in place and returns the new URL without publishing',async()=>{
 const response=await prepare();expect(response.status).toBe(200);expect((await response.json()).url).toContain('fixed.mp4');
 const rows=await db.all(sql`SELECT url,mime,size FROM property_videos WHERE property_id=16`);expect(rows).toEqual([{url:'https://test.public.blob.vercel-storage.com/properties/16/book-youtube/fixed.mp4',mime:'video/mp4',size:100}]);expect(conversions).toBe(1);
});
test('conversion failure preserves the saved original; session and property isolation are enforced',async()=>{
 fail=true;expect((await prepare()).status).toBe(400);
 const rows=await db.all(sql`SELECT url FROM property_videos WHERE property_id=16`) as {url:string}[];expect(rows[0]?.url).toContain('original.mp4');
 expect((await prepare(17)).status).toBe(400);expect(conversions).toBe(1);
 allowed=false;expect((await prepare()).status).toBe(401);expect(conversions).toBe(1);
});

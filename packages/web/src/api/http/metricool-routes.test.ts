import {test,expect,beforeEach,afterEach,mock} from "bun:test";
import {createClient,type Client} from "@libsql/client";
import {drizzle} from "drizzle-orm/libsql";
import {getTableConfig} from "drizzle-orm/sqlite-core";
import {sql} from "drizzle-orm";
import {Hono} from "hono";
import * as schema from "../database/schema";
import {propertyVideos} from "../database/property-videos-schema";
import type {AdminDb} from "../lib/admin-base";
let db:AdminDb,client:Client,allowed=true,posts=0,wrongBrand=false,remoteStatus="",remoteDetail="FPS abaixo de 23";
const original=globalThis.fetch;
mock.module("../lib/auth",()=>({getDb:async()=>db,resolveSession:async()=>allowed ? {id:1,name:"Edy"} : null,randomHex:()=>crypto.randomUUID().replace(/-/g,"")+crypto.randomUUID().replace(/-/g,"")}));
const {registerMetricoolRoutes}=await import("./metricool-routes");
let app:Hono;
beforeEach(async()=>{
 allowed=true;posts=0;wrongBrand=false;remoteStatus="";
 client=createClient({url:":memory:"});db=drizzle(client) as unknown as AdminDb;
 for(const table of [schema.properties,schema.integrations,schema.propertyChannels,propertyVideos]) {
  const config=getTableConfig(table);
  await client.execute(`CREATE TABLE "${config.name}" (${config.columns.map(col=>`"${col.name}" ${col.getSQLType()}${col.primary ? " PRIMARY KEY" : ""}`).join(",")})`);
 }
 await db.run(sql`INSERT INTO properties(id,code,title,address,city,district,price,purpose,status,published,description,slug) VALUES(16,'KT16','Kitnet no Paquetá','Rua A, 1','Praia Grande','Paquetá',110000,'venda','disponivel',1,'Descrição do imóvel','kitnet-paqueta')`);
 await db.run(sql`INSERT INTO property_videos(property_id,kind,url,mime,created_at,updated_at) VALUES(16,'book_complete','https://test.public.blob.vercel-storage.com/properties/16/book.mp4','video/mp4',0,0)`);
 const config=JSON.stringify({accessToken:"test-token",refreshToken:"test-refresh",expiresAt:String(Date.now()+3600000),clientId:"test-client",brandId:"7322391",username:"esantosgestorimobiliario"});
 await db.run(sql`INSERT INTO integrations(key,status,enabled,config,updated_at) VALUES('metricool_mcp','conectado',1,${config},0)`);
 await db.run(sql`CREATE TABLE crm_book_video_formats (source_url TEXT PRIMARY KEY,property_id INTEGER,output_url TEXT,pathname TEXT,size INTEGER,duration REAL)`);
 await db.run(sql`INSERT INTO crm_book_video_formats VALUES('source',16,'https://test.public.blob.vercel-storage.com/properties/16/book.mp4','book.mp4',100,60)`);
 app=new Hono();registerMetricoolRoutes(app);
 globalThis.fetch=(async(url,options)=>{
  if(String(url).endsWith('/oauth/token')) return Response.json({access_token:"new-token",refresh_token:"new-refresh",expires_in:3600});
  expect(String(url)).toBe("https://ai.metricool.com/mcp");
  const body=JSON.parse(String(options?.body));let result:any={};
  if(body.method === "notifications/initialized")return new Response(null,{status:202});
  if(body.method === "initialize")result={protocolVersion:"2025-03-26"};
  if(body.method === "tools/list")result={tools:[{name:"get_brand_settings"},{name:"create_scheduled_post"},{name:"get_scheduled_posts"}]};
  if(body.method === "tools/call") {
   if(body.params.name === "get_brand_settings")result={content:[{type:"text",text:JSON.stringify({data:[{id:7322391,label:"E Santos",networksData:{tiktokData:wrongBrand ? "other_account" : "esantosgestorimobiliario"}}]})}]};
   else if(body.params.name === "get_scheduled_posts")result={content:[{type:"text",text:JSON.stringify({data:remoteStatus ? [{id:99,providers:[{network:"tiktok",status:remoteStatus,detailedStatus:remoteDetail}]}] : []})}]};
   else {posts++;expect(body.params.name).toBe("create_scheduled_post");const args=body.params.arguments;expect(args.blogId).toBe("7322391");expect(JSON.parse(args.info).media).toEqual(["https://test.public.blob.vercel-storage.com/properties/16/book.mp4"]);expect(JSON.parse(args.info).publicationDate.timezone).toBe("America/Sao_Paulo");expect(JSON.parse(args.info).autoPublish).toBe(true);expect(JSON.parse(args.info).providers).toEqual([{network:"tiktok"}]);expect(JSON.parse(args.info).text).toContain("KT16");result={content:[{type:"text",text:JSON.stringify({data:{id:99},plannerUrl:"https://app.metricool.com/planner/post/99"})}]};}
  }
  return Response.json({jsonrpc:"2.0",id:body.id,result},{headers:{"Mcp-Session-Id":"test-session"}});
 }) as typeof fetch;
});
afterEach(()=>{globalThis.fetch=original;client.close();});
const post=(path:string)=>app.request(path,{method:"POST",headers:{"content-type":"application/json"},body:"{}"});
test("requires administrator session for connection, test, publishing and callback",async()=>{
 allowed=false;
 expect((await app.request('/api/admin/tiktok/connection')).status).toBe(401);
 expect((await post('/api/admin/tiktok/test')).status).toBe(401);
 expect((await post('/api/admin/property-book/16/publish-tiktok')).status).toBe(401);
 expect((await app.request('/api/oauth/metricool/callback?state=x&code=x')).status).toBe(302);
 expect(posts).toBe(0);
});
test("OAuth start uses registered public client, PKCE and a session-bound one-use state",async()=>{
 const response=await app.request('/api/oauth/metricool/start');expect(response.status).toBe(302);
 const url=new URL(response.headers.get('location')!);expect(url.origin).toBe('https://app.metricool.com');expect(url.pathname).toBe('/oauth/authorize');expect(url.searchParams.get('code_challenge_method')).toBe('S256');expect(url.searchParams.get('redirect_uri')).toBe('https://www.esantoscorretor.com.br/api/oauth/metricool/callback');
 const state=url.searchParams.get('state')!;
 const bad=await app.request('/api/oauth/metricool/callback?state=wrong&code=code');expect(bad.headers.get('location')).toContain('inv');
 const valid=await app.request(`/api/oauth/metricool/callback?state=${state}&code=code`);expect(decodeURIComponent(valid.headers.get('location')!)).toContain('Metricool autorizado');
 const replay=await app.request(`/api/oauth/metricool/callback?state=${state}&code=code`);expect(decodeURIComponent(replay.headers.get('location')!)).toContain('inválida');
 const result=await (await app.request('/api/admin/tiktok/connection')).json();expect(result.ready).toBe(false);expect(JSON.stringify(result)).not.toContain('new-token');
});
test("validates actual TikTok profile before enabling destination",async()=>{
 expect((await post('/api/admin/tiktok/test')).status).toBe(200);
 wrongBrand=true;
 expect((await post('/api/admin/tiktok/test')).status).toBe(400);
 expect((await (await app.request('/api/admin/tiktok/connection')).json()).ready).toBe(false);
 expect(posts).toBe(0);
});
test("submits only saved full MP4, records scheduled receipt and blocks repeated clicks",async()=>{
 const first=await post('/api/admin/property-book/16/publish-tiktok');expect(first.status).toBe(200);expect((await first.json()).status).toBe('scheduled');
 expect((await post('/api/admin/property-book/16/publish-tiktok')).status).toBe(400);expect(posts).toBe(1);
 const stored=await (await app.request('/api/admin/property-book/16/tiktok-status')).json();expect(stored.result.state).toBe('scheduled');expect(stored.result.message).toContain('ainda precisa ser confirmada');
 const channels=await db.all(sql`SELECT channel,status FROM property_channels`);expect(channels).toEqual([{channel:'tiktok',status:'aguardando'}]);
});
test("WebM and changed account cannot cause a TikTok post",async()=>{
 await db.run(sql`UPDATE property_videos SET mime='video/webm'`);
 expect((await post('/api/admin/property-book/16/publish-tiktok')).status).toBe(400);expect(posts).toBe(0);
 await db.run(sql`UPDATE property_videos SET mime='video/mp4'`);wrongBrand=true;
 expect((await post('/api/admin/property-book/16/publish-tiktok')).status).toBe(400);expect(posts).toBe(0);
});

test("confirmed remote rejection exposes cause and releases only a corrected verified video",async()=>{
 expect((await post('/api/admin/property-book/16/publish-tiktok')).status).toBe(200);
 remoteStatus="ERROR";
 const stored=await (await app.request('/api/admin/property-book/16/tiktok-status')).json();
 expect(stored.result.state).toBe('rejected');expect(stored.result.message).toContain('FPS abaixo de 23');
 expect((await post('/api/admin/property-book/16/publish-tiktok')).status).toBe(400);expect(posts).toBe(1);
 await db.run(sql`UPDATE crm_tiktok_posts SET video_url='https://test.public.blob.vercel-storage.com/properties/16/old.mp4'`);
 expect((await post('/api/admin/property-book/16/publish-tiktok')).status).toBe(200);expect(posts).toBe(2);
});
test("missing remote record, network failures and ambiguous sends do not unlock repeat posting",async()=>{
 await post('/api/admin/property-book/16/publish-tiktok');
 const absent=await (await app.request('/api/admin/property-book/16/tiktok-status')).json();expect(absent.result.state).toBe('scheduled');
 expect((await post('/api/admin/property-book/16/publish-tiktok')).status).toBe(400);
 globalThis.fetch=async()=>{throw new Error('timeout');};
 const unavailable=await (await app.request('/api/admin/property-book/16/tiktok-status')).json();expect(unavailable.result.state).toBe('scheduled');expect(unavailable.result.message).toContain('Não foi possível atualizar');expect(posts).toBe(1);
});
test("unverified output cannot be posted even if its extension is MP4",async()=>{
 await db.run(sql`DELETE FROM crm_book_video_formats`);
 const response=await post('/api/admin/property-book/16/publish-tiktok');expect(response.status).toBe(400);expect((await response.json()).error).toContain('30 FPS');expect(posts).toBe(0);
});

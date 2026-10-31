import { withPropertyLink } from "../lib/property-publication-link";
import { refreshTikTokAttempt } from "../lib/tiktok-post-status";
import type { Hono } from "hono";
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb, randomHex, resolveSession } from "../lib/auth";
import { readConfig, saveIntegration } from "../lib/integrations";
import * as schema from "../database/schema";
import { propertyVideos } from "../database/property-videos-schema";
import { publicationDescription } from "../../shared/negotiation";
import { formatPropertyPrice } from "../../shared/property-price";
import { METRICOOL_KEY, METRICOOL_MCP, METRICOOL_AUTH, METRICOOL_TOKEN, METRICOOL_CALLBACK, metricoolToken, openMetricool, brandList, scheduledConfirmation } from "../lib/metricool-mcp";

async function ensure(db:Awaited<ReturnType<typeof getDb>>) {
  await db.run(sql`CREATE TABLE IF NOT EXISTS crm_metricool_oauth (state TEXT PRIMARY KEY, user_id INTEGER NOT NULL, verifier TEXT NOT NULL, expires INTEGER NOT NULL)`);
  await db.run(sql`CREATE TABLE IF NOT EXISTS crm_tiktok_posts (property_id INTEGER PRIMARY KEY, video_url TEXT NOT NULL, state TEXT NOT NULL, message TEXT, external_id TEXT, planner_url TEXT, created_at INTEGER NOT NULL)`);
}
const back=(message:string)=>Response.redirect(`https://www.esantoscorretor.com.br/admin/tiktok?result=${encodeURIComponent(message)}`,302);
export function registerMetricoolRoutes(app:Hono) {
  app.get("/api/oauth/metricool/start",async c=>{
    const user=await resolveSession(c.req.raw.headers);if(!user) return c.redirect("/admin/login");
    const db=await getDb();await ensure(db);
    try {
      const {config}=await readConfig(db,METRICOOL_KEY);
      // Public OAuth client registered with Metricool for this exact redirect; PKCE required.
      const clientId=config.clientId || "client_a5f80e5afef849d695131c333569c37f";
      if(!config.clientId) await saveIntegration(db,METRICOOL_KEY,{config:{...config,clientId}});
      const state=randomHex(32),verifier=randomHex(32);
      const challenge=btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(verifier))))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
      await db.run(sql`DELETE FROM crm_metricool_oauth WHERE expires<${Date.now()}`);
      await db.run(sql`INSERT INTO crm_metricool_oauth(state,user_id,verifier,expires) VALUES(${state},${user.id},${verifier},${Date.now()+600000})`);
      const url=new URL(METRICOOL_AUTH);for(const [key,value] of Object.entries({client_id:clientId,redirect_uri:METRICOOL_CALLBACK,response_type:"code",scope:"mcp:read mcp:write",resource:METRICOOL_MCP,state,code_challenge:challenge,code_challenge_method:"S256"}))url.searchParams.set(key,value);
      return c.redirect(url.href);
    }catch {return back("Não foi possível iniciar a conexão com o Metricool. Nenhuma publicação foi enviada.");}
  });
  app.get("/api/oauth/metricool/callback",async c=>{
    const user=await resolveSession(c.req.raw.headers);if(!user) return c.redirect("/admin/login");
    const db=await getDb();await ensure(db);
    const state=c.req.query("state") ?? "";
    const claimed=await db.all(sql`DELETE FROM crm_metricool_oauth WHERE state=${state} AND user_id=${user.id} AND expires>${Date.now()} RETURNING verifier`) as {verifier:string}[];
    if(!claimed[0])return back("Autorização vencida ou inválida. Clique em Conectar com Metricool novamente.");
    if(c.req.query("error") || !c.req.query("code"))return back("A autorização do Metricool não foi concluída.");
    try {
      const {config}=await readConfig(db,METRICOOL_KEY);
      const response=await fetch(METRICOOL_TOKEN,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"authorization_code",client_id:config.clientId,code:c.req.query("code")!,redirect_uri:METRICOOL_CALLBACK,code_verifier:claimed[0].verifier,resource:METRICOOL_MCP}),signal:AbortSignal.timeout(20000)});
      const data=await response.json() as any;
      if(!response.ok || !data.access_token) return back("Metricool não concluiu a troca da autorização. Reconecte a conta.");
      await saveIntegration(db,METRICOOL_KEY,{config:{...config,accessToken:String(data.access_token),refreshToken:String(data.refresh_token ?? ""),expiresAt:String(Date.now()+Number(data.expires_in ?? 3600)*1000)},status:"configurando",enabled:false});
      return back("Metricool autorizado. Clique em Testar conexão para confirmar o perfil do TikTok.");
    }catch {return back("Não foi possível concluir a autorização. Nenhuma publicação foi enviada.");}
  });
  app.get("/api/admin/tiktok/connection",async c=>{
    if(!await resolveSession(c.req.raw.headers))return c.json({error:"Sessão expirada"},401);
    const current=await readConfig(await getDb(),METRICOOL_KEY);
    return c.json({ready:current.row?.enabled === 1 && current.row.status === "conectado",username:current.config.username ?? "",brandLabel:current.config.brandLabel ?? "",message:current.row?.lastError ?? ""});
  });
  app.post("/api/admin/tiktok/test",async c=>{
    if(!await resolveSession(c.req.raw.headers))return c.json({error:"Sessão expirada"},401);
    const db=await getDb();
    try {
      const mcp=await openMetricool(await metricoolToken(db));
      const brands=brandList(await mcp.call("get_brand_settings",{}));
      const profile=await readConfig(db,"tiktok_publishing");
      const expected=(profile.config.username || "esantosgestorimobiliario").replace(/^@/,"").toLowerCase();
      const brand=brands.find(b=>b.username.toLowerCase() === expected);
      if(!brand)throw new Error(`Perfil @${expected} não encontrado nesta conta Metricool. Confira a conta autorizada.`);
      const {config}=await readConfig(db,METRICOOL_KEY);
      await saveIntegration(db,METRICOOL_KEY,{config:{...config,brandId:brand.id,brandLabel:brand.label,username:brand.username},status:"conectado",enabled:true,lastError:null});
      await saveIntegration(db,"tiktok_publishing",{status:"conectado",enabled:true,lastError:null});
      return c.json({ready:true,message:`Metricool conectado ao TikTok @${brand.username}. O envio será feito somente para esse perfil.`});
    }catch(error) {
      const message=error instanceof Error ? error.message : "Falha na conexão Metricool";
      await saveIntegration(db,METRICOOL_KEY,{status:"erro",enabled:false,lastError:message});
      await saveIntegration(db,"tiktok_publishing",{status:"erro",enabled:false,lastError:message});
      return c.json({error:message},400);
    }
  });
  app.get("/api/admin/property-book/:propertyId/tiktok-status",async c=>{
    if(!await resolveSession(c.req.raw.headers))return c.json({error:"Sessão expirada"},401);
    const id=Number(c.req.param("propertyId"));if(!Number.isInteger(id)||id<=0)return c.json({error:"Imóvel inválido"},400);
    const db=await getDb();await ensure(db);
    const result=await refreshTikTokAttempt(db,id);
    return c.json({result:result ? {state:result.state,message:result.message,planner_url:result.planner_url} : null});
  });
  app.post("/api/admin/property-book/:propertyId/publish-tiktok",async c=>{
    if(!await resolveSession(c.req.raw.headers))return c.json({error:"Sessão expirada"},401);
    const id=Number(c.req.param("propertyId"));if(!Number.isInteger(id)||id<=0)return c.json({error:"Imóvel inválido"},400);
    const db=await getDb();await ensure(db);
    let claimed=false;
    try {
      const [property]=await db.select().from(schema.properties).where(eq(schema.properties.id,id)).limit(1);
      if(!property || property.status !== "disponivel" || property.published !== 1)throw new Error("O imóvel precisa estar disponível e publicado no site.");
      const [video]=await db.select().from(propertyVideos).where(and(eq(propertyVideos.propertyId,id),eq(propertyVideos.kind,"book_complete"))).orderBy(desc(propertyVideos.id)).limit(1);
      if(!video)throw new Error("Gere e salve o vídeo completo no cadastro antes de enviar ao TikTok.");
      if(!["video/mp4","video/quicktime"].includes(video.mime ?? ""))throw new Error("O vídeo salvo está em WebM. O TikTok precisa de MP4 ou MOV. Gere novamente em um navegador com gravação MP4 ou salve o Book em MP4 antes de enviar.");
      const asset=new URL(video.url);
      if(asset.protocol !== "https:" || !asset.hostname.endsWith(".blob.vercel-storage.com"))throw new Error("Arquivo do vídeo não está no armazenamento do CRM.");
      const previous=await refreshTikTokAttempt(db,id,true);
      if(previous && ["scheduled","processing","sending","published"].includes(previous.state))return c.json({status:previous.state,message:previous.message || "Envio ao TikTok em andamento. Aguarde antes de repetir."});
      if(previous && previous.state !== "rejected")throw new Error(previous.message || "Não foi possível confirmar a tentativa anterior. Confira o Metricool antes de repetir.");
      if(previous?.state === "rejected" && previous.video_url === video.url)throw new Error("O vídeo anterior foi recusado. Prepare a versão corrigida em 30 FPS antes de reenviar.");
      await db.run(sql`CREATE TABLE IF NOT EXISTS crm_book_video_formats (source_url TEXT PRIMARY KEY, property_id INTEGER NOT NULL, output_url TEXT NOT NULL, pathname TEXT NOT NULL, size INTEGER NOT NULL, duration REAL NOT NULL)`);
      const verified=await db.all(sql`SELECT output_url FROM crm_book_video_formats WHERE property_id=${id} AND output_url=${video.url} LIMIT 1`);
      if(!verified.length)throw new Error("Prepare o Book completo em 30 FPS antes de enviar ao TikTok.");
      const current=await readConfig(db,METRICOOL_KEY);
      if(current.row?.status !== "conectado" || current.row.enabled !== 1 || !current.config.brandId)throw new Error("Conecte e teste o Metricool em Integrações → TikTok.");
      const mcp=await openMetricool(await metricoolToken(db));
      const brands=brandList(await mcp.call("get_brand_settings",{}));
      if(!brands.some(b=>b.id === current.config.brandId && b.username === current.config.username))throw new Error("O perfil TikTok vinculado mudou. Teste a conexão antes de publicar.");
      const lock=await db.all(sql`INSERT INTO crm_tiktok_posts(property_id,video_url,state,created_at) VALUES(${id},${video.url},'sending',${Date.now()}) ON CONFLICT(property_id) DO UPDATE SET video_url=excluded.video_url,state='sending',message=NULL,external_id=NULL,planner_url=NULL,created_at=excluded.created_at WHERE crm_tiktok_posts.state='rejected' RETURNING property_id`) as unknown[];
      if(!lock.length)throw new Error("Este imóvel já tem uma solicitação de envio ao TikTok. Confira o planejamento no Metricool antes de repetir.");
      claimed=true;
      const caption=withPropertyLink([property.title,`Código: ${property.code}`,formatPropertyPrice(property),`${property.district} · ${property.city}`,publicationDescription(property.description,property.features,1000)].filter(Boolean).join("\n"),property,"https://www.esantoscorretor.com.br",2100);
      const date=new Date(Date.now()+120000).toISOString();
      const localDate=new Date(new Date(date).getTime()-3*3600000).toISOString().slice(0,19);
      const info=JSON.stringify({providers:[{network:"tiktok"}],text:caption,media:[video.url],publicationDate:{dateTime:localDate,timezone:"America/Sao_Paulo"},autoPublish:true,draft:false,shortener:false,saveExternalMediaFiles:true,tiktokData:{privacyOption:"PUBLIC_TO_EVERYONE",commercialContentOwnBrand:true,commercialContentThirdParty:false,autoAddMusic:false,title:property.title.slice(0,90)}});
      const result=scheduledConfirmation(await mcp.call("create_scheduled_post",{blogId:current.config.brandId,date,info}));
      const message=`Book completo recebido pelo Metricool e agendado somente para o TikTok @${current.config.username}. A publicação no TikTok ainda precisa ser confirmada. Planejamento: ${result.url}`;
      await db.run(sql`UPDATE crm_tiktok_posts SET state='scheduled',message=${message},external_id=${result.id},planner_url=${result.url} WHERE property_id=${id}`);
      await db.insert(schema.propertyChannels).values({propertyId:id,channel:"tiktok",authorized:1,status:"aguardando",message,updatedAt:new Date()});
      return c.json({status:"scheduled",message});
    }catch(error) {
      const message=error instanceof Error ? error.message : "Falha no envio ao Metricool";
      if(claimed)await db.run(sql`UPDATE crm_tiktok_posts SET state='error',message=${message} WHERE property_id=${id}`);
      return c.json({error:message},400);
    }
  });
}

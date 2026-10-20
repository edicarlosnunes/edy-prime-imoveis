import {sql} from 'drizzle-orm';
import type {AdminDb} from './admin-base';
import {METRICOOL_KEY,metricoolToken,openMetricool} from './metricool-mcp';
import {readConfig} from './integrations';
export type TikTokAttempt={state:string;message:string|null;planner_url:string|null;external_id:string|null;created_at:number;video_url:string};
export async function readTikTokAttempt(db:AdminDb,id:number) {
 const rows=await db.all(sql`SELECT state,message,planner_url,external_id,created_at,video_url FROM crm_tiktok_posts WHERE property_id=${id}`) as TikTokAttempt[];
 return rows[0] ?? null;
}
export function remoteTikTokState(value:unknown,externalId:string) {
 const data=(value as any)?.data ?? value;
 const posts=Array.isArray(data) ? data : [];
 const post=posts.find(p=>String(p.id)===externalId);
 const provider=post?.providers?.find((p:any)=>p.network==='tiktok');
 if(!provider)return null;
 if(provider.status==='ERROR')return {state:'rejected',message:`TikTok recusou o vídeo: ${String(provider.detailedStatus || 'erro informado pelo Metricool').slice(0,800)}. Prepare uma nova versão do vídeo para reenviar.`};
 if(provider.status==='PUBLISHED')return {state:'published',message:'Publicação no TikTok confirmada pelo Metricool.'};
 if(['PUBLISHING','PROCESSING','AWAITING_CONFIRMATION'].includes(provider.status))return {state:'processing',message:'Vídeo enviado ao TikTok; aguardando a confirmação final do Metricool. Não é necessário reenviar.'};
 if(['PENDING','SCHEDULED'].includes(provider.status))return {state:'scheduled',message:'O vídeo está agendado no Metricool. Aguarde a publicação; não é necessário reenviar.'};
 return null;
}
export async function refreshTikTokAttempt(db:AdminDb,id:number,strict=false) {
 const attempt=await readTikTokAttempt(db,id);
 if(!attempt?.external_id||!['scheduled','processing','error','rejected'].includes(attempt.state))return attempt;
 try {
  const current=await readConfig(db,METRICOOL_KEY);if(!current.config.brandId)return attempt;
  const mcp=await openMetricool(await metricoolToken(db));
  const value=await mcp.call('get_scheduled_posts',{brandId:current.config.brandId,fromDate:new Date(attempt.created_at-86400000).toISOString(),toDate:new Date(attempt.created_at+2*86400000).toISOString(),timezone:'America/Sao_Paulo',extendedRange:true});
  const result=remoteTikTokState(value,attempt.external_id);
  if(strict && attempt.state==='rejected' && !result)throw new Error('Não foi possível reconfirmar a falha anterior. Confira o Metricool antes de reenviar.');
  if(result){
   await db.run(sql`UPDATE crm_tiktok_posts SET state=${result.state},message=${result.message} WHERE property_id=${id} AND external_id=${attempt.external_id} AND state=${attempt.state}`);
   await db.run(sql`UPDATE property_channels SET status=${result.state==='published'?'publicado':result.state==='rejected'?'erro':'aguardando'},message=${result.message} WHERE property_id=${id} AND channel='tiktok' AND status IN ('aguardando','erro')`);
  }
  return await readTikTokAttempt(db,id);
 }catch(error){if(strict && attempt.state==='rejected')throw error;return {...attempt,message:['scheduled','processing'].includes(attempt.state) ? `${attempt.message ?? ''} Não foi possível atualizar o resultado agora; confira o planejamento antes de repetir.` : attempt.message};}
}

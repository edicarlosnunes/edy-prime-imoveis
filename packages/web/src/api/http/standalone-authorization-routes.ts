import type {Hono} from 'hono';
import {resolveSession} from '../lib/auth';
import {bodyLimit} from 'hono/body-limit';
import {OWNER_KEY_HASHES} from '../lib/authorization-owner-config';
import {hashAuthorizationKey,standaloneAuthorizationStore,type AuthorizationKind} from '../lib/standalone-authorizations';
type Store=ReturnType<typeof standaloneAuthorizationStore>;
export function registerStandaloneAuthorizationRoutes(app:Hono,dependencies:{store?:()=>Promise<Store>;ownerHashes?:Record<AuthorizationKind,string>}={}){
 const store=dependencies.store|| (async()=>standaloneAuthorizationStore((await import('../database')).db.$client));
 const hashes=dependencies.ownerHashes||OWNER_KEY_HASHES;
 const owner=(headers:Headers):AuthorizationKind|null=>{const key=headers.get('x-authorization-owner')||'';if(!/^[a-f0-9]{64}$/.test(key))return null;const hash=hashAuthorizationKey(key);return (['venda','locacao'] as const).find(k=>hashes[k]===hash)||null;};
 const token=(headers:Headers)=>{const t=headers.get('x-authorization-document')||'';return /^[a-f0-9]{64}$/.test(t)?t:null;};
 app.use('/api/standalone-authorizations/*',bodyLimit({maxSize:2000000,onError:c=>c.json({error:'Dados muito grandes.'},413)}));
 app.use('/api/standalone-authorizations/*',async(c,next)=>{c.header('Cache-Control','no-store');c.header('Referrer-Policy','no-referrer');c.header('X-Robots-Tag','noindex, nofollow');await next();});
 app.get('/api/standalone-authorizations/owner',c=>{const kind=owner(c.req.raw.headers);return kind?c.json({kind}):c.json({error:'Atalho particular inválido.'},401);});
 app.post('/api/standalone-authorizations/new',async c=>{const kind=owner(c.req.raw.headers);if(!kind)return c.json({error:'Somente o atalho particular do corretor pode preparar novos links.'},401);return c.json({token:await(await store()).create(kind),kind});});
 app.get('/api/standalone-authorizations/record',async c=>{const t=token(c.req.raw.headers);if(!t)return c.json({error:'Link incompleto. Peça ao corretor o link desta autorização.'},400);const record=await(await store()).read(t);return record?c.json(record):c.json({error:'Autorização não encontrada. Solicite outro link ao corretor.'},404);});
 app.post('/api/standalone-authorizations/complete',async c=>{const t=token(c.req.raw.headers);if(!t)return c.json({error:'Link incompleto.'},400);let operation:string;let submission:{data:Record<string,string>;pdf:string}|null=null;
 try{
  const body=await c.req.json() as {operation?:unknown;submission?:unknown;[key:string]:unknown};
  if(Object.keys(body).some(k=>k!=='operation'&&k!=='submission')||typeof body.operation!=='string'||! /^[a-f0-9-]{36}$/.test(body.operation))return c.json({error:'Código de conclusão inválido.'},400);
  operation=body.operation;
  if(body.submission!==undefined){
   if(!body.submission||typeof body.submission!=='object'||Array.isArray(body.submission))return c.json({error:'Documento inválido.'},400);
   const upload=body.submission as {data?:unknown;pdf?:unknown};
   if(!upload.data||typeof upload.data!=='object'||Array.isArray(upload.data)||typeof upload.pdf!=='string'||!upload.pdf.startsWith('JVBERi0')||upload.pdf.length>1700000||!/^[a-zA-Z0-9+/=]+$/.test(upload.pdf))return c.json({error:'Dados do documento inválidos.'},400);
   const fields=['owner','document','phone','email','ownerAddress','propertyAddress','type','bedrooms','parking','floors','price','commission','startDate','endDate','notes','city','condominium','iptu'];
   const input=upload.data as Record<string,unknown>;
   if(Object.keys(input).some(key=>!fields.includes(key))||fields.slice(0,16).some(key=>typeof input[key]!=='string')||Object.values(input).some(v=>typeof v!=='string'||v.length>1600))return c.json({error:'Campos da autorização inválidos.'},400);
   if(!String(input.owner).trim()||!String(input.propertyAddress).trim()||!String(input.phone).trim())return c.json({error:'Informe proprietário, telefone e endereço.'},400);
   submission={data:input as Record<string,string>,pdf:upload.pdf};
  }
 }catch{return c.json({error:'Dados inválidos.'},400);}
 try{const result=await(await store()).complete(t,operation);if(result.status==='missing')return c.json({error:'Autorização não encontrada.'},404);if(result.status==='completed')return c.json({error:'Esta autorização já foi concluída. Use o PDF já salvo ou solicite outro link ao corretor.',record:result.record},409);if(submission)await(await store()).archive(t,operation,submission.data,submission.pdf);return c.json(result.record);}catch(e){if(e instanceof Error&&/Confira|Preencha|Dados inválidos|campos excedeu/.test(e.message))return c.json({error:e.message},400);console.error('Falha ao registrar autorização independente');return c.json({error:'Não foi possível confirmar a conclusão. Seus dados continuam na ficha; tente novamente.'},503);}
 });
 app.get('/api/admin/captacao/autorizacoes-recebidas',async c=>{
  if(!await resolveSession(c.req.raw.headers))return c.json({error:'Não autorizado'},401);
  return c.json({rows:await(await store()).listSubmissions()});
 });
 app.get('/api/admin/captacao/autorizacoes-recebidas/:id/pdf',async c=>{
  if(!await resolveSession(c.req.raw.headers))return c.json({error:'Não autorizado'},401);
  const id=Number(c.req.param('id'));if(!Number.isSafeInteger(id)||id<=0)return c.json({error:'Documento inválido'},400);
  const pdf=await(await store()).pdfSubmission(id);if(!pdf)return c.json({error:'Documento não encontrado'},404);
  return new Response(Uint8Array.from(atob(pdf),char=>char.charCodeAt(0)),{headers:{'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="Autorizacao-de-venda-${id}.pdf"`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
 });
 app.post('/api/admin/captacao/autorizacoes-recebidas/:id/revisao',async c=>{
  if(!await resolveSession(c.req.raw.headers))return c.json({error:'Não autorizado'},401);
  const id=Number(c.req.param('id'));if(!Number.isSafeInteger(id)||id<=0)return c.json({error:'Documento inválido'},400);
  const body=await c.req.json().catch(()=>({})) as {status?:unknown};
  if(body.status!=='pre_cadastro'&&body.status!=='em_analise'&&body.status!=='arquivado')return c.json({error:'Status inválido'},400);
  const result=await(await store()).setReviewStatus(id,body.status);
  return result.rowsAffected?c.json({ok:true}):c.json({error:'Documento não encontrado'},404);
 });

}

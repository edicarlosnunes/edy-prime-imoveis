import type {Hono} from 'hono';
import {bodyLimit} from 'hono/body-limit';
import {OWNER_KEY_HASHES} from '../lib/authorization-owner-config';
import {hashAuthorizationKey,standaloneAuthorizationStore,type AuthorizationKind} from '../lib/standalone-authorizations';
type Store=ReturnType<typeof standaloneAuthorizationStore>;
export function registerStandaloneAuthorizationRoutes(app:Hono,dependencies:{store?:()=>Promise<Store>;ownerHashes?:Record<AuthorizationKind,string>}={}){
 const store=dependencies.store|| (async()=>standaloneAuthorizationStore((await import('../database')).db.$client));
 const hashes=dependencies.ownerHashes||OWNER_KEY_HASHES;
 const owner=(headers:Headers):AuthorizationKind|null=>{const key=headers.get('x-authorization-owner')||'';if(!/^[a-f0-9]{64}$/.test(key))return null;const hash=hashAuthorizationKey(key);return (['venda','locacao'] as const).find(k=>hashes[k]===hash)||null;};
 const token=(headers:Headers)=>{const t=headers.get('x-authorization-document')||'';return /^[a-f0-9]{64}$/.test(t)?t:null;};
 app.use('/api/standalone-authorizations/*',bodyLimit({maxSize:24000,onError:c=>c.json({error:'Dados muito grandes.'},413)}));
 app.use('/api/standalone-authorizations/*',async(c,next)=>{c.header('Cache-Control','no-store');c.header('Referrer-Policy','no-referrer');c.header('X-Robots-Tag','noindex, nofollow');await next();});
 app.get('/api/standalone-authorizations/owner',c=>{const kind=owner(c.req.raw.headers);return kind?c.json({kind}):c.json({error:'Atalho particular inválido.'},401);});
 app.post('/api/standalone-authorizations/new',async c=>{const kind=owner(c.req.raw.headers);if(!kind)return c.json({error:'Somente o atalho particular do corretor pode preparar novos links.'},401);return c.json({token:await(await store()).create(kind),kind});});
 app.get('/api/standalone-authorizations/record',async c=>{const t=token(c.req.raw.headers);if(!t)return c.json({error:'Link incompleto. Peça ao corretor o link desta autorização.'},400);const record=await(await store()).read(t);return record?c.json(record):c.json({error:'Autorização não encontrada. Solicite outro link ao corretor.'},404);});
 app.post('/api/standalone-authorizations/complete',async c=>{const t=token(c.req.raw.headers);if(!t)return c.json({error:'Link incompleto.'},400);let operation:string;try{const body=await c.req.json();if(Object.keys(body).some(k=>k!=='operation')||typeof body.operation!=='string'||! /^[a-f0-9-]{36}$/.test(body.operation))return c.json({error:'Código de conclusão inválido.'},400);operation=body.operation;}catch{return c.json({error:'Dados inválidos.'},400);}
 try{const result=await(await store()).complete(t,operation);if(result.status==='missing')return c.json({error:'Autorização não encontrada.'},404);if(result.status==='completed')return c.json({error:'Esta autorização já foi concluída. Use o PDF já salvo ou solicite outro link ao corretor.',record:result.record},409);return c.json(result.record);}catch(e){if(e instanceof Error&&/Confira|Preencha|Dados inválidos|campos excedeu/.test(e.message))return c.json({error:e.message},400);console.error('Falha ao registrar autorização independente');return c.json({error:'Não foi possível confirmar a conclusão. Seus dados continuam na ficha; tente novamente.'},503);}
 });
}

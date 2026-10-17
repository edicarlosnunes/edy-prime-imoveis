import type {Hono} from 'hono';
import {bodyLimit} from 'hono/body-limit';
import {authorizationCommission} from '../../web/lib/authorization-pdf';
import type {Client} from '@libsql/client';
import {getDb,randomHex,sha256Hex} from '../lib/auth';
import {authorizationLines,type AuthorizationData} from '../../web/lib/authorization-pdf';
import {rentalAuthorizationLines,type RentalAuthorizationData} from '../../web/lib/rental-authorization-pdf';

type Kind='venda'|'locacao';
export function authorizationLinkStore(client:Pick<Client,'execute'>){
 const ready=()=>client.execute(`CREATE TABLE IF NOT EXISTS private_authorization_links (token_hash TEXT PRIMARY KEY, kind TEXT NOT NULL, issued_at INTEGER NOT NULL, completed_at INTEGER, data_json TEXT, pdf_base64 TEXT)`);
 return {
 async create(kind:Kind){await ready();const token=randomHex();await client.execute({sql:'INSERT INTO private_authorization_links(token_hash,kind,issued_at) VALUES(?,?,?)',args:[await sha256Hex(token),kind,Date.now()]});return token;},
 async read(token:string){await ready();const result=await client.execute({sql:'SELECT kind,issued_at,completed_at,data_json,pdf_base64 FROM private_authorization_links WHERE token_hash=?',args:[await sha256Hex(token)]});return result.rows[0]||null;},
 async complete(token:string,data:Record<string,string>,pdf:string){await ready();const result=await client.execute({sql:'UPDATE private_authorization_links SET completed_at=?,data_json=?,pdf_base64=? WHERE token_hash=? AND completed_at IS NULL',args:[Date.now(),JSON.stringify(data),pdf,await sha256Hex(token)]});return result.rowsAffected===1;}
 };
}
export const ISSUER_DEVICE_COOKIE='__Host-esantos_authorization_device';
const ISSUER_ACTIVATION_HASH='f00507fd3c98472701431c88bec972efef94f91c83866d42fdbc41e214b4f2c4';
export function authorizationDeviceStore(client:Pick<Client,'execute'>){
 const ready=()=>client.execute(`CREATE TABLE IF NOT EXISTS private_authorization_devices (activation_hash TEXT PRIMARY KEY, device_hash TEXT UNIQUE NOT NULL, activated_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)`);
 return {
 async activate(secret:string,expectedHash:string){if(!/^[a-f0-9]{64}$/.test(secret)||await sha256Hex(secret)!==expectedHash)return null;await ready();const device=randomHex();const expires=Date.now()+365*86400000;const r=await client.execute({sql:'INSERT INTO private_authorization_devices(activation_hash,device_hash,activated_at,expires_at) VALUES(?,?,?,?) ON CONFLICT(activation_hash) DO NOTHING',args:[expectedHash,await sha256Hex(device),Date.now(),expires]});return r.rowsAffected===1?device:null;},
 async allowed(headers:Headers){const raw=(headers.get('cookie')||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(ISSUER_DEVICE_COOKIE+'='))?.slice(ISSUER_DEVICE_COOKIE.length+1);if(!raw||!/^[a-f0-9]{64}$/.test(raw))return false;await ready();const r=await client.execute({sql:'SELECT device_hash FROM private_authorization_devices WHERE device_hash=? AND expires_at>?',args:[await sha256Hex(raw),Date.now()]});return r.rows.length===1;}
 };
}
export function registerAuthorizationLinkRoutes(app:Hono,deps:{store?:()=>Promise<ReturnType<typeof authorizationLinkStore>>;devices?:()=>Promise<ReturnType<typeof authorizationDeviceStore>>;activationHash?:string}={}){
 const store=deps.store|| (async()=>authorizationLinkStore((await getDb()).$client));
 const devices=deps.devices||(async()=>authorizationDeviceStore((await getDb()).$client));
 const allowed=async(headers:Headers)=>(await devices()).allowed(headers);
 app.use('/api/authorization-links/*',bodyLimit({maxSize:100000,onError:c=>c.json({error:'Documento muito grande.'},413)}));
 const token=(headers:Headers)=>{const value=headers.get('x-authorization-link')||'';return /^[a-f0-9]{64}$/.test(value)?value:null;};
 app.use('/api/authorization-links/*',async(c,next)=>{c.header('Cache-Control','no-store');c.header('Referrer-Policy','no-referrer');await next();});
 app.get('/api/authorization-links/access',async c=>c.json({authorized:await allowed(c.req.raw.headers)}));
 app.post('/api/authorization-links/activate',async c=>{
  const origin=c.req.header('origin');if(origin&&origin!==new URL(c.req.url).origin&&origin!=='https://www.esantoscorretor.com.br'&&origin!=='https://esantoscorretor.com.br')return c.json({error:'Origem não permitida.'},403);
  const body=await c.req.json().catch(()=>null);
  if(await allowed(c.req.raw.headers))return c.json({ok:true});
  const device=await(await devices()).activate(String(body?.activation||''),deps.activationHash||ISSUER_ACTIVATION_HASH);
  if(!device)return c.json({error:'Este link de ativação é inválido ou já foi utilizado. Abra no navegador que já foi ativado.'},403);
  c.header('Set-Cookie',`${ISSUER_DEVICE_COOKIE}=${device}; Path=/; Max-Age=31536000; Secure; HttpOnly; SameSite=Lax`);
  return c.json({ok:true});
 });
 app.post('/api/authorization-links/create',async c=>{
  const origin=c.req.header('origin');if(origin&&origin!==new URL(c.req.url).origin&&origin!=='https://www.esantoscorretor.com.br'&&origin!=='https://esantoscorretor.com.br')return c.json({error:'Origem não permitida.'},403);
  if(!await allowed(c.req.raw.headers))return c.json({error:'Abra o link de ativação no seu celular para liberar este navegador.'},401);
  const body=await c.req.json().catch(()=>null);if(!body||!['venda','locacao'].includes(body.kind))return c.json({error:'Escolha venda ou locação.'},400);
  const value=await(await store()).create(body.kind);return c.json({token:value,kind:body.kind});
 });
 app.get('/api/authorization-links/document',async c=>{
  const value=token(c.req.raw.headers);if(!value)return c.json({error:'Solicite um link individual ao corretor.'},400);
  const row=await(await store()).read(value);if(!row)return c.json({error:'Link não encontrado. Solicite outro ao corretor.'},404);
  return c.json({kind:row.kind,issuedAt:row.issued_at,completed:Boolean(row.completed_at),data:row.data_json?JSON.parse(String(row.data_json)):null,pdf:row.pdf_base64||null});
 });
 app.post('/api/authorization-links/complete',async c=>{
  const value=token(c.req.raw.headers);if(!value)return c.json({error:'Link individual obrigatório.'},400);
  if(Number(c.req.header('content-length')||0)>100000)return c.json({error:'Documento muito grande.'},413);
  const raw=await c.req.text();if(raw.length>100000)return c.json({error:'Documento muito grande.'},413);
  let body;try{body=JSON.parse(raw);}catch{return c.json({error:'Dados inválidos.'},400);}
  const data=body?.data;const repo=await store();const row=await repo.read(value);if(!row)return c.json({error:'Link inválido.'},404);
  if(row.completed_at)return c.json({error:'Esta autorização já foi concluída. Reabra o link para consultar o documento preenchido.'},409);
  const required=['owner','document','phone','propertyAddress','type','price','commission','startDate','endDate','city'];
  if(!data||!required.every(k=>typeof data[k]==='string'&&data[k].trim())||Object.values(data).some(v=>typeof v!=='string'||v.length>1500)||String(data.document).replace(/\D/g,'').length!==11||!/^\d{4}-\d{2}-\d{2}$/.test(data.startDate)||!/^\d{4}-\d{2}-\d{2}$/.test(data.endDate)||data.endDate<data.startDate)return c.json({error:'Confira os campos obrigatórios e as datas.'},400);
  if(row.kind==='venda'&&(!Number.isFinite(authorizationCommission(data.commission))||authorizationCommission(data.commission)<=0||authorizationCommission(data.commission)>100))return c.json({error:'Comissão inválida.'},400);
  // The server builds the PDF from the frozen fields; callers cannot replace it with an unrelated PDF.
  const {pdfFromAuthorizationLines}=await import('../../web/lib/authorization-pdf');
  const date=new Date().toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'});
  const clean={owner:'',document:'',phone:'',email:'',ownerAddress:'',propertyAddress:'',type:'',bedrooms:'',parking:'',floors:'',price:'',commission:'',startDate:'',endDate:'',notes:'',city:'',condominium:'',iptu:'',...data};
  const lines=row.kind==='locacao'?rentalAuthorizationLines(clean as RentalAuthorizationData,date):authorizationLines(clean as AuthorizationData,date);
  const logo=body.logo;
  if(typeof logo!=='string'||logo.length>60000||!logo.startsWith('/9j/')||!/^[A-Za-z0-9+/]*={0,2}$/.test(logo))return c.json({error:'Logo inválido.'},400);
  const jpeg=Buffer.from(logo,'base64').toString('binary');
  const pdf=Buffer.from(pdfFromAuthorizationLines(lines,jpeg)).toString('base64');
  if(!await repo.complete(value,clean,pdf))return c.json({error:'Esta autorização já foi concluída em outra aba. Reabra o link.'},409);
  return c.json({ok:true,pdf});
 });
}

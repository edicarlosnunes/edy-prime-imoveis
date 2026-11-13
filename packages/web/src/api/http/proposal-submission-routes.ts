import type {Hono} from 'hono';
import {bodyLimit} from 'hono/body-limit';
import {resolveSession} from '../lib/auth';
import {db} from '../database';
import {validateProposal,initialProposal,type PurchaseProposal} from '../../web/lib/purchase-proposal';
import {purchaseProposalPdf} from '../../web/lib/purchase-proposal-pdf';

const columns=['name','cpf','nationality','civilStatus','profession','address','phone','email','spouseName','spouseCpf'] as const;
const textFields=['propertyType','propertyAddress','propertyCode','registry','amount','deposit','depositDate','balance','payment','installments','financing','notes','commission','city','date','duration'] as const;
const ready=()=>db.$client.execute(`CREATE TABLE IF NOT EXISTS purchase_proposal_submissions_v1 (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 operation TEXT NOT NULL UNIQUE,
 data_json TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'recebida',
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
)`);
function sanitize(raw:unknown):PurchaseProposal{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Dados da proposta inválidos.');
 const incoming=raw as Record<string,unknown>;
 const d=initialProposal();
 for(const field of textFields){
  const v=incoming[field];
  if(typeof v!=='string'||v.length>1000)throw Error('Campo inválido: '+field);
  (d as unknown as Record<string,string>)[field]=v;
 }
 for(const side of ['buyer','seller'] as const){
  const p=incoming[side];
  if(!p||typeof p!=='object'||Array.isArray(p))throw Error('Dados do '+side+' inválidos.');
  const row=p as Record<string,unknown>;
  for(const field of columns){
   if(typeof row[field]!=='string'||(row[field] as string).length>250)throw Error('Campo inválido: '+field);
   d[side][field]=row[field] as string;
  }
  if(typeof row.hasSpouse!=='boolean')throw Error('Estado civil inválido.');
  d[side].hasSpouse=row.hasSpouse;
 }
 validateProposal(d);
 return d;
}
export function registerProposalSubmissionRoutes(app:Hono){
 app.use('/api/proposta/*',bodyLimit({maxSize:20000,onError:c=>c.json({error:'Proposta muito grande.'},413)}));
 app.use('/api/proposta/*',async(c,next)=>{c.header('Cache-Control','no-store');c.header('X-Robots-Tag','noindex, nofollow');await next();});
 app.post('/api/proposta/enviar',async c=>{
  const origin=c.req.header('origin');
  if(origin&&origin!==new URL(c.req.url).origin)return c.json({error:'Origem não permitida.'},403);
  let input:{operation?:unknown;data?:unknown};
  try{input=await c.req.json();}catch{return c.json({error:'Dados inválidos.'},400);}
  if(!input||typeof input!=='object'||typeof input.operation!=='string'||!/^[0-9a-f-]{36}$/.test(input.operation))return c.json({error:'Identificador de envio inválido.'},400);
  let data:PurchaseProposal;
  try{data=sanitize(input.data);}catch(e){return c.json({error:e instanceof Error?e.message:'Proposta inválida.'},400);}
  try{
   await ready();
   const now=Date.now();
   await db.$client.execute({sql:'INSERT INTO purchase_proposal_submissions_v1(operation,data_json,status,created_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(operation) DO NOTHING',args:[input.operation,JSON.stringify(data),'recebida',now,now]});
   const res=await db.$client.execute({sql:'SELECT id FROM purchase_proposal_submissions_v1 WHERE operation=?',args:[input.operation]});
   return c.json({ok:true,id:Number(res.rows[0].id),message:'Dados recebidos no CRM. O corretor completará os campos pendentes.'});
  }catch{console.error('Falha ao arquivar proposta de comprador');return c.json({error:'Não foi possível confirmar o recebimento no CRM. Seus dados continuam no formulário. Tente novamente.'},503);}
 });
 app.get('/api/proposta/admin/recebidas',async c=>{
  if(!await resolveSession(c.req.raw.headers))return c.json({error:'Não autorizado.'},401);
  try{await ready();const r=await db.$client.execute("SELECT id,data_json,status,created_at FROM purchase_proposal_submissions_v1 ORDER BY id DESC LIMIT 200");
   return c.json({rows:r.rows.map(row=>({id:Number(row.id),data:JSON.parse(String(row.data_json)),status:String(row.status),createdAt:Number(row.created_at)}))});
  }catch{return c.json({error:'Não foi possível consultar propostas.'},503);}
 });
 app.get('/api/proposta/admin/recebidas/:id/pdf',async c=>{
  if(!await resolveSession(c.req.raw.headers))return c.json({error:'Não autorizado.'},401);
  const id=Number(c.req.param('id'));if(!Number.isSafeInteger(id)||id<=0)return c.json({error:'Documento inválido.'},400);
  try{await ready();const r=await db.$client.execute({sql:'SELECT data_json FROM purchase_proposal_submissions_v1 WHERE id=?',args:[id]});
   if(!r.rows[0])return c.json({error:'Proposta não encontrada.'},404);
   const pdf=purchaseProposalPdf(sanitize(JSON.parse(String(r.rows[0].data_json))));
   return new Response(pdf as BodyInit,{headers:{'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="Proposta-Recebida-${id}.pdf"`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  }catch{return c.json({error:'Não foi possível gerar o PDF. Consulte os dados na lista do CRM.'},422);}
 });
}

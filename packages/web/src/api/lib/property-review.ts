import { sql, eq } from "drizzle-orm";
import type { AdminDb } from "./admin-base";
import * as schema from "../database/schema";
import { DEFAULT_REVIEW, reviewDue, OWNER_REVIEW_BODY, BROKER_REVIEW_BODY, type ReviewSchedule } from "../../shared/revalidation";
import { readConfig, type ConfigMap } from "./integrations";

const DAY = 86_400_000;
const BROKER = "5513997141174";
const phone = (value: string) => { const digits = value.replace(/\D/g, ""); return digits.length === 10 || digits.length === 11 ? `55${digits}` : digits; };
export async function ensureReviews(db: AdminDb) {
  await db.run(sql`CREATE TABLE IF NOT EXISTS crm_property_review_setup (key TEXT PRIMARY KEY, last_attempt INTEGER NOT NULL, error TEXT)`);
  await db.run(sql`CREATE TABLE IF NOT EXISTS crm_property_reviews (property_id INTEGER PRIMARY KEY, interval TEXT NOT NULL DEFAULT '90d', custom_date TEXT, repeat_days INTEGER NOT NULL DEFAULT 90, cycle INTEGER NOT NULL DEFAULT 1, attempts INTEGER NOT NULL DEFAULT 0, last_sent INTEGER, outcome TEXT, owner_phone TEXT, notified INTEGER NOT NULL DEFAULT 0, error TEXT)`);
  await db.run(sql`CREATE TABLE IF NOT EXISTS crm_property_review_events (id INTEGER PRIMARY KEY AUTOINCREMENT, property_id INTEGER NOT NULL, cycle INTEGER NOT NULL, kind TEXT NOT NULL, state TEXT NOT NULL, at INTEGER NOT NULL, detail TEXT, message_id TEXT, UNIQUE(property_id,cycle,kind))`);
}
export async function reviewSettings(db: AdminDb, id: number) {
  await ensureReviews(db);
  const rows = await db.all(sql`SELECT * FROM crm_property_reviews WHERE property_id=${id}`) as ReviewRow[];
  const row = rows[0];
  const events = await db.all(sql`SELECT kind,state,at,detail FROM crm_property_review_events WHERE property_id=${id} ORDER BY id DESC LIMIT 20`);
  return { schedule: row ? {interval: row.interval, ...(row.custom_date ? {date:row.custom_date} : {})} as ReviewSchedule : DEFAULT_REVIEW, attempts:row?.attempts ?? 0, outcome:row?.outcome ?? null, error:row?.error ?? null, repeatDays: row?.repeat_days ?? 90, events: events as {kind:string;state:string;at:number;detail:string|null}[] };
}
export async function configureReview(db: AdminDb, id:number, schedule:ReviewSchedule, base:Date) {
  const due = reviewDue(base,schedule);
  if (due <= base) throw new Error("A próxima revisão deve ser posterior à data base");
  await ensureReviews(db);
  await db.run(sql`INSERT INTO crm_property_reviews(property_id,interval,custom_date,repeat_days) VALUES(${id},${schedule.interval},${schedule.date ?? null},${Math.ceil((due.getTime()-base.getTime())/DAY)}) ON CONFLICT(property_id) DO UPDATE SET interval=excluded.interval,custom_date=excluded.custom_date,repeat_days=excluded.repeat_days,cycle=cycle+1,attempts=0,last_sent=NULL,outcome=NULL,owner_phone=NULL,notified=0,error=NULL`);
  await db.update(schema.properties).set({nextRevalidationAt:due,updatedAt:new Date()}).where(eq(schema.properties.id,id));
  return due;
}
type ReviewRow = {property_id:number;interval:ReviewSchedule["interval"];custom_date:string|null;repeat_days:number;cycle:number;attempts:number;last_sent:number|null;outcome:string|null;owner_phone:string|null;notified:number;error:string|null};
export type Template = {name:string;language:string;status:string;components?:{type:string;text?:string;buttons?:{type:string;text?:string}[]}[]};
export function exactTemplate(templates:Template[], body:string) {
  return templates.find(t => t.status === "APPROVED" && t.components?.some(c => c.type === "BODY" && c.text === body) && t.components.every(c => c.type === "BODY" || (c.type === "BUTTONS" && c.buttons?.every(b => b.type === "QUICK_REPLY" && /^(sim|não|nao)$/i.test(b.text ?? "")))));
}
async function templates(config:ConfigMap):Promise<Template[]> {
  if (!config.accessToken || !config.wabaId || !config.phoneNumberId) throw new Error("WhatsApp: faltam credenciais ou WABA ID para validar os modelos de revalidação");
  const out:Template[]=[];
  let url:string|null = `https://graph.facebook.com/v21.0/${encodeURIComponent(config.wabaId)}/message_templates?limit=100`;
  for(let page=0;url && page<10;page++) {
    const response=await fetch(url,{headers:{authorization:`Bearer ${config.accessToken}`}});
    const data=await response.json() as {data?:Template[];paging?:{next?:string};error?:{message:string}};
    if(!response.ok) throw new Error(data.error?.message ?? "Não foi possível validar os modelos WhatsApp");
    out.push(...(data.data ?? []));
    const next=data.paging?.next; url=next && new URL(next).origin === "https://graph.facebook.com" ? next : null;
  }
  return out;
}
async function prepareTemplates(db:AdminDb,config:ConfigMap,list:Template[],stamp:number) {
  for(const [name,body] of [["esantos_revalidacao_imovel_v1",OWNER_REVIEW_BODY],["esantos_aviso_revalidacao_v1",BROKER_REVIEW_BODY]]) {
    const existing=list.find(t=>t.name === name || t.components?.some(c=>c.type === "BODY" && c.text === body));
    if(existing) continue;
    const claim=await db.all(sql`INSERT INTO crm_property_review_setup(key,last_attempt) VALUES(${name!},${stamp}) ON CONFLICT(key) DO UPDATE SET last_attempt=excluded.last_attempt WHERE last_attempt<${stamp-DAY} RETURNING key`) as unknown[];
    if(!claim.length) continue;
    try {
      const response=await fetch(`https://graph.facebook.com/v21.0/${config.wabaId}/message_templates`,{method:"POST",headers:{authorization:`Bearer ${config.accessToken}`,"content-type":"application/json"},body:JSON.stringify({name,language:"pt_BR",category:"UTILITY",components:[{type:"BODY",text:body,example:{body_text:[[name === "esantos_revalidacao_imovel_v1" ? "Rua Exemplo, 100, apartamento 2" : "AP-EXEMPLO, Rua Exemplo, 100. Sem resposta após três tentativas."]]}}]})});
      const result=await response.json() as {error?:{message:string}};
      if(!response.ok) throw new Error(result.error?.message ?? "Falha ao solicitar modelo WhatsApp");
      await db.run(sql`UPDATE crm_property_review_setup SET error=NULL WHERE key=${name!}`);
    } catch(error) {await db.run(sql`UPDATE crm_property_review_setup SET error=${String(error)} WHERE key=${name!}`);}
  }
}
export async function reviewChannelReadiness(db:AdminDb) {
  await ensureReviews(db);
  const {row,config}=await readConfig(db,"whatsapp_cloud");
  if(row?.enabled !== 1) return {ready:false,reason:"WhatsApp Cloud desativado"};
  try {
    const list=await templates(config);
    const missing=[!exactTemplate(list,OWNER_REVIEW_BODY) && "pergunta ao proprietário",!exactTemplate(list,BROKER_REVIEW_BODY) && "aviso ao responsável"].filter(Boolean);
    const setup=await db.all(sql`SELECT error FROM crm_property_review_setup WHERE error IS NOT NULL LIMIT 1`) as {error:string}[];
    return {ready:!missing.length,reason:missing.length ? `Falta modelo aprovado: ${missing.join(" e ")}.${setup[0] ? ` ${setup[0].error}` : ""}` : "Modelos de revalidação aprovados."};
  } catch(error) {return {ready:false,reason:error instanceof Error ? error.message : "Falha na validação do WhatsApp"};}
}
async function sendTemplate(config:ConfigMap,to:string,template:Template,value:string) {
  const response=await fetch(`https://graph.facebook.com/v21.0/${config.phoneNumberId}/messages`,{method:"POST",headers:{authorization:`Bearer ${config.accessToken}`,"content-type":"application/json"},body:JSON.stringify({messaging_product:"whatsapp",to,type:"template",template:{name:template.name,language:{code:template.language},components:[{type:"body",parameters:[{type:"text",text:value}]}]}})});
  const payload=await response.json() as {messages?:{id:string}[];error?:{message:string}};
  if(!response.ok) throw new Error(payload.error?.message ?? `WhatsApp HTTP ${response.status}`);
  if(!payload.messages?.[0]?.id) throw new Error("WhatsApp não confirmou o identificador do envio; verificar antes de repetir");
  return payload.messages[0].id;
}
async function deliver(db:AdminDb,r:ReviewRow,kind:string,to:string,t:Template,config:ConfigMap,text:string,now:number) {
  const claimed=await db.all(sql`INSERT INTO crm_property_review_events(property_id,cycle,kind,state,at,detail) VALUES(${r.property_id},${r.cycle},${kind},'sending',${now},${text}) ON CONFLICT DO NOTHING RETURNING id`) as {id:number}[];
  if(!claimed.length) return false; // Never repeat an ambiguous/failed send automatically.
  try {
    const id=await sendTemplate(config,to,t,text);
    await db.run(sql`UPDATE crm_property_review_events SET state='sent',message_id=${id} WHERE id=${claimed[0]!.id}`);
    return true;
  } catch(error) {
    const detail=error instanceof Error ? error.message : "Falha de envio";
    await db.run(sql`UPDATE crm_property_review_events SET state='error',detail=${detail} WHERE id=${claimed[0]!.id}`);
    await db.run(sql`UPDATE crm_property_reviews SET error=${detail} WHERE property_id=${r.property_id}`);
    return false;
  }
}
export async function sweepPropertyReviews(db:AdminDb,now=new Date()) {
  await ensureReviews(db);
  const stamp=now.getTime();
  // Defaults apply to existing sale properties with a known entry; never invent an entry date.
  await db.run(sql`INSERT INTO crm_property_reviews(property_id) SELECT id FROM properties WHERE portfolio_entry_at IS NOT NULL AND purpose IN ('venda','venda_locacao') ON CONFLICT DO NOTHING`);
  await db.run(sql`UPDATE properties SET next_revalidation_at=portfolio_entry_at+90*86400 WHERE next_revalidation_at IS NULL AND portfolio_entry_at IS NOT NULL AND revalidation_status IS NULL AND id IN (SELECT property_id FROM crm_property_reviews WHERE outcome IS NULL)`);
  await db.run(sql`UPDATE crm_property_reviews SET notified=1 WHERE EXISTS(SELECT 1 FROM crm_property_review_events e WHERE e.property_id=crm_property_reviews.property_id AND e.cycle=crm_property_reviews.cycle AND e.kind='broker' AND e.state='sent')`);
  await db.run(sql`UPDATE crm_property_reviews SET attempts=(SELECT COUNT(*) FROM crm_property_review_events e WHERE e.property_id=crm_property_reviews.property_id AND e.cycle=crm_property_reviews.cycle AND e.kind LIKE 'owner-%' AND e.state='sent'),last_sent=(SELECT MAX(at) FROM crm_property_review_events e WHERE e.property_id=crm_property_reviews.property_id AND e.cycle=crm_property_reviews.cycle AND e.kind LIKE 'owner-%' AND e.state='sent') WHERE outcome IS NULL`);
  const rows=await db.all(sql`SELECT r.*,p.code,p.address,p.next_revalidation_at,o.name AS owner_name,o.phone FROM crm_property_reviews r JOIN properties p ON p.id=r.property_id LEFT JOIN owners o ON o.id=p.owner_id WHERE p.status='disponivel' AND p.purpose IN ('venda','venda_locacao') AND p.next_revalidation_at<=${Math.floor(stamp/1000)} AND r.notified=0 AND (r.outcome IS NULL OR r.outcome IN ('nao','outro')) ORDER BY p.next_revalidation_at LIMIT 100`) as (ReviewRow & {code:string;address:string|null;next_revalidation_at:number;owner_name:string|null;phone:string|null})[];
  const {row,config}=await readConfig(db,"whatsapp_cloud");
  let list:Template[]=[]; let reason="WhatsApp Cloud desativado";
  if(row?.enabled === 1) {try {list=await templates(config);reason="Aguardando modelos WhatsApp aprovados: esantos_revalidacao_imovel_v1 e esantos_aviso_revalidacao_v1";} catch(error) {reason=String(error);}}
  if (row?.enabled === 1 && config.wabaId && config.accessToken) await prepareTemplates(db,config,list,stamp);
  const ownerTemplate=exactTemplate(list,OWNER_REVIEW_BODY),brokerTemplate=exactTemplate(list,BROKER_REVIEW_BODY);
  if(!ownerTemplate || !brokerTemplate) {
    for(const r of rows) await db.run(sql`UPDATE crm_property_reviews SET error=${reason} WHERE property_id=${r.property_id}`);
    return {checked:rows.length,sent:0,blocked:reason};
  }
  let sent=0;
  for(const r of rows) {
    const number=phone(r.phone ?? "");
    const invalid=!/^55\d{10,11}$/.test(number) || !r.address?.trim();
    const failed=Boolean((await db.all(sql`SELECT id FROM crm_property_review_events WHERE property_id=${r.property_id} AND cycle=${r.cycle} AND (state='error' OR (state='sending' AND at<${stamp-15*60_000}))` ) as unknown[]).length);
    const needsAlert=Boolean(r.outcome || invalid || failed || (r.attempts>=3 && r.last_sent !== null && stamp-r.last_sent>=DAY));
    if(needsAlert) {
      const cause=r.outcome === "nao" ? "Proprietário informou que não está à venda. Avalie retirar da carteira." : r.outcome === "outro" ? "Resposta precisa de conferência no CRM." : invalid ? "Falta endereço ou telefone válido para a consulta." : failed ? `Falha no envio: ${r.error}. Confira antes de tentar novamente.` : "Sem resposta após três tentativas. Entre em contato com o proprietário.";
      const text=`${r.code} — ${r.address ?? "endereço não informado"}. ${r.owner_name ?? "Proprietário"}, ${r.phone ?? "sem telefone"}. ${cause}`;
      if(await deliver(db,r,"broker",BROKER,brokerTemplate,config,text,stamp)) {await db.run(sql`UPDATE crm_property_reviews SET notified=1 WHERE property_id=${r.property_id} AND cycle=${r.cycle}`);sent++;}
      continue;
    }
    if(r.attempts>=3 || (r.last_sent !== null && stamp-r.last_sent<DAY)) continue;
    // One outstanding question per phone prevents assigning a bare Sim/Não to the wrong property.
    const busy=await db.all(sql`SELECT property_id FROM crm_property_reviews WHERE owner_phone=${number} AND property_id!=${r.property_id} AND attempts>0 AND outcome IS NULL AND notified=0 LIMIT 1`) as unknown[];
    if(busy.length) {await db.run(sql`UPDATE crm_property_reviews SET error='Aguardando resposta de outro imóvel deste proprietário' WHERE property_id=${r.property_id}`);continue;}
    const reserved=await db.all(sql`UPDATE crm_property_reviews SET owner_phone=${number} WHERE property_id=${r.property_id} AND cycle=${r.cycle} AND outcome IS NULL AND NOT EXISTS(SELECT 1 FROM crm_property_reviews other WHERE other.property_id!=${r.property_id} AND other.owner_phone=${number} AND other.outcome IS NULL AND other.notified=0) RETURNING property_id`) as unknown[];
    if(!reserved.length) continue;
    if(await deliver(db,r,`owner-${r.attempts+1}`,number,ownerTemplate,config,r.address!.trim(),stamp)) {
      await db.run(sql`UPDATE crm_property_reviews SET attempts=attempts+1,last_sent=${stamp},owner_phone=${number},error=NULL WHERE property_id=${r.property_id} AND cycle=${r.cycle}`);sent++;
    }
  }
  return {checked:rows.length,sent};
}
export async function receiveReviewReply(db:AdminDb,from:string,text:string,now=new Date()) {
  await ensureReviews(db);
  const rows=await db.all(sql`SELECT * FROM crm_property_reviews WHERE owner_phone=${phone(from)} AND attempts>0 AND outcome IS NULL AND notified=0`) as ReviewRow[];
  if(rows.length !== 1) return false;
  const r=rows[0]!;
  const normalized=text.normalize("NFD").replace(/\p{M}/gu,"").trim().toLowerCase().replace(/[.!?]+$/g,"");
  const answer=normalized === "sim" ? "sim" : normalized === "nao" ? "nao" : "outro";
  const schedule:ReviewSchedule={interval:r.interval,...(r.custom_date ? {date:r.custom_date} : {})};
  // Keep the original custom duration when the owner confirms availability.
  const due=answer === "sim" ? (schedule.interval === "custom" ? new Date(now.getTime()+r.repeat_days*DAY) : reviewDue(now,schedule)) : null;
  const seconds=Math.floor(now.getTime()/1000),dueSeconds=due ? Math.floor(due.getTime()/1000) : null;
  const historyOutcome=answer === "sim" ? "disponivel" : answer === "nao" ? "nao_deseja_vender" : "sem_resposta";
  // Atomic batch: a crash/replayed webhook cannot leave a consumed answer without its history.
  await db.batch([
    db.run(sql`INSERT INTO property_revalidations(property_id,outcome,note,revalidated_at,next_due_at,user_name,created_at) SELECT ${r.property_id},${historyOutcome},${`Resposta WhatsApp: ${text.slice(0,1000)}`},${seconds},${dueSeconds},'Revalidação automática',${seconds} WHERE EXISTS(SELECT 1 FROM crm_property_reviews WHERE property_id=${r.property_id} AND cycle=${r.cycle} AND outcome IS NULL)`),
    db.run(sql`UPDATE properties SET last_revalidation_at=CASE WHEN ${answer}='sim' THEN ${seconds} ELSE last_revalidation_at END,next_revalidation_at=CASE WHEN ${answer}='sim' THEN ${dueSeconds} ELSE next_revalidation_at END,revalidation_status=${historyOutcome},updated_at=${seconds} WHERE id=${r.property_id} AND EXISTS(SELECT 1 FROM crm_property_reviews WHERE property_id=${r.property_id} AND cycle=${r.cycle} AND outcome IS NULL)`),
    db.run(sql`UPDATE crm_property_reviews SET outcome=${answer === "sim" ? null : answer},cycle=cycle+${answer === "sim" ? 1 : 0},attempts=CASE WHEN ${answer}='sim' THEN 0 ELSE attempts END,last_sent=CASE WHEN ${answer}='sim' THEN NULL ELSE last_sent END,owner_phone=CASE WHEN ${answer}='sim' THEN NULL ELSE owner_phone END,error=NULL WHERE property_id=${r.property_id} AND cycle=${r.cycle} AND outcome IS NULL`),
  ]);
  return true;
}

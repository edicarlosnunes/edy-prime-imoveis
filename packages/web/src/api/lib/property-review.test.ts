import {test,expect,afterEach} from "bun:test";
import {createClient} from "@libsql/client";
import {drizzle} from "drizzle-orm/libsql";
import {sql} from "drizzle-orm";
import {configureReview,sweepPropertyReviews,receiveReviewReply,reviewSettings,exactTemplate,type Template} from "./property-review";
import {reviewDue,OWNER_REVIEW_BODY,BROKER_REVIEW_BODY} from "../../shared/revalidation";
import type {AdminDb} from "./admin-base";
const originalFetch=globalThis.fetch;
afterEach(()=>{globalThis.fetch=originalFetch;});
const start=new Date("2026-10-20T15:00:00Z"), day=86400000;
const approved:Template[]=[{name:"owner",language:"pt_BR",status:"APPROVED",components:[{type:"BODY",text:OWNER_REVIEW_BODY}]},{name:"broker",language:"pt_BR",status:"APPROVED",components:[{type:"BODY",text:BROKER_REVIEW_BODY}]}];
async function fixture() {
 const client=createClient({url:":memory:"}); const db=drizzle(client) as unknown as AdminDb;
 await client.executeMultiple(`CREATE TABLE properties(id INTEGER PRIMARY KEY,code TEXT,address TEXT,purpose TEXT DEFAULT 'venda',status TEXT DEFAULT 'disponivel',owner_id INTEGER,portfolio_entry_at INTEGER,next_revalidation_at INTEGER,last_revalidation_at INTEGER,revalidation_status TEXT,updated_at INTEGER);
 CREATE TABLE owners(id INTEGER PRIMARY KEY,name TEXT,phone TEXT);
 CREATE TABLE property_revalidations(id INTEGER PRIMARY KEY,property_id INTEGER,outcome TEXT,note TEXT,revalidated_at INTEGER,next_due_at INTEGER,user_name TEXT,created_at INTEGER);
 CREATE TABLE integrations(id INTEGER PRIMARY KEY,key TEXT,status TEXT,enabled INTEGER,config TEXT,last_sync_at INTEGER,last_test_at INTEGER,last_error TEXT,updated_at INTEGER);
 INSERT INTO owners VALUES(1,'Maria','13999990000');
 INSERT INTO integrations VALUES(1,'whatsapp_cloud','conectado',1,'{"accessToken":"test","wabaId":"test","phoneNumberId":"test"}',NULL,NULL,NULL,0);`);
 await db.run(sql`INSERT INTO properties(id,code,address,owner_id,portfolio_entry_at) VALUES(1,'AP12','Rua A, 12, apto 3',1,${Math.floor((start.getTime()-90*day)/1000)})`);
 await configureReview(db,1,{interval:"90d"},new Date(start.getTime()-90*day));
 const sends:{to:string;template:{name:string;components:{parameters:{text:string}[]}[]}}[]=[];
 globalThis.fetch=(async(input,options)=>{
  if(String(input).includes("message_templates"))return Response.json({data:approved});
  const body=JSON.parse(String(options?.body));sends.push(body);return Response.json({messages:[{id:`wamid-${sends.length}`}]});
 }) as typeof fetch;
 return {db,sends};
}
test("90 days differs from calendar months and preserves month ends",()=>{
 expect(reviewDue(start,{interval:"90d"}).toISOString()).toBe("2027-01-18T15:00:00.000Z");
 expect(reviewDue(start,{interval:"3m"}).toISOString()).toBe("2027-01-20T15:00:00.000Z");
 expect(reviewDue(new Date("2026-10-31T15:00:00Z"),{interval:"4m"}).toISOString()).toBe("2027-02-28T15:00:00.000Z");
 expect(()=>reviewDue(start,{interval:"custom",date:"2026-02-30"})).toThrow();
});
test("three daily attempts, then broker at day3; repeated job never duplicates",async()=>{
 const {db,sends}=await fixture();
 for(let i=0;i<3;i++){
  await Promise.all([sweepPropertyReviews(db,new Date(+start+i*day)),sweepPropertyReviews(db,new Date(+start+i*day))]);
  expect(sends.length).toBe(i+1);
  await sweepPropertyReviews(db,new Date(+start+i*day+day-1));expect(sends.length).toBe(i+1);
 }
 expect(sends[0]!.template.components[0]!.parameters[0]!.text).toBe("Rua A, 12, apto 3");
 await sweepPropertyReviews(db,new Date(+start+3*day));expect(sends.length).toBe(4);expect(sends[3]!.to).toBe("5513997141174");
 await sweepPropertyReviews(db,new Date(+start+6*day));expect(sends.length).toBe(4);
 expect((await reviewSettings(db,1)).attempts).toBe(3);
});
test("Sim stops retries and renews 60-day schedule, Não alerts without deleting property",async()=>{
 const {db,sends}=await fixture();await configureReview(db,1,{interval:"60d"},new Date(+start-60*day));
 await sweepPropertyReviews(db,start);
 expect(await receiveReviewReply(db,"5513999990000","Sim",start)).toBe(true);
 await sweepPropertyReviews(db,new Date(+start+day));expect(sends.length).toBe(1);
 const prop=await db.all(sql`SELECT * FROM properties`) as {next_revalidation_at:number}[];
 expect(prop[0]!.next_revalidation_at).toBe(Math.floor((+start+60*day)/1000));
 await sweepPropertyReviews(db,new Date(+start+60*day));
 await receiveReviewReply(db,"5513999990000","Não",new Date(+start+60*day));
 await sweepPropertyReviews(db,new Date(+start+60*day+1));
 expect(sends.length).toBe(3);expect(sends[2]!.to).toBe("5513997141174");
 expect((await db.all(sql`SELECT status FROM properties`))[0]).toEqual({status:"disponivel"});
});
test("unknown response stops retries; multiple properties do not receive ambiguous simultaneous questions",async()=>{
 const {db,sends}=await fixture();
 await db.run(sql`INSERT INTO properties(id,code,address,owner_id,portfolio_entry_at,next_revalidation_at) SELECT 2,'AP13','Rua B, 13',1,portfolio_entry_at,next_revalidation_at FROM properties WHERE id=1`);
 await Promise.all([sweepPropertyReviews(db,start),sweepPropertyReviews(db,start)]);expect(sends.length).toBe(1);
 await receiveReviewReply(db,"5513999990000","Vou conferir",start);
 await sweepPropertyReviews(db,new Date(+start+day));
 expect(sends.filter(s=>s.to === "5513997141174").length).toBe(1);
 expect((await reviewSettings(db,1)).outcome).toBe("outro");
});
test("unapproved or altered templates cannot send; failures are visible and not retried blindly",async()=>{
 expect(exactTemplate([{...approved[0]!,status:"PENDING"}],OWNER_REVIEW_BODY)).toBeUndefined();
 expect(exactTemplate([{...approved[0]!,components:[{type:"BODY",text:OWNER_REVIEW_BODY},{type:"HEADER",text:"Oferta"}]}],OWNER_REVIEW_BODY)).toBeUndefined();
 const {db,sends}=await fixture();
 globalThis.fetch=(async(input)=>String(input).includes("message_templates") ? Response.json({data:approved}) : Response.json({error:{message:"Sem permissão"}},{status:403})) as typeof fetch;
 await sweepPropertyReviews(db,start);await sweepPropertyReviews(db,start);
 expect((await reviewSettings(db,1)).attempts).toBe(0);
 expect((await reviewSettings(db,1)).error).toContain("Sem permissão");
 expect(sends.length).toBe(0);
});

test("custom review duration renews after Sim and rejected channel never consumes attempts",async()=>{
 const {db}=await fixture();
 const base=new Date("2026-08-20T15:00:00Z");
 await configureReview(db,1,{interval:"custom",date:"2026-10-20"},base);
 await sweepPropertyReviews(db,start);
 await receiveReviewReply(db,"5513999990000","Sim",start);
 const prop=await db.all(sql`SELECT next_revalidation_at FROM properties`) as {next_revalidation_at:number}[];
 expect(prop[0]!.next_revalidation_at).toBe(Math.floor((+start+61*day)/1000));
});

test("missing templates are requested once and no WhatsApp message is falsely marked as sent",async()=>{
 const {db}=await fixture();let submissions=0;
 globalThis.fetch=(async(input,options)=>{
  expect(String(input)).toContain("message_templates");
  if(options?.method === "POST") {submissions++;return Response.json({id:"template",status:"PENDING"});}
  return Response.json({data:[]});
 }) as typeof fetch;
 await sweepPropertyReviews(db,start);await sweepPropertyReviews(db,start);
 expect(submissions).toBe(2);
 const state=await reviewSettings(db,1);
 expect(state.attempts).toBe(0);expect(state.events.length).toBe(0);expect(state.error).toContain("Aguardando modelos");
});

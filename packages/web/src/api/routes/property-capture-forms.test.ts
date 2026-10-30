import { test, expect } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import * as schema from "../database/schema";
import { issueCaptureShareTokenRecord } from "../lib/capture-share-tokens";
import { submitPropertyCaptureForm } from "./property-capture-forms";
import { propertyCaptureFormSchema } from "../../shared/property-capture-form";

async function fixture() {
  const client = createClient({url:`file:/tmp/capture-form-${crypto.randomUUID()}.db`}); const db=drizzle(client);
  for(const table of [schema.captureShareTokens,schema.owners,schema.propertyCaptures,schema.settings,schema.tasks,schema.media,schema.crmSerials]) {
    const config=getTableConfig(table);
    await db.run(sql.raw(`CREATE TABLE "${config.name}" (${config.columns.map(c=>`"${c.name}" ${c.getSQLType()}${c.primary ? " PRIMARY KEY" : ""}`).join(",")})`));
  }
  const {token}=await issueCaptureShareTokenRecord(db,1);
  const blank={name:"Proprietário teste",phone:"13999990000",email:"",intention:"venda",propertyType:"apartamento",cep:"11700000",street:"Rua de teste",number:"100",complement:"101",city:"Praia Grande",state:"SP",neighborhood:"Tupi",area:"26",bedrooms:"1",bathrooms:"1",suites:"0",parking:"1",balcony:"Sim",view:"Sim",furnished:"Sim",amenities:"Elevador",price:"175.000,00",condominium:"Não sei",iptu:"Não sei",negotiation:"Aceita proposta",occupancy:"Vazio",deed:"Sim",financing:"Não",debts:"Não sei",observations:"OK",consent:true,website:"",token,photo:`data:image/jpeg;base64,${Buffer.concat([Buffer.from([255,216]),Buffer.alloc(120),Buffer.from([255,217])]).toString("base64")}`};
  return {client,db,token,input:propertyCaptureFormSchema.parse(blank)};
}
test("submission saves owner, source, unit and provisional facade; replay cannot create a duplicate",async()=>{
 const f=await fixture();
 await submitPropertyCaptureForm(f.db,f.input);
 const [capture]=await f.db.select().from(schema.propertyCaptures);
 expect(capture.source).toBe("link_captacao");expect(capture.complements).toContain('"unit":"101"');
 expect(capture.notes).toContain("Sacada: Sim");expect(capture.intention).toBe("venda");
 expect(JSON.parse(capture.ownerPhotos!)[0].source).toBe("proprietario");
 await expect(submitPropertyCaptureForm(f.db,f.input)).rejects.toThrow();
 expect(await f.db.select().from(schema.propertyCaptures)).toHaveLength(1);
 expect(await f.db.select().from(schema.media)).toHaveLength(1);
 f.client.close();
});
test("invalid facade does not consume the link or write an owner",async()=>{
 const f=await fixture();
 await expect(submitPropertyCaptureForm(f.db,{...f.input,photo:"data:image/jpeg;base64,YWJj"})).rejects.toThrow();
 expect(await f.db.select().from(schema.owners)).toHaveLength(0);
 expect((await f.db.select().from(schema.captureShareTokens))[0].status).toBe("active");f.client.close();
});
test("transaction rolls back a claimed token when saving fails",async()=>{
 const f=await fixture(); await f.db.run(sql.raw('DROP TABLE media'));
 await expect(submitPropertyCaptureForm(f.db,f.input)).rejects.toThrow();
 expect(await f.db.select().from(schema.owners)).toHaveLength(0);
 expect((await f.db.select().from(schema.captureShareTokens))[0].status).toBe("active");f.client.close();
});
test("a second unit from the same owner produces a separate capture",async()=>{
 const f=await fixture();await submitPropertyCaptureForm(f.db,f.input);
 const {token}=await issueCaptureShareTokenRecord(f.db,1);
 await submitPropertyCaptureForm(f.db,{...f.input,token,complement:"102"});
 expect(await f.db.select().from(schema.owners)).toHaveLength(1);
 expect(await f.db.select().from(schema.propertyCaptures)).toHaveLength(2);f.client.close();
});

test("permanent URL creates independent visitor sessions and resumes an unfinished form", async()=>{
 const f=await fixture();
 const {startPublicCaptureSession}=await import("./property-capture-forms");
 const first=await startPublicCaptureSession(f.db);
 const second=await startPublicCaptureSession(f.db);
 expect(first.token).not.toBe(second.token);
 expect((await startPublicCaptureSession(f.db,first.token)).token).toBe(first.token);
 expect(await f.db.select().from(schema.owners)).toHaveLength(0);
 await submitPropertyCaptureForm(f.db,{...f.input,token:first.token});
 const next=await startPublicCaptureSession(f.db,first.token);
 expect(next.token).not.toBe(first.token);
 expect((await startPublicCaptureSession(f.db,second.token)).token).toBe(second.token);
 f.client.close();
});

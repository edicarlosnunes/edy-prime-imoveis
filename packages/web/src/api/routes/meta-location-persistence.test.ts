import { test, expect } from 'bun:test';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { getTableColumns } from 'drizzle-orm';
import * as schema from '../database/schema';
import { adminProperties } from './admin-properties';
import { readMetaLocation } from '../../shared/meta-location';
test('update and reopen property preserves public address, SP and coordinates in SQLite', async () => {
 const client=createClient({url:':memory:'});
 const db=drizzle(client,{schema});
 for (const table of [schema.properties,schema.propertyImages]) {
  const name=table===schema.properties?'properties':'property_images';
  const columns=Object.values(getTableColumns(table)).map(c=>`"${c.name}" ${c.name==='id'?'INTEGER PRIMARY KEY':c.getSQLType()}`);
  await client.execute(`CREATE TABLE ${name} (${columns.join(',')})`);
 }
 await client.execute('CREATE TABLE crm_property_types (key TEXT PRIMARY KEY,label TEXT,normalized_label TEXT,active INTEGER)');
 await client.execute("INSERT INTO crm_property_types VALUES ('terreno','Terreno','terreno',1)");
 await db.insert(schema.properties).values({code:'TE-TEST',title:'Terreno de teste',type:'terreno',price:110000});
 const proc=(adminProperties.update as any)['~orpc'];
 const location={address:'Av. Dr. Roberto de Almeida Vinhas, 11041',region:'SP',latitude:-24.036786,longitude:-46.514833};
 await proc.handler({input:proc.inputSchema.parse({id:1,code:'TE-TEST',title:'Terreno de teste',type:'terreno',price:110000,metaLocation:location}),context:{db,user:{id:1,name:'Teste'}}});
 const saved=await db.select().from(schema.properties);
 expect(readMetaLocation(saved[0].features)).toEqual(location);
 const get=(adminProperties.get as any)['~orpc'];
 const reopened=await get.handler({input:{id:1},context:{db,user:{id:1,name:'Teste'}}});
 expect(reopened.metaLocation).toEqual(location);
 client.close();
});

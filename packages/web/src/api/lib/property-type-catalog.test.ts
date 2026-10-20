import { test, expect } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { listPropertyTypes,savePropertyType,validatePropertyType } from "./property-type-catalog";

test("catalog persists additions and renames, prevents duplicate names and preserves disabled types", async()=>{
 const db=drizzle(createClient({url:":memory:"}));
 const initial=await listPropertyTypes(db);
 expect(initial.find(row=>row.key==="kitnet")?.active).toBe(true);
 const {key}=await savePropertyType(db,{label:"Galpão",active:true});
 await validatePropertyType(db,key);
 await expect(savePropertyType(db,{label:" GALPAO ",active:true})).rejects.toThrow("Já existe");
 await savePropertyType(db,{key,label:"Galpão industrial",active:false});
 await expect(validatePropertyType(db,key)).rejects.toThrow("tipo ativo");
 await validatePropertyType(db,key,key);
 expect((await listPropertyTypes(db)).find(row=>row.key===key)).toEqual({key,label:"Galpão industrial",active:false});
 await savePropertyType(db,{key:"casa",label:"Casa residencial",active:false});
 expect((await listPropertyTypes(db)).find(row=>row.key==="casa")).toEqual({key:"casa",label:"Casa residencial",active:false});
 await savePropertyType(db,{key,label:"Galpão industrial",active:true});
 await validatePropertyType(db,key);
 await expect(validatePropertyType(db,"inventado")).rejects.toThrow("tipo ativo");
});

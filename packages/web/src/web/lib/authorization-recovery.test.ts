import {test,expect} from 'bun:test';
import {readCompleted,restoredPdf} from '../pages/autorizacao-venda';
test('blocked or invalid local storage does not prevent opening the form',()=>{
 expect(readCompleted({getItem:()=>{throw new Error('blocked');}})).toBeNull();
 for(const value of ['{','null','{}','{"data":{},"pdf":"JVBERi0"}'])expect(readCompleted({getItem:()=>value})).toBeNull();
});
test('completed authorization restores all fields and original unsigned PDF bytes',async()=>{
 const data=Object.fromEntries(['owner','document','phone','email','ownerAddress','propertyAddress','type','bedrooms','parking','floors','price','commission','startDate','endDate','notes','city'].map(key=>[key,key]));
 const pdf=btoa('%PDF-1.4\noriginal authorization');
 const saved=readCompleted({getItem:()=>JSON.stringify({data,pdf})});
 expect(saved?.data).toEqual(data);
 const file=restoredPdf(saved!.pdf)!;
 expect(file.name).toBe('Autorizacao-de-venda-E-Santos.pdf');
 expect(file.type).toBe('application/pdf');
 expect(await file.text()).toBe(atob(pdf));
});

import {useState} from 'react';
import {joaquimAuthorizationPdf} from '../lib/joaquim-authorization';
import type {AuthorizationData} from '../lib/authorization-pdf';
import type {StandaloneRecord} from '../lib/standalone-authorization-client';
// Independent public forms: in-memory only; no network submission, tracking, CRM or usage lock.
export function useJoaquimAuthorization(kind:'venda'|'locacao'){
 const [record,setRecord]=useState<StandaloneRecord|null>(null);
 async function finish(data:Record<string,string>){const bytes=await joaquimAuthorizationPdf(kind,data as AuthorizationData);let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);const local={kind,issuedAt:Date.now(),completed:true,data,pdf:btoa(binary)};setRecord(local);return local;}
 return {ready:true,error:'',isOwner:false,record,link:'',busy:false,prepare:async()=>{},finish,reset:()=>setRecord(null)};
}

import {authorizationPdf,type AuthorizationData} from '../lib/authorization-pdf';
import {rentalAuthorizationPdf,type RentalAuthorizationData} from '../lib/rental-authorization-pdf';
import {AUTHORIZATION_LOGO_JPEG} from '../lib/authorization-logo';
import {useEffect,useRef,useState} from 'react';
import {authorizationAccess,checkAuthorizationOwner,prepareRecipientAuthorization,readRecipientAuthorization,finishRecipientAuthorization,recipientAuthorizationUrl,type StandaloneKind,type StandaloneRecord} from '../lib/standalone-authorization-client';
export function useStandaloneAuthorization(kind:StandaloneKind){
 const [access]=useState(()=>authorizationAccess(location.hash));
 const [ready,setReady]=useState(false),[error,setError]=useState(''),[isOwner,setIsOwner]=useState(false),[record,setRecord]=useState<StandaloneRecord|null>(null),[link,setLink]=useState(''),[busy,setBusy]=useState(false);
 const operation=useRef(crypto.randomUUID());
 const token=useRef<string|null>(access.token);const pending=useRef<Promise<string>|null>(null);
 useEffect(()=>{let active=true;async function load(){try{if(access.owner){const owner=await checkAuthorizationOwner(access.owner);if(owner.kind!==kind)throw Error('Este atalho particular é de outra modalidade. Use seu atalho correspondente.');if(active){setIsOwner(true);setReady(true);}return;}
 if(!access.token){if(active)setReady(true);return;}
 const value=await readRecipientAuthorization(access.token);if(value.kind!==kind)throw Error('Este link pertence a outra modalidade de autorização.');if(active){setRecord(value);setReady(true);setLink(recipientAuthorizationUrl(location.origin,kind,access.token));}
 }catch(e){if(active)setError(e instanceof Error?e.message:'Não foi possível abrir a autorização.');}}
 void load();return()=>{active=false;};},[access,kind]);
 async function ensureToken(){if(token.current)return token.current;if(!access.owner||!isOwner)throw Error('Peça ao corretor um novo link.');if(pending.current)return pending.current;
 const task=prepareRecipientAuthorization(access.owner).then(value=>{token.current=value.token;setLink(recipientAuthorizationUrl(location.origin,kind,value.token));return value.token;}).finally(()=>{pending.current=null;});pending.current=task;return task;}
 async function prepare(){setBusy(true);setError('');try{await ensureToken();}catch(e){setError(e instanceof Error?e.message:'Não foi possível preparar o link.');}finally{setBusy(false);}}
 async function finish(data:Record<string,string>){
 const logo=atob(AUTHORIZATION_LOGO_JPEG);const bytes=kind==='venda'?authorizationPdf(data as AuthorizationData,new Date(),logo):rentalAuthorizationPdf(data as RentalAuthorizationData,new Date(),logo);
 const pdf=btoa(typeof bytes==='string'?bytes:String.fromCharCode(...new Uint8Array(bytes)));
 // Rendering succeeds before consuming the individual link. Same attempt can retry a lost response.
 const value=access.owner||access.token?await finishRecipientAuthorization(await ensureToken(),operation.current):{kind,issuedAt:Date.now(),completed:true,data:null,pdf:null};
 const local={...value,data,pdf};setRecord(local);return local;
 }

 function reset(){if(!isOwner)return;token.current=null;operation.current=crypto.randomUUID();pending.current=null;setRecord(null);setLink('');setError('');}
 return {ready,error,isOwner,record,link,busy,prepare,finish,reset};
}

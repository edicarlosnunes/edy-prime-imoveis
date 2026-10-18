export type StandaloneKind='venda'|'locacao';
export type StandaloneRecord={kind:StandaloneKind;issuedAt:number;completed:boolean;data:Record<string,string>|null;pdf:string|null};
export function authorizationAccess(hash:string){const p=new URLSearchParams(hash.replace(/^#/,''));const valid=(v:string|null)=>v&&/^[a-f0-9]{64}$/.test(v)?v:null;return {owner:valid(p.get('particular')),token:valid(p.get('a'))};}
export function recipientAuthorizationUrl(origin:string,kind:StandaloneKind,token:string){if(!/^[a-f0-9]{64}$/.test(token))throw Error('Código de autorização inválido.');return `${origin}/${kind==='venda'?'autorizar':'locacao'}#a=${token}`;}
async function request(path:string,headers:Record<string,string>,body?:unknown){let response:Response;
 try{response=await fetch('/api/standalone-authorizations/'+path,{method:body===undefined?'GET':'POST',headers:{...headers,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),cache:'no-store'});}catch{throw Error('Falha de conexão. Seus dados continuam na ficha; tente novamente.');}
 let value;try{value=await response.json();}catch{throw Error('O serviço está indisponível. Seus dados continuam na ficha; tente novamente.');}
 if(!response.ok){throw Error(value.error||'Não foi possível acessar a autorização. Tente novamente.');}return value;
}
export const checkAuthorizationOwner=(owner:string)=>request('owner',{'x-authorization-owner':owner}) as Promise<{kind:StandaloneKind}>;
export const prepareRecipientAuthorization=(owner:string)=>request('new',{'x-authorization-owner':owner},{}) as Promise<{token:string;kind:StandaloneKind}>;
export const readRecipientAuthorization=(token:string)=>request('record',{'x-authorization-document':token}) as Promise<StandaloneRecord>;
export const finishRecipientAuthorization=(token:string,operation:string)=>request('complete',{'x-authorization-document':token},{operation}) as Promise<StandaloneRecord>;

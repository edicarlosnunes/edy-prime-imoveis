import {createHash,randomBytes} from 'node:crypto';
import type {Client} from '@libsql/client';
export type AuthorizationKind='venda'|'locacao';
export const hashAuthorizationKey=(key:string)=>createHash('sha256').update(key).digest('hex');
// Only random capability hashes and usage metadata. No fields, CPF, address or PDF.
export function standaloneAuthorizationStore(client:Pick<Client,'execute'>){
 const ready=()=>client.execute('CREATE TABLE IF NOT EXISTS standalone_authorization_usage_v1 (token_hash TEXT PRIMARY KEY,kind TEXT NOT NULL,issued_at INTEGER NOT NULL,completed_at INTEGER,completion_hash TEXT)');
 const read=async(token:string)=>{await ready();const r=await client.execute({sql:'SELECT kind,issued_at,completed_at FROM standalone_authorization_usage_v1 WHERE token_hash=?',args:[hashAuthorizationKey(token)]});const row=r.rows[0];return row?{kind:row.kind as AuthorizationKind,issuedAt:Number(row.issued_at),completed:row.completed_at!==null,data:null,pdf:null}:null;};
 const archiveReady=()=>client.execute(`CREATE TABLE IF NOT EXISTS standalone_authorization_submissions_v1 (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 token_hash TEXT NOT NULL UNIQUE,
 kind TEXT NOT NULL,
 data_json TEXT NOT NULL,
 pdf_base64 TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pre_cadastro',
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
 )`);
 const archive=async(token:string,operation:string,data:Record<string,string>,pdf:string)=>{
   await archiveReady();
   const hash=hashAuthorizationKey(token);
   const usage=await client.execute({sql:'SELECT kind,completed_at,completion_hash FROM standalone_authorization_usage_v1 WHERE token_hash=?',args:[hash]});
   const row=usage.rows[0];
   if(!row||row.completed_at===null||row.completion_hash!==hashAuthorizationKey(operation))throw Error('Autorização ainda não concluída.');
   await client.execute({sql:'INSERT INTO standalone_authorization_submissions_v1(token_hash,kind,data_json,pdf_base64,created_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(token_hash) DO NOTHING',args:[hash,String(row.kind),JSON.stringify(data),pdf,Date.now(),Date.now()]});
 };
 const listSubmissions=async()=>{
   await archiveReady();
   const rows=await client.execute('SELECT id,kind,data_json,status,created_at FROM standalone_authorization_submissions_v1 ORDER BY created_at DESC LIMIT 200');
   return rows.rows.map(row=>({id:Number(row.id),kind:String(row.kind),data:JSON.parse(String(row.data_json)) as Record<string,string>,status:String(row.status),createdAt:Number(row.created_at)}));
 };
 const pdfSubmission=async(id:number)=>{
   await archiveReady();
   const rows=await client.execute({sql:'SELECT pdf_base64 FROM standalone_authorization_submissions_v1 WHERE id=?',args:[id]});
   return rows.rows[0]?String(rows.rows[0].pdf_base64):null;
 };
 const setReviewStatus=async(id:number,status:'pre_cadastro'|'em_analise'|'arquivado')=>{
   await archiveReady();
   return client.execute({sql:'UPDATE standalone_authorization_submissions_v1 SET status=?,updated_at=? WHERE id=?',args:[status,Date.now(),id]});
 };
 return {read,archive,listSubmissions,pdfSubmission,setReviewStatus,
 async create(kind:AuthorizationKind){await ready();const token=randomBytes(32).toString('hex');await client.execute({sql:'INSERT INTO standalone_authorization_usage_v1(token_hash,kind,issued_at) VALUES(?,?,?)',args:[hashAuthorizationKey(token),kind,Date.now()]});return token;},
 async complete(token:string,operation:string){await ready();const digest=hashAuthorizationKey(operation);const result=await client.execute({sql:'UPDATE standalone_authorization_usage_v1 SET completed_at=?,completion_hash=? WHERE token_hash=? AND completed_at IS NULL',args:[Date.now(),digest,hashAuthorizationKey(token)]});const record=await read(token);if(!record)return {status:'missing' as const};if(result.rowsAffected===1)return {status:'saved' as const,record};
 const previous=await client.execute({sql:'SELECT completion_hash FROM standalone_authorization_usage_v1 WHERE token_hash=?',args:[hashAuthorizationKey(token)]});return {status:previous.rows[0]?.completion_hash===digest?'saved' as const:'completed' as const,record};
 }};
}

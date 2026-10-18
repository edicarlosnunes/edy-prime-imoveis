import {createHash,randomBytes} from 'node:crypto';
import type {Client} from '@libsql/client';
export type AuthorizationKind='venda'|'locacao';
export const hashAuthorizationKey=(key:string)=>createHash('sha256').update(key).digest('hex');
// Only random capability hashes and usage metadata. No fields, CPF, address or PDF.
export function standaloneAuthorizationStore(client:Pick<Client,'execute'>){
 const ready=()=>client.execute('CREATE TABLE IF NOT EXISTS standalone_authorization_usage_v1 (token_hash TEXT PRIMARY KEY,kind TEXT NOT NULL,issued_at INTEGER NOT NULL,completed_at INTEGER,completion_hash TEXT)');
 const read=async(token:string)=>{await ready();const r=await client.execute({sql:'SELECT kind,issued_at,completed_at FROM standalone_authorization_usage_v1 WHERE token_hash=?',args:[hashAuthorizationKey(token)]});const row=r.rows[0];return row?{kind:row.kind as AuthorizationKind,issuedAt:Number(row.issued_at),completed:row.completed_at!==null,data:null,pdf:null}:null;};
 return {read,
 async create(kind:AuthorizationKind){await ready();const token=randomBytes(32).toString('hex');await client.execute({sql:'INSERT INTO standalone_authorization_usage_v1(token_hash,kind,issued_at) VALUES(?,?,?)',args:[hashAuthorizationKey(token),kind,Date.now()]});return token;},
 async complete(token:string,operation:string){await ready();const digest=hashAuthorizationKey(operation);const result=await client.execute({sql:'UPDATE standalone_authorization_usage_v1 SET completed_at=?,completion_hash=? WHERE token_hash=? AND completed_at IS NULL',args:[Date.now(),digest,hashAuthorizationKey(token)]});const record=await read(token);if(!record)return {status:'missing' as const};if(result.rowsAffected===1)return {status:'saved' as const,record};
 const previous=await client.execute({sql:'SELECT completion_hash FROM standalone_authorization_usage_v1 WHERE token_hash=?',args:[hashAuthorizationKey(token)]});return {status:previous.rows[0]?.completion_hash===digest?'saved' as const:'completed' as const,record};
 }};
}

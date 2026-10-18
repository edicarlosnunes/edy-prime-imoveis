import {test,expect} from 'bun:test';
import {createClient} from '@libsql/client';
import {Hono} from 'hono';
import {hashAuthorizationKey,standaloneAuthorizationStore} from '../lib/standalone-authorizations';
import {registerStandaloneAuthorizationRoutes} from './standalone-authorization-routes';
const saleKey='a'.repeat(64),rentalKey='b'.repeat(64);
const base={owner:'Pessoa de teste',document:'12345678900',phone:'13999990000',email:'',ownerAddress:'',propertyAddress:'Rua de Teste, 1, Praia Grande/SP',type:'Apartamento',bedrooms:'2',parking:'1',floors:'',price:'2.000,00',commission:'6',startDate:'2026-10-18',endDate:'2027-01-16',notes:'',city:'Praia Grande/SP',condominium:'450,00',iptu:'120,00'};
function setup(){const db=createClient({url:':memory:'});const store=standaloneAuthorizationStore(db);const app=new Hono();registerStandaloneAuthorizationRoutes(app,{store:async()=>store,ownerHashes:{venda:hashAuthorizationKey(saleKey),locacao:hashAuthorizationKey(rentalKey)}});return{db,store,app};}
const headers=(token:string)=>({'content-type':'application/json','x-authorization-document':token});
test('separate private links create unlimited independent sale and rental authorizations without CRM sessions',async()=>{
 const {db,app}=setup();
 expect((await app.request('/api/standalone-authorizations/new',{method:'POST',headers:{cookie:'epi_admin=some-session'},body:'{}'})).status).toBe(401);
 for(const key of [saleKey,rentalKey,saleKey]){const r=await app.request('/api/standalone-authorizations/new',{method:'POST',headers:{'x-authorization-owner':key},body:'{}'});expect(r.status).toBe(200);const value=await r.json();expect(value.kind).toBe(key===saleKey?'venda':'locacao');const read=await app.request('/api/standalone-authorizations/record',{headers:headers(value.token)});expect(await read.json()).toMatchObject({completed:false,data:null,pdf:null});}
 db.close();
});
test('single use persists across browsers without retaining any personal fields or PDF',async()=>{
 const {db,app,store}=setup();const token=await store.create('venda');const operation=crypto.randomUUID();
 const first=await app.request('/api/standalone-authorizations/complete',{method:'POST',headers:headers(token),body:JSON.stringify({operation})});expect(first.status).toBe(200);expect(await first.json()).toMatchObject({completed:true,data:null,pdf:null});
 const other=await app.request('/api/standalone-authorizations/complete',{method:'POST',headers:{...headers(token),'user-agent':'Other browser'},body:JSON.stringify({operation:crypto.randomUUID()})});expect(other.status).toBe(409);
 const retry=await app.request('/api/standalone-authorizations/complete',{method:'POST',headers:headers(token),body:JSON.stringify({operation})});expect(retry.status).toBe(200);
 const reopened=await app.request('/api/standalone-authorizations/record',{headers:{'x-authorization-document':token}});expect(await reopened.json()).toMatchObject({completed:true,data:null,pdf:null});expect(reopened.headers.get('cache-control')).toBe('no-store');
 const cols=await db.execute('PRAGMA table_info(standalone_authorization_usage_v1)');expect(cols.rows.map(r=>r.name)).toEqual(['token_hash','kind','issued_at','completed_at','completion_hash']);
 const serialized=JSON.stringify((await db.execute('SELECT * FROM standalone_authorization_usage_v1')).rows);expect(serialized).not.toContain(token);expect(serialized).not.toContain(operation);
 const next=await store.create('venda');expect((await store.read(next))?.completed).toBe(false);db.close();
});
test('concurrent attempts consume only once',async()=>{
 const {db,store}=setup();const token=await store.create('venda');const results=await Promise.all([store.complete(token,crypto.randomUUID()),store.complete(token,crypto.randomUUID())]);expect(results.map(r=>r.status).sort()).toEqual(['completed','saved']);db.close();
});
test('rejects personal data and failed connections leave a usable link',async()=>{
 const {db,store,app}=setup();const token=await store.create('locacao');
 const invalid=await app.request('/api/standalone-authorizations/complete',{method:'POST',headers:headers(token),body:JSON.stringify({operation:crypto.randomUUID(),data:base})});expect(invalid.status).toBe(400);expect((await store.read(token))?.completed).toBe(false);
 const failing=new Hono();registerStandaloneAuthorizationRoutes(failing,{store:async()=>({...store,complete:async()=>{throw Error('connection interrupted');}})});
 const failed=await failing.request('/api/standalone-authorizations/complete',{method:'POST',headers:headers(token),body:JSON.stringify({operation:crypto.randomUUID()})});expect(failed.status).toBe(503);expect((await store.read(token))?.completed).toBe(false);expect((await store.complete(token,crypto.randomUUID())).status).toBe('saved');db.close();
});
test('unknown links and incorrect private keys cannot mint or retrieve documents',async()=>{
 const {db,app}=setup();expect((await app.request('/api/standalone-authorizations/owner',{headers:{'x-authorization-owner':'c'.repeat(64)}})).status).toBe(401);
 expect((await app.request('/api/standalone-authorizations/record',{headers:headers('d'.repeat(64))})).status).toBe(404);db.close();
});

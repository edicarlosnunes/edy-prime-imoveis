import {test,expect} from 'bun:test';
import {createClient} from '@libsql/client';
import {Hono} from 'hono';
import {authorizationLinkStore,registerAuthorizationLinkRoutes} from './authorization-link-routes';
function setup(authorized=false){const db=createClient({url:':memory:'});const store=authorizationLinkStore(db);const app=new Hono();registerAuthorizationLinkRoutes(app,{store:async()=>store,session:async()=>authorized?{id:1,name:'Corretor',email:'teste@example.com',role:'admin'}:null});return {db,store,app};}
test('only authorized issuer can create links; generic and unknown tokens cannot read a form',async()=>{
 const {app,db}=setup();expect((await app.request('/api/authorization-links/create',{method:'POST',headers:{'content-type':'application/json'},body:'{"kind":"venda"}'})).status).toBe(401);
 expect((await app.request('/api/authorization-links/document')).status).toBe(400);
 expect((await app.request('/api/authorization-links/document',{headers:{'x-authorization-link':'a'.repeat(64)}})).status).toBe(404);db.close();
});
test('a completed link is immutable globally, even across concurrent completions',async()=>{
 const {store,db}=setup();const token=await store.create('venda');expect(token).toMatch(/^[a-f0-9]{64}$/);
 expect((await store.read(token))?.completed_at).toBeNull();
 const results=await Promise.all([store.complete(token,{owner:'Primeiro'},'PDF1'),store.complete(token,{owner:'Segundo'},'PDF2')]);
 expect(results.filter(Boolean)).toHaveLength(1);const frozen=await store.read(token);expect(frozen?.completed_at).toBeTruthy();expect(await store.complete(token,{owner:'Terceiro'},'PDF3')).toBe(false);
 expect((await store.read(token))?.data_json).toBe(frozen?.data_json);db.close();
});
test('issuer can create independent sale and rental links, with no CRM owner or property IDs',async()=>{
 const {app,db}=setup(true);const request=async(kind:string)=>{const r=await app.request('/api/authorization-links/create',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({kind})});expect(r.status).toBe(200);return r.json();};
 const sale=await request('venda'),rental=await request('locacao');expect(sale.token).not.toBe(rental.token);
 const r=await app.request('/api/authorization-links/document',{headers:{'x-authorization-link':rental.token}});expect(r.headers.get('cache-control')).toBe('no-store');expect(await r.json()).toMatchObject({kind:'locacao',completed:false,data:null,pdf:null});db.close();
});
test('completion route freezes canonical fields and rejects later changes from a different request',async()=>{
 const {app,store,db}=setup();const token=await store.create('locacao');
 const data={owner:'Pessoa teste',document:'12345678900',phone:'13999990000',propertyAddress:'Rua Teste, 1',type:'Casa',price:'2.000,00',commission:'Um aluguel na assinatura',startDate:'2026-10-17',endDate:'2027-01-15',city:'Praia Grande/SP',notes:'',condominium:'450,00',iptu:'120,00'};
 const send=()=>app.request('/api/authorization-links/complete',{method:'POST',headers:{'content-type':'application/json','x-authorization-link':token},body:JSON.stringify({data,logo:'/9j/2Q=='})});
 const first=await send();expect(first.status).toBe(200);expect((await first.json()).pdf).toStartWith('JVBERi0');
 expect((await send()).status).toBe(409);
 const reopened=await app.request('/api/authorization-links/document',{headers:{'x-authorization-link':token}});const result=await reopened.json();expect(result.completed).toBe(true);expect(result.data.owner).toBe('Pessoa teste');expect(result.data.condominium).toBe('450,00');expect(result.data.iptu).toBe('120,00');db.close();
});

import {test,expect} from 'bun:test';
import {JSDOM} from 'jsdom';
import {Hono} from 'hono';
import {createClient} from '@libsql/client';
import {hashAuthorizationKey,standaloneAuthorizationStore} from '../../api/lib/standalone-authorizations';
import {registerStandaloneAuthorizationRoutes} from '../../api/http/standalone-authorization-routes';

test('simulated UI: owner prepares links, completes for a client and starts a fresh form; recipient reopens read-only',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'https://qa.test/autorizar#particular='+ 'a'.repeat(64)});
 const names=['window','document','location','history','HTMLInputElement','HTMLSelectElement','HTMLTextAreaElement','HTMLElement'];const originals=new Map<string,PropertyDescriptor|undefined>();
 for(const name of names){originals.set(name,Object.getOwnPropertyDescriptor(globalThis,name));Object.defineProperty(globalThis,name,{configurable:true,writable:true,value:(dom.window as any)[name]});}
 const originalFetch=globalThis.fetch;const originalRaf=globalThis.requestAnimationFrame;const actOriginal=(globalThis as any).IS_REACT_ACT_ENVIRONMENT;(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
 globalThis.requestAnimationFrame=(cb)=>{cb(0);return 1;};(dom.window.HTMLElement.prototype as any).scrollIntoView=()=>{};
 const db=createClient({url:':memory:'});const store=standaloneAuthorizationStore(db);const app=new Hono();registerStandaloneAuthorizationRoutes(app,{store:async()=>store,ownerHashes:{venda:hashAuthorizationKey('a'.repeat(64)),locacao:hashAuthorizationKey('b'.repeat(64))}});
 let failComplete=false;globalThis.fetch=((input:any,init:any)=>{if(failComplete&&String(input).endsWith('/complete')){failComplete=false;return Promise.reject(new TypeError('network disconnected'));}return app.request(new Request(new URL(String(input),'https://qa.test'),init));}) as typeof fetch;
 const {act}=await import('react');const {createRoot}=await import('react-dom/client');const {default:Sale}=await import('../pages/autorizacao-venda');
 let root=createRoot(dom.window.document.getElementById('root')!);
 const settle=async()=>{await act(async()=>{await new Promise(r=>setTimeout(r,20));});};
 const button=(text:string)=>Array.from(dom.window.document.querySelectorAll('button')).find(b=>b.textContent?.includes(text))!;
 async function click(text:string){const el=button(text);expect(el).toBeTruthy();await act(async()=>el.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true})));await settle();}
 try{
 await act(async()=>root.render(<Sale/>));await settle();expect(dom.window.document.body.textContent).toContain('Seu atalho particular de venda');
 await click('Preparar link para enviar');const link=(dom.window.document.querySelector('input[readonly]') as HTMLInputElement).value;expect(link).toContain('#a=');expect(link).not.toContain('particular');const token=new URLSearchParams(new URL(link).hash.slice(1)).get('a')!;
 // Fill and submit the actual owner form; a failed connection must preserve it for retry.
 async function fill(name:string,value:string){const el=dom.window.document.querySelector(`[name="${name}"]`) as HTMLInputElement;const prototype=el.tagName==='SELECT'?dom.window.HTMLSelectElement.prototype:dom.window.HTMLInputElement.prototype;await act(async()=>{Object.getOwnPropertyDescriptor(prototype,'value')!.set!.call(el,value);el.dispatchEvent(new dom.window.Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));});}
 for(const [name,value] of Object.entries({owner:'Pessoa teste',document:'12345678900',phone:'13999990000',propertyAddress:'Rua Teste, 1',type:'Casa',price:'2.000,00',city:'Praia Grande/SP'}))await fill(name,value);
 await act(async()=>{(dom.window.document.querySelector('input[name="reviewed"]') as HTMLInputElement).click();});
 failComplete=true;await click('Concluir e preparar PDF');expect(dom.window.document.body.textContent).toContain('Falha de conexão');expect((dom.window.document.querySelector('input[name="owner"]') as HTMLInputElement).value).toBe('Pessoa teste');expect((dom.window.document.querySelector('fieldset') as HTMLFieldSetElement).disabled).toBe(false);
 await click('Concluir e preparar PDF');expect((await store.read(token))?.completed).toBe(true);expect((await store.read(token))?.data).toBeNull();expect((dom.window.document.querySelector('fieldset') as HTMLFieldSetElement).disabled).toBe(true);
 const events:string[]=[];(dom.window as any).open=()=>{events.push('gov');return {opener:null};};
 Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>true});Object.defineProperty(navigator,'share',{configurable:true,value:async()=>{events.push('save-dialog');}});
 await click('Salvar PDF em Arquivos');expect(events).toEqual(['save-dialog','gov']);
 events.length=0;Object.defineProperty(navigator,'share',{configurable:true,value:async()=>{throw new DOMException('Cancelled','AbortError');}});await click('Salvar PDF em Arquivos');expect(events).toEqual([]);
 (dom.window as any).showSaveFilePicker=async()=>({createWritable:async()=>({write:async(file:File)=>{expect(file.name).toBe('Autorizacao-de-venda-E-Santos.pdf');events.push('write');},close:async()=>events.push('close')})});
 await click('Salvar PDF em Arquivos');expect(events).toEqual(['write','close','gov']);
 delete (navigator as any).canShare;delete (navigator as any).share;
 await act(async()=>root.unmount());dom.window.history.replaceState(null,'',link);root=createRoot(dom.window.document.getElementById('root')!);await act(async()=>root.render(<Sale/>));await settle();
 expect(dom.window.document.body.textContent).toContain('Autorização já concluída');expect(dom.window.document.querySelector('form')).toBeNull();expect(dom.window.document.body.textContent).not.toContain('Pessoa teste');
 // Reopening the private bookmark remains free to prepare another blank authorization.
 await act(async()=>root.unmount());dom.window.history.replaceState(null,'','/autorizar#particular='+'a'.repeat(64));root=createRoot(dom.window.document.getElementById('root')!);await act(async()=>root.render(<Sale/>));await settle();
 expect((dom.window.document.querySelector('input[name="owner"]') as HTMLInputElement).value).toBe('');expect((dom.window.document.querySelector('fieldset') as HTMLFieldSetElement).disabled).toBe(false);await click('Preparar link para enviar');const newLink=(dom.window.document.querySelector('input[readonly]') as HTMLInputElement).value;expect(newLink).not.toBe(link);await click('Nova autorização de venda');expect(dom.window.document.querySelector('input[readonly]')).toBeNull();expect((dom.window.document.querySelector('input[name="reviewed"]') as HTMLInputElement).checked).toBe(false);
 }finally{await act(async()=>root.unmount());globalThis.fetch=originalFetch;globalThis.requestAnimationFrame=originalRaf;(globalThis as any).IS_REACT_ACT_ENVIRONMENT=actOriginal;for(const name of names){const descriptor=originals.get(name);if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete(globalThis as any)[name];}db.close();dom.window.close();}
});

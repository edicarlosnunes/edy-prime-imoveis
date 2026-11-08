import {useCallback,useEffect,useState} from "react";
import {FileCheck,RefreshCw} from "lucide-react";

type Received={id:number;kind:string;status:string;createdAt:number;data:Record<string,string>};
type Status="pre_cadastro"|"em_analise"|"arquivado";
const names:Record<Status,string>={pre_cadastro:"Pré-cadastro / recebida",em_analise:"Em análise",arquivado:"Arquivada"};
export function ReceivedAuthorizations(){
 const [rows,setRows]=useState<Received[]>([]);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const reload=useCallback(async()=>{
  setBusy(true);setError("");
  try{
   const response=await fetch("/api/admin/captacao/autorizacoes-recebidas",{credentials:"same-origin",cache:"no-store"});
   const value=await response.json().catch(()=>({}));
   if(!response.ok)throw Error(value.error||"Não foi possível carregar as autorizações.");
   setRows(value.rows||[]);
  }catch(e){setError(e instanceof Error?e.message:"Erro ao carregar autorizações.");}
  finally{setBusy(false);}
 },[]);
 useEffect(()=>{void reload();},[reload]);
 async function changeStatus(id:number,status:Status){
  setBusy(true);setError("");
  try{
   const response=await fetch(`/api/admin/captacao/autorizacoes-recebidas/${id}/revisao`,{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify({status})});
   const data=await response.json().catch(()=>({}));
   if(!response.ok)throw Error(data.error||"Falha ao atualizar.");
   await reload();
  }catch(e){setError(e instanceof Error?e.message:"Falha ao atualizar.");}
  finally{setBusy(false);}
 }
 return <section id="autorizacoes-recebidas" className="rounded-xl border border-line bg-white p-4 text-deep">
  <div className="flex flex-wrap items-center justify-between gap-3">
   <div><h2 className="flex items-center gap-2 text-lg font-semibold"><FileCheck className="h-5 w-5"/>Autorizações de venda recebidas</h2>
   <p className="mt-1 text-sm text-muted">Pré-cadastro privado. Documentos preenchidos aguardam sua análise; não criam imóvel nem representam assinatura.</p></div>
   <button type="button" onClick={()=>void reload()} disabled={busy} className="flex items-center gap-2 rounded border border-line px-3 py-2 text-sm"><RefreshCw className="h-4 w-4"/>Atualizar</button>
  </div>
  {error&&<p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
  {rows.length===0&&!busy&&<p className="mt-4 text-sm text-muted">Nenhuma autorização recebida automaticamente até agora. Links anteriores podem exigir devolução manual do PDF.</p>}
  <div className="mt-4 space-y-3">{rows.map(r=><article key={r.id} className="rounded border border-line p-3">
   <div className="flex flex-wrap justify-between gap-2"><div><b>{r.data.owner||"Proprietário não informado"}</b><p className="text-xs text-muted">#{r.id} · {new Date(r.createdAt).toLocaleString("pt-BR")} · {names[r.status as Status]||r.status}</p></div>
   <a className="rounded border border-line px-3 py-2 text-sm underline" href={`/api/admin/captacao/autorizacoes-recebidas/${r.id}/pdf`}>Baixar PDF preenchido</a></div>
   <p className="mt-2 text-sm">{r.data.propertyAddress||"Endereço não informado"}</p>
   <p className="mt-1 text-sm text-muted">Telefone: {r.data.phone||"—"} · Tipo: {r.data.type||"—"} · Preço autorizado: R$ {r.data.price||"—"}</p>
   <p className="mt-2 text-xs text-muted">O documento preenchido ainda precisa de assinatura, devolução e validação. Confira o proprietário antes de vinculá-lo a um imóvel.</p>
   <label className="mt-3 flex max-w-xs flex-col gap-1 text-xs">Acompanhamento
    <select disabled={busy} className="rounded border border-line bg-white p-2 text-sm" value={r.status} onChange={e=>void changeStatus(r.id,e.target.value as Status)}>
     {Object.entries(names).map(([value,label])=><option key={value} value={value}>{label}</option>)}
    </select>
   </label>
  </article>)}</div>
 </section>;
}

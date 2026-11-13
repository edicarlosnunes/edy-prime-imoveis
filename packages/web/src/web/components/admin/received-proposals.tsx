import {useCallback,useEffect,useState} from 'react';
import {FileText,RefreshCw} from 'lucide-react';
import type {PurchaseProposal} from '../../lib/purchase-proposal';

type Entry={id:number;data:PurchaseProposal;status:string;createdAt:number};
export function ReceivedProposals(){
 const [rows,setRows]=useState<Entry[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const refresh=useCallback(async()=>{setBusy(true);setError('');
  try{const r=await fetch('/api/proposta/admin/recebidas',{credentials:'same-origin',cache:'no-store'});const value=await r.json().catch(()=>({}));if(!r.ok)throw Error(value.error||'Erro ao carregar propostas.');setRows(value.rows||[]);}
  catch(e){setError(e instanceof Error?e.message:'Erro ao consultar propostas.');}finally{setBusy(false);}
 },[]);
 useEffect(()=>{void refresh();},[refresh]);
 return <section id="propostas-recebidas" className="rounded-xl border border-line bg-white p-4 text-deep">
  <div className="flex flex-wrap items-center justify-between gap-3">
   <div><h2 className="flex items-center gap-2 text-lg font-semibold"><FileText className="h-5 w-5"/>Propostas e dados de compradores recebidos</h2>
    <p className="mt-1 text-sm text-muted">Recebidos diretamente de /proposta no CRM. Campos pendentes precisam de conferência antes de formalizar ou solicitar assinatura.</p></div>
   <button type="button" onClick={()=>void refresh()} disabled={busy} className="flex items-center gap-2 rounded border border-line px-3 py-2 text-sm"><RefreshCw className="h-4 w-4"/>Atualizar recebimentos</button>
  </div>
  {error&&<p role="alert" className="mt-3 text-red-700">{error}</p>}
  {!busy&&rows.length===0&&<p className="mt-4 text-sm text-muted">Nenhuma proposta recebida neste novo fluxo. PDFs gerados anteriormente apenas no celular não foram enviados automaticamente.</p>}
  <div className="mt-4 space-y-3">{rows.map(row=><article key={row.id} className="rounded border border-line p-3">
    <div className="flex flex-wrap justify-between gap-3"><div>
     <p className="font-semibold">{row.data.buyer.name||'Comprador sem nome'}</p>
     <p className="text-xs text-muted">Protocolo #{row.id} · {new Date(row.createdAt).toLocaleString('pt-BR')} · Recebida para análise</p>
    </div><a href={`/api/proposta/admin/recebidas/${row.id}/pdf`} className="rounded border border-line px-3 py-2 text-sm underline">Baixar proposta em PDF</a></div>
    <div className="mt-3 grid gap-1 text-sm sm:grid-cols-2">
     <p>Telefone: <b>{row.data.buyer.phone||'—'}</b></p>
     <p>CPF: {row.data.buyer.cpf||'Pendente'}</p>
     <p>E-mail: {row.data.buyer.email||'Não informado'}</p>
     <p>Vendedor: {row.data.seller.name||'Pendente'}</p>
     <p>Imóvel: {row.data.propertyAddress||row.data.propertyCode||'Pendente'}</p>
     <p>Valor oferecido: {row.data.amount?'R$ '+row.data.amount:'Pendente'}</p>
    </div>
    <p className="mt-2 text-xs text-muted">Recebimento de dados não significa proposta aceita nem documento assinado. Confira os dados e condições antes de encaminhar ao vendedor.</p>
   </article>)}</div>
 </section>;
}

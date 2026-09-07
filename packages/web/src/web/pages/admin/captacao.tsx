import { useMemo, useState } from "react";
import { Plus, Phone, MessageCircle, FileText, Building2 } from "lucide-react";
import { useLocation } from "wouter";
import { AdminGuard } from "../../components/admin/guard";
import { AdminLayout } from "../../components/admin/layout";
import { Badge, Btn, Card, Field, Input, Modal, Select, Stat, Textarea, dateTimeLabel, money, waLink } from "../../components/admin/ui";
import { errorMessage } from "../../lib/admin-session";
import { formatMoneyInput, parseMoneyInput } from "../../lib/money-input";
import { CHECKLIST_GROUPS, CHECKLIST_GROUP_LABELS, CHECKLIST_ITEMS, checklistProgress, documentRequestMessage, parseChecklist } from "../../../api/lib/capture-checklist";
import { normalizeDocStatus } from "../../../api/lib/capture-rules";
import { useAdminCaptures, useCapture, useCreateCapture, useMarkCaptureLost, useReopenCapture, useSetCaptureDocStatus, useSetCaptureNextAction, useSetCaptureStage, useSaveCaptureAppraisal, useMarkCaptureConverted, useSetCaptureChecklist } from "../../queries/admin";

const CITIES = ["Praia Grande","Mongaguá","Itanhaém","Peruíbe","Guarujá","Santos","São Vicente","Cubatão"];
const STAGES = [
  ["novo_contato","NOVO CONTATO"],
  ["avaliacao","AVALIAÇÃO"],
  ["documentacao","DOCUMENTAÇÃO"],
  ["captado","CAPTADO"],
] as const;

type Stage = (typeof STAGES)[number][0] | "perdido";

/* `pendente` e legado no banco e nao e reescrito: le como "solicitado". */
const DOC_OPTIONS = [
  ["nao_iniciado","Não iniciado"],
  ["solicitado","Solicitado"],
  ["parcial","Parcial"],
  ["completo","Completo"],
] as const;
const DOC_LABELS: Record<string,string> = Object.fromEntries(DOC_OPTIONS);
const CRECI = "134718-F";

export default function Captacao() { return <AdminGuard><Content /></AdminGuard>; }

function Content() {
  const [search, setSearch] = useState("");
  const [city, setCity] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const filters = useMemo(() => ({ search: search || undefined, city: city || undefined }), [search, city]);
  const { data = [] } = useAdminCaptures(filters);
  const active = data.filter((x) => x.stage !== "perdido");
  const lost = data.filter((x) => x.stage === "perdido");
  const overdue = active.filter((x) => x.nextActionAt && new Date(x.nextActionAt).getTime() < Date.now()).length;
  return <AdminLayout title="Radar de Captação" subtitle="Proprietários e imóveis antes de entrarem na carteira" actions={<Btn tone="brass" onClick={() => setNewOpen(true)}><Plus className="h-4 w-4"/> Nova captação</Btn>}>
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Stat label="Ativas" value={active.length}/><Stat label="Captadas" value={active.filter(x=>x.stage==="captado").length}/><Stat label="Atrasadas" value={overdue}/><Stat label="Perdidas" value={lost.length}/></div>
      <Card><div className="grid gap-3 md:grid-cols-[1fr_220px]"><Input placeholder="Buscar proprietário, telefone, bairro..." value={search} onChange={e=>setSearch(e.target.value)}/><Select value={city} onChange={e=>setCity(e.target.value)}><option value="">Todas as regiões</option>{CITIES.map(c=><option key={c}>{c}</option>)}</Select></div></Card>
      <div className="grid gap-4 xl:grid-cols-4">{STAGES.map(([key,label])=><Card key={key} title={`${label} · ${active.filter(x=>x.stage===key).length}`}><div className="space-y-3">{active.filter(x=>x.stage===key).map(c=><button key={c.id} onClick={()=>setSelected(c.id)} className="w-full rounded border border-line bg-bone/30 p-3 text-left hover:bg-bone/60"><div className="font-medium text-deep">{c.owner?.name ?? `Proprietário #${c.ownerId}`}</div><div className="mt-1 text-xs text-muted">{c.propertyType || "Imóvel"} · {c.district || c.city}</div><div className="mt-1 text-sm">{money(c.askingPrice)}</div>{c.nextAction && <div className="mt-2 text-[11px] text-muted">{c.nextAction} · {dateTimeLabel(c.nextActionAt)}</div>}</button>)}</div></Card>)}</div>
      {lost.length>0 && <Card title={`Arquivo de perdidos · ${lost.length}`}><div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">{lost.map(c=><button key={c.id} onClick={()=>setSelected(c.id)} className="rounded border border-line p-3 text-left"><b>{c.owner?.name}</b><div className="text-xs text-muted">{c.lostReason || "Motivo não informado"}</div></button>)}</div></Card>}
    </div>
    <NewCapture open={newOpen} onClose={()=>setNewOpen(false)} onCreated={(id)=>{setNewOpen(false);setSelected(id)}}/>
    <Detail id={selected} onClose={()=>setSelected(null)}/>
  </AdminLayout>;
}

function NewCapture({open,onClose,onCreated}:{open:boolean;onClose:()=>void;onCreated:(id:number)=>void}) {
  const create = useCreateCapture(); const [error,setError]=useState<string|null>(null);
  const [f,setF]=useState({ownerName:"",ownerPhone:"",ownerEmail:"",city:"Praia Grande",district:"",address:"",propertyType:"apartamento",askingPrice:"",source:"manual",intention:"venda",notes:""});
  async function save(){setError(null);try{const r=await create.mutateAsync({ownerName:f.ownerName,ownerPhone:f.ownerPhone,ownerEmail:f.ownerEmail||null,city:f.city,district:f.district||null,address:f.address||null,propertyType:f.propertyType,askingPrice:parseMoneyInput(f.askingPrice,"Valor pretendido"),source:f.source,intention:f.intention,notes:f.notes||null});onCreated(r.id)}catch(e){setError(errorMessage(e,"Não foi possível criar a captação"))}}
  return <Modal open={open} onClose={onClose} title="Nova captação" wide><div className="grid gap-3 md:grid-cols-2"><Field label="Proprietário"><Input value={f.ownerName} onChange={e=>setF({...f,ownerName:e.target.value})}/></Field><Field label="WhatsApp"><Input value={f.ownerPhone} onChange={e=>setF({...f,ownerPhone:e.target.value})}/></Field><Field label="E-mail"><Input value={f.ownerEmail} onChange={e=>setF({...f,ownerEmail:e.target.value})}/></Field><Field label="Região"><Select value={f.city} onChange={e=>setF({...f,city:e.target.value})}>{CITIES.map(c=><option key={c}>{c}</option>)}</Select></Field><Field label="Bairro"><Input value={f.district} onChange={e=>setF({...f,district:e.target.value})}/></Field><Field label="Endereço aproximado"><Input value={f.address} onChange={e=>setF({...f,address:e.target.value})}/></Field><Field label="Tipo"><Input value={f.propertyType} onChange={e=>setF({...f,propertyType:e.target.value})}/></Field><Field label="Valor pretendido"><Input inputMode="numeric" value={f.askingPrice} onChange={e=>setF({...f,askingPrice:e.target.value})}/></Field><Field label="Origem"><Select value={f.source} onChange={e=>setF({...f,source:e.target.value})}><option value="manual">Manual</option><option value="site">Site</option><option value="whatsapp">WhatsApp</option><option value="indicacao">Indicação</option><option value="instagram">Instagram</option><option value="facebook">Facebook</option><option value="placa">Placa</option><option value="portal">Portal</option><option value="outro">Outro</option></Select></Field><Field label="Intenção"><Select value={f.intention} onChange={e=>setF({...f,intention:e.target.value})}><option value="venda">Venda</option><option value="locacao">Locação</option><option value="venda_locacao">Venda ou locação</option></Select></Field><Field label="Observações" className="md:col-span-2"><Textarea value={f.notes} onChange={e=>setF({...f,notes:e.target.value})}/></Field></div>{error&&<p className="mt-3 text-sm text-red-700">{error}</p>}<div className="mt-5 flex justify-end gap-2"><Btn tone="outline" onClick={onClose}>Cancelar</Btn><Btn tone="brass" onClick={save} disabled={create.isPending}>Salvar captação</Btn></div></Modal>
}

function Detail({id,onClose}:{id:number|null;onClose:()=>void}) {
  const q=useCapture(id); const setStage=useSetCaptureStage(); const next=useSetCaptureNextAction(); const appraisal=useSaveCaptureAppraisal(); const docs=useSetCaptureDocStatus(); const checkItem=useSetCaptureChecklist(); const lost=useMarkCaptureLost(); const reopen=useReopenCapture(); const converted=useMarkCaptureConverted(); const [,navigate]=useLocation();
  const c=q.data; if(!c) return <Modal open={id!==null} onClose={onClose} title="Captação">Carregando...</Modal>;
  async function run(p:Promise<unknown>){try{await p}catch(e){alert(errorMessage(e,"Não foi possível concluir"))}}
  const checklist=parseChecklist(c.notes);
  const progress=checklistProgress(checklist.done);
  const docValue=normalizeDocStatus(c.docStatus);
  const docRequest=documentRequestMessage({ownerName:c.owner?.name??null,done:checklist.done,creci:CRECI});
  function nextAction(){const title=prompt("Próxima ação:",c.nextAction||"Retornar proprietário");if(!title)return;const due=prompt("Data/hora (AAAA-MM-DDTHH:MM):",new Date(Date.now()+2*3600000).toISOString().slice(0,16));if(due)run(next.mutateAsync({id:c.id,title,dueAt:due}))}
  function saveAppraisal(){const v=prompt("Valor estimado da avaliação (ex.: 480 mil ou 480.000,00):",formatMoneyInput(c.estimatedPrice)); if(v===null)return; let estimatedPrice:number|null=null; try{estimatedPrice=parseMoneyInput(v,"Valor estimado")}catch(e){alert(errorMessage(e,"Valor estimado inválido"));return} run(appraisal.mutateAsync({id:c.id,estimatedPrice,note:null}))}
  function markLost(){const reason=prompt("Motivo da perda:");if(reason)run(lost.mutateAsync({id:c.id,reason,detail:null}))}
  /* CAPTADO nao e mais manual: quem marca e a criacao do imovel no Cadastro
     Premium, que volta pela rota com capture_id. Sair sem criar imovel deixa a
     captacao em DOCUMENTACAO. */
  function goToProperty(){navigate(`/admin/imoveis/novo?capture_id=${c.id}`)}
  return <Modal open={id!==null} onClose={onClose} title={`Captação #${c.id}`} wide><div className="space-y-4"><div className="flex flex-wrap gap-2"><Badge tone={c.stage==="captado"?"green":c.stage==="perdido"?"red":"brass"}>{c.stage}</Badge><Badge>{DOC_LABELS[normalizeDocStatus(c.docStatus)]??c.docStatus}</Badge></div><div className="grid gap-4 md:grid-cols-2"><Card title="Proprietário"><b>{c.owner?.name}</b><div className="mt-2 text-sm text-muted">{c.owner?.phone}</div><div className="mt-3 flex gap-2"><a href={`tel:${c.owner?.phone||""}`}><Btn tone="outline"><Phone className="h-4 w-4"/>Ligar</Btn></a>{c.owner?.phone&&<a href={waLink(c.owner.phone)} target="_blank" rel="noreferrer"><Btn tone="outline"><MessageCircle className="h-4 w-4"/>WhatsApp</Btn></a>}</div></Card><Card title="Imóvel"><div>{c.propertyType||"—"} · {c.district||c.city}</div><div className="mt-1 text-xl">{money(c.askingPrice)}</div><div className="text-xs text-muted">{c.address||""}</div></Card></div><Card title="Próxima ação"><div className="text-sm">{c.nextAction||"Sem próxima ação"} · {dateTimeLabel(c.nextActionAt)}</div><Btn className="mt-3" tone="outline" onClick={nextAction}>Agendar / reagendar</Btn></Card><Card title="Avaliação"><div className="text-sm">Estimativa: {money(c.estimatedPrice)}</div><Btn className="mt-3" tone="outline" onClick={saveAppraisal}>Registrar avaliação</Btn></Card><Card title={`Documentação · ${progress.done}/${progress.total}`}><div className="space-y-4"><Select value={docValue} onChange={e=>run(docs.mutateAsync({id:c.id,docStatus:e.target.value as any}))} disabled={docs.isPending}>{DOC_OPTIONS.map(([value,label])=><option key={value} value={value}>{label}</option>)}</Select><div className="grid gap-3 md:grid-cols-2">{CHECKLIST_GROUPS.map(group=><div key={group}><div className="text-xs font-semibold tracking-wide text-muted">{CHECKLIST_GROUP_LABELS[group]}</div><div className="mt-2 space-y-2">{CHECKLIST_ITEMS.filter(item=>item.group===group).map(item=><label key={item.key} className="flex items-start gap-2 text-sm text-deep"><input type="checkbox" className="mt-1 h-4 w-4" checked={checklist.done.includes(item.key)} disabled={checkItem.isPending} onChange={e=>run(checkItem.mutateAsync({id:c.id,key:item.key,value:e.target.checked}))}/><span>{item.label}</span></label>)}</div></div>)}</div><div className="flex flex-wrap gap-2"><Btn tone="outline" disabled={docs.isPending||docValue!=="nao_iniciado"} onClick={()=>run(docs.mutateAsync({id:c.id,docStatus:"solicitado"}))}><FileText className="h-4 w-4"/>Solicitar documentos</Btn>{c.owner?.phone&&<a href={waLink(c.owner.phone,docRequest)} target="_blank" rel="noreferrer"><Btn tone="outline"><MessageCircle className="h-4 w-4"/>Pedir por WhatsApp</Btn></a>}</div></div></Card><Card title="Etapa"><div className="flex flex-wrap gap-2">{STAGES.filter(([key])=>key!=="captado").map(([key,label])=><Btn key={key} tone={c.stage===key?"brass":"outline"} disabled={setStage.isPending||c.stage===key} onClick={()=>{if(c.stage===key||setStage.isPending)return;run(setStage.mutateAsync({id:c.id,stage:key}))}}>{label}</Btn>)}</div></Card><div className="flex flex-wrap gap-2">{c.stage==="perdido"?<Btn onClick={()=>run(reopen.mutateAsync({id:c.id}))}>Reabrir</Btn>:<Btn tone="danger" onClick={markLost}>Marcar perdido</Btn>}{!c.convertedPropertyId&&c.stage!=="perdido"&&<Btn tone="brass" onClick={goToProperty}><Building2 className="h-4 w-4"/>Cadastrar imóvel e captar</Btn>}{c.convertedPropertyId&&<Badge tone="green">Imóvel #{c.convertedPropertyId}</Badge>}</div>{c.history?.length>0&&<Card title="Histórico"><div className="space-y-2">{c.history.map(h=><div key={h.id} className="border-b border-line pb-2 text-xs"><b>{h.action}</b> · {dateTimeLabel(h.createdAt)}<div className="text-muted">{h.detail||""}</div></div>)}</div></Card>}</div></Modal>
}

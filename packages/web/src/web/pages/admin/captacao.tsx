import { useMemo, useState } from "react";
import { Plus, Phone, MessageCircle, FileText, Building2 } from "lucide-react";
import { useLocation } from "wouter";
import { AdminGuard } from "../../components/admin/guard";
import { AdminLayout } from "../../components/admin/layout";
import { Badge, Btn, Card, Field, Input, Modal, Select, Stat, Textarea, dateTimeLabel, money, waLink } from "../../components/admin/ui";
import { errorMessage, uploadImage } from "../../lib/admin-session";
import { docLabel, formatDoc } from "../../../api/lib/person-doc";
import { formatMoneyInput, parseMoneyInput } from "../../lib/money-input";
import { CHECKLIST_GROUPS, CHECKLIST_GROUP_LABELS, CHECKLIST_ITEMS, checklistProgress, documentRequestMessage, parseChecklist } from "../../../api/lib/capture-checklist";
import { checkConversionStart, hasValidAppraisal, normalizeDocStatus, normalizeStage, stageLabel } from "../../../api/lib/capture-rules";
import { COMPLEMENT_FIELDS, formatCep, formatUnitAddress, isValidCep } from "../../../api/lib/capture-address";
import { lookupCep } from "../../../api/lib/cep-lookup";
import { parseComplements } from "../../../api/lib/capture-intake";
import { PROVISIONAL_LABEL, parseOwnerPhotos } from "../../../api/lib/capture-photos";
import { DOC_KIND_LABELS, DOC_TRACK_LABELS } from "../../../api/lib/capture-documents";
import { useAdminCaptures, useCapture, useCreateCapture, useMarkCaptureLost, useReopenCapture, useSetCaptureDocStatus, useSetCaptureNextAction, useSetCaptureStage, useSaveCaptureAppraisal, useMarkCaptureConverted, useSetCaptureChecklist, useAddCapturePhotos, useRemoveCapturePhoto, useCaptureDocuments, useGenerateCaptureDocument, useSetOwnerIdentity, useClearOwnerDuplicate, useCapturePromotedPhotos, usePromoteCapturePhoto, useDemoteCapturePhoto } from "../../queries/admin";

const CITIES = ["Praia Grande","Mongaguá","Itanhaém","Peruíbe","Guarujá","Santos","São Vicente","Cubatão"];
/* Fluxo V3: NOVO CONTATO -> DOCUMENTACAO -> VALIDACAO -> CAPTADO.
   AVALIACAO saiu como etapa independente; o preco vive dentro de VALIDACAO.
   Captacoes antigas gravadas como `avaliacao` continuam no banco com esse
   valor e aparecem na coluna DOCUMENTACAO por `normalizeStage` — leitura, nao
   reescrita. */
const STAGES = [
  ["novo_contato","NOVO CONTATO"],
  ["documentacao","DOCUMENTAÇÃO"],
  ["validacao","VALIDAÇÃO"],
  ["captado","CAPTADO"],
] as const;

type Stage = (typeof STAGES)[number][0] | "perdido";

/* Etapa canonica de uma linha do banco, para agrupar/contar sem perder o legado. */
const st = (row: { stage: string }) => normalizeStage(row.stage) ?? "novo_contato";

/* `pendente` e legado no banco e nao e reescrito: le como "solicitado". */
const DOC_OPTIONS = [
  ["nao_iniciado","Não iniciado"],
  ["solicitado","Solicitado"],
  ["parcial","Parcial"],
  ["completo","Completo"],
  ["validado_pela_equipe","Validada pela equipe"],
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
  const active = data.filter((x) => st(x) !== "perdido");
  const lost = data.filter((x) => st(x) === "perdido");
  const overdue = active.filter((x) => x.nextActionAt && new Date(x.nextActionAt).getTime() < Date.now()).length;
  return <AdminLayout title="Radar de Captação" subtitle="Proprietários e imóveis antes de entrarem na carteira" actions={<Btn tone="brass" onClick={() => setNewOpen(true)}><Plus className="h-4 w-4"/> Nova captação</Btn>}>
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Stat label="Ativas" value={active.length}/><Stat label="Captadas" value={active.filter(x=>st(x)==="captado").length}/><Stat label="Atrasadas" value={overdue}/><Stat label="Perdidas" value={lost.length}/></div>
      <Card><div className="grid gap-3 md:grid-cols-[1fr_220px]"><Input placeholder="Buscar proprietário, telefone, bairro..." value={search} onChange={e=>setSearch(e.target.value)}/><Select value={city} onChange={e=>setCity(e.target.value)}><option value="">Todas as regiões</option>{CITIES.map(c=><option key={c}>{c}</option>)}</Select></div></Card>
      <div className="grid gap-4 xl:grid-cols-4">{STAGES.map(([key,label])=><Card key={key} title={`${label} · ${active.filter(x=>st(x)===key).length}`}><div className="space-y-3">{active.filter(x=>st(x)===key).map(c=><button key={c.id} onClick={()=>setSelected(c.id)} className="w-full rounded border border-line bg-bone/30 p-3 text-left hover:bg-bone/60"><div className="font-medium text-deep">{c.owner?.name ?? `Proprietário #${c.ownerId}`}</div><div className="mt-1 text-xs text-muted">{c.propertyType || "Imóvel"} · {c.district || c.city}</div><div className="mt-1 text-sm">{money(c.askingPrice)}</div>{c.nextAction && <div className="mt-2 text-[11px] text-muted">{c.nextAction} · {dateTimeLabel(c.nextActionAt)}</div>}</button>)}</div></Card>)}</div>
      {lost.length>0 && <Card title={`Arquivo de perdidos · ${lost.length}`}><div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">{lost.map(c=><button key={c.id} onClick={()=>setSelected(c.id)} className="rounded border border-line p-3 text-left"><b>{c.owner?.name}</b><div className="text-xs text-muted">{c.lostReason || "Motivo não informado"}</div></button>)}</div></Card>}
    </div>
    <NewCapture open={newOpen} onClose={()=>setNewOpen(false)} onCreated={(id)=>{setNewOpen(false);setSelected(id)}}/>
    <Detail id={selected} onClose={()=>setSelected(null)}/>
  </AdminLayout>;
}

function NewCapture({open,onClose,onCreated}:{open:boolean;onClose:()=>void;onCreated:(id:number)=>void}) {
  const create = useCreateCapture(); const [error,setError]=useState<string|null>(null);
  const [f,setF]=useState({ownerName:"",ownerPhone:"",ownerEmail:"",city:"Praia Grande",district:"",address:"",cep:"",street:"",number:"",state:"SP",propertyType:"apartamento",askingPrice:"",source:"manual",intention:"venda",notes:""});
  /* Complementos da unidade: todos opcionais. Um terreno nao tem apartamento. */
  const [comp,setComp]=useState<Record<string,string>>({}); const [cepNote,setCepNote]=useState("");
  /* Consulta a ViaCEP. Falha NUNCA bloqueia: cai em preenchimento manual. */
  async function findCep(v:string){const masked=formatCep(v);setF(p=>({...p,cep:masked}));if(!isValidCep(masked)){setCepNote("");return}setCepNote("Buscando endereco...");const r=await lookupCep(masked);if(!r.ok){setCepNote(`${r.reason} Preencha o endereco a mao.`);return}setF(p=>({...p,street:r.address.street||p.street,district:p.district||r.address.district,city:CITIES.includes(r.address.city)?r.address.city:p.city,state:r.address.state||p.state}));setCepNote(CITIES.includes(r.address.city)?"":`CEP de ${r.address.city}/${r.address.state} - fora das cidades da lista.`)}
  async function save(){setError(null);try{const complements=Object.fromEntries(Object.entries(comp).filter(([,v])=>(v??"").trim().length>0));const r=await create.mutateAsync({ownerName:f.ownerName,ownerPhone:f.ownerPhone,ownerEmail:f.ownerEmail||null,city:f.city,district:f.district||null,address:f.address||null,cep:f.cep||null,street:f.street||null,number:f.number||null,state:f.state||null,complements:Object.keys(complements).length?complements:null,propertyType:f.propertyType,askingPrice:parseMoneyInput(f.askingPrice,"Valor pretendido"),source:f.source,intention:f.intention,notes:f.notes||null});if(r.duplicateUnit)alert(r.duplicateUnit);onCreated(r.id)}catch(e){setError(errorMessage(e,"Não foi possível criar a captação"))}}
  return <Modal open={open} onClose={onClose} title="Nova captação" wide><div className="grid gap-3 md:grid-cols-2"><Field label="Proprietário"><Input value={f.ownerName} onChange={e=>setF({...f,ownerName:e.target.value})}/></Field><Field label="WhatsApp"><Input value={f.ownerPhone} onChange={e=>setF({...f,ownerPhone:e.target.value})}/></Field><Field label="E-mail"><Input value={f.ownerEmail} onChange={e=>setF({...f,ownerEmail:e.target.value})}/></Field><Field label="Região"><Select value={f.city} onChange={e=>setF({...f,city:e.target.value})}>{CITIES.map(c=><option key={c}>{c}</option>)}</Select></Field><Field label="Bairro"><Input value={f.district} onChange={e=>setF({...f,district:e.target.value})}/></Field><Field label="CEP"><Input inputMode="numeric" value={f.cep} onChange={e=>void findCep(e.target.value)}/></Field><Field label="Número"><Input value={f.number} onChange={e=>setF({...f,number:e.target.value})}/></Field><Field label="Rua / avenida"><Input value={f.street} onChange={e=>setF({...f,street:e.target.value})}/></Field><Field label="UF"><Input value={f.state} onChange={e=>setF({...f,state:e.target.value.toUpperCase().slice(0,2)})}/></Field>{cepNote&&<p className="text-xs text-muted md:col-span-2">{cepNote}</p>}<Field label="Endereço livre (opcional)" className="md:col-span-2"><Input value={f.address} onChange={e=>setF({...f,address:e.target.value})}/></Field><div className="md:col-span-2"><div className="text-xs font-semibold tracking-wide text-muted">COMPLEMENTOS DA UNIDADE (opcionais)</div><div className="mt-2 grid gap-3 md:grid-cols-3">{COMPLEMENT_FIELDS.map(cf=><Field key={cf.key} label={cf.label}><Input value={comp[cf.key]??""} onChange={e=>setComp(p=>({...p,[cf.key]:e.target.value}))}/></Field>)}</div></div><Field label="Tipo"><Input value={f.propertyType} onChange={e=>setF({...f,propertyType:e.target.value})}/></Field><Field label="Valor pretendido"><Input inputMode="numeric" value={f.askingPrice} onChange={e=>setF({...f,askingPrice:e.target.value})}/></Field><Field label="Origem"><Select value={f.source} onChange={e=>setF({...f,source:e.target.value})}><option value="manual">Manual</option><option value="site">Site</option><option value="whatsapp">WhatsApp</option><option value="indicacao">Indicação</option><option value="instagram">Instagram</option><option value="facebook">Facebook</option><option value="placa">Placa</option><option value="portal">Portal</option><option value="outro">Outro</option></Select></Field><Field label="Intenção"><Select value={f.intention} onChange={e=>setF({...f,intention:e.target.value})}><option value="venda">Venda</option><option value="locacao">Locação</option><option value="venda_locacao">Venda ou locação</option></Select></Field><Field label="Observações" className="md:col-span-2"><Textarea value={f.notes} onChange={e=>setF({...f,notes:e.target.value})}/></Field></div>{error&&<p className="mt-3 text-sm text-red-700">{error}</p>}<div className="mt-5 flex justify-end gap-2"><Btn tone="outline" onClick={onClose}>Cancelar</Btn><Btn tone="brass" onClick={save} disabled={create.isPending}>Salvar captação</Btn></div></Modal>
}

function Detail({id,onClose}:{id:number|null;onClose:()=>void}) {
  const q=useCapture(id); const setStage=useSetCaptureStage(); const next=useSetCaptureNextAction(); const appraisal=useSaveCaptureAppraisal(); const docs=useSetCaptureDocStatus(); const checkItem=useSetCaptureChecklist(); const lost=useMarkCaptureLost(); const reopen=useReopenCapture(); const converted=useMarkCaptureConverted(); const addPhotos=useAddCapturePhotos(); const removePhoto=useRemoveCapturePhoto(); const [,navigate]=useLocation();
  /* TODO HOOK RODA ANTES DO EARLY RETURN: o "Carregando..." abaixo saia
     antes destes hooks, entao o render seguinte (com a captacao carregada)
     chamava mais hooks que o anterior. O React aborta com "Rendered more
     hooks than during the previous render" e a ficha abria em tela branca.
     Recebem o prop id (number|null): as queries ja tem enabled:id!==null. */
  const identity=useSetOwnerIdentity();
  const clearDup=useClearOwnerDuplicate();
  const [uploading,setUploading]=useState(false);
  const promotedQ=useCapturePromotedPhotos(id);
  const promote=usePromoteCapturePhoto();
  const demote=useDemoteCapturePhoto();
  const docList=useCaptureDocuments(id);
  const genDoc=useGenerateCaptureDocument();
  const c=q.data; if(!c) return <Modal open={id!==null} onClose={onClose} title="Captação">Carregando...</Modal>;
  async function run(p:Promise<unknown>){try{await p}catch(e){alert(errorMessage(e,"Não foi possível concluir"))}}
  const checklist=parseChecklist(c.notes);
  const progress=checklistProgress(checklist.done);
  const docValue=normalizeDocStatus(c.docStatus);
  const stage=normalizeStage(c.stage)??"novo_contato";
  const docRequest=documentRequestMessage({ownerName:c.owner?.name??null,done:checklist.done,creci:CRECI});
  /* Endereco montado a partir da estrutura (CEP + numero + complementos). */
  const fullAddress=formatUnitAddress({cep:c.cep,street:c.street,number:c.number,city:c.city,district:c.district,state:c.state},parseComplements(c.complements));
  const photos=parseOwnerPhotos(c.ownerPhotos);
  /* IDENTIDADE: CPF/CNPJ e RG alimentam Ficha Tecnica e Autorizacao. NAO
     identificam imovel — imovel e identificado pelo serial/unitKey. */
  async function editIdentity(){
    const ownerId=c!.owner?.id; if(!ownerId){alert("Captação sem proprietário vinculado");return}
    const document=prompt("CPF ou CNPJ do proprietário (em branco apaga):",formatDoc(c!.owner?.document));
    if(document===null)return;
    const rg=prompt("RG / documento de identidade (em branco apaga):",c!.owner?.rg??"");
    if(rg===null)return;
    try{const r=await identity.mutateAsync({id:ownerId,document,rg});if(r.warning)alert(r.warning)}
    catch(e){alert(errorMessage(e,"Não foi possível salvar o documento"))}
  }
  /* POSSIVEL DUPLICADO: e-mail repetido nunca faz merge automatico. A equipe
     confere e baixa o alerta; a referencia ao proprietario relacionado fica. */
  function reviewDuplicate(){
    const ownerId=c!.owner?.id; if(!ownerId)return;
    const note=prompt("Conferência do possível duplicado (quem conferiu e o que concluiu):","");
    if(note===null)return;
    run(clearDup.mutateAsync({id:ownerId,note:note.trim()||undefined}));
  }
  /* FOTOS: upload real reutilizando /api/admin/upload (mesmo caminho do
     cadastro de imoveis). Continua PROVISORIA: nada vai para o site sem a
     promocao explicita abaixo. */
  async function uploadPhotos(files:FileList|null){
    if(!files||files.length===0)return;
    setUploading(true);
    try{
      const uploaded:{url:string;caption:string|null}[]=[];
      for(const file of Array.from(files)){uploaded.push({url:await uploadImage(file),caption:file.name.slice(0,80)||null})}
      if(uploaded.length>0)await addPhotos.mutateAsync({id:c!.id,photos:uploaded});
    }catch(e){alert(errorMessage(e,"Não foi possível enviar a foto"))}
    finally{setUploading(false)}
  }
  /* PROMOCAO: unica ponte entre a foto provisoria e property_images (o que o
     site publico exibe). Sempre foto a foto, sempre por acao da equipe. */
  const promotedUrls=promotedQ.data?.urls??[];
  function addPhoto(){const url=prompt("URL da foto provisória enviada pelo proprietário:");if(!url)return;const caption=prompt("Legenda (opcional):")||null;run(addPhotos.mutateAsync({id:c!.id,photos:[{url,caption}]}))}
  /* DOCUMENTOS: a emissao congela um snapshot; a tela imprimivel le esse
     snapshot, nunca a captacao atual. Emitir de novo gera 2a via, sem
     apagar a emissao anterior. */
  function askTerms(){
    /* Nada e preenchido por conta propria: campo em branco vira LACUNA no
       documento impresso, para o corretor combinar e escrever a mao. */
    const commission=prompt("Comissão combinada em % (deixe em branco para imprimir a lacuna):","");
    if(commission===null)return null;
    const exclusive=prompt("Exclusividade? responda sim ou nao (em branco = lacuna):","");
    if(exclusive===null)return null;
    const term=prompt("Prazo da autorização em dias (em branco = lacuna):","");
    if(term===null)return null;
    const price=prompt("Preço autorizado de venda (em branco = lacuna):","");
    if(price===null)return null;
    const terms:{commissionPercent?:number;exclusive?:boolean;termDays?:number;authorizedPrice?:number}={};
    const cm=Number(commission.replace(",","."));if(commission.trim()&&Number.isFinite(cm))terms.commissionPercent=cm;
    const ex=exclusive.trim().toLowerCase();if(ex==="sim")terms.exclusive=true;else if(ex==="nao"||ex==="não")terms.exclusive=false;
    const td=Number(term.replace(/\D/g,""));if(term.trim()&&Number.isFinite(td)&&td>0)terms.termDays=td;
    if(price.trim()){try{terms.authorizedPrice=parseMoneyInput(price,"Preço autorizado")??undefined}catch(e){alert(errorMessage(e,"Preço autorizado inválido"));return null}}
    return terms;
  }
  async function generateDoc(kind:"ficha_tecnica"|"autorizacao"){
    let terms:Record<string,unknown>|null=null;
    if(kind==="autorizacao"){terms=askTerms();if(terms===null)return}
    try{const doc=await genDoc.mutateAsync(terms?{captureId:c!.id,kind,terms}:{captureId:c!.id,kind});navigate(`/admin/documento/${doc.id}`)}
    catch(e){alert(errorMessage(e,"Não foi possível emitir o documento"))}
  }
  function nextAction(){const title=prompt("Próxima ação:",c.nextAction||"Retornar proprietário");if(!title)return;const due=prompt("Data/hora (AAAA-MM-DDTHH:MM):",new Date(Date.now()+2*3600000).toISOString().slice(0,16));if(due)run(next.mutateAsync({id:c.id,title,dueAt:due}))}
  function saveAppraisal(){const v=prompt("Valor estimado da avaliação (ex.: 480 mil ou 480.000,00):",formatMoneyInput(c.estimatedPrice)); if(v===null)return; let estimatedPrice:number|null=null; try{estimatedPrice=parseMoneyInput(v,"Valor estimado")}catch(e){alert(errorMessage(e,"Valor estimado inválido"));return} run(appraisal.mutateAsync({id:c.id,estimatedPrice,note:null}))}
  /* DOCUMENTACAO VALIDADA PELA EQUIPE cobre o proprietario que nao faz
     upload: a equipe conferiu por WhatsApp/telefone/e-mail. O backend exige
     observacao para que fique registrado QUEM conferiu, POR QUAL MEIO e O
     QUE foi conferido — sem isso o selo seria uma caixinha marcada sem
     rastro. */
  function changeDoc(value:string){if(value==="validado_pela_equipe"){const note=prompt("Observação obrigatória: quem conferiu, por qual meio e o que foi conferido");if(note===null)return;if(!note.trim()){alert("A observação é obrigatória para validar a documentação pela equipe");return}run(docs.mutateAsync({id:c.id,docStatus:value as any,note:note.trim()}));return}run(docs.mutateAsync({id:c.id,docStatus:value as any,note:null}))}
  function markLost(){const reason=prompt("Motivo da perda:");if(reason)run(lost.mutateAsync({id:c.id,reason,detail:null}))}
  /* CAPTADO nao e mais manual: quem marca e a criacao do imovel no Cadastro
     Premium, que volta pela rota com capture_id. Sair sem criar imovel deixa a
     captacao em DOCUMENTACAO. */
  /* Trava de conversao: mesma regra do backend, avaliada antes de abrir o
     cadastro. Sem isso o corretor criava um imovel real e so entao tomava o
     erro em markConverted, deixando imovel orfao no banco. */
  const canConvert=checkConversionStart({stage:c.stage,docStatus:c.docStatus,estimatedPrice:c.estimatedPrice,convertedPropertyId:c.convertedPropertyId});
  function goToProperty(){if(!canConvert.ok){alert(canConvert.message);return}navigate(`/admin/imoveis/novo?capture_id=${c.id}`)}
  return <Modal open={id!==null} onClose={onClose} title={`Captação #${c.id}`} wide><div className="space-y-4"><div className="flex flex-wrap gap-2"><Badge tone={stage==="captado"?"green":stage==="perdido"?"red":"brass"}>{stageLabel(c.stage)}</Badge><Badge>{DOC_LABELS[normalizeDocStatus(c.docStatus)]??c.docStatus}</Badge></div><div className="grid gap-4 md:grid-cols-2"><Card title="Proprietário"><b>{c.owner?.name}</b><div className="mt-2 text-sm text-muted">{c.owner?.phone}</div>{c.owner?.possibleDuplicate?<div className="mt-3 rounded border border-red-300 bg-red-50 p-2 text-xs text-red-800"><b>POSSÍVEL DUPLICADO</b><div className="mt-1">{c.owner.duplicateOfOwnerId?<>Pode ser a mesma pessoa do proprietário #{c.owner.duplicateOfOwnerId}. Nada foi unificado automaticamente.</>:<>Cadastro parecido com outro já existente. Nada foi unificado automaticamente.</>}</div>{c.owner.duplicateNote?<div className="mt-1">{c.owner.duplicateNote}</div>:null}<div className="mt-2 flex flex-wrap gap-2">{c.owner.duplicateOfOwnerId?<Btn tone="outline" onClick={()=>navigate(`/admin/proprietarios?id=${c.owner!.duplicateOfOwnerId}`)}>Ver proprietário #{c.owner.duplicateOfOwnerId}</Btn>:null}<Btn tone="outline" disabled={clearDup.isPending} onClick={reviewDuplicate}>Conferi, baixar alerta</Btn></div></div>:null}<div className="mt-3 text-xs text-muted"><div>{docLabel(c.owner?.document)}: {formatDoc(c.owner?.document)||"— (lacuna no documento impresso)"}</div><div>RG: {c.owner?.rg||"— (lacuna no documento impresso)"}</div><div className="mt-1">Usado na Ficha Técnica e na Autorização. Não identifica o imóvel.</div></div><div className="mt-3 flex flex-wrap gap-2"><a href={`tel:${c.owner?.phone||""}`}><Btn tone="outline"><Phone className="h-4 w-4"/>Ligar</Btn></a>{c.owner?.phone&&<a href={waLink(c.owner.phone)} target="_blank" rel="noreferrer"><Btn tone="outline"><MessageCircle className="h-4 w-4"/>WhatsApp</Btn></a>}<Btn tone="outline" disabled={identity.isPending} onClick={editIdentity}>CPF/CNPJ e RG</Btn></div></Card><Card title="Imóvel"><div>{c.propertyType||"—"} · {c.district||c.city}</div><div className="mt-1 text-xl">{money(c.askingPrice)}</div><div className="text-xs text-muted">{fullAddress||c.address||""}</div>{c.unitKey&&<div className="mt-1 text-[11px] text-muted">Unidade: {c.unitKey}</div>}</Card></div><Card title={PROVISIONAL_LABEL}><div className="space-y-2">{photos.length===0&&<div className="text-xs text-muted">Nenhuma foto provisória. Foto do proprietário serve para avaliar o imóvel e NÃO vai para o site — a foto oficial é aprovada no cadastro do imóvel.</div>}{photos.map(p=><div key={p.url} className="flex items-center gap-2 text-xs"><img src={p.url} alt="" className="h-12 w-16 rounded object-cover"/><span className="flex-1 truncate text-muted">{p.caption||p.url}</span>{promotedUrls.includes(p.url)?<><Badge tone="green">No anúncio</Badge><Btn tone="outline" disabled={demote.isPending} onClick={()=>run(demote.mutateAsync({id:c.id,url:p.url}))}>Tirar do anúncio</Btn></>:<Btn tone="outline" disabled={promote.isPending||!c.convertedPropertyId} onClick={()=>run(promote.mutateAsync({id:c.id,url:p.url}))}>Promover para o anúncio</Btn>}<Btn tone="outline" onClick={()=>run(removePhoto.mutateAsync({id:c.id,url:p.url}))}>Remover</Btn></div>)}{!c.convertedPropertyId&&photos.length>0&&<div className="text-[11px] text-muted">Para promover uma foto é preciso cadastrar o imóvel primeiro: foto oficial pertence ao anúncio.</div>}<div className="flex flex-wrap items-center gap-2"><label className="cursor-pointer rounded border border-line px-3 py-2 text-xs text-deep">{uploading?"Enviando...":"Enviar foto do computador"}<input type="file" accept="image/*" multiple className="hidden" disabled={uploading} onChange={e=>{void uploadPhotos(e.target.files);e.target.value=""}}/></label><Btn tone="outline" onClick={addPhoto}>Adicionar foto por URL</Btn></div></div></Card><Card title="Documentos (Ficha Técnica / Autorização)"><div className="space-y-2"><div className="flex flex-wrap gap-2"><Btn tone="outline" disabled={genDoc.isPending} onClick={()=>generateDoc("ficha_tecnica")}><FileText className="h-4 w-4"/>Gerar Ficha Técnica</Btn><Btn tone="outline" disabled={genDoc.isPending} onClick={()=>generateDoc("autorizacao")}><FileText className="h-4 w-4"/>Gerar Autorização de Venda</Btn></div>{(docList.data??[]).length===0&&<div className="text-xs text-muted">Nenhum documento emitido. A emissão congela os dados e abre a tela imprimível.</div>}{(docList.data??[]).map(d=><div key={d.id} className="flex items-center gap-2 text-xs"><span className="font-mono">{d.serial}</span><span className="flex-1 truncate text-muted">{DOC_KIND_LABELS[d.kind as keyof typeof DOC_KIND_LABELS]??d.kind} · {DOC_TRACK_LABELS[d.status as keyof typeof DOC_TRACK_LABELS]??d.status}</span><Btn tone="outline" onClick={()=>navigate(`/admin/documento/${d.id}`)}>Abrir / imprimir</Btn></div>)}</div></Card><Card title="Próxima ação"><div className="text-sm">{c.nextAction||"Sem próxima ação"} · {dateTimeLabel(c.nextActionAt)}</div><Btn className="mt-3" tone="outline" onClick={nextAction}>Agendar / reagendar</Btn></Card><Card title="Validação · preço"><div className="text-sm">Preço pretendido: {money(c.askingPrice)}</div><div className="text-sm">Valor avaliado/validado: {money(c.estimatedPrice)}</div><Btn className="mt-3" tone="outline" onClick={saveAppraisal}>Registrar valor avaliado</Btn>{!hasValidAppraisal({estimatedPrice:c.estimatedPrice})&&<div className="mt-2 text-xs text-muted">Sem valor avaliado a captação não pode ser concluída.</div>}</Card><Card title={`Documentação · ${progress.done}/${progress.total}`}><div className="space-y-4"><Select value={docValue} onChange={e=>changeDoc(e.target.value)} disabled={docs.isPending}>{DOC_OPTIONS.map(([value,label])=><option key={value} value={value}>{label}</option>)}</Select>{c.docValidatedBy&&<div className="rounded border border-line bg-sand/40 p-2 text-xs text-muted">Documentação validada pela equipe por <b>{c.docValidatedBy}</b> · {dateTimeLabel(c.docValidatedAt)}{c.docValidationNote?<div className="mt-1">{c.docValidationNote}</div>:null}</div>}<div className="grid gap-3 md:grid-cols-2">{CHECKLIST_GROUPS.map(group=><div key={group}><div className="text-xs font-semibold tracking-wide text-muted">{CHECKLIST_GROUP_LABELS[group]}</div><div className="mt-2 space-y-2">{CHECKLIST_ITEMS.filter(item=>item.group===group).map(item=><label key={item.key} className="flex items-start gap-2 text-sm text-deep"><input type="checkbox" className="mt-1 h-4 w-4" checked={checklist.done.includes(item.key)} disabled={checkItem.isPending} onChange={e=>run(checkItem.mutateAsync({id:c.id,key:item.key,value:e.target.checked}))}/><span>{item.label}</span></label>)}</div></div>)}</div><div className="flex flex-wrap gap-2"><Btn tone="outline" disabled={docs.isPending||docValue!=="nao_iniciado"} onClick={()=>run(docs.mutateAsync({id:c.id,docStatus:"solicitado"}))}><FileText className="h-4 w-4"/>Solicitar documentos</Btn>{c.owner?.phone&&<a href={waLink(c.owner.phone,docRequest)} target="_blank" rel="noreferrer"><Btn tone="outline"><MessageCircle className="h-4 w-4"/>Pedir por WhatsApp</Btn></a>}</div></div></Card><Card title="Etapa"><div className="flex flex-wrap gap-2">{STAGES.filter(([key])=>key!=="captado").map(([key,label])=><Btn key={key} tone={stage===key?"brass":"outline"} disabled={setStage.isPending||stage===key} onClick={()=>{if(stage===key||setStage.isPending)return;run(setStage.mutateAsync({id:c.id,stage:key}))}}>{label}</Btn>)}</div></Card><div className="flex flex-wrap gap-2">{stage==="perdido"?<Btn onClick={()=>run(reopen.mutateAsync({id:c.id}))}>Reabrir</Btn>:<Btn tone="danger" onClick={markLost}>Marcar perdido</Btn>}{!c.convertedPropertyId&&stage!=="perdido"&&<div className="flex flex-wrap items-center gap-2"><Btn tone="brass" disabled={!canConvert.ok} onClick={goToProperty}><Building2 className="h-4 w-4"/>Cadastrar imóvel e captar</Btn>{!canConvert.ok&&<span className="text-xs text-muted">{canConvert.message}</span>}</div>}{c.convertedPropertyId&&<Badge tone="green">Imóvel #{c.convertedPropertyId}</Badge>}</div>{c.history?.length>0&&<Card title="Histórico"><div className="space-y-2">{c.history.map(h=><div key={h.id} className="border-b border-line pb-2 text-xs"><b>{h.action}</b> · {dateTimeLabel(h.createdAt)}<div className="text-muted">{h.detail||""}</div></div>)}</div></Card>}</div></Modal>
}

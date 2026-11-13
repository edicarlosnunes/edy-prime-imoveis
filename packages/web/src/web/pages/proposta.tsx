import {useState} from 'react';
import {initialProposal,proposalExpiry,proposalDate,PROPOSAL_TERMS,type ProposalParty,type PurchaseProposal} from '../lib/purchase-proposal';
import {purchaseProposalPdf} from '../lib/purchase-proposal-pdf';
const GOV='https://assinador.iti.br/';
const BROKER_WHATSAPP='https://wa.me/5513997141174';
const inputClass='mt-2 w-full rounded-lg border border-line bg-white p-3 font-normal';
export default function Proposta(){
 const [data,setData]=useState(initialProposal),[file,setFile]=useState<File|null>(null),[error,setError]=useState(''),[status,setStatus]=useState(''),[busy,setBusy]=useState(false),[reviewed,setReviewed]=useState(false),[openGov,setOpenGov]=useState(false);
 let expires='';try{expires=proposalDate(proposalExpiry(data.date,data.duration));}catch{/* validation is shown on submit */}
 function invalidate(){setFile(null);setError('');setStatus('');setReviewed(false);}
 function change(key:keyof PurchaseProposal,value:string){invalidate();setData(d=>({...d,[key]:value}));}
 function partyChange(side:'seller'|'buyer',key:keyof ProposalParty,value:string|boolean){invalidate();setData(d=>({...d,[side]:key==='kind'?{...d[side],kind:value as 'pf'|'pj',cpf:'',cnpj:'',representative:'',nationality:'',civilStatus:'',profession:'',hasSpouse:false,spouseName:'',spouseCpf:''}:{...d[side],[key]:value}}));}
 function field(key:Exclude<keyof PurchaseProposal,'seller'|'buyer'>,label:string,required=false,maxLength=100,type='text'){return <label className="block text-sm font-medium">{label}<input className={inputClass} name={key} value={data[key]} required={required} maxLength={maxLength} type={type} onChange={e=>change(key,e.target.value)}/></label>;}
 function area(key:'payment'|'installments'|'financing'|'notes'|'commission',label:string,maxLength:number,required=false){return <label className="block text-sm font-medium sm:col-span-2">{label}<textarea className={inputClass} name={key} rows={2} maxLength={maxLength} required={required} value={data[key]} onChange={e=>change(key,e.target.value)}/></label>;}
 function party(side:'seller'|'buyer',title:string){
  const p=data[side];
  const pf=(key:Exclude<keyof ProposalParty,'hasSpouse'|'kind'>,label:string,required=false,maxLength=60,type='text')=><label className="block text-sm font-medium" key={key}>{label}<input className={inputClass} name={side+'-'+key} required={required} maxLength={maxLength} type={type} value={p[key]} onChange={e=>partyChange(side,key,e.target.value)}/></label>;
  const requiredBuyer=side==='buyer';
  return <fieldset className="space-y-4">
   <legend className="mb-4 text-lg font-semibold">{title}</legend>
   <div className="flex flex-wrap gap-4 rounded-lg border border-line bg-bone p-3 text-sm">
    <label className="flex items-center gap-2"><input type="radio" name={side+'-kind'} checked={p.kind==='pf'} onChange={()=>partyChange(side,'kind','pf')}/> Pessoa física — CPF</label>
    <label className="flex items-center gap-2"><input type="radio" name={side+'-kind'} checked={p.kind==='pj'} onChange={()=>partyChange(side,'kind','pj')}/> Pessoa jurídica — CNPJ</label>
   </div>
   <div className="grid gap-4 sm:grid-cols-2">
    {p.kind==='pj'?<>
     {pf('name','Razão social / Nome da empresa',requiredBuyer,100)}
     {pf('cnpj','CNPJ',requiredBuyer,18)}
     {pf('representative','Responsável pela empresa',false,100)}
     {pf('phone','Telefone com DDD'+(requiredBuyer?'':' (opcional)'),requiredBuyer,22,'tel')}
     <div className="sm:col-span-2">{pf('address','Endereço da empresa (rua, número, bairro, cidade/UF e CEP)',false,160)}</div>
     {pf('email','E-mail (opcional)',false,70,'email')}
    </>:<>
     {pf('name','Nome completo',requiredBuyer,70)}
     {pf('cpf','CPF',false,14)}
     {pf('nationality','Nacionalidade',false,22)}
     {pf('civilStatus','Estado civil',false,22)}
     {pf('profession','Profissão',false,35)}
     {pf('phone','Telefone com DDD',requiredBuyer,22,'tel')}
     <div className="sm:col-span-2">{pf('address','Endereço completo: rua, número, complemento, bairro, cidade/UF e CEP',false,130)}</div>
     {pf('email','E-mail (opcional)',false,70,'email')}
     <label className="block text-sm font-medium">Possui cônjuge?<select className={inputClass} name={side+'-hasSpouse'} value={p.hasSpouse?'sim':'nao'} onChange={e=>partyChange(side,'hasSpouse',e.target.value==='sim')}><option value="nao">Não</option><option value="sim">Sim</option></select></label>
     {p.hasSpouse&&<>{pf('spouseName','Nome completo do cônjuge',false,70)}{pf('spouseCpf','CPF do cônjuge',false,14)}</>}
    </>}
   </div>
  </fieldset>;
 }
 function download(pdf:File){const url=URL.createObjectURL(pdf);const a=document.createElement('a');a.href=url;a.download=pdf.name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
 function gov(){const tab=window.open(GOV,'_blank');if(tab){tab.opener=null;setStatus('Assinador gov.br aberto. Escolha o PDF salvo no celular.');}else setStatus('O navegador não abriu o assinador. Toque em Abrir gov.br abaixo.');}
 async function save(pdf:File,sign:boolean){setBusy(true);setError('');try{const picker=(window as Window & {showSaveFilePicker?:(o:unknown)=>Promise<{createWritable:()=>Promise<{write:(v:File)=>Promise<void>;close:()=>Promise<void>}>}>}).showSaveFilePicker;
 if(picker){const h=await picker.call(window,{suggestedName:pdf.name,startIn:'documents',types:[{description:'Proposta em PDF',accept:{'application/pdf':['.pdf']}}]});const w=await h.createWritable();await w.write(pdf);await w.close();setStatus('PDF salvo.');}
 else if(navigator.canShare?.({files:[pdf]})){await navigator.share({files:[pdf],title:'Proposta de compra de imóvel'});setStatus('Se escolheu Salvar em Arquivos, o PDF está na pasta selecionada.');}
 else{download(pdf);setStatus('Download iniciado. Procure Proposta-de-compra-E-Santos.pdf em Downloads.');}
 if(sign)gov();
 }catch(e){if(!(e instanceof DOMException&&e.name==='AbortError'))setError('Não foi possível salvar. Use Baixar PDF e, na prévia, três pontinhos → Compartilhar → Salvar em Arquivos.');else setStatus('Salvamento cancelado. O PDF continua disponível abaixo.');}finally{setBusy(false);}}
 async function generate(){setError('');if(!reviewed){setError('Confira e confirme os dados antes de gerar o PDF.');return;}try{const bytes=purchaseProposalPdf(data);const pdf=new File([bytes as BlobPart],'Proposta-de-compra-E-Santos.pdf',{type:'application/pdf'});setFile(pdf);await save(pdf,openGov);}catch(e){setError(e instanceof Error?e.message:'Não foi possível gerar o PDF.');}}
 async function conclude(){
  setError('');setStatus('');
  if(!reviewed){setError('Confirme os dados informados antes de finalizar.');return;}
  try{
   const bytes=purchaseProposalPdf(data);
   const pdf=new File([bytes as BlobPart],'Proposta-de-compra-E-Santos.pdf',{type:'application/pdf'});
   setFile(pdf);
   // Preserva cópia para o comprador independentemente do aplicativo escolhido.
   download(pdf);
   setStatus('PDF salvo em Downloads. Abri o WhatsApp do corretor final 1174: toque em Anexar → Documento, selecione o PDF e envie. O envio não é automático.');
   // Conversa de retorno fixa; compartilhamento genérico poderia selecionar outro contato.
   window.open(BROKER_WHATSAPP,'_blank','noopener,noreferrer');
  }catch(e){setError(e instanceof Error?e.message:'Não foi possível finalizar o PDF.');}
 }

 return <main className="min-h-screen bg-bone px-4 py-8 text-deep"><div className="mx-auto max-w-3xl"><header className="rounded-2xl border border-line bg-white p-5 sm:p-7"><div className="flex items-center gap-4"><img src="/autorizacao-esantos-logo.png" alt="Logo E. Santos" className="h-20 w-20 shrink-0 bg-black object-contain sm:h-24 sm:w-24"/><div><p className="text-lg font-semibold">E. Santos Gestor Imobiliário</p><p className="mt-2 text-sm">CRECI 134718-F<br/>(Perito Imobiliário CNAI 55.918)<br/>Rua Guimarães Rosa, 492/163</p></div></div><h1 className="mt-5 text-3xl font-semibold">Proposta de compra de imóvel</h1><p className="mt-3 text-sm text-gray-700">Preencha os dados do comprador, salve sua cópia em PDF e devolva o documento pelo WhatsApp E. Santos final 1174. Não é necessário cadastrar no CRM.</p></header>
 <section className="my-5 rounded-xl border border-line bg-white p-5"><h2 className="font-semibold">Como proceder</h2><ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-relaxed"><li>O comprador preenche seus dados (CPF ou CNPJ); pode deixar vendedor e condições do negócio para o corretor completar depois.</li><li>Toque em <strong>Salvar PDF e abrir WhatsApp 1174</strong>. O PDF é baixado no celular e a conversa com o corretor é aberta.</li><li>No WhatsApp do corretor <strong>(13) 99714-1174</strong>, toque em <strong>Anexar → Documento</strong>, selecione o PDF baixado e toque em enviar. Mesmo que o link da proposta seja repassado, a conversa aberta continua sendo a do corretor.</li><li>O corretor confere o documento, completa a negociação e o encaminha ao vendedor. O arquivo pode circular entre as partes, mas o PDF não é um formulário editável no site após o envio.</li></ol></section>
 <form onSubmit={e=>{e.preventDefault();void conclude();}} className="space-y-7 rounded-xl border border-line bg-white p-5 sm:p-7">{party('buyer','1. Dados do comprador')}{party('seller','2. Dados do vendedor (opcional — corretor completa depois)')}<fieldset><legend className="mb-4 text-lg font-semibold">3. Dados do imóvel</legend><div className="grid gap-4 sm:grid-cols-2">{field('propertyType','Tipo do imóvel',false,35)}{field('propertyCode','Código do imóvel (opcional)',false,35)}<div className="sm:col-span-2">{field('propertyAddress','Endereço completo do imóvel',false,180)}</div><div className="sm:col-span-2">{field('registry','Matrícula e cartório (opcional)',false,90)}</div></div></fieldset>
 <fieldset><legend className="mb-4 text-lg font-semibold">4. Valor e condições de pagamento</legend><div className="grid gap-4 sm:grid-cols-2">{field('amount','Valor total oferecido (R$)',false,20)}{field('deposit','Sinal / entrada (R$)',false,20)}{field('depositDate','Data do sinal / entrada',false,10,'date')}{field('balance','Saldo (R$)',false,20)}{area('payment','Forma de pagamento',160,false)}{area('installments','Parcelamento: quantidade, valores e vencimentos (se houver)',160)}{area('financing','Financiamento, FGTS ou permuta (se houver)',160)}</div></fieldset>
 <fieldset><legend className="mb-4 text-lg font-semibold">5. Observações e condições específicas</legend>{area('notes','Descrição adicional (opcional)',280)}<div className="mt-4">{area('commission','Intermediação: comissão e responsável pelo pagamento (opcional)',130)}</div></fieldset>
 <fieldset><legend className="mb-4 text-lg font-semibold">6. Datas e validade</legend><div className="grid gap-4 sm:grid-cols-2"><div className="text-sm font-medium">Data da proposta<p className="mt-2 rounded-lg border border-line bg-bone p-3">{proposalDate(data.date)}</p></div><label className="text-sm font-medium">Duração da proposta (dias)<input className={inputClass} type="number" min="1" max="3650" step="1" required value={data.duration} onChange={e=>change('duration',e.target.value)}/></label><div className="text-sm font-medium">Data de validade<p className="mt-2 rounded-lg border border-line bg-bone p-3">{expires||'Confira a duração'}</p></div>{field('city','Cidade/UF da proposta',false,60)}</div></fieldset>
 <section className="rounded-lg bg-bone p-4 text-sm leading-relaxed"><h2 className="font-semibold">Condições da proposta</h2><p className="mt-2">{PROPOSAL_TERMS}</p><p className="mt-2">Válida até {expires||'a data calculada acima'}. O PDF terá assinaturas de vendedor, comprador e intermediário{data.seller.hasSpouse||data.buyer.hasSpouse?', incluindo os cônjuges informados':''}.</p></section>
 <label className="flex items-start gap-3 text-sm"><input type="checkbox" required checked={reviewed} onChange={e=>setReviewed(e.target.checked)} className="mt-1"/>Confirmo os dados que informei e desejo salvar o PDF para devolvê-lo ao corretor pelo WhatsApp.</label><label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={openGov} onChange={e=>setOpenGov(e.target.checked)} className="mt-1"/>Abrir o assinador gov.br após salvar o PDF.</label>{error&&<p role="alert" className="rounded-lg border border-red-300 p-4 text-sm text-red-800">{error}</p>}{status&&<p role="status" className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm">{status}</p>}<button type="submit" disabled={busy} className="w-full rounded-lg bg-deep p-4 font-semibold text-white disabled:opacity-60">Salvar PDF e abrir WhatsApp 1174</button><p className="text-xs text-gray-700">A cópia fica no aparelho. O WhatsApp precisa que você selecione/confirme o destinatário e toque em enviar. Nenhum dado é registrado no CRM por este botão.</p><a href={BROKER_WHATSAPP} target="_blank" rel="noopener noreferrer" className="block w-full rounded-lg border border-line bg-white p-3 text-center font-semibold">Abrir WhatsApp E. Santos — final 1174</a>
 {file&&<section className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm"><h2 className="font-semibold">Proposta pronta em PDF</h2><p className="mt-2 break-words">Proposta-de-compra-E-Santos.pdf</p><div className="mt-4 flex flex-wrap gap-3"><button type="button" disabled={busy} onClick={()=>void save(file,openGov)} className="rounded-lg bg-deep p-3 text-white">Salvar PDF em Arquivos</button><button type="button" onClick={()=>download(file)} className="rounded-lg border border-line bg-white p-3">Baixar PDF</button><a href={BROKER_WHATSAPP} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-line bg-white p-3">Abrir conversa WhatsApp 1174</a><a href={GOV} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-line bg-white p-3">Abrir gov.br</a></div></section>}
 </form><aside className="mt-5 rounded-xl border border-line bg-white p-5 text-sm leading-relaxed"><h2 className="font-semibold">Após a assinatura</h2><p className="mt-2 text-gray-700">No gov.br, baixe o arquivo assinado. Se abrir a prévia, use os três pontinhos → Compartilhar → WhatsApp ou Salvar em Arquivos. Devolva ao corretor ou para <a className="underline" href="mailto:esantosgestorimobiliario@gmail.com">esantosgestorimobiliario@gmail.com</a>.</p><p className="mt-2 text-gray-700">Para manter as assinaturas, compartilhe o PDF assinado original e utilize esse mesmo arquivo nas assinaturas seguintes.</p></aside><button type="button" onClick={()=>{if(!window.confirm('Limpar os dados para uma nova proposta?'))return;setData(initialProposal());setFile(null);setReviewed(false);setStatus('');setError('');window.scrollTo({top:0,behavior:'smooth'});}} className="my-5 w-full rounded-lg border border-line bg-white p-3">Limpar e preencher nova proposta</button><footer className="pb-6 text-center text-xs text-gray-600">E. Santos · CRECI 134718-F · Preencher ou baixar não equivale a assinar.</footer></div></main>;
}

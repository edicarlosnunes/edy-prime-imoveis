import {useState} from 'react';
import {initialProposal,proposalExpiry,proposalDate,commissionMoney,PROPOSAL_TERMS,type ProposalParty,type PurchaseProposal} from '../lib/purchase-proposal';
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
 function area(key:'payment'|'installments'|'financing'|'notes'|'commission',label:string,maxLength:number,required=false){return <label className="block text-sm font-medium sm:col-span-2">{label}<textarea className={inputClass} name={key} rows={key==='commission'?3:2} maxLength={maxLength} required={required} value={data[key]} onChange={e=>change(key,e.target.value)}/></label>;}
 function party(side:'seller'|'buyer',title:string){
  const p=data[side];
  const pf=(key:Exclude<keyof ProposalParty,'hasSpouse'|'kind'>,label:string,required=false,maxLength=60,type='text')=><label className="block text-sm font-medium" key={key}>{label}<input className={inputClass} name={side+'-'+key} required={required} maxLength={maxLength} type={type} value={p[key]} onChange={e=>partyChange(side,key,e.target.value)}/></label>;
  const requiredBuyer=false; // A proposta pode ser salva em branco e preenchida depois.
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
 async function generate(){setError('');try{const bytes=purchaseProposalPdf(data);const pdf=new File([bytes as BlobPart],'Proposta-de-compra-E-Santos.pdf',{type:'application/pdf'});setFile(pdf);await save(pdf,openGov);}catch(e){setError(e instanceof Error?e.message:'Não foi possível gerar o PDF.');}}
 async function conclude(){
  setError('');setStatus('');
  
  try{
   const bytes=purchaseProposalPdf(data);
   const pdf=new File([bytes as BlobPart],'Proposta-de-compra-E-Santos.pdf',{type:'application/pdf'});
   setFile(pdf);
   // Uma cópia local, separada do compartilhamento. Nunca afirma envio confirmado.
   download(pdf);
   const message='Devolver esta proposta ao corretor E. Santos — WhatsApp (13) 99714-1174.';
   if(navigator.canShare?.({files:[pdf]})){
    setStatus('PDF salvo. Escolha WhatsApp, selecione E. Santos (final 1174), anexe/compartilhe o documento e confirme Enviar.');
    try{
     await navigator.share({files:[pdf],title:'Proposta preenchida — E. Santos',text:message});
     setStatus('PDF salvo e compartilhamento concluído no aparelho. Confira na conversa do WhatsApp 1174 se a proposta foi entregue.');
    }catch(e){
     if(e instanceof DOMException&&e.name==='AbortError'){
      setStatus('PDF salvo no celular. O compartilhamento foi cancelado; use o botão abaixo para tentar novamente.');
     }else{
      setError('PDF salvo, mas o compartilhamento não foi concluído. Use o botão abaixo ou anexe o PDF no WhatsApp 1174.');
     }
    }
   }else{
    setStatus('PDF salvo no celular. Para devolver: abra o WhatsApp 1174 abaixo, anexe o PDF como Documento e toque em Enviar.');
   }
  }catch(e){setError(e instanceof Error?e.message:'Não foi possível finalizar o PDF.');}
 }
 async function sharePdf(){
  if(!file)return;
  try{
   if(navigator.canShare?.({files:[file]})){
    await navigator.share({files:[file],title:'Proposta preenchida — E. Santos',text:'Enviar para E. Santos Gestor Imobiliário, WhatsApp final 1174.'});
    setStatus('Compartilhamento concluído no aparelho. Confira na conversa do WhatsApp 1174 se a proposta foi entregue.');
   }else{
    window.open(BROKER_WHATSAPP,'_blank','noopener,noreferrer');
    setStatus('Abra a conversa do corretor final 1174, anexe o PDF salvo e confirme Enviar.');
   }
  }catch(e){if(!(e instanceof DOMException&&e.name==='AbortError'))setError('Não foi possível compartilhar. Envie o PDF salvo pelo WhatsApp final 1174.');}
 }

 return <main className="min-h-screen bg-bone px-4 py-8 text-deep"><div className="mx-auto max-w-3xl"><header className="rounded-2xl border border-line bg-white p-5 sm:p-7"><div className="flex items-center gap-4"><img src="/logo-proposta-dourado.jpg" alt="Logo E. Santos" className="h-20 w-20 shrink-0 bg-black object-contain sm:h-24 sm:w-24"/><div><p className="text-lg font-semibold">E. Santos Gestor Imobiliário</p><p className="mt-2 text-sm">CRECI 134718-F<br/>(Perito Imobiliário CNAI 55.918)<br/>Rua Guimarães Rosa, 492/163</p></div></div><h1 className="mt-5 text-3xl font-semibold">Proposta de compra de imóvel</h1><p className="mt-3 text-sm text-gray-700">Preencha os dados do comprador, salve sua cópia em PDF e devolva o documento pelo WhatsApp E. Santos final 1174. Não é necessário cadastrar no CRM.</p></header>
 <section className="my-5 rounded-xl border border-line bg-white p-5"><h2 className="font-semibold">Como proceder</h2><ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-relaxed"><li>Você pode salvar a proposta com campos em branco e enviar o link para o comprador preencher seus dados depois.</li><li>Toque em <strong>Salvar proposta</strong>. O PDF é salvo e o celular oferece a opção de compartilhar o documento pelo WhatsApp.</li><li>Escolha o WhatsApp, selecione a conversa com <strong>E. Santos — (13) 99714-1174</strong> e confirme <strong>Enviar</strong>. O cliente precisa escolher o destinatário; o site não envia sozinho nem consegue fixar a conversa no compartilhamento do celular.</li><li>O corretor confere o documento, completa a negociação e o encaminha ao vendedor. O arquivo pode circular entre as partes, mas o PDF não é um formulário editável no site após o envio.</li></ol></section>
 <form onSubmit={e=>{e.preventDefault();void conclude();}} className="space-y-7 rounded-xl border border-line bg-white p-5 sm:p-7">{party('buyer','1. Dados do comprador')}{party('seller','2. Dados do vendedor (opcional — corretor completa depois)')}<fieldset><legend className="mb-4 text-lg font-semibold">3. Dados do imóvel</legend><div className="grid gap-4 sm:grid-cols-2">{field('propertyType','Tipo do imóvel',false,35)}{field('propertyCode','Código do imóvel (opcional)',false,35)}<div className="sm:col-span-2">{field('propertyAddress','Endereço completo do imóvel',false,180)}</div><div className="sm:col-span-2">{field('registry','Matrícula e cartório (opcional)',false,90)}</div><label className="block text-sm font-medium sm:col-span-2">Descrição completa do apartamento e do prédio<textarea className={inputClass} name="propertyDescription" rows={6} maxLength={3000} value={data.propertyDescription} placeholder="Ex.: 2 dormitórios, sala, cozinha, banheiro, sacada, vaga de garagem, área de lazer, elevador, portaria..." onChange={e=>change('propertyDescription',e.target.value)}/><span className="mt-1 block text-xs text-gray-600">Escreva livremente os ambientes, acabamentos, características do condomínio e diferenciais do imóvel. A descrição sairá no PDF.</span></label></div></fieldset>
 <fieldset><legend className="mb-4 text-lg font-semibold">4. Valor e condições de pagamento</legend><div className="grid gap-4 sm:grid-cols-2">{field('amount','Valor total oferecido (R$)',false,20)}{field('deposit','Sinal / entrada (R$)',false,20)}{field('depositDate','Data do sinal / entrada',false,10,'date')}{field('balance','Saldo (R$)',false,20)}{area('payment','Forma de pagamento',160,false)}{area('installments','Parcelamento: quantidade, valores e vencimentos (se houver)',160)}{area('financing','Financiamento, FGTS ou permuta (se houver)',160)}</div></fieldset>
 <fieldset><legend className="mb-4 text-lg font-semibold">5. Observações e condições específicas</legend>{area('notes','Descrição adicional (opcional)',280)}<div className="mt-4 grid gap-4 sm:grid-cols-2"><label className="block text-sm font-medium">Percentual da comissão (%)<input className={inputClass} name="commissionRate" inputMode="decimal" type="text" maxLength={6} placeholder="Ex.: 5, 8, 10, 12 ou 7,5" required value={data.commissionRate} onChange={e=>change('commissionRate',e.target.value)}/><span className="mt-1 block text-xs text-gray-600">Digite livremente o percentual desejado (maior que 0 e até 100%).</span></label><div className="text-sm font-medium">Valor da comissão (automático)<p aria-live="polite" className="mt-2 rounded-lg border border-line bg-bone p-3 font-semibold">{data.amount.trim()?(()=>{try{return commissionMoney(data.amount,data.commissionRate);}catch{return 'Confira o valor da proposta';}})():'Preencha o valor total oferecido acima'}</p></div><div className="sm:col-span-2"><p className="mb-3 rounded-lg border border-line bg-bone p-3 text-sm font-semibold" aria-live="polite">{data.amount.trim()?(()=>{try{return `Comissão de intermediação: ${data.commissionRate.replace('.',',')}% sobre o valor total oferecido, R$ ${data.amount} = ${commissionMoney(data.amount,data.commissionRate)}`;}catch{return 'Preencha um valor e percentual válidos para calcular a comissão.';}})():'Preencha o valor oferecido para visualizar a linha automática da comissão.'}</p>{area('commission','Condições de pagamento da comissão (opcional)',312)}</div></div></fieldset>
 <fieldset><legend className="mb-4 text-lg font-semibold">6. Datas e validade</legend><div className="grid gap-4 sm:grid-cols-2"><div className="text-sm font-medium">Data da proposta<p className="mt-2 rounded-lg border border-line bg-bone p-3">{proposalDate(data.date)}</p></div><label className="text-sm font-medium">Duração da proposta (dias)<input className={inputClass} type="number" min="1" max="3650" step="1" required value={data.duration} onChange={e=>change('duration',e.target.value)}/></label><div className="text-sm font-medium">Data de validade<p className="mt-2 rounded-lg border border-line bg-bone p-3">{expires||'Confira a duração'}</p></div>{field('city','Cidade/UF da proposta',false,60)}</div></fieldset>
 <section className="rounded-lg bg-bone p-4 text-sm leading-relaxed"><h2 className="font-semibold">Condições da proposta</h2><p className="mt-2">{PROPOSAL_TERMS}</p><p className="mt-2">Válida até {expires||'a data calculada acima'}. O PDF terá assinaturas de vendedor, comprador e intermediário{data.seller.hasSpouse||data.buyer.hasSpouse?', incluindo os cônjuges informados':''}.</p></section>
 <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)} className="mt-1"/>Conferi os dados que já preenchi (opcional). Campos em branco podem ser completados depois.</label><label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={openGov} onChange={e=>setOpenGov(e.target.checked)} className="mt-1"/>Abrir o assinador gov.br após salvar o PDF.</label>{error&&<p role="alert" className="rounded-lg border border-red-300 p-4 text-sm text-red-800">{error}</p>}{status&&<p role="status" className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm">{status}</p>}<button type="submit" disabled={busy} className="w-full rounded-lg bg-deep p-4 font-semibold text-white disabled:opacity-60">Salvar proposta</button><p className="text-xs text-gray-700">O PDF fica salvo no aparelho; para devolver ao corretor, confirme o envio pelo WhatsApp ao final 1174. Nenhum dado é enviado ao CRM por este botão.</p><a href={BROKER_WHATSAPP} target="_blank" rel="noopener noreferrer" className="block w-full rounded-lg border border-line bg-white p-3 text-center font-semibold">Abrir WhatsApp E. Santos — final 1174</a>
 {file&&<section className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm"><h2 className="font-semibold">Proposta pronta em PDF</h2><p className="mt-2 break-words">Proposta-de-compra-E-Santos.pdf</p><div className="mt-4 flex flex-wrap gap-3"><button type="button" disabled={busy} onClick={()=>void save(file,openGov)} className="rounded-lg bg-deep p-3 text-white">Salvar PDF em Arquivos</button><button type="button" onClick={()=>download(file)} className="rounded-lg border border-line bg-white p-3">Baixar PDF</button><button type="button" onClick={()=>void sharePdf()} className="rounded-lg border border-line bg-white p-3">Compartilhar PDF</button><a href={BROKER_WHATSAPP} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-line bg-white p-3">Abrir conversa WhatsApp 1174</a><a href={GOV} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-line bg-white p-3">Abrir gov.br</a></div></section>}
 </form><aside className="mt-5 rounded-xl border border-line bg-white p-5 text-sm leading-relaxed"><h2 className="font-semibold">Após a assinatura</h2><p className="mt-2 text-gray-700">No gov.br, baixe o arquivo assinado. Se abrir a prévia, use os três pontinhos → Compartilhar → WhatsApp ou Salvar em Arquivos. Devolva ao corretor ou para <a className="underline" href="mailto:esantosgestorimobiliario@gmail.com">esantosgestorimobiliario@gmail.com</a>.</p><p className="mt-2 text-gray-700">Para manter as assinaturas, compartilhe o PDF assinado original e utilize esse mesmo arquivo nas assinaturas seguintes.</p></aside><button type="button" onClick={()=>{if(!window.confirm('Limpar os dados para uma nova proposta?'))return;setData(initialProposal());setFile(null);setReviewed(false);setStatus('');setError('');window.scrollTo({top:0,behavior:'smooth'});}} className="my-5 w-full rounded-lg border border-line bg-white p-3">Limpar e preencher nova proposta</button><footer className="pb-6 text-center text-xs text-gray-600">E. Santos · CRECI 134718-F · Preencher ou baixar não equivale a assinar.</footer></div></main>;
}

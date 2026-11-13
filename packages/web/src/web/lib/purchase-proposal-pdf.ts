import {AUTHORIZATION_LOGO_JPEG} from './authorization-logo';
import {PROPOSAL_TERMS,proposalDate,proposalExpiry,proposalMoney,commissionMoney,validateProposal,type PurchaseProposal,type ProposalParty} from './purchase-proposal';
function latin(s:string){return s.normalize('NFC').replace(/[–—]/g,'-').replace(/[“”]/g,'"').replace(/[‘’]/g,"'").replace(/[^\x20-\xFF]/g,'?');}
function esc(s:string){return latin(s).replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');}
// Conservative Helvetica widths: wrapping never relies on browser/canvas availability.
function width(s:string,size:number){return [...latin(s)].reduce((n,c)=>n+(/[ilI.,:;!|' ]/.test(c)?.28:/[mwMW@%]/.test(c)?.9:/[A-ZÁÉÍÓÚÃÕÇ]/.test(c)?.72:.56),0)*size;}
export function proposalWrap(s:string,maxWidth:number,size=9.2){const lines:string[]=[];let line='';for(const word of s.replace(/\s+/g,' ').trim().split(' ')){let rest=word;if(line&&width(line+' '+rest,size)>maxWidth){lines.push(line);line='';}while(width(rest,size)>maxWidth){let cut=1;while(cut<rest.length&&width(rest.slice(0,cut+1),size)<=maxWidth)cut++;lines.push(rest.slice(0,cut));rest=rest.slice(cut);}line+=(line?' ':'')+rest;}if(line)lines.push(line);return lines;}
export function purchaseProposalPdf(d:PurchaseProposal){validateProposal(d);const ops:string[]=[];
const text=(s:string,x:number,y:number,size=9.2,bold=false)=>ops.push(`BT /${bold?'F2':'F1'} ${size} Tf 1 0 0 1 ${x} ${y} Tm (${esc(s)}) Tj ET`);
const rule=(x:number,y:number,w:number)=>ops.push(`0.65 G .5 w ${x} ${y} m ${x+w} ${y} l S 0 G`);
function block(s:string,x:number,y:number,w:number,max:number,label:string,size=9.2){const lines=proposalWrap(s,w,size);if(lines.length>max)throw Error(`Resuma o campo ${label} para manter a proposta em uma folha A4.`);lines.forEach((l,i)=>text(l,x,y-i*11,size));return y-lines.length*11;}
function section(s:string,y:number,x=36,w=523){ops.push(`.95 .94 .91 rg ${x} ${y-5} ${w} 17 re f 0 g`);text(s,x+5,y,10,true);}
ops.push('q 64 0 0 64 36 754 cm /Logo Do Q');text('E. SANTOS GESTOR IMOBILIÁRIO',112,803,12,true);text('CRECI 134718-F | (Perito Imobiliário CNAI 55.918)',112,788,9);text('Rua Guimarães Rosa, 492/163',112,774,9);text('esantosgestorimobiliario@gmail.com | (13) 99714-1174',112,760,9);rule(36,746,523);
text('PROPOSTA DE COMPRA DE IMÓVEL',36,726,15,true);text(`Data: ${proposalDate(d.date)}   |   Duração: ${d.duration} dias   |   Válida até: ${proposalDate(proposalExpiry(d.date,d.duration))}`,36,707,9.5);
function party(p:ProposalParty,label:string,x:number){
 section(label,684,x,253);let y=663;
 const add=(s:string,max=1)=>{y=block(s,x,y,250,max,label);};
 if(p.kind==='pj'){
  add(`Razão social: ${p.name||'A preencher'}`,2);
  add(`CNPJ: ${p.cnpj||'A preencher'}`);
  add(`Responsável: ${p.representative||'A preencher'}`,2);
  add(`Endereço: ${p.address||'A preencher'}`,3);
  add(`Telefone: ${p.phone||'A preencher'}`);
  add(`E-mail: ${p.email||'Não informado'}`,2);
 }else{
  add(`Nome: ${p.name||'A preencher'}`,2);
  add(`CPF: ${p.cpf||'A preencher'}`);
  add(`Nacionalidade: ${p.nationality||'A preencher'}`);
  add(`Estado civil: ${p.civilStatus||'A preencher'} | Profissão: ${p.profession||'A preencher'}`,2);
  add(`Endereço: ${p.address||'A preencher'}`,3);
  add(`Telefone: ${p.phone||'A preencher'}`);
  add(`E-mail: ${p.email||'Não informado'}`,2);
  if(p.hasSpouse){add(`Cônjuge: ${p.spouseName}`,2);add(`CPF do cônjuge: ${p.spouseCpf}`);}
 }
 if(y<531)throw Error(`Resuma os dados do ${label.toLowerCase()} para caber em uma folha A4.`);
}
party(d.buyer,'1. COMPRADOR',36);party(d.seller,'2. VENDEDOR',306);
section('3. IMÓVEL',520);block(`Tipo: ${d.propertyType||'A preencher'} | Código: ${d.propertyCode||'Não informado'}`,36,499,523,1,'tipo/código');block(`Endereço: ${d.propertyAddress||'A preencher'}`,36,487,523,2,'endereço do imóvel');block(`Matrícula/cartório: ${d.registry||'Não informado'}`,36,463,523,1,'matrícula');
section('4. VALOR E CONDIÇÕES DE PAGAMENTO',441);text(`Valor total oferecido: ${d.amount?'R$ '+proposalMoney(d.amount):'A definir pelo comprador'}`,36,420,11,true);text(`Sinal/entrada: ${d.deposit?'R$ '+proposalMoney(d.deposit):'Não informado'} | Data: ${proposalDate(d.depositDate)} | Saldo: ${d.balance?'R$ '+proposalMoney(d.balance):'Não informado'}`,36,405,9.2);
let y=389;for(const [label,value,max] of [['Forma de pagamento',d.payment,2],['Parcelamento',d.installments||'Não se aplica',2],['Financiamento / FGTS / permuta',d.financing||'Não se aplica',2]] as const){y=block(`${label}: ${value}`,36,y,523,max,label);}
if(y<323)throw Error('Resuma as condições de pagamento para manter uma folha A4.');
section('5. OBSERVAÇÕES E CONDIÇÕES ESPECÍFICAS',309);block(d.notes||'Sem observações adicionais.',36,288,523,3,'observações');
section('6. CONDIÇÕES DA PROPOSTA',241);block(PROPOSAL_TERMS,36,220,523,4,'condições',9);block(`Comissão de intermediação: ${d.commissionRate}% sobre o valor da proposta = ${commissionMoney(d.amount,d.commissionRate)}. Pagamento: ${d.commission||'responsável a definir.'}`,36,172,523,2,'comissão',9);text(`Local: ${d.city||'A definir'} | Data: ${proposalDate(d.date)}`,36,144,9);
// Space above every line is kept clear for handwritten or digital signatures.
function signature(name:string,label:string,x:number,y:number,w:number){rule(x,y,w);text(label,x,y-11,8,true);block(name,x,y-22,w,2,'nome na assinatura',8);}
signature(d.seller.name||'A preencher',d.seller.kind==='pj'?'Vendedora - aceite (PJ)':'Vendedor - aceite',36,100,162);signature(d.buyer.name||'A preencher',d.buyer.kind==='pj'?'Compradora - proponente (PJ)':'Comprador - proponente',217,100,162);
signature('E. Santos | CRECI 134718-F','Intermediário',398,100,161);
if(d.seller.kind==='pf'&&d.seller.hasSpouse)signature(d.seller.spouseName,'Cônjuge do vendedor',36,40,253);if(d.buyer.kind==='pf'&&d.buyer.hasSpouse)signature(d.buyer.spouseName,'Cônjuge do comprador',306,40,253);

const logo=atob(AUTHORIZATION_LOGO_JPEG);
const streams=[ops.join('\n')];
const description=d.propertyDescription.trim();
if(description){
 const lines=proposalWrap(description,505,10);
 const perPage=54;
 for(let offset=0;offset<lines.length;offset+=perPage){
  const pageIndex=Math.floor(offset/perPage)+2;
  const pageOps=[
   'q 54 0 0 54 36 754 cm /Logo Do Q',
   'BT /F2 12 Tf 1 0 0 1 102 798 Tm (E. SANTOS GESTOR IMOBILIÁRIO) Tj ET',
   '0.65 G .5 w 36 745 m 559 745 l S 0 G',
   'BT /F2 14 Tf 1 0 0 1 36 716 Tm (DESCRIÇÃO DO IMÓVEL E CONDOMÍNIO) Tj ET',
   'BT /F1 9 Tf 1 0 0 1 36 694 Tm (Complemento da proposta de compra - página '+pageIndex+') Tj ET'
  ];
  lines.slice(offset,offset+perPage).forEach((l,i)=>pageOps.push('BT /F1 10 Tf 1 0 0 1 36 '+(670-i*12)+' Tm ('+esc(l)+') Tj ET'));
  streams.push(pageOps.join('\n'));
 }
}
const pageIds=streams.map((_,i)=>6+i*2);
const objects=[
 '<< /Type /Catalog /Pages 2 0 R >>',
 '<< /Type /Pages /Kids ['+pageIds.map(n=>n+' 0 R').join(' ')+'] /Count '+streams.length+' >>',
 '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
 '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
 '<< /Type /XObject /Subtype /Image /Width 240 /Height 240 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length '+logo.length+' >>\nstream\n'+logo+'\nendstream'
];
streams.forEach((content,i)=>{
 const contentId=pageIds[i]+1;
 objects.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> /XObject << /Logo 5 0 R >> >> /Contents '+contentId+' 0 R >>');
 objects.push('<< /Length '+content.length+' >>\nstream\n'+content+'\nendstream');
});
let out='%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';const offsets=[0];objects.forEach((o,i)=>{offsets.push(out.length);out+=`${i+1} 0 obj\n${o}\nendobj\n`;});const start=out.length;out+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;return Uint8Array.from(out,c=>c.charCodeAt(0));}

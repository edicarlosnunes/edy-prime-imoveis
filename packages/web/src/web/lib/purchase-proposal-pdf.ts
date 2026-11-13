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
// Layout compacto: todas as seções permanecem em UMA folha A4, como o modelo aprovado.
let y=520;
section('3. IMÓVEL',y);y-=21;
y=block(`Tipo: ${d.propertyType||'A preencher'} | Código: ${d.propertyCode||'Não informado'}`,36,y,523,1,'tipo/código',9);
y=block(`Endereço: ${d.propertyAddress||'A preencher'}`,36,y,523,2,'endereço do imóvel',9);
y=block(`Matrícula/cartório: ${d.registry||'Não informado'}`,36,y,523,1,'matrícula',9);
if(d.propertyDescription.trim())y=block(`Descrição do imóvel e condomínio: ${d.propertyDescription.trim()}`,36,y,523,4,'descrição do imóvel',8.7);
y-=8;
section('4. VALOR E CONDIÇÕES DE PAGAMENTO',y);y-=21;
text(`Valor total oferecido: ${d.amount?'R$ '+proposalMoney(d.amount):'A definir pelo comprador'}`,36,y,11,true);y-=15;
text(`Sinal/entrada: ${d.deposit?'R$ '+proposalMoney(d.deposit):'Não informado'} | Data: ${proposalDate(d.depositDate)} | Saldo: ${d.balance?'R$ '+proposalMoney(d.balance):'Não informado'}`,36,y,9.2);y-=16;
for(const [label,value,max] of [['Forma de pagamento',d.payment,2],['Parcelamento',d.installments||'Não se aplica',2],['Financiamento / FGTS / permuta',d.financing||'Não se aplica',2]] as const){y=block(`${label}: ${value}`,36,y,523,max,label,9);}
y-=8;
section('5. OBSERVAÇÕES E CONDIÇÕES ESPECÍFICAS',y);y-=21;
y=block(d.notes||'Sem observações adicionais.',36,y,523,3,'observações',9);
y-=8;
section('6. CONDIÇÕES DA PROPOSTA',y);y-=21;
y=block(PROPOSAL_TERMS,36,y,523,4,'condições',8.8);
y-=3;
y=block(`Comissão de intermediação: ${d.commissionRate.replace('.',',')}% sobre o valor total oferecido, ${d.amount?'R$ '+proposalMoney(d.amount):'valor a definir'} = ${commissionMoney(d.amount,d.commissionRate)}`,36,y,523,2,'comissão',9);
if(d.commission.trim())y=block(`Condições de pagamento da comissão: ${d.commission.trim()}`,36,y,523,2,'condições da comissão',8.7);
if(y<140)throw Error('O texto ultrapassa o espaço de uma folha A4. Resuma a descrição do imóvel ou as observações.');
text(`Local: ${d.city||'A definir'} | Data: ${proposalDate(d.date)}`,36,Math.max(135,y-4),9);
// Space above every line is kept clear for handwritten or digital signatures.
function signature(name:string,label:string,x:number,y:number,w:number){rule(x,y,w);text(label,x,y-11,8,true);block(name,x,y-22,w,2,'nome na assinatura',8);}
signature(d.seller.name||'A preencher',d.seller.kind==='pj'?'Vendedora - aceite (PJ)':'Vendedor - aceite',36,100,162);signature(d.buyer.name||'A preencher',d.buyer.kind==='pj'?'Compradora - proponente (PJ)':'Comprador - proponente',217,100,162);
signature('E. Santos | CRECI 134718-F','Intermediário',398,100,161);
if(d.seller.kind==='pf'&&d.seller.hasSpouse)signature(d.seller.spouseName,'Cônjuge do vendedor',36,40,253);if(d.buyer.kind==='pf'&&d.buyer.hasSpouse)signature(d.buyer.spouseName,'Cônjuge do comprador',306,40,253);

const logo=atob(AUTHORIZATION_LOGO_JPEG);
const content=ops.join('\n');
const objects=[
 '<< /Type /Catalog /Pages 2 0 R >>',
 '<< /Type /Pages /Kids [6 0 R] /Count 1 >>',
 '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
 '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
 '<< /Type /XObject /Subtype /Image /Width 240 /Height 240 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length '+logo.length+' >>\nstream\n'+logo+'\nendstream',
 '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> /XObject << /Logo 5 0 R >> >> /Contents 7 0 R >>',
 '<< /Length '+content.length+' >>\nstream\n'+content+'\nendstream'
];
let out='%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';const offsets=[0];objects.forEach((o,i)=>{offsets.push(out.length);out+=`${i+1} 0 obj\n${o}\nendobj\n`;});const start=out.length;out+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;return Uint8Array.from(out,c=>c.charCodeAt(0));}

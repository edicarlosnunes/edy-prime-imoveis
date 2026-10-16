export type AuthorizationData = Record<'owner'|'document'|'identity'|'phone'|'email'|'ownerAddress'|'propertyAddress'|'type'|'area'|'price'|'commission'|'days'|'exclusive'|'notes'|'city',string>;
export function authorizationLines(d:AuthorizationData,date:string) {
return ['E. SANTOS | GESTOR IMOBILIÁRIO','CRECI 134718-F','AUTORIZAÇÃO DE VENDA / INTERMEDIAÇÃO',
`Proprietário(a): ${d.owner}`,`CPF/CNPJ: ${d.document} | Identidade: ${d.identity}`,`Contato: ${d.phone} | E-mail: ${d.email||'Não informado'}`,`Endereço do proprietário: ${d.ownerAddress}`,`Imóvel: ${d.type} | Área informada (m²): ${d.area||'Não informada'}`,`Endereço completo do imóvel: ${d.propertyAddress}`,`Preço autorizado de venda: R$ ${d.price}`,
'O(A) proprietário(a) autoriza E. Santos a intermediar a negociação do imóvel identificado nesta autorização.',
'Autoriza a divulgação do imóvel nos canais da imobiliária, incluindo site, portais e redes sociais.',
'Autoriza o uso das fotos e das informações do imóvel exclusivamente para fins de divulgação da venda.',
'Autoriza a apresentação do imóvel a interessados e o recebimento e a apresentação de propostas.',
`Comissão de intermediação: ${d.commission}% sobre o valor da venda.`, `Prazo de vigência: ${d.days} dias, contado da assinatura.`,d.exclusive==='sim'?'Autorização com EXCLUSIVIDADE.':'Autorização SEM exclusividade.',
...(d.notes.trim()?[`Observações e condições adicionais: ${d.notes}`]:[]),`Local e data do preenchimento: ${d.city}, ${date}.`,
'Confira os dados e as condições antes de assinar. O preenchimento não equivale a assinatura.','Assinatura do(a) proprietário(a):','','________________________________________________________',d.owner,'Espaço para assinatura eletrônica do proprietário.','Após assinar, envie o PDF original assinado ao corretor pelo WhatsApp ou e-mail.'];
}
function ansi(t:string){return t.normalize('NFC').replace(/[–—]/g,'-').replace(/[“”]/g,'"').replace(/[‘’]/g,"'").replace(/[^\x20-\xFF\n]/g,'?');}
function escaped(t:string){return ansi(t).replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');}
export function authorizationPdf(d:AuthorizationData,now=new Date()):Uint8Array {
 const wrapped:string[]=[];
 for(const line of authorizationLines(d,now.toLocaleDateString('pt-BR'))){
  let current='';
  for(const word of line.replace(/\s+/g,' ').split(' ')){
   if((current+' '+word).length>83&&current){wrapped.push(current);current='';}
   let rest=word;while(rest.length>83){if(current){wrapped.push(current);current='';}wrapped.push(rest.slice(0,83));rest=rest.slice(83);}
   current+=(current?' ':'')+rest;
  }wrapped.push(current);if(line==='AUTORIZAÇÃO DE VENDA / INTERMEDIAÇÃO'||line.startsWith('Preço autorizado')||line.startsWith('Autorização ')||line.startsWith('Local e data')||line.startsWith('Assinatura do'))wrapped.push('');
 }
 const signature=wrapped.findIndex(l=>l.startsWith('Assinatura do(a)'));
 if(signature>=0&&signature%48>38)wrapped.splice(signature,0,...Array(48-signature%48).fill(''));
 const pages:string[][]=[];for(let i=0;i<wrapped.length;i+=48)pages.push(wrapped.slice(i,i+48));
 const objects=['','','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'];const kids:string[]=[];
 pages.forEach((page,index)=>{const id=objects.length+1; kids.push(`${id} 0 R`);
 const text=ansi(`BT /F1 11 Tf 14 TL 48 790 Td\n${page.map((l,i)=>`${i?'T* ':''}(${escaped(l)}) Tj`).join('\n')}\nET\nBT /F1 9 Tf 48 28 Td (Página ${index+1} de ${pages.length}) Tj ET`);
 objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /Font << /F1 3 0 R >> >> /Contents ${id+1} 0 R >>`,`<< /Length ${text.length} >>\nstream\n${text}\nendstream`);
 });objects[0]='<< /Type /Catalog /Pages 2 0 R >>';objects[1]=`<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages.length} >>`;
 let out='%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';const offsets=[0];objects.forEach((o,i)=>{offsets.push(out.length);out+=`${i+1} 0 obj\n${o}\nendobj\n`;});const xref=out.length;
 out+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(o=>`${String(o).padStart(10,'0')} 00000 n \n`).join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
 return Uint8Array.from(out,c=>c.charCodeAt(0));
}

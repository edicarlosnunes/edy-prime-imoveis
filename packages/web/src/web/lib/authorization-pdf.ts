export function authorizationCommission(value:string):number { const text=value.trim(); return text === '' ? 6 : /^\d+(?:[.,]\d+)?\s*%?$/.test(text) ? Number(text.replace(/\s*%$/, '').replace(',','.')) : NaN; }
export type AuthorizationData = Record<'owner'|'document'|'phone'|'email'|'ownerAddress'|'propertyAddress'|'type'|'bedrooms'|'parking'|'floors'|'price'|'commission'|'startDate'|'endDate'|'notes'|'city',string>;
export function authorizationLines(d:AuthorizationData,date:string) {
return ['E. SANTOS | GESTOR IMOBILIÁRIO','CRECI 134718 F | Perito imobiliário CNAE 55.918','Rua Guimaraes Rosa, 492/163','esantosgestorimobiliario@gmail.com','AUTORIZAÇÃO DE VENDA / INTERMEDIAÇÃO',
`Eu, ${d.owner}, CPF ${d.document},`,
`Contato: ${d.phone} | E-mail: ${d.email||'Não informado'}`,
'autorizo a E. Santos, Gestor Imobiliário, CRECI 134718-F, a divulgar e intermediar a venda do meu imóvel abaixo identificado.',
`Tipo do imóvel: ${d.type}`,
`Endereço completo do imóvel: ${d.propertyAddress}`,
...(d.bedrooms ? [`Dormitórios: ${d.bedrooms} e demais dependências.`] : []),
...(d.parking ? [`Vagas de garagem: ${d.parking}.`] : []),
`Preço autorizado de venda: R$ ${d.price}`,
'Autorizo a divulgação no site, portais e redes sociais, o uso de fotos e informações para divulgar a venda, a apresentação do imóvel a interessados e o recebimento e encaminhamento de propostas.',
`Comissão de intermediação acordada: ${authorizationCommission(d.commission).toLocaleString('pt-BR')}% sobre o valor da venda.`,
`Validade da autorização: de ${d.startDate.split('-').reverse().join('/')} até ${d.endDate.split('-').reverse().join('/')}.`,
'Esta autorização de venda é SEM exclusividade.',
...(d.notes.trim()?[`Observações e condições adicionais: ${d.notes}`]:[]),`Local e data do preenchimento: ${d.city}, ${date}.`,
'Confira os dados e as condições antes de assinar. O preenchimento não equivale a assinatura.','Assinatura do(a) proprietário(a):','','________________________________________________________',d.owner,'Espaço para assinatura eletrônica do proprietário.','Após assinar, envie o PDF original assinado ao corretor pelo WhatsApp ou e-mail.'];
}
function ansi(t:string){return t.normalize('NFC').replace(/[–—]/g,'-').replace(/[“”]/g,'"').replace(/[‘’]/g,"'").replace(/[^\x20-\xFF\n]/g,'?');}
function escaped(t:string){return ansi(t).replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');}
export function authorizationPdf(d:AuthorizationData,now=new Date(),logoJpeg?:string):Uint8Array {
 return pdfFromAuthorizationLines(authorizationLines(d,now.toLocaleDateString('pt-BR')),logoJpeg);
}
export function pdfFromAuthorizationLines(lines:string[],logoJpeg?:string):Uint8Array {
 const wrapped:string[]=[];
 for(const line of lines){
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
 const objects=['','','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'];const kids:string[]=[];if(logoJpeg)objects.push(`<< /Type /XObject /Subtype /Image /Width 240 /Height 240 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${logoJpeg.length} >>\nstream\n${logoJpeg}\nendstream`);
 pages.forEach((page,index)=>{const id=objects.length+1; kids.push(`${id} 0 R`);
 const header=logoJpeg&&index===0;
 const text=(logoJpeg?'q 64 0 0 64 48 762 cm /Logo Do Q\n':'')+ansi((header?`BT /F1 10 Tf 14 TL 128 814 Td\n${page.slice(0,4).map((l,i)=>`${i?'T* ':''}(${escaped(l)}) Tj`).join('\n')}\nET\n`:'')+`BT /F1 11 Tf 14 TL 48 ${logoJpeg?740:790} Td\n${page.slice(header?4:0).map((l,i)=>`${i?'T* ':''}(${escaped(l)}) Tj`).join('\n')}\nET\nBT /F1 9 Tf 48 28 Td (Página ${index+1} de ${pages.length}) Tj ET`);
 objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /Font << /F1 3 0 R >> ${logoJpeg ? "/XObject << /Logo 4 0 R >>" : ""} >> /Contents ${id+1} 0 R >>`,`<< /Length ${text.length} >>\nstream\n${text}\nendstream`);
 });objects[0]='<< /Type /Catalog /Pages 2 0 R >>';objects[1]=`<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages.length} >>`;
 let out='%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';const offsets=[0];objects.forEach((o,i)=>{offsets.push(out.length);out+=`${i+1} 0 obj\n${o}\nendobj\n`;});const xref=out.length;
 out+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(o=>`${String(o).padStart(10,'0')} 00000 n \n`).join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
 return Uint8Array.from(out,c=>c.charCodeAt(0));
}

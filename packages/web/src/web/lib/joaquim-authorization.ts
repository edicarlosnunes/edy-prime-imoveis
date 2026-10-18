import {authorizationLines,pdfFromAuthorizationLines,type AuthorizationData} from './authorization-pdf';
import {rentalAuthorizationLines,type RentalAuthorizationData} from './rental-authorization-pdf';
export const JOAQUIM={name:'Joaquim Imóveis',company:'Empreendimentos Imobiliários Ltda.',creci:'23.091-J',address:'Av. Presidente Kennedy, 6884 - Cidade Ocian',city:'CEP 11704-100 - Praia Grande/SP',email:'joaquimimoveis@bol.com.br',website:'www.joaquimimoveis.com.br',logo:'/joaquim-logo.png'} as const;
export function joaquimAuthorizationLines(kind:'venda'|'locacao',data:AuthorizationData|RentalAuthorizationData,now=new Date()){
 const lines=kind==='venda'?authorizationLines(data,now.toLocaleDateString('pt-BR')):rentalAuthorizationLines(data as RentalAuthorizationData,now.toLocaleDateString('pt-BR'));
 lines.splice(0,4,'JOAQUIM IMÓVEIS | EMPREENDIMENTOS IMOBILIÁRIOS LTDA','CRECI '+JOAQUIM.creci+' | SEDE PRÓPRIA',JOAQUIM.address,JOAQUIM.city+' | '+JOAQUIM.email);
 const authorization=lines.findIndex(line=>line.startsWith('autorizo '));lines[authorization]=`autorizo a Joaquim Imóveis, Empreendimentos Imobiliários Ltda., CRECI ${JOAQUIM.creci}, a divulgar e intermediar a ${kind==='venda'?'venda':'locação'} do meu imóvel abaixo identificado.`;
 return lines;
}
export async function joaquimAuthorizationPdf(kind:'venda'|'locacao',data:AuthorizationData|RentalAuthorizationData){
 const image=new Image();image.src=JOAQUIM.logo;await image.decode();const canvas=document.createElement('canvas');canvas.width=240;canvas.height=240;const ctx=canvas.getContext('2d');if(!ctx)throw Error('Não foi possível preparar o logotipo.');ctx.fillStyle='#000';ctx.fillRect(0,0,240,240);const scale=Math.min(240/image.naturalWidth,240/image.naturalHeight);const w=image.naturalWidth*scale,h=image.naturalHeight*scale;ctx.drawImage(image,(240-w)/2,(240-h)/2,w,h);const logo=atob(canvas.toDataURL('image/jpeg',0.95).split(',')[1]);
 return pdfFromAuthorizationLines(joaquimAuthorizationLines(kind,data),logo);
}

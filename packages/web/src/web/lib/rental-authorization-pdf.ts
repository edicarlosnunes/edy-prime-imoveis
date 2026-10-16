import {pdfFromAuthorizationLines,type AuthorizationData} from './authorization-pdf';
export type RentalAuthorizationData=AuthorizationData & {condominium:string;iptu:string};
export function rentalAuthorizationLines(d:RentalAuthorizationData,date:string){return [
'E. SANTOS | GESTOR IMOBILIÁRIO','CRECI 134718 F | Perito imobiliário CNAE 55.918','Rua Guimaraes Rosa, 492/163','esantosgestorimobiliario@gmail.com','AUTORIZAÇÃO DE LOCAÇÃO / INTERMEDIAÇÃO',
`Eu, ${d.owner}, CPF ${d.document},`,
`Contato: ${d.phone} | E-mail: ${d.email||'Não informado'}`,
'autorizo E. Santos, Gestor Imobiliário, CRECI 134718-F, a divulgar e intermediar a locação do meu imóvel abaixo identificado.',
`Tipo do imóvel: ${d.type}`,`Endereço completo do imóvel: ${d.propertyAddress}`,
...(d.bedrooms?[`Dormitórios: ${d.bedrooms} e demais dependências.`]:[]),
...(d.parking?[`Vagas de garagem: ${d.parking}.`]:[]),...(d.floors?[`Pavimentos: ${d.floors}.`]:[]),
`Valor mensal do aluguel: R$ ${d.price}`,
`Condomínio: ${d.condominium?'R$ '+d.condominium:'Não informado'}`,
`IPTU: ${d.iptu?'R$ '+d.iptu:'Não informado'}`,
'Autorizo a divulgação de informações e imagens do imóvel no site, portais e redes sociais, a apresentação a interessados, o agendamento de visitas e o encaminhamento de propostas para minha aprovação.',
`Remuneração pela intermediação e condição de pagamento: ${d.commission}.`,
`Validade da autorização: de ${d.startDate.split('-').reverse().join('/')} até ${d.endDate.split('-').reverse().join('/')}.`,
'Esta autorização de locação é SEM exclusividade. Não inclui administração de aluguéis nem poderes para assinar contrato de locação em meu nome.',
'A locação dependerá da minha aprovação das condições finais e da formalização do contrato próprio entre as partes.',
...(d.notes.trim()?[`Observações e condições adicionais: ${d.notes}`]:[]),
`Local e data do preenchimento: ${d.city}, ${date}.`,
'Confira os dados e as condições antes de assinar. O preenchimento não equivale a assinatura.',
'Assinatura do(a) proprietário(a):','','________________________________________________________',d.owner,'Espaço para assinatura eletrônica do proprietário.',
'Após assinar, envie o PDF original assinado ao corretor pelo WhatsApp ou e-mail.'];}
export function rentalAuthorizationPdf(d:RentalAuthorizationData,now=new Date(),logoJpeg?:string){return pdfFromAuthorizationLines(rentalAuthorizationLines(d,now.toLocaleDateString('pt-BR')),logoJpeg);}

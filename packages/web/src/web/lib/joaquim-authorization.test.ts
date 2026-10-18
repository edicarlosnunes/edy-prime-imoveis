import {test,expect} from 'bun:test';
import {joaquimAuthorizationLines,JOAQUIM} from './joaquim-authorization';
import {authorizationLines,pdfFromAuthorizationLines,type AuthorizationData} from './authorization-pdf';
import type {RentalAuthorizationData} from './rental-authorization-pdf';
const data:RentalAuthorizationData={owner:'Pessoa teste',document:'12345678900',phone:'13999990000',email:'',ownerAddress:'',propertyAddress:'Rua Exemplo, 10',type:'Casa',bedrooms:'2',parking:'1',floors:'',price:'2.500,00',commission:'6',startDate:'2026-10-18',endDate:'2027-01-16',notes:'',city:'Praia Grande/SP',condominium:'400,00',iptu:'100,00'};
test('Joaquim PDF identifies the correct agency and preserves original E Santos output',()=>{
 const before=authorizationLines(data,'18/10/2026');
 const sale=joaquimAuthorizationLines('venda',data,new Date('2026-10-18T12:00:00Z'));
 expect(sale.join('\n')).toContain('Joaquim Imóveis, Empreendimentos Imobiliários Ltda., CRECI '+JOAQUIM.creci);
 expect(sale.join('\n')).not.toContain('E. Santos');expect(sale.join('\n')).not.toContain('esantosgestor');expect(sale.join('\n')).toContain(JOAQUIM.email);expect(sale.join('\n')).toContain('SEM exclusividade');
 expect(authorizationLines(data,'18/10/2026')).toEqual(before);
 const bytes=pdfFromAuthorizationLines(sale);expect(new TextDecoder('latin1').decode(bytes)).toContain('JOAQUIM');expect(new TextDecoder('latin1').decode(bytes)).not.toContain('134718');
});
test('rental copy retains separate taxes and negotiated remuneration, without changing customer text',()=>{
 const rental=joaquimAuthorizationLines('locacao',{...data,owner:'E. Santos é o proprietário',commission:'Um aluguel'});
 expect(rental.join('\n')).toContain('Eu, E. Santos é o proprietário');expect(rental.join('\n')).toContain('Condomínio: R$ 400,00');expect(rental.join('\n')).toContain('IPTU: R$ 100,00');expect(rental.join('\n')).toContain('Um aluguel');expect(rental.join('\n')).not.toContain('sobre o valor da venda');
});

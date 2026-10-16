import {test,expect} from 'bun:test';
import {rentalAuthorizationLines,rentalAuthorizationPdf,type RentalAuthorizationData} from './rental-authorization-pdf';
const data:RentalAuthorizationData={owner:'Pessoa teste',document:'12345678900',phone:'13999990000',email:'',ownerAddress:'',propertyAddress:'Rua Teste, 1, Praia Grande/SP',type:'Apartamento',bedrooms:'2',parking:'1',floors:'',price:'2.000,00',condominium:'450,00',iptu:'120,00',commission:'Um aluguel, na assinatura do contrato',startDate:'2026-10-16',endDate:'2027-01-14',notes:'',city:'Praia Grande/SP'};
test('rental authorization keeps rent, condominium and IPTU distinct without sale commission',()=>{
 const lines=rentalAuthorizationLines(data,'16/10/2026');
 expect(lines).toContain('Condomínio: R$ 450,00');expect(lines).toContain('IPTU: R$ 120,00');expect(lines).toContain('Valor mensal do aluguel: R$ 2.000,00');
 const text=lines.join('\n');expect(text).toContain(data.commission);expect(text).toContain('SEM exclusividade');expect(text).not.toContain('venda');expect(text).not.toContain('6%');
 expect(new TextDecoder().decode(rentalAuthorizationPdf(data))).toStartWith('%PDF-1.4');
});

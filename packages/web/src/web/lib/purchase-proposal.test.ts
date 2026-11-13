import {describe,it,expect} from 'bun:test';
import {initialProposal,proposalToday,proposalExpiry,validCnpj,type PurchaseProposal} from './purchase-proposal';
import {purchaseProposalPdf} from './purchase-proposal-pdf';
export function exampleProposal():PurchaseProposal{const d=initialProposal(new Date('2026-10-22T15:00:00Z'));d.seller={kind:'pf',cnpj:'',representative:'',name:'Mariana de Oliveira Santos',cpf:'123.456.789-09',nationality:'Brasileira',civilStatus:'Casada',profession:'Empresária',address:'Rua das Acácias, 120, apto 43, Vila Caiçara, Praia Grande/SP, CEP 11700-000',phone:'(13) 99999-0000',email:'mariana.exemplo@example.com',hasSpouse:true,spouseName:'Roberto de Oliveira Santos',spouseCpf:'987.654.321-00'};d.buyer={...d.seller,name:'Fernando Almeida Costa',email:'fernando.exemplo@example.com',spouseName:'Juliana Almeida Costa'};Object.assign(d,{propertyType:'Apartamento',propertyAddress:'Rua Guimarães Rosa, 492, apto 163, Vila Caiçara, Praia Grande/SP, CEP 11700-000',propertyCode:'AP-EXEMPLO',registry:'Matrícula 12345, Cartório de Registro de Imóveis de Praia Grande',amount:'110.000,00',deposit:'80.000,00',depositDate:'2026-11-01',balance:'30.000,00',payment:'Entrada por transferência bancária e saldo conforme as condições abaixo.',installments:'Saldo em 10 parcelas de R$ 3.000,00, vencendo no dia 10 de cada mês.',financing:'Sem financiamento ou permuta. Condições sujeitas à conferência documental.',notes:'Exemplo de preenchimento para conferir o espaço da proposta. Os dados e valores são fictícios.',commission:'6% sobre a venda, pagos pelo vendedor, conforme ajuste entre as partes.',city:'Praia Grande/SP'});return d;}
describe('proposta independente',()=>{it('usa data de São Paulo e prazo editável, inclusive virada de mês',()=>{expect(proposalToday(new Date('2026-10-23T01:00:00Z'))).toBe('2026-10-22');expect(proposalExpiry('2026-10-22','30')).toBe('2026-11-21');expect(proposalExpiry('2026-10-22','7')).toBe('2026-10-29');expect(proposalExpiry('2028-02-01','30')).toBe('2028-03-02');expect(()=>proposalExpiry('2026-10-22','0')).toThrow();});it('gera uma única página com cinco assinaturas',()=>{const out=new TextDecoder('latin1').decode(purchaseProposalPdf(exampleProposal()));expect(out).toContain('/Count 1');expect(out.match(/\/Type \/Page\b/g)?.length).toBe(1);expect(out).toContain('Juliana Almeida Costa');expect(out).toContain('Roberto de Oliveira Santos');});it('omite cônjuges desmarcados, mesmo com valores antigos',()=>{const d=exampleProposal();d.seller.hasSpouse=false;d.buyer.hasSpouse=false;const out=new TextDecoder('latin1').decode(purchaseProposalPdf(d));expect(out).not.toContain('Juliana Almeida Costa');expect(out).not.toContain('Roberto de Oliveira Santos');});it('aceita dados mínimos do comprador e gera PDF sem vendedor ou dados do imóvel',()=>{
 const d=initialProposal(new Date('2026-11-13T17:00:00Z'));
 d.buyer.name='Comprador de Exemplo';
 d.buyer.phone='13999999999';
 const out=new TextDecoder('latin1').decode(purchaseProposalPdf(d));
 expect(out).toContain('Comprador de Exemplo');
 expect(out).toContain('A preencher');
 expect(out).toContain('A definir pelo comprador');
 expect(out).toContain('/Count 1');
});
it('permite salvar PDF sem comprador preenchido, com descrição e comissão',()=>{
 const d=initialProposal();d.propertyDescription='Apartamento com dois dormitórios e sacada';d.amount='610.000,00';d.commissionRate='5';
 const pdf=new TextDecoder('latin1').decode(purchaseProposalPdf(d));
 expect(pdf).toContain('/Count 1');
 expect(pdf).toContain('Apartamento com dois dormitórios e sacada');
 expect(pdf).toContain('30.500,00');
 expect(pdf).toContain('A preencher');
});
it('permite salvar proposta com empresa compradora sem CNPJ ainda preenchido',()=>{
 const d=initialProposal();d.buyer.kind='pj';
 expect(()=>purchaseProposalPdf(d)).not.toThrow();
});
it('aceita empresa compradora com CNPJ válido e gera PDF sem campos de pessoa física',()=>{
 const d=initialProposal(new Date('2026-11-13T17:00:00Z'));
 d.buyer.kind='pj';
 d.buyer.name='Construtora Exemplo Ltda';
 d.buyer.cnpj='04.252.011/0001-10';
 d.buyer.representative='Responsável Exemplo';
 d.buyer.phone='13999990000';
 d.buyer.address='Rua da Empresa, 100, Praia Grande/SP';
 const pdf=new TextDecoder('latin1').decode(purchaseProposalPdf(d));
 expect(validCnpj(d.buyer.cnpj)).toBe(true);
 expect(pdf).toContain('Construtora Exemplo Ltda');
 expect(pdf).toContain('04.252.011/0001-10');
 expect(pdf).toContain('Responsável Exemplo');
 expect(pdf).not.toContain('Nacionalidade:');
 expect(pdf).toContain('/Count 1');
});
it('aceita vendedor pessoa jurídica com comprador pessoa física',()=>{
 const d=initialProposal(new Date('2026-11-13T17:00:00Z'));
 d.buyer.name='Comprador Exemplo';d.buyer.phone='13999990000';
 d.seller.kind='pj';d.seller.name='Construtora Exemplo Ltda';
 d.seller.cnpj='04.252.011/0001-10';
 d.seller.representative='Administradora Exemplo';
 const pdf=new TextDecoder('latin1').decode(purchaseProposalPdf(d));
 expect(pdf).toContain('Administradora Exemplo');
 expect(pdf).toContain('/Count 1');
});
it('rejeita CNPJ inválido do comprador ou vendedor sem exigir CPF do PJ',()=>{
 const d=initialProposal();
 d.buyer.kind='pj';d.buyer.name='Empresa Compradora';
 d.buyer.phone='13999990000';
 expect(()=>purchaseProposalPdf(d)).not.toThrow();
 d.buyer.cnpj='11.111.111/1111-11';
 expect(()=>purchaseProposalPdf(d)).toThrow('Confira o CNPJ');
 d.buyer.cnpj='04.252.011/0001-10';
 d.seller.kind='pj';d.seller.cnpj='11.111.111/1111-11';
 expect(()=>purchaseProposalPdf(d)).toThrow('Confira o CNPJ');
});
it('não corta texto longo silenciosamente nem produz segunda página',()=>{const d=exampleProposal();d.notes='Observação extensa '.repeat(100);expect(()=>purchaseProposalPdf(d)).toThrow('Resuma');});});

import { expect, test } from 'bun:test';
import { authorizationLines, authorizationPdf, type AuthorizationData } from './authorization-pdf';
const data:AuthorizationData={owner:'José da Conceição',document:'00000000000',phone:'00000000000',email:'teste@example.com',ownerAddress:'Rua do Proprietário, 10',propertyAddress:'Rua do Imóvel, 20, apto 3, Praia Grande/SP',type:'Apartamento',bedrooms:'2',parking:'1',floors:'',price:'590.000,00',commission:'5',startDate:'2026-10-16',endDate:'2026-12-15',notes:'Condição (teste) com acentos e barra \\',city:'Praia Grande/SP'};
test('authorization uses only supplied commercial terms and leaves signature pending',()=>{
 const lines=authorizationLines(data,'16/10/2026').join('\n');
 expect(lines).toContain('SEM exclusividade');expect(lines).toContain('5%');expect(lines).toContain('de 16/10/2026 até 15/12/2026');expect(lines).toContain('590.000,00');expect(lines).toContain('O preenchimento não equivale a assinatura');expect(lines).toContain('Eu, José da Conceição');expect(lines).toContain('Dormitórios: 2');expect(lines).toContain('Vagas de garagem: 1');expect(lines).not.toContain('com EXCLUSIVIDADE');
});
test('PDF cross reference points to each object despite accented characters',()=>{
 const pdf=authorizationPdf(data,new Date('2026-10-16T15:00:00Z'));
 const raw=Array.from(pdf,c=>String.fromCharCode(c)).join('');expect(raw.startsWith('%PDF-1.4')).toBe(true);
 const xref=Number(raw.match(/startxref\n(\d+)/)?.[1]);expect(raw.slice(xref,xref+4)).toBe('xref');
 const offsets=raw.slice(xref).split('\n').filter(l=>/^\d{10} 00000 n/.test(l));
 offsets.forEach((line,i)=>expect(raw.slice(Number(line.slice(0,10)))).toStartWith(`${i+1} 0 obj`));
});

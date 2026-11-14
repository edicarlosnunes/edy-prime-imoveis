import {describe,it,expect} from 'bun:test';
import {valorPorExtenso,dinheiroComExtenso,numeroMonetarioBR,anotarValoresMonetarios} from './valor-por-extenso';
import {initialProposal} from './purchase-proposal';
import {purchaseProposalPdf} from './purchase-proposal-pdf';

describe('valores por extenso',()=>{
 it('converte reais e centavos',()=>{
  expect(valorPorExtenso(610000)).toBe('seiscentos e dez mil reais');
  expect(valorPorExtenso(30500)).toBe('trinta mil e quinhentos reais');
  expect(valorPorExtenso(250000)).toBe('duzentos e cinquenta mil reais');
  expect(valorPorExtenso(360000)).toBe('trezentos e sessenta mil reais');
  expect(valorPorExtenso(1.01)).toBe('um real e um centavo');
  expect(valorPorExtenso(1000000)).toBe('um milhão de reais');
 });
 it('converte valores em textos livres sem mudar quantidades e datas',()=>{
  const a=anotarValoresMonetarios('Entrada de 250 MIL, carro de R$ 140.000,00, 88 parcelas de 2.500,00 em 14/11/2026');
  expect(a).toContain('duzentos e cinquenta mil reais');
  expect(a).toContain('cento e quarenta mil reais');
  expect(a).toContain('dois mil e quinhentos reais');
  expect(a).toContain('88 parcelas');
  expect(a).toContain('14/11/2026');
 });
 it('gera PDF A4 em uma página com oferta, sinal, saldo e comissão por extenso',()=>{
  const d=initialProposal(new Date('2026-11-13T17:00:00Z'));
  d.amount='610.000,00';d.deposit='250.000,00';d.balance='360.000,00';d.commissionRate='5';
  const pdf=new TextDecoder('latin1').decode(purchaseProposalPdf(d));
  expect(pdf).toContain('/Count 1');
  expect(pdf).toContain('seiscentos e dez mil reais');
  expect(pdf).toContain('duzentos e cinquenta mil reais');
  expect(pdf).toContain('trezentos e sessenta mil reais');
  expect(pdf).toContain('trinta mil e quinhentos reais');
 });
});

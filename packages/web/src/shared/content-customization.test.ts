import { describe, expect, test } from 'bun:test';
import { contentCustomizationSchema, customizationInstructions } from './content-customization';
const selected = contentCustomizationSchema.parse({homeOwnership:true, financing:true});
const facts = {purpose:'venda',type:'sobrado',price:580000,negotiation:{methods:['Financiamento']}};
describe('personalização comercial', () => {
  test('combina casa própria e simulação quando os dados permitem', () => {
    const prompt = customizationInstructions(selected,facts);
    expect(prompt).toContain('Use uma abertura criativa sobre sair do aluguel');
    expect(prompt).toContain('Inclua convite para solicitar simulação');
    expect(prompt).toContain('exatamente 4 ou 5 hashtags');
  });
  test('não oferece financiamento sem condição cadastrada', () => {
    expect(customizationInstructions(selected,{...facts,negotiation:{methods:[]}})).toContain('Não inclua convite de simulação');
  });
  test('locação, comercial e alto padrão não recebem sair do aluguel', () => {
    for (const changed of [{purpose:'locacao'},{type:'sala_comercial'},{price:1500000}]) {
      const prompt = customizationInstructions(selected,{...facts,...changed});
      expect(prompt).not.toContain('Use uma abertura criativa sobre sair do aluguel');
    }
  });
  test('desconto exige preço anterior maior que atual e escolha marcada', () => {
    expect(customizationInstructions(selected,{...facts,price:640000,opportunityPrice:580000})).toContain('Destaque a redução real');
    expect(customizationInstructions({...selected,priceDrop:false},{...facts,price:640000,opportunityPrice:580000})).toContain('Não anuncie desconto');
  });
  test('formulário respeita cadastro antes de contato e opções desmarcadas', () => {
    const prompt = customizationInstructions({...selected,destination:'form',hashtags:false}, facts);
    expect(prompt).toContain('após o cadastro');
    expect(prompt).toContain('Não inclua hashtags');
  });
});

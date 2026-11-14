/** Valores monetários em português do Brasil para PDFs de propostas. */
const unidades=['','um','dois','três','quatro','cinco','seis','sete','oito','nove'];
const especiais=['dez','onze','doze','treze','quatorze','quinze','dezesseis','dezessete','dezoito','dezenove'];
const dezenas=['','','vinte','trinta','quarenta','cinquenta','sessenta','setenta','oitenta','noventa'];
const centenas=['','cento','duzentos','trezentos','quatrocentos','quinhentos','seiscentos','setecentos','oitocentos','novecentos'];
function ate999(n:number):string{
 if(n===100)return 'cem';
 const c=Math.floor(n/100),resto=n%100;
 const partes:string[]=[];
 if(c)partes.push(centenas[c]);
 if(resto>=20){const d=Math.floor(resto/10),u=resto%10;partes.push(dezenas[d]+(u?' e '+unidades[u]:''));}
 else if(resto>=10)partes.push(especiais[resto-10]);
 else if(resto)partes.push(unidades[resto]);
 return partes.join(' e ');
}
function inteiroPorExtenso(n:number):string{
 if(n===0)return 'zero';
 const grupos:[number,string,string][]=[
  [1_000_000_000_000,'trilhão','trilhões'],
  [1_000_000_000,'bilhão','bilhões'],
  [1_000_000,'milhão','milhões'],
  [1000,'mil','mil'],
  [1,'','']
 ];
 const partes:string[]=[];
 let restante=n;
 for(const [base,singular,plural] of grupos){
  const qtd=Math.floor(restante/base);
  if(!qtd)continue;
  restante%=base;
  if(base===1000&&qtd===1)partes.push('mil');
  else if(base===1)partes.push(ate999(qtd));
  else partes.push(ate999(qtd)+' '+(qtd===1?singular:plural));
 }
 if(partes.length===1)return partes[0];
 const ultimo=partes[partes.length-1];
 const temRestantePequeno=restante===0&&/^(?:[^\s]+(?: e [^\s]+)?)$/.test(ultimo);
 return partes.slice(0,-1).join(', ')+(temRestantePequeno?' e ':', ')+ultimo;
}
export function valorPorExtenso(valor:number):string{
 if(!Number.isFinite(valor)||valor<0||valor>999_999_999_999_999)throw Error('Valor fora do limite para escrita por extenso.');
 const centavosTotais=Math.round(valor*100);
 const reais=Math.floor(centavosTotais/100);
 const centavos=centavosTotais%100;
 const reaisTexto=reais===0?'zero real':inteiroPorExtenso(reais)+(reais>=1_000_000&&reais%1_000_000===0?' de reais':reais===1?' real':' reais');
 if(centavos===0)return reaisTexto;
 const centavosTexto=inteiroPorExtenso(centavos)+(centavos===1?' centavo':' centavos');
 return reais===0?centavosTexto:reaisTexto+' e '+centavosTexto;
}
export function numeroMonetarioBR(value:string):number{
 const v=value.trim().replace(/^R\$\s*/,'');
 if(!/^\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?$/.test(v)&&!/^\d+(?:,\d{1,2})?$/.test(v))throw Error('Valor monetário inválido.');
 const n=Number(v.replace(/\./g,'').replace(',','.'));
 if(!Number.isFinite(n)||n<0)throw Error('Valor monetário inválido.');
 return n;
}
export function dinheiroComExtenso(valor:number):string{
 return valor.toLocaleString('pt-BR',{style:'currency',currency:'BRL'})+' ('+valorPorExtenso(valor)+')';
}
/** Anota valores monetários explícitos no texto livre, sem alterar datas, documentos ou quantidades. */
export function anotarValoresMonetarios(texto:string):string{
 const comMil=texto.replace(/\b(\d{1,3})\s+mil\b(?!\s+(?:reais|habitantes|metros|m²))/gi,(trecho,qtd,offset,original)=>{
  if(/\(\s*$/.test(original.slice(Math.max(0,offset-2),offset)))return trecho;
  return dinheiroComExtenso(Number(qtd)*1000);
 });
 return comMil.replace(/(?:R\$\s*)?\d{1,3}(?:\.\d{3})+,\d{2}|R\$\s*\d+(?:,\d{1,2})?/g,(valor,offset,original)=>{
  const anterior=original.slice(Math.max(0,offset-3),offset);
  if(/\($/.test(anterior))return valor;
  try{return dinheiroComExtenso(numeroMonetarioBR(valor));}catch{return valor;}
 });
}

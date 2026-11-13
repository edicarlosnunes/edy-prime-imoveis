export type ProposalParty = Record<'name'|'cpf'|'nationality'|'civilStatus'|'profession'|'address'|'phone'|'email'|'spouseName'|'spouseCpf',string> & {hasSpouse:boolean;kind:'pf'|'pj';cnpj:string;representative:string};
export type PurchaseProposal = {seller:ProposalParty;buyer:ProposalParty;propertyType:string;propertyAddress:string;propertyCode:string;registry:string;amount:string;deposit:string;depositDate:string;balance:string;payment:string;installments:string;financing:string;notes:string;commission:string;city:string;date:string;duration:string};
export const emptyParty=():ProposalParty=>({name:'',cpf:'',nationality:'',civilStatus:'',profession:'',address:'',phone:'',email:'',hasSpouse:false,spouseName:'',spouseCpf:'',kind:'pf',cnpj:'',representative:''});
export function proposalToday(now=new Date()){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);const v=(k:string)=>parts.find(p=>p.type===k)!.value;return `${v('year')}-${v('month')}-${v('day')}`;}
export function proposalExpiry(date:string,duration:string){const days=Number(duration);if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isInteger(days)||days<1||days>3650)throw Error('Informe uma duração entre 1 e 3.650 dias.');const d=new Date(date+'T12:00:00Z');if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==date)throw Error('Data da proposta inválida.');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
export const proposalDate=(date:string)=>date?date.split('-').reverse().join('/'):'Não informado';
export function initialProposal(now=new Date()):PurchaseProposal{return {seller:emptyParty(),buyer:emptyParty(),propertyType:'',propertyAddress:'',propertyCode:'',registry:'',amount:'',deposit:'',depositDate:'',balance:'',payment:'',installments:'',financing:'',notes:'',commission:'',city:'',date:proposalToday(now),duration:'30'};}
export function proposalMoney(value:string){const v=value.trim();if(!/^\d+(?:\.\d{3})*(?:,\d{1,2})?$/.test(v))throw Error('Informe os valores em reais, por exemplo: 110.000,00.');const n=Number(v.replace(/\./g,'').replace(',','.'));if(!Number.isFinite(n)||n<=0)throw Error('Informe um valor maior que zero.');return n.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});}
/** Valida dígitos verificadores do CNPJ, inclusive valores informados com máscara. */
export function validCnpj(value:string){
 const x=value.replace(/\D/g,'');
 if(!/^\d{14}$/.test(x)||/^(\d)\1{13}$/.test(x))return false;
 const check=(digits:string,weights:number[])=>{const sum=[...digits].reduce((n,d,i)=>n+Number(d)*weights[i],0);const r=sum%11;return r<2?0:11-r;};
 return check(x.slice(0,12),[5,4,3,2,9,8,7,6,5,4,3,2])===Number(x[12])&&check(x.slice(0,13),[6,5,4,3,2,9,8,7,6,5,4,3,2])===Number(x[13]);
}
/** Dados mínimos de recebimento: os detalhes do vendedor e do negócio podem ser
 * completados pelo corretor depois. Não valida assinatura ou aceite do vendedor. */
export function validateProposal(d:PurchaseProposal){
 proposalExpiry(d.date,d.duration);
 if(!d.buyer.name.trim()||!d.buyer.phone.trim())throw Error('Informe o nome e o telefone do comprador.');
 for(const [label,p] of [['vendedor',d.seller],['comprador',d.buyer]] as const){
  if(p.kind!=='pf'&&p.kind!=='pj')throw Error(`Selecione pessoa física ou jurídica para o ${label}.`);
  if(p.kind==='pf'){
   if(p.cpf.trim()&&p.cpf.replace(/\D/g,'').length!==11)throw Error(`Confira o CPF do ${label} (11 dígitos).`);
   if(p.hasSpouse&&p.spouseCpf.trim()&&p.spouseCpf.replace(/\D/g,'').length!==11)throw Error(`Confira o CPF do cônjuge do ${label}.`);
  }else{
   if(label==='comprador'&&!p.cnpj.trim())throw Error('Informe o CNPJ da empresa compradora.');
   if(p.cnpj.trim()&&!validCnpj(p.cnpj))throw Error(`Confira o CNPJ do ${label} (14 dígitos válidos).`);
  }
 }
 for(const value of [d.amount,d.deposit,d.balance])if(value.trim())proposalMoney(value);
}

export const PROPOSAL_TERMS='O comprador apresenta esta oferta nas condições registradas. O aceite do vendedor será formalizado por assinatura dentro da validade. Alterações dependem da concordância das partes. A negociação observará a conferência documental e as condições expressas de financiamento, se houver, com formalização em instrumento próprio. Esta proposta não transfere a propriedade.';

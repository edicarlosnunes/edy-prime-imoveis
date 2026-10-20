import { Field, Input, MoneyInput, Select, Textarea } from "./ui";
import { PAYMENT_METHODS, type Negotiation } from "../../../shared/negotiation";
export function NegotiationFields({value,onChange,types}: {value:Negotiation;onChange:(value:Negotiation)=>void;types:string[]}) {
  function set<K extends keyof Negotiation>(key:K,next:Negotiation[K]) {onChange({...value,[key]:next});}
  function toggle(key:"methods"|"swapTypes", item:string, checked:boolean) {
    onChange({...value,[key]:checked ? [...value[key],item] : value[key].filter(current=>current!==item)});
  }
  return <section className="mt-5 space-y-4 border-t border-line pt-5">
    <h3 className="text-sm font-semibold text-deep">Condições de pagamento e negociação</h3>
    <p className="text-xs text-muted">Opcional. Todas as informações preenchidas serão divulgadas na apresentação do imóvel. Informe apenas condições confirmadas com o proprietário.</p>
    <fieldset><legend className="mb-2 text-xs font-medium text-muted">Condições aceitas</legend><div className="flex flex-wrap gap-x-5 gap-y-3">{PAYMENT_METHODS.map(method=><label key={method} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={value.methods.includes(method as Negotiation["methods"][number])} onChange={event=>toggle("methods",method,event.target.checked)}/>{method}</label>)}</div></fieldset>
    {value.methods.includes("Permuta por imóvel") && <fieldset><legend className="mb-2 text-xs font-medium text-muted">Tipo de imóvel aceito na permuta</legend><div className="flex flex-wrap gap-x-5 gap-y-3">{Array.from(new Set([...types,...value.swapTypes])).map(type=><label key={type} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={value.swapTypes.includes(type)} onChange={event=>toggle("swapTypes",type,event.target.checked)}/>{type}</label>)}</div></fieldset>}
    <Field label="Pagamento ao proprietário (R$)" hint="Opcional. Não altera nem recalcula o valor do imóvel."><MoneyInput value={value.cash} onChange={next=>set("cash",next)} placeholder="Ex.: 80.000,00"/></Field>
    <Field label="Detalhes da negociação"><Textarea maxLength={800} rows={3} value={value.details} onChange={event=>set("details",event.target.value)} placeholder="Ex.: aceita carro como parte do pagamento; estuda permuta por apartamento em Praia Grande."/></Field>
    <div className="grid gap-4 sm:grid-cols-2"><Field label="Valor dos débitos existentes (R$)" hint="Débitos acumulados; separado do IPTU e condomínio regulares acima."><MoneyInput value={value.debtAmount} onChange={next=>set("debtAmount",next)} placeholder="Ex.: 30.000,00"/></Field>
    <Field label="Responsabilidade pelos débitos"><Select value={value.debtResponsibility} onChange={event=>set("debtResponsibility",event.target.value as Negotiation["debtResponsibility"])}><option value="">Não informado</option>{["Proprietário quita","Comprador assume","A negociar"].map(option=><option key={option}>{option}</option>)}</Select></Field></div>
    <Field label="Descrição dos débitos"><Input maxLength={400} value={value.debtDetails} onChange={event=>set("debtDetails",event.target.value)} placeholder="Ex.: IPTU em atraso, valor informado pelo proprietário."/></Field>
  </section>;
}

import { DEFAULT_REVIEW, REVIEW_OPTIONS, reviewDue, type ReviewSchedule } from "../../../shared/revalidation";
import { Field, Input, Select } from "./ui";
export function ReviewScheduleFields({value=DEFAULT_REVIEW,onChange,base}:{value:ReviewSchedule;onChange:(value:ReviewSchedule)=>void;base:string}) {
  let due="Informe a data base";
  try { const date=reviewDue(new Date(`${base}T12:00:00-03:00`),value); if(!Number.isNaN(date.getTime())) due=date.toLocaleDateString("pt-BR",{timeZone:"America/Sao_Paulo"}); } catch {due="Informe uma data válida";}
  return <div className="space-y-3">
    <Field label="Prazo para revisão"><Select value={value.interval} onChange={e=>onChange({interval:e.target.value as ReviewSchedule["interval"],...(e.target.value === "custom" ? {date:value.date ?? ""} : {})})}>{REVIEW_OPTIONS.map(([key,label])=><option key={key} value={key}>{label}</option>)}</Select></Field>
    {value.interval === "custom" && <Field label="Data da próxima revisão"><Input type="date" value={value.date ?? ""} onChange={e=>onChange({...value,date:e.target.value})}/></Field>}
    <p className="text-sm text-deep">Próxima revisão: <strong>{due}</strong></p>
    <p className="text-xs text-muted">No vencimento: até três perguntas ao proprietário, uma a cada 24 horas. Sem resposta, aviso ao responsável 24 horas após a última tentativa.</p>
  </div>;
}

import { z } from "zod";
export const reviewScheduleSchema = z.object({
  interval: z.enum(["90d", "60d", "3m", "4m", "5m", "6m", "custom"]).default("90d"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).refine(value => value.interval !== "custom" || Boolean(value.date), "Informe a data da revisão");
export type ReviewSchedule = z.infer<typeof reviewScheduleSchema>;
export const DEFAULT_REVIEW: ReviewSchedule = { interval: "90d" };
export const REVIEW_OPTIONS = [["90d", "90 dias (padrão)"], ["60d", "60 dias"], ["3m", "3 meses"], ["4m", "4 meses"], ["5m", "5 meses"], ["6m", "6 meses"], ["custom", "Data personalizada"]] as const;
export function reviewDue(base: Date, schedule: ReviewSchedule): Date {
  if (schedule.interval === "custom" && schedule.date) {
    const date = new Date(`${schedule.date}T12:00:00-03:00`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0,10) !== schedule.date) throw new Error("Data da revisão inválida");
    return date;
  }
  const result = new Date(base);
  if (schedule.interval.endsWith("d")) result.setUTCDate(result.getUTCDate() + Number(schedule.interval.slice(0,-1)));
  else {
    const day = result.getUTCDate(); result.setUTCDate(1);
    result.setUTCMonth(result.getUTCMonth() + Number(schedule.interval.slice(0,-1)));
    const end = new Date(Date.UTC(result.getUTCFullYear(),result.getUTCMonth()+1,0)).getUTCDate();
    result.setUTCDate(Math.min(day,end));
  }
  return result;
}
export const OWNER_REVIEW_BODY = "Seu imóvel na {{1}} ainda se encontra à venda? Sim ou não.";
export const BROKER_REVIEW_BODY = "Há uma atualização na revisão de disponibilidade do imóvel {{1}}. Consulte o cadastro no CRM para verificar a situação e entrar em contato com o proprietário.";

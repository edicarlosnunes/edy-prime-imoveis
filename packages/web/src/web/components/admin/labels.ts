/** Rótulos em português compartilhados pelas telas do painel. */

export const LEAD_STAGES = [
  "novo",
  "primeiro_contato",
  "qualificado",
  "imovel_apresentado",
  "visita_agendada",
  "proposta_enviada",
  "negociacao",
  "venda_fechada",
] as const;

export type LeadStage = (typeof LEAD_STAGES)[number];

export const stageLabel: Record<string, string> = {
  novo: "Lead novo",
  primeiro_contato: "Primeiro contato",
  qualificado: "Lead qualificado",
  imovel_apresentado: "Imóvel apresentado",
  visita_agendada: "Visita agendada",
  proposta_enviada: "Proposta enviada",
  negociacao: "Negociação",
  venda_fechada: "Venda fechada",
};

export const leadStatusLabel: Record<string, string> = {
  aberto: "Em aberto",
  ganho: "Ganho",
  perdido: "Perdido",
};

export const propertyStatuses = ["disponivel", "reservado", "vendido", "alugado"] as const;

export const propertyStatusLabel: Record<string, string> = {
  disponivel: "Disponível",
  reservado: "Reservado",
  vendido: "Vendido",
  alugado: "Alugado",
};

export const purposes = ["venda", "locacao", "venda_locacao"] as const;

export const purposeLabel: Record<string, string> = {
  venda: "Venda",
  locacao: "Locação",
  venda_locacao: "Venda e locação",
};

export const propertyTypes = [
  "apartamento",
  "casa",
  "cobertura",
  "sobrado",
  "terreno",
  "sala_comercial",
  "chacara",
  "outro",
] as const;

export const propertyTypeLabel: Record<string, string> = {
  apartamento: "Apartamento",
  casa: "Casa",
  cobertura: "Cobertura",
  sobrado: "Sobrado",
  terreno: "Terreno",
  sala_comercial: "Sala comercial",
  chacara: "Chácara",
  outro: "Outro",
};

export const taskTypes = ["visita", "retorno", "reuniao", "proposta", "follow_up", "outro"] as const;

export const taskTypeLabel: Record<string, string> = {
  visita: "Visita",
  retorno: "Retorno",
  reuniao: "Reunião",
  proposta: "Proposta",
  follow_up: "Follow-up",
  outro: "Outro",
};

export const taskStatuses = ["pendente", "concluida", "cancelada"] as const;

export const taskStatusLabel: Record<string, string> = {
  pendente: "Pendente",
  concluida: "Concluída",
  cancelada: "Cancelada",
};

export const dealStatuses = ["enviada", "em_negociacao", "aceita", "recusada", "fechada"] as const;

export const dealStatusLabel: Record<string, string> = {
  enviada: "Proposta enviada",
  em_negociacao: "Em negociação",
  aceita: "Aceita",
  recusada: "Recusada",
  fechada: "Venda fechada",
};

export const captureStatuses = ["prospeccao", "em_negociacao", "captado", "perdido"] as const;

export const captureStatusLabel: Record<string, string> = {
  prospeccao: "Prospecção",
  em_negociacao: "Em negociação",
  captado: "Captado",
  perdido: "Perdido",
};

export const leadSources = [
  "site",
  "hero",
  "cta-final",
  "manual",
  "whatsapp",
  "instagram",
  "facebook",
  "indicacao",
  "portal",
  "placa",
  "outro",
] as const;

export const sourceLabel: Record<string, string> = {
  site: "Site",
  hero: "Site — formulário do topo",
  "cta-final": "Site — formulário final",
  manual: "Cadastro manual",
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  facebook: "Facebook",
  indicacao: "Indicação",
  portal: "Portal de imóveis",
  placa: "Placa / rua",
  outro: "Outro",
};

export function labelOf(map: Record<string, string>, value: string | null | undefined) {
  if (!value) return "—";
  return map[value] ?? value;
}

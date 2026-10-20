export interface PropertyTypeOption { key: string; label: string; active: boolean }
export const DEFAULT_PROPERTY_TYPES: PropertyTypeOption[] = Object.entries({
  apartamento: "Apartamento", casa: "Casa", cobertura: "Cobertura", sobrado: "Sobrado",
  kitnet: "Kitnet", terreno: "Terreno", lote: "Lote", sitio: "Sítio", fazenda: "Fazenda",
  gleba: "Gleba", loteamento: "Loteamento", area: "Área", sala_comercial: "Sala comercial",
  chacara: "Chácara", outro: "Outro",
}).map(([key, label]) => ({ key, label, active: true }));
export function normalizePropertyTypeLabel(label: string) {
  return label.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase().replace(/\s+/g, " ");
}

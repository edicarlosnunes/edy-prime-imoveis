/**
 * Catálogo de características e diferenciais do imóvel.
 * Só entram no texto da IA os itens que o administrador marcar aqui —
 * nada é sugerido nem preenchido automaticamente.
 */

export interface FeatureGroup {
  label: string;
  items: string[];
}

export const FEATURE_GROUPS: FeatureGroup[] = [
  {
    label: "Lazer e condomínio",
    items: [
      "Piscina",
      "Churrasqueira",
      "Salão de festas",
      "Academia",
      "Playground",
      "Quadra",
      "Sauna",
      "Espaço gourmet",
      "Portaria 24h",
      "Elevador",
    ],
  },
  {
    label: "Imóvel",
    items: [
      "Varanda gourmet",
      "Sacada",
      "Suíte",
      "Armários planejados",
      "Cozinha planejada",
      "Ar-condicionado",
      "Mobiliado",
      "Semimobiliado",
      "Área de serviço",
      "Dependência de empregada",
      "Vista mar",
      "Vista livre",
      "Andar alto",
    ],
  },
  {
    label: "Localização",
    items: [
      "Próximo ao comércio",
      "Próximo a escolas",
      "Próximo à praia",
      "Próximo a farmácia/mercado",
      "Fácil acesso à rodovia",
    ],
  },
  {
    label: "Negócio e documentação",
    items: [
      "Aceita financiamento",
      "Aceita FGTS",
      "Aceita permuta",
      "Documentação ok",
      "Escritura registrada",
      "Pronto para morar",
      "Na planta",
      "Em construção",
    ],
  },
];

/** Todos os itens do catálogo, em minúsculas, para separar o que é personalizado. */
const CATALOG = new Set(
  FEATURE_GROUPS.flatMap((group) => group.items).map((item) => item.toLowerCase()),
);

export function isCustomFeature(value: string) {
  return !CATALOG.has(value.trim().toLowerCase());
}

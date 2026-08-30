/**
 * Contrato do conteúdo editável do site (Editor do Site / CMS).
 *
 * Este arquivo é a ÚNICA definição do formato do conteúdo: tipos, valores padrão
 * (o site como foi entregue) e a fusão do que vem do banco sobre esses padrões.
 * Se o banco estiver vazio ou a API falhar, o site renderiza exatamente igual ao padrão.
 *
 * Nada aqui depende de React, do servidor ou de variáveis de ambiente.
 */

import {
  createTypographyMap,
  createTypographyScopeMap,
  type TypographyMap,
  type TypographyScopeMap,
} from "./site-typography";

export interface MenuItem {
  id: string;
  label: string;
  href: string;
  visible: boolean;
}

export interface TextItem {
  id: string;
  text: string;
}

export interface PillarItem {
  id: string;
  title: string;
  text: string;
}

export interface StepItem {
  id: string;
  number: string;
  title: string;
  text: string;
}

export interface FaqItem {
  id: string;
  question: string;
  answer: string;
}

export interface LinkItem {
  id: string;
  label: string;
  href: string;
}

export interface SectionBase {
  visible: boolean;
  order: number;
  eyebrow: string;
  title: string;
  subtitle: string;
  text: string;
  imageUrl: string;
}

export interface SiteContent {
  /** tipografia global, por tipo de texto */
  typography: TypographyMap;
  /** tipografia por seção (vence a global quando preenchida) */
  typographyScopes: TypographyScopeMap;
  theme: {
    logoUrl: string;
    logoHeight: number;
    faviconUrl: string;
    /** cor principal (fundos escuros, botões sólidos) */
    primary: string;
    /** cor secundária (detalhes, ícones, links) */
    secondary: string;
    /** cor de destaque (títulos em itálico, hover) */
    accent: string;
    /** cor de fundo do site */
    background: string;
    /** cor dos textos */
    text: string;
    /** cor dos textos secundários */
    muted: string;
    /** cor das faixas/cards claros */
    surface: string;
    headingFont: string;
    bodyFont: string;
    /** multiplicador do tamanho dos títulos (0.8 a 1.3) */
    headingScale: number;
    /** arredondamento dos botões em px */
    buttonRadius: number;
    buttonStyle: "solid" | "outline";
    buttonUppercase: boolean;
  };
  hero: {
    imageUrl: string;
    /** intensidade do escurecimento sobre a imagem (0 a 100) */
    overlay: number;
    eyebrow: string;
    title: string;
    titleAccent: string;
    subtitle: string;
    supportText: string;
    primaryCtaLabel: string;
    primaryCtaHref: string;
    secondaryCtaLabel: string;
    secondaryCtaHref: string;
    showForm: boolean;
    formEyebrow: string;
    formTitle: string;
    formText: string;
    /** alinhamento do texto */
    align: "left" | "center";
    /** lado do conteúdo na capa */
    contentSide: "left" | "right";
    assurances: TextItem[];
  };
  menu: {
    logoText: string;
    logoSuffix: string;
    logoUrl: string;
    items: MenuItem[];
    showWhatsapp: boolean;
    whatsappLabel: string;
    /** comportamento do menu no celular */
    mobileStyle: "panel" | "fullscreen";
    sticky: boolean;
  };
  sections: {
    diferenciais: SectionBase & { items: PillarItem[]; showDistricts: boolean; districtsLabel: string };
    imoveis: SectionBase & { limit: number };
    ctaFinal: SectionBase & { ctaLabel: string; ctaHref: string };
    comoFunciona: SectionBase & { items: StepItem[] };
    sobre: SectionBase & { badgeName: string; badgeCaption: string; paragraphs: TextItem[]; items: TextItem[]; ctaLabel: string };
    faq: SectionBase & { items: FaqItem[] };
    contato: SectionBase & {
      titleAccent: string;
      showForm: boolean;
      formTitle: string;
      formText: string;
      officeLabel: string;
      emailLabel: string;
      creciLabel: string;
    };
  };
  company: {
    name: string;
    brandSuffix: string;
    broker: string;
    role: string;
    creci: string;
    whatsapp: string;
    phone: string;
    email: string;
    address: string;
    instagram: string;
    facebook: string;
    hours: string;
    city: string;
    state: string;
    districts: string[];
  };
  footer: {
    about: string;
    navLabel: string;
    contactLabel: string;
    links: LinkItem[];
    showSocial: boolean;
    copyright: string;
    note: string;
  };
  seo: {
    title: string;
    description: string;
    ogImageUrl: string;
    shareTitle: string;
    shareDescription: string;
    noindex: boolean;
  };
}

export type SectionKey = keyof SiteContent["sections"];

export const SECTION_KEYS: SectionKey[] = [
  "diferenciais",
  "imoveis",
  "ctaFinal",
  "comoFunciona",
  "sobre",
  "faq",
  "contato",
];

export const SECTION_LABELS: Record<SectionKey, string> = {
  diferenciais: "Diferenciais",
  imoveis: "Imóveis",
  ctaFinal: "CTA final",
  comoFunciona: "Como funciona",
  sobre: "Sobre",
  faq: "FAQ / Dúvidas",
  contato: "Contato",
};

export const HEADING_FONTS = [
  "Cormorant Garamond",
  "Playfair Display",
  "Marcellus",
  "Libre Baskerville",
  "Lora",
  "Jost",
  "Inter",
];

export const BODY_FONTS = ["Jost", "Inter", "Work Sans", "DM Sans", "Lato", "Montserrat"];

/** Conteúdo padrão = o site exatamente como está publicado hoje. */
export const defaultSiteContent: SiteContent = {
  // tudo em branco = o site exatamente como foi entregue (nenhum CSS extra)
  typography: createTypographyMap(),
  typographyScopes: createTypographyScopeMap(),
  theme: {
    logoUrl: "",
    logoHeight: 34,
    faviconUrl: "",
    primary: "#17231f",
    secondary: "#a9834b",
    accent: "#c9a46a",
    background: "#f4f1ea",
    text: "#12140f",
    muted: "#6b6a62",
    surface: "#dcd8cd",
    headingFont: "Cormorant Garamond",
    bodyFont: "Jost",
    headingScale: 1,
    buttonRadius: 0,
    buttonStyle: "solid",
    buttonUppercase: true,
  },
  hero: {
    imageUrl: "/images/hero.jpg",
    overlay: 60,
    eyebrow: "Praia Grande · SP — médio e alto padrão",
    title: "O imóvel certo\nà beira-mar,",
    titleAccent: "sem labirinto.",
    subtitle:
      "Curadoria pessoal de apartamentos e coberturas em Praia Grande. Você me diz o que procura, eu filtro o mercado e apresento só o que vale a sua visita — com segurança jurídica e negociação conduzida por quem mora aqui.",
    supportText: "",
    primaryCtaLabel: "",
    primaryCtaHref: "#imoveis",
    secondaryCtaLabel: "",
    secondaryCtaHref: "#contato",
    showForm: true,
    formEyebrow: "Consulta sem compromisso",
    formTitle: "Diga o que você procura",
    formText: "Em até algumas horas você recebe uma seleção com valores, plantas e vídeos reais.",
    align: "left",
    contentSide: "left",
    assurances: [
      { id: "a1", text: "Documentação e negociação acompanhadas do início ao fim" },
      { id: "a2", text: "Atuação em toda a orla de Praia Grande e região" },
      { id: "a3", text: "Resposta no mesmo dia, em horário comercial" },
    ],
  },
  menu: {
    logoText: "Edy Prime",
    logoSuffix: "Imóveis",
    logoUrl: "",
    items: [
      { id: "m1", label: "Imóveis", href: "#imoveis", visible: true },
      { id: "m2", label: "Como funciona", href: "#como-funciona", visible: true },
      { id: "m3", label: "Sobre", href: "#sobre", visible: true },
      { id: "m4", label: "Dúvidas", href: "#duvidas", visible: true },
      { id: "m5", label: "Contato", href: "#contato", visible: true },
    ],
    showWhatsapp: true,
    whatsappLabel: "WhatsApp",
    mobileStyle: "panel",
    sticky: true,
  },
  sections: {
    diferenciais: {
      visible: true,
      order: 1,
      eyebrow: "",
      title: "",
      subtitle: "",
      text: "",
      imageUrl: "",
      showDistricts: true,
      districtsLabel: "Bairros atendidos:",
      items: [
        {
          id: "p1",
          title: "Corretor registrado",
          text: "Atendimento conduzido por profissional com registro ativo — CRECI 134718-F.",
        },
        {
          id: "p2",
          title: "Atendimento direto",
          text: "Você fala comigo do primeiro contato à entrega das chaves, sem intermediários.",
        },
        {
          id: "p3",
          title: "Compra, venda e locação",
          text: "Imóveis de médio e alto padrão na orla de Praia Grande e bairros próximos.",
        },
      ],
    },
    imoveis: {
      visible: true,
      order: 2,
      eyebrow: "Seleção da semana",
      title: "Imóveis que já passaram\npelo meu filtro",
      subtitle: "",
      text: "Visitados pessoalmente, com documentação conferida e valor dentro da realidade do bairro. O portfólio completo tem mais opções — me diga o perfil e eu envio.",
      imageUrl: "",
      limit: 12,
    },
    ctaFinal: {
      visible: true,
      order: 3,
      eyebrow: "",
      title: "Não encontrou o que procurava?",
      subtitle: "",
      text: "Boa parte dos imóveis de alto padrão não vai para portais. Me diga bairro, metragem e faixa de valor e eu busco nas carteiras fechadas da região.",
      imageUrl: "",
      ctaLabel: "Pedir uma busca personalizada",
      ctaHref: "",
    },
    comoFunciona: {
      visible: true,
      order: 4,
      eyebrow: "Como funciona",
      title: "Três etapas claras,\ndo primeiro contato às chaves",
      subtitle: "",
      text: "",
      imageUrl: "/images/orla.jpg",
      items: [
        {
          id: "s1",
          number: "01",
          title: "Conversa inicial",
          text: "Entendo objetivo, faixa de valor, financiamento e prazo. Em 15 minutos de conversa já sei o que faz sentido mostrar — e o que não faz.",
        },
        {
          id: "s2",
          number: "02",
          title: "Seleção e visitas",
          text: "Você recebe uma lista curta com vídeos, plantas e valores reais. Agendamos as visitas em sequência, no mesmo dia, sem perder tempo.",
        },
        {
          id: "s3",
          number: "03",
          title: "Proposta e chaves",
          text: "Conduzo negociação, documentação e financiamento com assessoria jurídica. Você acompanha cada etapa até a entrega das chaves.",
        },
      ],
    },
    sobre: {
      visible: true,
      order: 5,
      eyebrow: "Quem vai te atender",
      title: "Atendimento próximo,\ndo litoral para você",
      subtitle: "",
      text: "",
      imageUrl: "/images/corretor.jpg",
      badgeName: "Edy Prime",
      badgeCaption: "CRECI 134718-F",
      ctaLabel: "Conversar direto comigo",
      paragraphs: [
        {
          id: "t1",
          text: "Atuo em Praia Grande com foco em imóveis de médio e alto padrão na orla, hoje com o apoio de uma equipe enxuta. A lógica é simples: poucos clientes por vez, atendimento direto e nenhuma promessa que eu não possa cumprir.",
        },
        {
          id: "t2",
          text: "Conheço prédio por prédio da orla — quais têm vista permanente, quais têm taxa de condomínio alta, quais valorizam. É essa leitura que separa uma boa compra de um arrependimento caro.",
        },
      ],
      items: [
        { id: "c1", text: "Nenhum imóvel entra na minha lista sem visita e documentação conferida" },
        { id: "c2", text: "Você fala sempre comigo — não com um call center" },
        { id: "c3", text: "Assessoria de financiamento e escritura com parceiros da região" },
        { id: "c4", text: "Avaliação gratuita para quem quer vender ou colocar para locação" },
      ],
    },
    faq: {
      visible: true,
      order: 6,
      eyebrow: "Dúvidas frequentes",
      title: "Antes de\nvocê perguntar",
      subtitle: "",
      text: "",
      imageUrl: "",
      items: [
        {
          id: "f1",
          question: "Trabalho com imóvel de qual faixa de valor?",
          answer:
            "Trabalho com apartamentos, coberturas e lançamentos de médio e alto padrão na orla e nos bairros próximos. Se o que você procura estiver fora do meu foco, indico com transparência quem pode atender melhor.",
        },
        {
          id: "f2",
          question: "Preciso pagar algo para ser atendido?",
          answer:
            "Não. A consultoria, as visitas e a análise de documentação não têm custo para o comprador. A comissão é paga pelo vendedor na conclusão da venda, conforme a tabela do CRECI.",
        },
        {
          id: "f3",
          question: "Consigo financiar? Vocês ajudam com o banco?",
          answer:
            "Sim. Faço a simulação inicial, organizo a documentação e acompanho o processo junto ao banco escolhido até a assinatura do contrato.",
        },
        {
          id: "f4",
          question: "Atende quem mora em outra cidade?",
          answer:
            "Sim. Gravo vídeos completos do imóvel e do prédio, faço videochamada ao vivo durante a visita e concentro as visitas presenciais em um único dia.",
        },
        {
          id: "f5",
          question: "Quero vender meu imóvel. Como funciona?",
          answer:
            "Começamos com uma avaliação gratuita, comparando os valores praticados no mesmo prédio e bairro. Definido o preço, cuido das fotos profissionais, da divulgação e da triagem dos interessados — você recebe só propostas reais.",
        },
        {
          id: "f6",
          question: "Em quanto tempo você responde?",
          answer:
            "No mesmo dia, em horário comercial. Mensagens enviadas à noite são respondidas na manhã seguinte, e sempre por mim ou por alguém da minha equipe direta.",
        },
      ],
    },
    contato: {
      visible: true,
      order: 7,
      eyebrow: "Próximo passo",
      title: "Vamos encontrar\no seu endereço",
      titleAccent: "em Praia Grande.",
      subtitle: "",
      text: "",
      imageUrl: "/images/imovel-5.jpg",
      showForm: true,
      formTitle: "Solicitar seleção de imóveis",
      formText: "Quanto mais detalhes, mais certeira a lista que você recebe.",
      officeLabel: "Escritório",
      emailLabel: "E-mail",
      creciLabel: "Registro",
    },
  },
  company: {
    name: "Edy Prime",
    brandSuffix: "Imóveis",
    broker: "Edy Prime",
    role: "Consultor de imóveis · Praia Grande/SP",
    creci: "CRECI 134718-F",
    whatsapp: "5513997141174",
    phone: "(13) 99714-1174",
    email: "edyprimeimoveis@gmail.com",
    address: "Rua Guimarães Rosa, 492/163 — CEP 11704-160 — Praia Grande/SP",
    instagram: "https://instagram.com/edy_prime_imoveis",
    facebook: "https://facebook.com/edy_prime_imoveis",
    hours: "Seg a sáb, 9h às 20h · Domingo com agendamento",
    city: "Praia Grande",
    state: "SP",
    districts: [
      "Canto do Forte",
      "Boqueirão",
      "Guilhermina",
      "Aviação",
      "Vila Tupi",
      "Ocian",
      "Real",
      "Mirim",
      "Solemar",
    ],
  },
  footer: {
    about:
      "Assessoria em compra, venda e locação de imóveis de médio e alto padrão em Praia Grande e região.",
    navLabel: "Navegar",
    contactLabel: "Contato",
    links: [
      { id: "l1", label: "Imóveis em destaque", href: "#imoveis" },
      { id: "l2", label: "Como funciona", href: "#como-funciona" },
      { id: "l3", label: "Sobre", href: "#sobre" },
      { id: "l4", label: "Dúvidas frequentes", href: "#duvidas" },
    ],
    showSocial: true,
    copyright: "Todos os direitos reservados.",
    note: "Imagens ilustrativas. Valores e disponibilidade sujeitos a alteração sem aviso prévio.",
  },
  seo: {
    title: "Edy Prime Imóveis | Imóveis de alto padrão em Praia Grande/SP",
    description:
      "Edy Prime Imóveis — assessoria em imóveis de médio e alto padrão em Praia Grande/SP. Seleção curada, atendimento direto e negociação segura, do primeiro contato às chaves.",
    ogImageUrl: "/og-image.png",
    shareTitle: "Edy Prime Imóveis | Praia Grande/SP",
    shareDescription:
      "Imóveis de médio e alto padrão em Praia Grande/SP com curadoria e atendimento direto pelo WhatsApp.",
    noindex: false,
  },
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Funde o conteúdo salvo sobre os padrões (profundo, arrays substituem).
 * Chaves desconhecidas são descartadas — o formato padrão manda.
 */
function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(patch)) return base;
  if (!isPlainObject(base)) return (patch as T) ?? base;

  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in result)) continue;
    const current = result[key];
    if (Array.isArray(current)) {
      if (Array.isArray(value)) result[key] = value;
      continue;
    }
    if (isPlainObject(current)) {
      result[key] = deepMerge(current, value);
      continue;
    }
    if (value === null || value === undefined) continue;
    if (typeof current === typeof value) result[key] = value;
    else if (typeof current === "number" && typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value);
      if (!Number.isNaN(parsed)) result[key] = parsed;
    }
  }
  return result as T;
}

export function mergeSiteContent(patch: unknown): SiteContent {
  return deepMerge(defaultSiteContent, patch);
}

export function cloneSiteContent(content: SiteContent): SiteContent {
  return JSON.parse(JSON.stringify(content)) as SiteContent;
}

/** Lista de seções na ordem configurada, já filtrando as ocultas. */
export function orderedSections(content: SiteContent): SectionKey[] {
  return SECTION_KEYS.filter((key) => content.sections[key].visible).sort(
    (a, b) => content.sections[a].order - content.sections[b].order,
  );
}

export function newId(prefix = "i") {
  return `${prefix}${Math.random().toString(36).slice(2, 8)}`;
}

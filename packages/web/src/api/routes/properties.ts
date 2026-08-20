import { base } from "../__core/app";

export interface Property {
  code: string;
  title: string;
  district: string;
  city: string;
  price: number;
  bedrooms: number;
  suites: number;
  parking: number;
  area: number;
  status: "disponivel" | "lancamento" | "exclusivo";
  highlight: string;
  image: string;
}

/**
 * Vitrine em destaque. Para atualizar o site, edite esta lista:
 * troque textos, valores e o caminho da imagem (arquivos em packages/web/public/images).
 */
const featured: Property[] = [
  {
    code: "EP-1042",
    title: "Apartamento frente mar com varanda gourmet",
    district: "Canto do Forte",
    city: "Praia Grande",
    price: 1450000,
    bedrooms: 3,
    suites: 1,
    parking: 2,
    area: 128,
    status: "exclusivo",
    highlight: "Vista definitiva para o mar",
    image: "/images/imovel-5.jpg",
  },
  {
    code: "EP-1078",
    title: "Cobertura duplex com piscina privativa",
    district: "Boqueirão",
    city: "Praia Grande",
    price: 2390000,
    bedrooms: 4,
    suites: 2,
    parking: 3,
    area: 218,
    status: "exclusivo",
    highlight: "Piscina e deck no terraço",
    image: "/images/imovel-6.jpg",
  },
  {
    code: "EP-1015",
    title: "Apartamento reformado a uma quadra da praia",
    district: "Guilhermina",
    city: "Praia Grande",
    price: 780000,
    bedrooms: 2,
    suites: 1,
    parking: 1,
    area: 86,
    status: "disponivel",
    highlight: "Pronto para morar",
    image: "/images/imovel-1.jpg",
  },
  {
    code: "EP-1091",
    title: "Lançamento com lazer completo e vista mar",
    district: "Aviação",
    city: "Praia Grande",
    price: 1120000,
    bedrooms: 3,
    suites: 1,
    parking: 2,
    area: 104,
    status: "lancamento",
    highlight: "Entrada facilitada na planta",
    image: "/images/imovel-4.jpg",
  },
  {
    code: "EP-1063",
    title: "Alto padrão com cozinha integrada e armários",
    district: "Vila Tupi",
    city: "Praia Grande",
    price: 960000,
    bedrooms: 3,
    suites: 1,
    parking: 2,
    area: 98,
    status: "disponivel",
    highlight: "Mobiliado e decorado",
    image: "/images/imovel-2.jpg",
  },
  {
    code: "EP-1087",
    title: "Suíte master com closet em condomínio-clube",
    district: "Ocian",
    city: "Praia Grande",
    price: 690000,
    bedrooms: 2,
    suites: 1,
    parking: 1,
    area: 74,
    status: "disponivel",
    highlight: "Lazer de resort no condomínio",
    image: "/images/imovel-3.jpg",
  },
];

export const properties = {
  list: base.handler((): Property[] => featured),
};

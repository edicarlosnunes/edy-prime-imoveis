/**
 * Qualificação determinística de leads (F4.1).
 *
 * 100% regras e regex: sem rede, sem modelo de IA, sem custo por token.
 * Só extrai o que o CLIENTE escreveu. Fala da IA nunca entra aqui — quem chama
 * é responsável por passar apenas texto de autor "cliente".
 *
 * Princípio: nunca inventar. Na dúvida, o campo fica `null` (não informado).
 */

export type FieldOrigin = "deterministico" | "ia" | "manual";

export interface QualificationPatch {
  purpose?: string | null;
  propertyType?: string | null;
  city?: string | null;
  districts?: string[] | null;
  budgetMin?: number | null;
  budgetMax?: number | null;
  bedrooms?: number | null;
  suites?: number | null;
  parking?: number | null;
  areaMin?: number | null;
  financing?: string | null;
  fgts?: string | null;
  tradeIn?: string | null;
  tradeInDetail?: string | null;
  timeframe?: string | null;
  preferences?: string[] | null;
  restrictions?: string[] | null;
  contactPreference?: string | null;
  contactWindow?: string | null;
}

export interface QualificationSignals {
  wantsVisit: boolean;
  wantsHuman: boolean;
  cashPayment: boolean;
  justLooking: boolean;
  /** Código de imóvel citado, ex: EP-1042 */
  propertyCode: string | null;
}

export interface QualificationResult {
  patch: QualificationPatch;
  signals: QualificationSignals;
  /** Campos efetivamente extraídos (para montar fieldsSource) */
  fields: string[];
}

/* --------------------------------------------------------------- helpers */

const stripAccents = (value: string) =>
  value.normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Normaliza para comparação: minúsculo, sem acento, espaços colapsados. */
export const norm = (value: string) =>
  stripAccents(value.toLowerCase()).replace(/\s+/g, " ").trim();

const WORD_NUMBERS: Record<string, number> = {
  um: 1,
  uma: 1,
  dois: 2,
  duas: 2,
  tres: 3,
  quatro: 4,
  cinco: 5,
  seis: 6,
  sete: 7,
  oito: 8,
  nove: 9,
  dez: 10,
};

/**
 * Guarda de negação: se a janela de texto antes do trecho indica ausência de
 * informação ("não sei", "ainda não decidi", "sem ideia"), o dado é descartado.
 */
const NEGATION = /\b(nao|n)\s+(sei|tenho|decidi|defini|faco|fechei|penso|pretendo|quero|posso|consigo|vou)\b|\bsem\s+(ideia|previsao|condicao)\b|\bnenhuma\s+ideia\b|\bainda\s+nao\b|\bnao\s+e\b/;

function negatedAround(text: string, index: number, span = 42) {
  const before = text.slice(Math.max(0, index - span), index);
  return NEGATION.test(before);
}

/** Converte "450 mil", "1,2 milhão", "450.000", "R$ 450000,00" em número. */
function parseMoney(raw: string, scaleWord: string | undefined): number | null {
  let digits = raw.replace(/[^\d.,]/g, "");
  if (!digits) return null;

  const hasComma = digits.includes(",");
  const hasDot = digits.includes(".");
  if (hasComma && hasDot) {
    digits = digits.replace(/\./g, "").replace(",", ".");
  } else if (hasComma) {
    const parts = digits.split(",");
    digits = parts[parts.length - 1]!.length <= 2 ? parts.join(".") : parts.join("");
  } else if (hasDot) {
    const parts = digits.split(".");
    /* 450.000 é milhar; 1.5 (com palavra de escala) é decimal */
    digits = parts[parts.length - 1]!.length === 3 ? parts.join("") : parts.join(".");
  }

  let value = Number.parseFloat(digits);
  if (!Number.isFinite(value)) return null;

  const scale = scaleWord ? norm(scaleWord) : "";
  if (/^(mil|k)$/.test(scale)) value *= 1_000;
  else if (/^(mi|milhao|milhoes|kk)$/.test(scale)) value *= 1_000_000;

  /* Valores absurdos para imóvel: descarta em vez de chutar. */
  if (value < 1_000 || value > 500_000_000) return null;
  return Math.round(value);
}

const MONEY = /(?:r\$\s*)?(\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d+)?)\s*(mil|milhao|milhoes|mi|kk|k)?\b/g;

interface MoneyHit {
  value: number;
  index: number;
}

function moneyHits(text: string): MoneyHit[] {
  const hits: MoneyHit[] = [];
  MONEY.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MONEY.exec(text))) {
    const scale = match[2];
    /* número solto e pequeno sem escala e sem R$ não é preço */
    const rawHasCurrency = /r\$/.test(match[0]);
    if (!scale && !rawHasCurrency && !/[.,]/.test(match[1]!)) continue;
    const value = parseMoney(match[1]!, scale);
    if (value === null) continue;
    if (negatedAround(text, match.index)) continue;
    hits.push({ value, index: match.index });
  }
  return hits;
}

function intNear(text: string, pattern: RegExp): number | null {
  pattern.lastIndex = 0;
  const match = pattern.exec(text);
  if (!match) return null;
  if (negatedAround(text, match.index)) return null;
  const raw = (match[1] ?? match[2] ?? "").trim();
  if (!raw) return null;
  const numeric = Number.parseInt(raw, 10);
  if (Number.isFinite(numeric)) return numeric >= 0 && numeric <= 20 ? numeric : null;
  const word = WORD_NUMBERS[norm(raw)];
  return word ?? null;
}

/* ------------------------------------------------------------ extração */

export interface QualifyOptions {
  /** Bairros reais do catálogo, para não inventar localização. */
  knownDistricts?: string[];
  /** Cidades reais do catálogo. */
  knownCities?: string[];
}

/** Extrai perfil e sinais de um texto escrito pelo cliente. */
export function qualifyText(input: string, options: QualifyOptions = {}): QualificationResult {
  const text = norm(input ?? "");
  const patch: QualificationPatch = {};
  const signals: QualificationSignals = {
    wantsVisit: false,
    wantsHuman: false,
    cashPayment: false,
    justLooking: false,
    propertyCode: null,
  };
  if (!text) return { patch, signals, fields: [] };

  /* ---------------------------------------------------------- finalidade */
  if (/\b(alugar|aluguel|locacao|para locar)\b/.test(text)) patch.purpose = "alugar";
  else if (/\b(investir|investimento|renda|rentabilidade)\b/.test(text)) patch.purpose = "investir";
  else if (/\b(vender|colocar (meu|a) (imovel|casa|apartamento) (a )?venda|anunciar meu imovel)\b/.test(text))
    patch.purpose = "vender";
  else if (/\b(comprar|compra|adquirir|financiar (um|uma)|quero (um|uma) (casa|apartamento|apto))\b/.test(text))
    patch.purpose = "comprar";

  /* ------------------------------------------------------- tipo de imóvel */
  const types: [RegExp, string][] = [
    [/\b(apartamento|apto|aptos|apartamentos)\b/, "apartamento"],
    [/\b(cobertura|coberturas)\b/, "cobertura"],
    [/\b(casa|casas|sobrado|sobrados)\b/, "casa"],
    [/\b(terreno|terrenos|lote|lotes)\b/, "terreno"],
    [/\b(sala comercial|loja|ponto comercial|comercial|galpao)\b/, "comercial"],
    [/\b(kitnet|kitinete|studio|estudio)\b/, "kitnet"],
    [/\b(chacara|sitio|fazenda)\b/, "chacara"],
  ];
  for (const [pattern, value] of types) {
    const match = pattern.exec(text);
    if (match && !negatedAround(text, match.index)) {
      patch.propertyType = value;
      break;
    }
  }

  /* ------------------------------------------------------------ orçamento */
  const hits = moneyHits(text);
  if (hits.length) {
    const between = /\b(entre|de)\b[^.]{0,40}?\b(e|a|ate)\b/.test(text);
    const upperOnly = /\b(ate|no maximo|maximo de|nao passar de|limite de|teto de)\b/.test(text);
    const lowerOnly = /\b(a partir de|acima de|no minimo|minimo de|pelo menos)\b/.test(text);
    const sorted = [...hits].sort((a, b) => a.value - b.value);
    if (between && hits.length >= 2) {
      patch.budgetMin = sorted[0]!.value;
      patch.budgetMax = sorted[sorted.length - 1]!.value;
    } else if (upperOnly) {
      patch.budgetMax = sorted[sorted.length - 1]!.value;
    } else if (lowerOnly) {
      patch.budgetMin = sorted[0]!.value;
    } else if (hits.length >= 2) {
      patch.budgetMin = sorted[0]!.value;
      patch.budgetMax = sorted[sorted.length - 1]!.value;
    } else {
      patch.budgetMax = sorted[0]!.value;
    }
  }

  /* ----------------------------------------------- dormitórios/suítes/vagas */
  const bedrooms = intNear(
    text,
    /(\d{1,2}|um|uma|dois|duas|tres|quatro|cinco|seis)\s*(?:-|\s)?\s*(?:dormitorios?|dorms?|quartos?|qtos?|suites? e quartos?)\b/g,
  );
  if (bedrooms !== null) patch.bedrooms = bedrooms;

  const suites = intNear(
    text,
    /(\d{1,2}|um|uma|dois|duas|tres|quatro)\s*(?:-|\s)?\s*suites?\b/g,
  );
  if (suites !== null) patch.suites = suites;

  const parking = intNear(
    text,
    /(\d{1,2}|um|uma|dois|duas|tres|quatro)\s*(?:-|\s)?\s*(?:vagas?|garagens?|vagas? de garagem)\b/g,
  );
  if (parking !== null) patch.parking = parking;

  const area = /(\d{2,4})\s*(?:m2|m²|metros(?: quadrados)?)\b/g.exec(text);
  if (area && !negatedAround(text, area.index)) {
    const value = Number.parseInt(area[1]!, 10);
    if (value >= 15 && value <= 100_000) patch.areaMin = value;
  }

  /* ---------------------------------------------------- pagamento/crédito */
  const financingYes = /\b(financiar|financiamento|financiado|carta de credito|caixa|minha casa minha vida)\b/;
  const financingNo = /\b(sem financiamento|nao (quero|vou|pretendo) financiar|a vista)\b/;
  if (financingNo.test(text)) patch.financing = "nao";
  else if (financingYes.test(text)) {
    const match = financingYes.exec(text)!;
    patch.financing = negatedAround(text, match.index) ? "nao_sei" : "sim";
  }

  if (/\bfgts\b/.test(text)) {
    const match = /\bfgts\b/.exec(text)!;
    patch.fgts = negatedAround(text, match.index) || /\b(nao tenho|sem) fgts\b/.test(text) ? "nao" : "sim";
  }

  if (/\b(permuta|permutar|dar (meu|um) (imovel|apartamento|casa) (na|como) (troca|entrada)|troca)\b/.test(text)) {
    patch.tradeIn = "sim";
    patch.tradeInDetail = input.trim().slice(0, 300);
  }

  if (/\b(a vista|pagamento a vista|dinheiro (na mao|vivo)|pago a vista)\b/.test(text)) {
    signals.cashPayment = true;
  }

  /* --------------------------------------------------------------- prazo */
  if (/\b(urgente|urgencia|imediato|para (ja|agora)|essa semana|esta semana|o quanto antes|hoje)\b/.test(text))
    patch.timeframe = "imediato";
  else if (/\b(30 dias|um mes|1 mes|proximo mes|mes que vem)\b/.test(text)) patch.timeframe = "30_dias";
  else if (/\b(90 dias|tres meses|3 meses|dois meses|2 meses|semestre|seis meses)\b/.test(text))
    patch.timeframe = "90_dias";
  else if (/\b(sem pressa|so pesquisando|apenas pesquisando|ano que vem|futuro|mais pra frente|mais para frente)\b/.test(text))
    patch.timeframe = "sem_pressa";

  /* --------------------------------------------- contato: canal e janela */
  if (/\b(whatsapp|whats|zap|wpp)\b/.test(text)) patch.contactPreference = "whatsapp";
  else if (/\b(ligar|ligacao|me liga|telefone|chamada)\b/.test(text)) patch.contactPreference = "ligacao";
  else if (/\b(e-?mail)\b/.test(text)) patch.contactPreference = "email";

  const window = /\b(manha|tarde|noite|horario comercial|depois das? \d{1,2}(?::\d{2})?h?|antes das? \d{1,2}(?::\d{2})?h?|apos as? \d{1,2}h?)\b/.exec(
    text,
  );
  if (window) patch.contactWindow = window[0]!.slice(0, 60);

  /* ---------------------------------------------- cidade/bairro (catálogo) */
  const cities = (options.knownCities ?? []).filter(Boolean);
  for (const city of cities) {
    if (city && norm(city).length >= 3 && text.includes(norm(city))) {
      patch.city = city;
      break;
    }
  }
  const districts: string[] = [];
  for (const district of options.knownDistricts ?? []) {
    if (!district) continue;
    const key = norm(district);
    if (key.length >= 3 && text.includes(key) && !districts.includes(district)) districts.push(district);
  }
  if (districts.length) patch.districts = districts.slice(0, 8);

  /* ---------------------------------------------- preferências/restrições */
  const prefMap: [RegExp, string][] = [
    [/\b(piscina)\b/, "piscina"],
    [/\b(churrasqueira)\b/, "churrasqueira"],
    [/\b(vista (para o )?mar|frente ao mar|pe na areia)\b/, "vista para o mar"],
    [/\b(academia)\b/, "academia"],
    [/\b(sacada|varanda gourmet|varanda)\b/, "varanda"],
    [/\b(mobiliado|semi ?mobiliado)\b/, "mobiliado"],
    [/\b(elevador)\b/, "elevador"],
    [/\b(portaria 24|seguranca 24)\b/, "portaria 24h"],
    [/\b(pet|aceita animais|animal de estimacao)\b/, "aceita pet"],
    [/\b(novo|lancamento|na planta)\b/, "novo/lançamento"],
  ];
  const preferences: string[] = [];
  const restrictions: string[] = [];
  for (const [pattern, label] of prefMap) {
    const match = pattern.exec(text);
    if (!match) continue;
    if (negatedAround(text, match.index) || /\bsem\s*$/.test(text.slice(0, match.index).slice(-6))) {
      restrictions.push(`sem ${label}`);
    } else {
      preferences.push(label);
    }
  }
  if (/\b(nao|sem) (quero |queremos )?(terreo|andar baixo)\b/.test(text)) restrictions.push("sem térreo");
  if (preferences.length) patch.preferences = preferences.slice(0, 12);
  if (restrictions.length) patch.restrictions = restrictions.slice(0, 12);

  /* --------------------------------------------------------------- sinais */
  if (/\b(visita|visitar|agendar|marcar|conhecer o imovel|ver o imovel|ver pessoalmente)\b/.test(text)) {
    const match = /\b(visita|visitar|agendar|marcar|conhecer o imovel|ver o imovel|ver pessoalmente)\b/.exec(text)!;
    if (!negatedAround(text, match.index)) signals.wantsVisit = true;
  }
  if (/\b(falar com (o )?(corretor|humano|atendente|pessoa|responsavel)|atendimento humano|me liga|quero falar com alguem)\b/.test(text))
    signals.wantsHuman = true;
  if (/\b(so (pesquisando|olhando|dando uma olhada)|apenas (pesquisando|olhando)|curiosidade|sem compromisso|so uma ideia)\b/.test(text))
    signals.justLooking = true;

  const code = /\bep[-\s]?(\d{2,6})\b/i.exec(input ?? "");
  if (code) signals.propertyCode = `EP-${code[1]}`;

  /* Remove chaves com valor nulo/indefinido: patch só carrega o que existe. */
  const fields: string[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined || (Array.isArray(value) && value.length === 0)) {
      delete (patch as Record<string, unknown>)[key];
      continue;
    }
    fields.push(key);
  }

  return { patch, signals, fields };
}

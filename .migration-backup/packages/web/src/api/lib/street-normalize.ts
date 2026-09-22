/**
 * Normalização de logradouro e busca aproximada.
 *
 * Módulo puro: sem banco, sem rede. Existe porque a identidade do imóvel só é
 * confiável se "Rua Guimarães Rosa 492 apto 163" e "Av. Guimaraes Rosa, 492,
 * ap 163" chegarem à MESMA chave — o proprietário digita de um jeito no
 * WhatsApp, o corretor de outro no CRM, e o site de um terceiro.
 *
 * Regras fechadas com o usuário (seções 5 e 6 do escopo):
 *  - o TIPO DE VIA é descartado na comparação (Rua/R./Avenida/Av./Travessa…):
 *    ninguém erra o nome da rua, mas todo mundo erra o tipo;
 *  - acento, caixa, pontuação e abreviação não distinguem endereço;
 *  - erro pequeno de digitação NÃO cria endereço novo às escondidas: gera
 *    candidato com nota de similaridade para a IA/corretor confirmar.
 *
 * O que este módulo NÃO faz: decidir que dois imóveis são o mesmo. Isso é de
 * `capture-address.ts` (unitKey/addrKey), que soma número e complementos.
 */

/** Remove acentos e baixa a caixa, preservando espaços. */
function deburr(value: string | null | undefined): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/**
 * Tipos de via descartados na comparação, já sem acento.
 *
 * Inclui as abreviações que aparecem de fato no cadastro brasileiro. A lista é
 * de COMPARAÇÃO: o texto original do endereço nunca é reescrito no banco.
 *
 * "jardim", "vila", "parque", "residencial", "quadra", "conjunto" e afins
 * ficam FORA de propósito: em nome de logradouro elas quase sempre são parte
 * do nome ("Rua Vila Nova" não é "Rua Nova") e descartá-las fundiria
 * endereços diferentes — o erro mais caro possível aqui.
 */
const STREET_TYPES = [
  "rua", "r",
  "avenida", "av", "avn", "avda",
  "travessa", "tv", "trav",
  "alameda", "al", "alam",
  "praca", "pca", "pc",
  "rodovia", "rod",
  "estrada", "est", "estr",
  "via",
  "largo", "lgo",
  "viela",
  "servidao",
  "passagem", "psg",
  "ladeira",
  "marginal",
  "beco",
  "caminho",
  "acesso",
  "anel",
  "trecho",
] as const;

const STREET_TYPE_SET = new Set<string>(STREET_TYPES);

/**
 * Partículas que não distinguem logradouro nenhum.
 *
 * "Rua Doutor João de Barros" e "R. Dr. Joao Barros" precisam casar, então os
 * conectivos e os títulos abreviados caem junto com o tipo de via.
 */
const NOISE_WORDS = new Set([
  "de", "da", "do", "das", "dos", "e", "d",
  "dr", "doutor", "dra", "doutora",
  "prof", "professor", "profa", "professora",
  "eng", "engenheiro", "engenheira",
  "pres", "presidente",
  "gov", "governador",
  "pref", "prefeito",
  "gen", "general",
  "cel", "coronel",
  "cap", "capitao",
  "sgt", "sargento",
  "ver", "vereador",
  "sen", "senador",
  "dep", "deputado",
  "com", "comendador",
  "mal", "marechal",
  "pe", "padre",
  "sao", "santo", "santa", "s",
  "vva", "viuva",
  "jr", "junior", "filho", "neto",
]);

/**
 * Nome do logradouro em palavras comparáveis, sem tipo de via nem ruído.
 *
 * O tipo de via só é descartado quando aparece NA PRIMEIRA posição: "Rua da
 * Praia" perde "rua", mas "Rua Vila Nova" não perde "vila" no meio do nome —
 * ali "vila" é parte do nome próprio.
 */
export function streetWords(raw: string | null | undefined): string[] {
  const words = deburr(raw)
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!words.length) return [];

  /* Corta UM tipo de via no início ("Avenida X", "Av. X", "R. X").
     Só um: cortar em sequência transformaria "Rua Beco do Sapo" em "sapo" e
     dois logradouros distintos viram um. */
  const start = words.length > 1 && STREET_TYPE_SET.has(words[0]!) ? 1 : 0;

  const rest = words.slice(start).filter((word) => !NOISE_WORDS.has(word));

  /* Se o filtro comeu tudo (ex.: "Rua de Santo"), devolve o que sobrou depois
     do tipo de via: perder o endereço inteiro seria pior que manter o ruído. */
  return rest.length ? rest : words.slice(start);
}

/**
 * Chave comparável do logradouro: palavras significativas, sem separador.
 *
 * `""` quando não há logradouro utilizável — e chave vazia NUNCA casa com
 * chave vazia em decisão de identidade (quem compara precisa checar isso).
 */
export function streetKey(raw: string | null | undefined): string {
  return streetWords(raw).join("");
}

/** Cidade comparável: sem acento, sem pontuação, sem espaço. */
export function cityKey(raw: string | null | undefined): string {
  return deburr(raw).replace(/[^a-z0-9]+/g, "");
}

/**
 * Nome de exibição do logradouro: caixa e acento do original preservados,
 * apenas com espaços e pontuação sobrando normalizados.
 *
 * Existe para a tabela central de logradouros mostrar "Avenida Presidente
 * Costa e Silva" e não a chave comparável.
 */
export function streetDisplayName(raw: string | null | undefined): string {
  return String(raw ?? "")
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*$/, "")
    .trim();
}

/* ------------------------------------------------------- similaridade */

/** Distância de Levenshtein em duas linhas de buffer (sem matriz completa). */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
    }
    const swap = prev;
    prev = curr;
    curr = swap;
  }

  return prev[b.length]!;
}

/** Similaridade de 0 a 1 entre duas chaves de logradouro. */
export function similarity(a: string, b: string): number {
  if (!a && !b) return 0;
  if (a === b) return 1;
  const longest = Math.max(a.length, b.length);
  if (!longest) return 0;
  return 1 - editDistance(a, b) / longest;
}

/**
 * Limiares de decisão.
 *
 * `AUTO` é alto de propósito: acima dele o logradouro é tratado como o mesmo
 * (troca de tipo de via, acento, um caractere trocado). Entre `SUGGEST` e
 * `AUTO` NÃO se assume nada — devolve candidato para confirmação, que é o que
 * o usuário pediu em "deixar preparado para confirmação pela IA, sem criar
 * endereço errado".
 */
export const STREET_MATCH_AUTO = 0.92;
export const STREET_MATCH_SUGGEST = 0.74;

/**
 * Erros de digitação toleráveis para chaves do tamanho dado.
 *
 * Percentual sozinho não serve: "kennedy"/"kenedy" é 0,857 (um caractere em
 * nome curto) e "brasil"/"bahia" é 0,66 — a diferença entre os dois casos é a
 * QUANTIDADE de edições, não a proporção. Nome curto não tolera edição
 * nenhuma, porque ali um caractere já é outro logradouro.
 */
export function editTolerance(length: number): number {
  if (length >= 12) return 2;
  if (length >= 6) return 1;
  return 0;
}

/**
 * `true` quando duas chaves já normalizadas são o mesmo logradouro: iguais, ou
 * dentro da tolerância de digitação.
 */
export function sameStreetKey(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const tolerance = editTolerance(Math.min(a.length, b.length));
  if (tolerance === 0) return false;
  return editDistance(a, b) <= tolerance;
}

export interface StreetCandidate {
  id?: number;
  city: string;
  name: string;
  /** apelidos/grafias já aceitas para este logradouro */
  aliases?: string[] | null;
}

export type StreetMatch = {
  candidate: StreetCandidate;
  score: number;
  /** `true` só acima de STREET_MATCH_AUTO: pode usar sem perguntar */
  exact: boolean;
};

/** Todas as chaves que representam um logradouro: nome + apelidos. */
export function candidateKeys(candidate: StreetCandidate): string[] {
  const keys = [streetKey(candidate.name), ...(candidate.aliases ?? []).map(streetKey)];
  return [...new Set(keys.filter(Boolean))];
}

/**
 * Melhor logradouro para um texto digitado, dentro de UMA cidade.
 *
 * Cidade é filtro duro: "Rua São Paulo" de Santos não é a de Praia Grande.
 * Devolve `null` quando nada passa de `STREET_MATCH_SUGGEST` — nesse caso o
 * logradouro é novo e deve ser criado com o texto que a pessoa digitou.
 */
export function matchStreet(
  candidates: StreetCandidate[],
  input: { street: string | null | undefined; city: string | null | undefined },
): StreetMatch | null {
  const key = streetKey(input.street);
  if (!key) return null;
  const city = cityKey(input.city);

  let best: StreetMatch | null = null;

  for (const candidate of candidates) {
    if (city && cityKey(candidate.city) !== city) continue;
    for (const candidateKey of candidateKeys(candidate)) {
      const score = similarity(key, candidateKey);
      const exact = sameStreetKey(key, candidateKey);
      if (!best || score > best.score) best = { candidate, score, exact };
    }
  }

  if (!best) return null;
  if (!best.exact && best.score < STREET_MATCH_SUGGEST) return null;
  return best;
}

/**
 * Logradouros parecidos o bastante para virar pergunta de confirmação.
 *
 * Ordenado do mais parecido para o menos. Usado quando `matchStreet` achou
 * algo mas não o suficiente para assumir sozinho.
 */
export function suggestStreets(
  candidates: StreetCandidate[],
  input: { street: string | null | undefined; city: string | null | undefined },
  limit = 5,
): StreetMatch[] {
  const key = streetKey(input.street);
  if (!key) return [];
  const city = cityKey(input.city);

  const scored = candidates
    .filter((candidate) => !city || cityKey(candidate.city) === city)
    .map((candidate) => {
      const keys = candidateKeys(candidate);
      const score = Math.max(0, ...keys.map((candidateKey) => similarity(key, candidateKey)));
      const exact = keys.some((candidateKey) => sameStreetKey(key, candidateKey));
      return { candidate, score, exact };
    })
    .filter((row) => row.exact || row.score >= STREET_MATCH_SUGGEST)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, limit);
}

/** `true` quando os dois textos descrevem o mesmo logradouro. */
export function sameStreet(a: string | null | undefined, b: string | null | undefined): boolean {
  return sameStreetKey(streetKey(a), streetKey(b));
}

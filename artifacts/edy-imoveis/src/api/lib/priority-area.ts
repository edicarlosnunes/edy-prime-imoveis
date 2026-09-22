/**
 * Área prioritária de captação — PRIORIDADE, nunca limite.
 *
 * Regra fechada com o usuário: imóvel fora das cidades prioritárias é
 * cadastrado exatamente pelo mesmo fluxo, sem bloqueio, sem etapa extra e sem
 * mensagem de recusa. A única diferença é que o CRM recebe a marca
 * `FORA_DA_AREA_PRIORITARIA` e mostra o destaque visual forte.
 *
 * Módulo puro: a lista efetiva entra por parâmetro para que a versão editável
 * (gravada em `settings`) e a lista padrão usem a mesma comparação.
 */
import { cityKey } from "./street-normalize";

/**
 * Lista padrão (Baixada Santista + litoral sul), confirmada pelo usuário.
 * É o fallback quando as configurações ainda não têm lista própria — nunca
 * uma trava: ver `isPriorityCity`.
 */
export const DEFAULT_PRIORITY_CITIES = [
  "Praia Grande",
  "Mongaguá",
  "Itanhaém",
  "Peruíbe",
  "São Vicente",
  "Santos",
  "Guarujá",
  "Cubatão",
] as const;

/** Marca gravada/exibida quando a cidade está fora da lista. */
export const OUTSIDE_PRIORITY_FLAG = "FORA_DA_AREA_PRIORITARIA";

/** Texto do selo/faixa vermelha no CRM. */
export const OUTSIDE_PRIORITY_LABEL = "FORA DA ÁREA PRIORITÁRIA";

/**
 * Normaliza uma lista de cidades para comparação e exibição.
 * Remove vazios e repetidos (comparando sem acento/caixa), preservando a
 * grafia da primeira ocorrência — é ela que aparece na tela.
 */
export function normalizePriorityCities(
  raw: readonly (string | null | undefined)[] | null | undefined,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw ?? []) {
    const name = String(item ?? "").trim().replace(/\s+/g, " ").slice(0, 120);
    if (!name) continue;
    const key = cityKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/**
 * Lê a lista das configurações. Aceita JSON (`["Santos","Guarujá"]`) e texto
 * separado por vírgula/linha, porque o campo é editado por humano.
 *
 * Conteúdo vazio ou inválido devolve a lista padrão: a ausência de
 * configuração nunca pode virar "nenhuma cidade é prioritária".
 */
export function parsePriorityCities(raw: string | null | undefined): string[] {
  const value = String(raw ?? "").trim();
  if (!value) return [...DEFAULT_PRIORITY_CITIES];

  let parts: (string | null | undefined)[] = [];
  if (value.startsWith("[")) {
    try {
      const parsed = JSON.parse(value) as unknown;
      parts = Array.isArray(parsed) ? parsed.map((item) => (typeof item === "string" ? item : null)) : [];
    } catch {
      parts = [];
    }
  }
  if (!parts.length) parts = value.split(/[,;\n]/);

  /* Nome de cidade só tem letras, espaço, hífen, apóstrofo e ponto. Lixo
     digitado no campo (JSON quebrado, chaves soltas) é descartado em vez de
     virar "cidade" e passar a marcar todo mundo como fora da área. */
  const cities = normalizePriorityCities(
    parts.filter((part) => /^[\p{L}][\p{L}\s'.\-]*$/u.test(String(part ?? "").trim())),
  );
  return cities.length ? cities : [...DEFAULT_PRIORITY_CITIES];
}

/** Serializa para a coluna de configuração (JSON). */
export function serializePriorityCities(cities: readonly string[]): string {
  return JSON.stringify(normalizePriorityCities(cities));
}

/**
 * A cidade está na área prioritária?
 *
 * Cidade vazia responde `true` de propósito: sem cidade informada não há como
 * afirmar que está fora, e marcar "fora" em cadastro pela metade encheria o
 * CRM de faixa vermelha falsa. A marcação só acontece quando a cidade é
 * conhecida e realmente não está na lista.
 */
export function isPriorityCity(
  city: string | null | undefined,
  cities: readonly string[] = DEFAULT_PRIORITY_CITIES,
): boolean {
  const key = cityKey(city);
  if (!key) return true;
  return cities.some((item) => cityKey(item) === key);
}

/** Valor da flag a gravar (1/0 na coluna inteira). */
export function outsidePriorityArea(
  city: string | null | undefined,
  cities: readonly string[] = DEFAULT_PRIORITY_CITIES,
): boolean {
  return !isPriorityCity(city, cities);
}

export type PriorityAreaView = {
  outside: boolean;
  flag: typeof OUTSIDE_PRIORITY_FLAG | null;
  label: string | null;
  /** Mensagem do alerta — informativa, nunca impedimento. */
  message: string | null;
};

/** Pronto para a UI: selo, faixa e texto do alerta. */
export function priorityAreaView(
  city: string | null | undefined,
  cities: readonly string[] = DEFAULT_PRIORITY_CITIES,
): PriorityAreaView {
  if (!outsidePriorityArea(city, cities)) {
    return { outside: false, flag: null, label: null, message: null };
  }
  const name = String(city ?? "").trim();
  return {
    outside: true,
    flag: OUTSIDE_PRIORITY_FLAG,
    label: OUTSIDE_PRIORITY_LABEL,
    message: `${name} está fora da área prioritária de atuação. O cadastro segue normalmente — atenção redobrada na viabilidade do atendimento.`,
  };
}

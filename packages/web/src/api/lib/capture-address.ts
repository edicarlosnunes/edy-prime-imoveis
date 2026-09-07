/**
 * Endereço estruturado e identidade da unidade imobiliária.
 *
 * Módulo puro: nenhuma dependência de banco ou rede. A consulta de CEP em si
 * (ViaCEP) fica em `cep-lookup.ts`; aqui ficam só normalização e a regra de
 * identidade, que é o que precisa ser inquestionável e testável.
 *
 * Regra fechada com o usuário (seções 3 e 5 do escopo):
 *  - o TELEFONE identifica o PROPRIETÁRIO, nunca o imóvel;
 *  - dois imóveis NÃO são o mesmo só por terem o mesmo dono, o mesmo telefone,
 *    o mesmo prédio ou o mesmo preço;
 *  - a unidade é identificada por CEP + número + complementos relevantes.
 *    Apartamentos diferentes no mesmo prédio são captações diferentes.
 */

/** Só dígitos, para comparar CEP salvo com e sem máscara. */
const digits = (value: string | null | undefined) => String(value ?? "").replace(/\D/g, "");

/** CEP normalizado em 8 dígitos, ou `null` quando não há CEP utilizável. */
export function normalizeCep(raw: string | null | undefined): string | null {
  const only = digits(raw);
  return only.length === 8 ? only : null;
}

/** `true` só para CEP completo de 8 dígitos. */
export function isValidCep(raw: string | null | undefined): boolean {
  return normalizeCep(raw) !== null;
}

/** Exibição: 11700-000. Devolve o texto original quando não dá para formatar. */
export function formatCep(raw: string | null | undefined): string {
  const cep = normalizeCep(raw);
  if (!cep) return String(raw ?? "").trim();
  return `${cep.slice(0, 5)}-${cep.slice(5)}`;
}

/**
 * Campos de complemento aceitos no cadastro.
 *
 * Todos OPCIONAIS: um terreno não tem apartamento, uma casa não tem torre.
 * A ordem aqui é a ordem de exibição e a ordem usada na chave da unidade.
 * `identifies: true` marca o que efetivamente distingue duas unidades no mesmo
 * endereço — `andar` e `box` não distinguem (dois apartamentos podem estar no
 * mesmo andar; a garagem não define a unidade).
 */
export const COMPLEMENT_FIELDS = [
  { key: "unit", label: "Apartamento / unidade", identifies: true },
  { key: "block", label: "Bloco", identifies: true },
  { key: "tower", label: "Torre", identifies: true },
  { key: "conjunto", label: "Conjunto", identifies: true },
  { key: "room", label: "Sala", identifies: true },
  { key: "store", label: "Loja", identifies: true },
  { key: "house", label: "Casa / fundos", identifies: true },
  { key: "chale", label: "Chalé", identifies: true },
  { key: "lot", label: "Lote", identifies: true },
  { key: "quadra", label: "Quadra", identifies: true },
  { key: "otherId", label: "Outro identificador", identifies: true },
  { key: "floor", label: "Andar", identifies: false },
  { key: "box", label: "Box / garagem", identifies: false },
  { key: "complement", label: "Complemento", identifies: false },
] as const;

export type ComplementKey = (typeof COMPLEMENT_FIELDS)[number]["key"];

/** Só os complementos que participam da identidade da unidade. */
export const IDENTIFYING_COMPLEMENTS: ComplementKey[] = COMPLEMENT_FIELDS.filter(
  (field) => field.identifies,
).map((field) => field.key);

export type Complements = Partial<Record<ComplementKey, string | null | undefined>>;

export interface UnitAddress {
  cep?: string | null;
  /** número do logradouro; texto porque existe "s/n", "12-A", "km 3" */
  number?: string | null;
  /** usado só quando não há CEP (fallback manual) */
  street?: string | null;
  city?: string | null;
}

/**
 * Normaliza um pedaço de complemento para comparação.
 *
 * "Apto 101", "APTO 101", "apto101" e "101" precisam casar: o corretor digita
 * de um jeito no site e de outro no CRM. Remove acentos, pontuação, espaços e
 * as palavras-rótulo mais comuns, sobrando o identificador de fato.
 */
export function normalizeComplementValue(raw: string | null | undefined): string {
  const base = String(raw ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036F]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    /* Separa rótulo colado do número ("apto101" -> "apto 101") para que o
       corte de rótulos abaixo, que depende de fronteira de palavra, também
       pegue quem digitou sem espaço. Sem isto, "APTO101" e "101" geravam
       chaves diferentes e o MESMO apartamento virava dois imóveis. */
    .replace(/([a-z])(\d)/g, "$1 $2")
    .replace(/(\d)([a-z])/g, "$1 $2")
    .trim();
  if (!base) return "";
  const stripped = base
    .replace(
      /\b(apartamento|apto|apt|ap|unidade|und|un|bloco|bl|torre|tr|conjunto|conj|sala|sl|loja|lj|casa|cs|chale|lote|lt|quadra|qd|andar|and|box|bx|numero|num|no|n)\b/g,
      " ",
    )
    .replace(/\s+/g, "")
    .trim();
  /* Se sobrou nada (ex.: o valor era só a palavra "casa"), o rótulo ERA o
     conteúdo — mantém o texto normalizado para não perder a distinção. */
  return stripped || base.replace(/\s+/g, "");
}

/**
 * Chave estável da unidade imobiliária.
 *
 * Formato: `cep:<8 digitos>|n:<numero>|<key>=<valor>...` com os complementos
 * identificadores em ordem fixa. Sem CEP, cai para logradouro + cidade, que é
 * o melhor disponível no preenchimento manual.
 *
 * Duas captações com a mesma chave são o MESMO imóvel. Chaves diferentes são
 * imóveis diferentes, ainda que do mesmo dono e no mesmo prédio.
 */
export function unitKey(address: UnitAddress, complements: Complements = {}): string {
  const cep = normalizeCep(address.cep);
  const number = normalizeComplementValue(address.number);

  const head = cep
    ? `cep:${cep}`
    : `st:${normalizeComplementValue(address.street)}|ct:${normalizeComplementValue(address.city)}`;

  const parts = IDENTIFYING_COMPLEMENTS.map((key) => {
    const value = normalizeComplementValue(complements[key]);
    return value ? `${key}=${value}` : "";
  }).filter(Boolean);

  return [head, `n:${number}`, ...parts].join("|");
}

/** `true` quando as duas entradas descrevem a mesma unidade imobiliária. */
export function sameUnit(
  a: { address: UnitAddress; complements?: Complements },
  b: { address: UnitAddress; complements?: Complements },
): boolean {
  return unitKey(a.address, a.complements ?? {}) === unitKey(b.address, b.complements ?? {});
}

/** Endereço em uma linha, para ficha técnica, autorização e listagens. */
export function formatUnitAddress(
  address: UnitAddress & { district?: string | null; state?: string | null },
  complements: Complements = {},
): string {
  const complementText = COMPLEMENT_FIELDS.map((field) => {
    const value = String(complements[field.key] ?? "").trim();
    return value ? `${field.label}: ${value}` : "";
  })
    .filter(Boolean)
    .join(", ");

  const line = [
    [String(address.street ?? "").trim(), String(address.number ?? "").trim()].filter(Boolean).join(", "),
    complementText,
    String(address.district ?? "").trim(),
    [String(address.city ?? "").trim(), String(address.state ?? "").trim()].filter(Boolean).join("/"),
    address.cep ? `CEP ${formatCep(address.cep)}` : "",
  ]
    .filter(Boolean)
    .join(" — ");

  return line;
}

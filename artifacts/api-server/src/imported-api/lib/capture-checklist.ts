/**
 * Checklist de pré-captação (operacional, sem tabela nova).
 *
 * Decisão de arquitetura: `property_checklist` é keyed em `property_id` e o
 * imóvel só existe DEPOIS da captação, então não serve aqui. A persistência
 * principal do estágio de documentação continua em `property_captures.doc_status`;
 * o item a item vive num bloco estruturado no fim de `property_captures.notes`,
 * sem alterar o schema.
 *
 * Formato gravado (última linha das observações):
 *
 *     [checklist] owner_id,owner_cpf
 *
 * Texto livre do corretor é preservado intacto acima do bloco.
 */

export const CHECKLIST_GROUPS = ["proprietario", "imovel"] as const;
export type ChecklistGroup = (typeof CHECKLIST_GROUPS)[number];

export type ChecklistItem = {
  key: string;
  group: ChecklistGroup;
  label: string;
};

/** Os 6 itens de pré-captação. A ordem aqui é a ordem canônica de gravação. */
export const CHECKLIST_ITEMS: readonly ChecklistItem[] = [
  { key: "owner_id", group: "proprietario", label: "Documento de identificação" },
  { key: "owner_cpf", group: "proprietario", label: "CPF" },
  { key: "owner_address", group: "proprietario", label: "Comprovante de endereço" },
  { key: "property_deed", group: "imovel", label: "Matrícula / documento do imóvel" },
  { key: "property_iptu", group: "imovel", label: "IPTU" },
  { key: "property_basics", group: "imovel", label: "Dados básicos e documentos disponíveis" },
];

export const CHECKLIST_GROUP_LABELS: Record<ChecklistGroup, string> = {
  proprietario: "PROPRIETÁRIO",
  imovel: "IMÓVEL",
};

const CHECKLIST_KEYS: readonly string[] = CHECKLIST_ITEMS.map((item) => item.key);

/** Linha do bloco estruturado. Tolerante a espaços; casa só no início da linha. */
const BLOCK_LINE = /^[ \t]*\[checklist\][ \t]*(.*)$/;

export function isChecklistKey(key: string): boolean {
  return CHECKLIST_KEYS.includes(key);
}

/**
 * Mantém apenas chaves conhecidas, sem duplicatas, na ordem canônica.
 * Chave desconhecida é descartada em silêncio: nunca deve virar item na tela.
 */
export function normalizeChecklist(done: readonly string[]): string[] {
  const wanted = new Set(done.map((key) => key.trim()).filter((key) => key.length > 0));
  return CHECKLIST_ITEMS.filter((item) => wanted.has(item.key)).map((item) => item.key);
}

/** Separa o texto livre do bloco de checklist. Nunca perde o texto do corretor. */
export function parseChecklist(notes: string | null | undefined): {
  text: string;
  done: string[];
} {
  if (!notes) return { text: "", done: [] };
  const lines = notes.split("\n");
  const kept: string[] = [];
  let done: string[] = [];
  for (const line of lines) {
    const match = BLOCK_LINE.exec(line);
    if (match) {
      /* Último bloco vence: gravações antigas duplicadas não somam. */
      done = normalizeChecklist((match[1] ?? "").split(","));
      continue;
    }
    kept.push(line);
  }
  return { text: kept.join("\n").trim(), done };
}

/** Recompõe as observações com o bloco no fim. Sem itens marcados, sem bloco. */
export function serializeChecklist(
  text: string | null | undefined,
  done: readonly string[],
): string | null {
  const body = (text ?? "").trim();
  const keys = normalizeChecklist(done);
  if (keys.length === 0) return body.length > 0 ? body : null;
  const block = `[checklist] ${keys.join(",")}`;
  return body.length > 0 ? `${body}\n\n${block}` : block;
}

/** Aplica uma marcação/desmarcação sobre o estado atual das observações. */
export function toggleChecklistItem(
  notes: string | null | undefined,
  key: string,
  value: boolean,
): string | null {
  const { text, done } = parseChecklist(notes);
  if (!isChecklistKey(key)) return serializeChecklist(text, done);
  const set = new Set(done);
  if (value) set.add(key);
  else set.delete(key);
  return serializeChecklist(text, [...set]);
}

export function checklistProgress(done: readonly string[]): { done: number; total: number } {
  return { done: normalizeChecklist(done).length, total: CHECKLIST_ITEMS.length };
}

/** Itens que ainda faltam — é o que vai no texto do pedido ao proprietário. */
export function missingChecklistItems(done: readonly string[]): ChecklistItem[] {
  const have = new Set(normalizeChecklist(done));
  return CHECKLIST_ITEMS.filter((item) => !have.has(item.key));
}

/**
 * Sugestão de `doc_status` a partir do checklist. É sugestão: quem decide o
 * status continua sendo o corretor no Select, porque documento recebido e
 * documento conferido não são a mesma coisa.
 */
export function suggestDocStatus(done: readonly string[]): "nao_iniciado" | "parcial" | "completo" {
  const { done: count, total } = checklistProgress(done);
  if (count === 0) return "nao_iniciado";
  if (count >= total) return "completo";
  return "parcial";
}

/** Texto do WhatsApp pedindo o que falta. Sem itens faltando, sem lista. */
export function documentRequestMessage(input: {
  ownerName?: string | null;
  done: readonly string[];
  creci?: string | null;
}): string {
  const first = (input.ownerName ?? "").trim().split(/\s+/)[0] ?? "";
  const missing = missingChecklistItems(input.done);
  const hello = first ? `Olá, ${first}!` : "Olá!";
  const lines = [
    `${hello} Aqui é da Edy Prime Imóveis${input.creci ? ` (CRECI ${input.creci})` : ""}.`,
    "",
    missing.length > 0
      ? "Para seguir com a captação do seu imóvel, preciso destes documentos:"
      : "Recebi todos os documentos da captação do seu imóvel, obrigado!",
  ];
  for (const item of missing) {
    lines.push(`• ${item.label} (${CHECKLIST_GROUP_LABELS[item.group].toLowerCase()})`);
  }
  if (missing.length > 0) {
    lines.push("", "Pode enviar por aqui mesmo, em foto ou PDF.");
  }
  return lines.join("\n");
}

import { describe, expect, test } from "bun:test";
import {
  CHECKLIST_ITEMS,
  checklistProgress,
  documentRequestMessage,
  missingChecklistItems,
  normalizeChecklist,
  parseChecklist,
  serializeChecklist,
  suggestDocStatus,
  toggleChecklistItem,
} from "./capture-checklist";

const ALL = CHECKLIST_ITEMS.map((item) => item.key);

describe("checklist tem os 6 itens de pre-captacao", () => {
  test("3 do proprietario e 3 do imovel", () => {
    expect(CHECKLIST_ITEMS).toHaveLength(6);
    expect(CHECKLIST_ITEMS.filter((i) => i.group === "proprietario")).toHaveLength(3);
    expect(CHECKLIST_ITEMS.filter((i) => i.group === "imovel")).toHaveLength(3);
  });

  test("chaves sao unicas", () => {
    expect(new Set(ALL).size).toBe(6);
  });
});

describe("parseChecklist preserva o texto do corretor", () => {
  test("observacoes sem bloco vem inteiras e sem itens", () => {
    const r = parseChecklist("Proprietário viaja em outubro.");
    expect(r.text).toBe("Proprietário viaja em outubro.");
    expect(r.done).toEqual([]);
  });

  test("nulo e vazio nao quebram", () => {
    expect(parseChecklist(null)).toEqual({ text: "", done: [] });
    expect(parseChecklist(undefined)).toEqual({ text: "", done: [] });
    expect(parseChecklist("")).toEqual({ text: "", done: [] });
  });

  test("bloco e separado do texto livre", () => {
    const r = parseChecklist("Ligar depois das 18h.\n\n[checklist] owner_cpf,owner_id");
    expect(r.text).toBe("Ligar depois das 18h.");
    expect(r.done).toEqual(["owner_id", "owner_cpf"]);
  });

  test("chave desconhecida e descartada", () => {
    expect(parseChecklist("[checklist] owner_id,scraper_magico").done).toEqual(["owner_id"]);
  });

  test("ultimo bloco vence quando o arquivo tem dois", () => {
    const r = parseChecklist("[checklist] owner_id\ntexto\n[checklist] property_iptu");
    expect(r.done).toEqual(["property_iptu"]);
    expect(r.text).toBe("texto");
  });
});

describe("serializeChecklist", () => {
  test("sem itens nao grava bloco", () => {
    expect(serializeChecklist("texto", [])).toBe("texto");
  });

  test("sem texto e sem itens vira null", () => {
    expect(serializeChecklist("", [])).toBeNull();
    expect(serializeChecklist(null, [])).toBeNull();
  });

  test("grava na ordem canonica, nao na ordem do clique", () => {
    expect(serializeChecklist("", ["property_iptu", "owner_id"])).toBe(
      "[checklist] owner_id,property_iptu",
    );
  });

  test("ida e volta nao duplica bloco nem perde texto", () => {
    const once = serializeChecklist("Nota importante.", ["owner_id"]);
    const parsed = parseChecklist(once);
    const twice = serializeChecklist(parsed.text, parsed.done);
    expect(twice).toBe(once);
    expect(parseChecklist(twice).text).toBe("Nota importante.");
  });

  test("duplicatas colapsam", () => {
    expect(normalizeChecklist(["owner_id", "owner_id", " owner_id "])).toEqual(["owner_id"]);
  });
});

describe("toggleChecklistItem", () => {
  test("marcar e desmarcar volta ao estado inicial", () => {
    const base = "Observação.";
    const marked = toggleChecklistItem(base, "owner_cpf", true);
    expect(parseChecklist(marked).done).toEqual(["owner_cpf"]);
    const unmarked = toggleChecklistItem(marked, "owner_cpf", false);
    expect(parseChecklist(unmarked).done).toEqual([]);
    expect(unmarked).toBe(base);
  });

  test("marcar duas vezes nao duplica", () => {
    const once = toggleChecklistItem(null, "owner_id", true);
    expect(toggleChecklistItem(once, "owner_id", true)).toBe(once);
  });

  test("chave invalida nao altera nada", () => {
    const base = serializeChecklist("txt", ["owner_id"]);
    expect(toggleChecklistItem(base, "nao_existe", true)).toBe(base);
  });
});

describe("progresso e sugestao de doc_status", () => {
  test("nada marcado sugere nao_iniciado", () => {
    expect(checklistProgress([])).toEqual({ done: 0, total: 6 });
    expect(suggestDocStatus([])).toBe("nao_iniciado");
  });

  test("parte marcada sugere parcial", () => {
    expect(suggestDocStatus(["owner_id", "owner_cpf"])).toBe("parcial");
  });

  test("tudo marcado sugere completo", () => {
    expect(checklistProgress(ALL)).toEqual({ done: 6, total: 6 });
    expect(suggestDocStatus(ALL)).toBe("completo");
  });

  test("chave invalida nao infla o progresso", () => {
    expect(checklistProgress(["owner_id", "xx"])).toEqual({ done: 1, total: 6 });
  });
});

describe("pedido de documentos por WhatsApp", () => {
  test("lista o que falta e usa o primeiro nome", () => {
    const msg = documentRequestMessage({
      ownerName: "Maria Souza Lima",
      done: ["owner_id"],
      creci: "134718-F",
    });
    expect(msg).toContain("Olá, Maria!");
    expect(msg).toContain("CRECI 134718-F");
    expect(msg).toContain("CPF");
    expect(msg).not.toContain("Documento de identificação");
  });

  test("faltando todos, lista os 6", () => {
    const msg = documentRequestMessage({ ownerName: null, done: [] });
    expect(msg).toContain("Olá!");
    for (const item of CHECKLIST_ITEMS) expect(msg).toContain(item.label);
  });

  test("nada faltando: agradece em vez de pedir", () => {
    const msg = documentRequestMessage({ ownerName: "João", done: ALL });
    expect(missingChecklistItems(ALL)).toEqual([]);
    expect(msg).toContain("Recebi todos os documentos");
    expect(msg).not.toContain("•");
  });
});

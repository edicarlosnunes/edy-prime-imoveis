/**
 * Arquivo Morto — regras de arquivar e restaurar.
 *
 * O que está sendo garantido aqui: EPI preservado, nada apagado, ficha fora das
 * listagens e fora do ar, restauração com o mesmo código.
 */
import { describe, expect, test } from "bun:test";
import {
  archiveEffect,
  decideArchivedMatch,
  isArchived,
  normalizeArchiveReason,
  restoreEffect,
} from "./archive-rules";

const now = new Date("2026-09-18T15:00:00Z");

describe("isArchived", () => {
  test("ficha sem data de arquivamento está na operação", () => {
    expect(isArchived({ archivedAt: null })).toBe(false);
    expect(isArchived({})).toBe(false);
    expect(isArchived(null)).toBe(false);
  });

  test("ficha com data está no Arquivo Morto", () => {
    expect(isArchived({ archivedAt: now })).toBe(true);
  });
});

describe("arquivar", () => {
  test("marca arquivamento, tira do ar e preserva o EPI", () => {
    const effect = archiveEffect({ now, userName: "Edy", reason: "Proprietário desistiu", epiCode: "EPI-1054/09-26" });
    expect(effect.patch.archivedAt).toEqual(now);
    expect(effect.patch.archivedBy).toBe("Edy");
    expect(effect.patch.archiveReason).toBe("Proprietário desistiu");
    expect(effect.patch.published).toBe(0);
    /* O EPI NÃO entra no patch: arquivar não pode tocar no código. */
    expect(Object.keys(effect.patch)).not.toContain("epiCode");
    expect(effect.historyNote).toContain("EPI preservado: EPI-1054/09-26");
  });

  test("nada do conteúdo da ficha entra no patch", () => {
    /* Arquivar só ACRESCENTA marcas. Proprietário, endereço, documentos,
       origem, datas e histórico não são tocados. */
    const effect = archiveEffect({ now, userName: "Edy", epiCode: "EPI-1000/09-26" });
    expect(Object.keys(effect.patch).sort()).toEqual(
      ["archiveReason", "archivedAt", "archivedBy", "published", "updatedAt"].sort(),
    );
  });

  test("motivo é opcional", () => {
    const effect = archiveEffect({ now, userName: "Edy", epiCode: "EPI-1000/09-26" });
    expect(effect.patch.archiveReason).toBeNull();
    expect(effect.historyNote).not.toContain("Motivo");
  });

  test("ficha legada sem EPI é arquivável e o histórico diz isso", () => {
    const effect = archiveEffect({ now, userName: "Edy", epiCode: null });
    expect(effect.historyNote).toContain("Ficha legada sem EPI");
  });

  test("motivo longo é cortado, não recusado", () => {
    const effect = archiveEffect({ now, reason: "x".repeat(900), epiCode: "EPI-1000/09-26" });
    expect(effect.patch.archiveReason!.length).toBe(400);
  });

  test("motivo em branco vira null", () => {
    expect(normalizeArchiveReason("   ")).toBeNull();
    expect(normalizeArchiveReason(null)).toBeNull();
    expect(normalizeArchiveReason(" venda encerrada ")).toBe("venda encerrada");
  });
});

describe("restaurar", () => {
  test("limpa as marcas de arquivamento e mantém o EPI", () => {
    const effect = restoreEffect({ now, userName: "Edy", epiCode: "EPI-1054/09-26" });
    expect(effect.patch.archivedAt).toBeNull();
    expect(effect.patch.archivedBy).toBeNull();
    expect(effect.patch.archiveReason).toBeNull();
    expect(Object.keys(effect.patch)).not.toContain("epiCode");
    expect(effect.historyNote).toContain("mesmo EPI: EPI-1054/09-26");
  });

  test("não republica sozinho", () => {
    const effect = restoreEffect({ now, epiCode: "EPI-1054/09-26" });
    expect(Object.keys(effect.patch)).not.toContain("published");
    expect(effect.historyNote).toContain("fora do ar");
  });

  test("arquivar e restaurar não altera o código em nenhum momento", () => {
    const epi = "EPI-1077/09-26";
    const arquivo = archiveEffect({ now, epiCode: epi });
    const volta = restoreEffect({ now, epiCode: epi });
    const tocouNoCodigo = [arquivo.patch, volta.patch].some((patch) =>
      Object.keys(patch).some((key) => key.toLowerCase().includes("epi")),
    );
    expect(tocouNoCodigo).toBe(false);
  });
});

describe("dedup encontra ficha arquivada", () => {
  test("mesmo imóvel arquivado = reabrir, sem EPI novo", () => {
    const decision = decideArchivedMatch({ id: 12, archivedAt: now, epiCode: "EPI-1054/09-26" });
    expect(decision.action).toBe("reopen");
    expect(decision.epiCode).toBe("EPI-1054/09-26");
    expect(decision.message).toContain("nenhum EPI novo");
  });

  test("ficha ativa não dispara reabertura", () => {
    expect(decideArchivedMatch({ id: 12, archivedAt: null, epiCode: "EPI-1054/09-26" }).action).toBe("none");
    expect(decideArchivedMatch(null).action).toBe("none");
  });

  test("arquivada legada sem EPI reabre sem inventar código", () => {
    const decision = decideArchivedMatch({ id: 3, archivedAt: now, epiCode: null });
    expect(decision.action).toBe("reopen");
    expect(decision.epiCode).toBeNull();
    expect(decision.message).toContain("legada sem EPI");
  });
});

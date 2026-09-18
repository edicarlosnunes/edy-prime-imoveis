/**
 * ARQUIVO MORTO — regras puras de arquivar e restaurar.
 *
 * O botão "Excluir" do CRM NÃO apaga fisicamente nada. Excluir = arquivar
 * (soft delete). O Arquivo Morto é o destino de fichas que não devem mais
 * aparecer na operação normal — desistência, cancelamento, venda encerrada,
 * falta de continuidade — e que nunca podem ser perdidas.
 *
 * O QUE ESTE MÓDULO GARANTE
 * -------------------------
 *  - o CÓDIGO UNIVERSAL EPI é preservado. `EPI-1054/09-26` arquivado continua
 *    permanentemente `EPI-1054/09-26`, e o número nunca é reutilizado por
 *    outra ficha;
 *  - proprietário, imóvel, telefone, endereço, documentos, origem, datas e
 *    histórico ficam intactos: arquivar só ACRESCENTA marcas de arquivamento;
 *  - a ficha sai das listagens operacionais e sai do ar (`published = 0`) —
 *    arquivada não aparece no site público, que só lê `published = 1`;
 *  - restaurar devolve a ficha ao CRM com o MESMO EPI e todo o histórico. Volta
 *    fora do ar de propósito: republicar é decisão editorial de quem restaurou,
 *    não efeito colateral do restore.
 *
 * Módulo puro: `now` e os dados entram por parâmetro, nada de banco aqui. As
 * rotas (`admin-properties.ts`, `admin-captures.ts`) só executam o que ele diz.
 */

/** O mínimo que uma ficha precisa expor para as regras decidirem. */
export interface ArchivableRow {
  archivedAt?: Date | null;
  epiCode?: string | null;
  published?: number | null;
}

export const MAX_ARCHIVE_REASON = 400;

/** `true` quando a ficha já está no Arquivo Morto. */
export function isArchived(row: ArchivableRow | null | undefined): boolean {
  return row?.archivedAt != null;
}

/** Motivo do arquivamento, normalizado. Sem motivo é aceito: o campo é opcional. */
export function normalizeArchiveReason(reason: string | null | undefined): string | null {
  const value = String(reason ?? "").trim();
  return value.length > 0 ? value.slice(0, MAX_ARCHIVE_REASON) : null;
}

export interface ArchiveEffect {
  /** Campos a gravar na ficha. */
  patch: {
    archivedAt: Date;
    archivedBy: string | null;
    archiveReason: string | null;
    /** Arquivada sai do ar. Nunca é republicada por um restore automático. */
    published: number;
    updatedAt: Date;
  };
  /** Linha para o histórico/audit_log. */
  historyNote: string;
}

/**
 * Efeito de arquivar.
 *
 * Idempotente por contrato: a rota deve checar `isArchived` antes e não
 * rearquivar — rearquivar sobrescreveria a data original do arquivamento, que é
 * informação do histórico.
 */
export function archiveEffect(input: {
  now: Date;
  userName?: string | null;
  reason?: string | null;
  epiCode?: string | null;
}): ArchiveEffect {
  const reason = normalizeArchiveReason(input.reason);
  const who = String(input.userName ?? "").trim() || null;
  const epi = String(input.epiCode ?? "").trim();
  return {
    patch: {
      archivedAt: input.now,
      archivedBy: who,
      archiveReason: reason,
      published: 0,
      updatedAt: input.now,
    },
    historyNote: [
      "Arquivado no Arquivo Morto",
      epi ? `EPI preservado: ${epi}` : "Ficha legada sem EPI",
      who ? `por ${who}` : null,
      reason ? `Motivo: ${reason}` : null,
    ]
      .filter(Boolean)
      .join(" | "),
  };
}

export interface RestoreEffect {
  patch: {
    archivedAt: null;
    archivedBy: null;
    archiveReason: null;
    updatedAt: Date;
  };
  historyNote: string;
}

/**
 * Efeito de restaurar.
 *
 * O EPI não entra no patch de propósito: restaurar não pode tocar no código.
 * `published` também não: a ficha volta fora do ar (como ficou ao arquivar) e
 * quem restaurou decide se publica.
 */
export function restoreEffect(input: {
  now: Date;
  userName?: string | null;
  epiCode?: string | null;
  note?: string | null;
}): RestoreEffect {
  const who = String(input.userName ?? "").trim() || null;
  const epi = String(input.epiCode ?? "").trim();
  const note = normalizeArchiveReason(input.note);
  return {
    patch: {
      archivedAt: null,
      archivedBy: null,
      archiveReason: null,
      updatedAt: input.now,
    },
    historyNote: [
      "Restaurado do Arquivo Morto",
      epi ? `mesmo EPI: ${epi}` : "ficha legada sem EPI",
      who ? `por ${who}` : null,
      note ? `Observação: ${note}` : null,
      "volta fora do ar até republicação manual",
    ]
      .filter(Boolean)
      .join(" | "),
  };
}

/**
 * Decisão da deduplicação quando o imóvel encontrado está no Arquivo Morto.
 *
 * Regra do usuário: tentar cadastrar de novo o mesmo imóvel/unidade NÃO gera
 * ficha nova nem EPI novo — localiza a arquivada e reabre aquela.
 */
export interface ArchivedMatchDecision {
  action: "reopen" | "none";
  epiCode: string | null;
  message: string | null;
}

export function decideArchivedMatch(
  match: (ArchivableRow & { id?: number }) | null | undefined,
): ArchivedMatchDecision {
  if (!match || !isArchived(match)) return { action: "none", epiCode: null, message: null };
  const epi = String(match.epiCode ?? "").trim() || null;
  return {
    action: "reopen",
    epiCode: epi,
    message: epi
      ? `Imóvel já existe no Arquivo Morto (${epi}). Ficha reaberta com o mesmo código — nenhum EPI novo foi gerado.`
      : "Imóvel já existe no Arquivo Morto (ficha legada sem EPI). Ficha reaberta — nenhum EPI novo foi gerado.",
  };
}

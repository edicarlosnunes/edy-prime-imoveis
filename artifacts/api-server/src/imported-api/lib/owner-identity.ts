/**
 * Identidade do proprietário no V3.
 *
 * Módulo puro: recebe os candidatos já lidos do banco e decide. Existe para que
 * a regra de identidade seja testável sem escrever uma linha em lugar nenhum.
 *
 * Decisão fechada com o usuário (opção "b"):
 *  1. TELEFONE é a chave principal de reuso do proprietário;
 *  2. E-MAIL deixa de ser chave de merge automático;
 *  3. e-mail já existente em OUTRO proprietário NÃO mescla: cria o novo
 *     normalmente e marca POSSÍVEL DUPLICADO para revisão humana, registrando
 *     qual proprietário gerou o alerta. O alerta nunca bloqueia a criação;
 *  4. registros históricos não são alterados e merges antigos não são
 *     desfeitos — a regra vale só para cadastros novos;
 *  5. o alerta não afeta serial, captação, ficha técnica nem autorização.
 *
 * Por que o e-mail saiu da chave de merge: endereços compartilhados
 * (cônjuge, `contato@`, síndico, advogado de espólio) fundiam pessoas
 * diferentes em um único `owner`, e no V3 isso arrastaria captação, serial e
 * documentos assinados da pessoa errada.
 */

/** Telefone comparável: só dígitos. Linhas antigas foram salvas com máscara. */
export function ownerPhoneKey(phone: string | null | undefined): string {
  return String(phone ?? "").replace(/\D/g, "");
}

/** E-mail comparável: minúsculo e sem espaços. `null` quando não utilizável. */
export function ownerEmailKey(email: string | null | undefined): string | null {
  const value = String(email ?? "").trim().toLowerCase();
  return value.includes("@") ? value : null;
}

export interface OwnerCandidate {
  id: number;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
}

export type OwnerIdentityDecision =
  | {
      /** proprietário existente reutilizado pelo telefone */
      action: "reuse";
      ownerId: number;
      duplicateOfOwnerId: null;
      reason: string;
    }
  | {
      /** proprietário novo; `duplicateOfOwnerId` marca o alerta de revisão */
      action: "create";
      ownerId: null;
      duplicateOfOwnerId: number | null;
      reason: string;
    };

/**
 * Proprietário existente com o mesmo telefone.
 *
 * Telefone vazio nunca casa: sem telefone não há identidade, e casar "vazio com
 * vazio" fundiria todo mundo que foi cadastrado sem contato.
 */
export function findOwnerByPhone(
  candidates: OwnerCandidate[],
  phone: string | null | undefined,
): OwnerCandidate | null {
  const key = ownerPhoneKey(phone);
  if (!key) return null;
  return candidates.find((owner) => ownerPhoneKey(owner.phone) === key) ?? null;
}

/**
 * Proprietário que já usa este e-mail — SINAL FRACO, nunca merge.
 *
 * Devolve o primeiro encontrado só para registrar quem disparou o alerta.
 */
export function findEmailDuplicate(
  candidates: OwnerCandidate[],
  email: string | null | undefined,
  excludeOwnerId: number | null = null,
): OwnerCandidate | null {
  const key = ownerEmailKey(email);
  if (!key) return null;
  return (
    candidates.find(
      (owner) => owner.id !== excludeOwnerId && ownerEmailKey(owner.email) === key,
    ) ?? null
  );
}

/**
 * Decide entre reutilizar e criar proprietário.
 *
 * O telefone manda. O e-mail só produz alerta, e só quando o proprietário é
 * novo: se o telefone já reutilizou alguém, não há duplicado a revisar.
 */
export function resolveOwnerIdentity(
  candidates: OwnerCandidate[],
  input: { phone?: string | null; email?: string | null },
): OwnerIdentityDecision {
  const byPhone = findOwnerByPhone(candidates, input.phone);
  if (byPhone) {
    return {
      action: "reuse",
      ownerId: byPhone.id,
      duplicateOfOwnerId: null,
      reason: `Telefone já cadastrado: proprietário #${byPhone.id} reutilizado.`,
    };
  }

  const emailTwin = findEmailDuplicate(candidates, input.email);
  if (emailTwin) {
    return {
      action: "create",
      ownerId: null,
      duplicateOfOwnerId: emailTwin.id,
      reason: `E-mail já usado pelo proprietário #${emailTwin.id}. Proprietário criado assim mesmo e marcado como possível duplicado para revisão.`,
    };
  }

  return {
    action: "create",
    ownerId: null,
    duplicateOfOwnerId: null,
    reason: "Proprietário novo.",
  };
}

/** Texto do alerta exibido no CRM, ou `null` quando não há alerta. */
export function duplicateAlertText(duplicateOfOwnerId: number | null | undefined): string | null {
  if (duplicateOfOwnerId == null) return null;
  return `Possível duplicado do proprietário #${duplicateOfOwnerId} (mesmo e-mail). Revisar manualmente.`;
}

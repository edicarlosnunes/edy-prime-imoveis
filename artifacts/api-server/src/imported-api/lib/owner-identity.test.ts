/**
 * Testes da identidade do proprietário (seção 29 do escopo).
 *
 * Cobre o teste 4: o telefone reutiliza o proprietário SEM misturar imóveis.
 *
 * Regra fechada com o usuário (opção "b"): telefone é a chave de reuso; e-mail
 * deixou de mesclar e só levanta alerta de POSSÍVEL DUPLICADO para revisão
 * humana, sem bloquear o cadastro.
 */
import { describe, expect, test } from "bun:test";
import {
  duplicateAlertText,
  findEmailDuplicate,
  findOwnerByPhone,
  ownerEmailKey,
  ownerPhoneKey,
  resolveOwnerIdentity,
  type OwnerCandidate,
} from "./owner-identity";

const base: OwnerCandidate[] = [
  { id: 1, name: "Maria", phone: "13997141174", email: "maria@exemplo.com" },
  { id: 2, name: "João", phone: "(13) 98888-7777", email: "contato@exemplo.com" },
];

describe("chaves de comparação", () => {
  test("telefone é comparado por dígitos", () => {
    /* Linhas antigas foram salvas com máscara pelo painel. */
    expect(ownerPhoneKey("(13) 99714-1174")).toBe("13997141174");
    expect(ownerPhoneKey("13997141174")).toBe("13997141174");
  });

  test("e-mail é comparado em minúsculas e precisa ser plausível", () => {
    expect(ownerEmailKey(" Maria@Exemplo.COM ")).toBe("maria@exemplo.com");
    expect(ownerEmailKey("nao-e-email")).toBeNull();
    expect(ownerEmailKey("")).toBeNull();
    expect(ownerEmailKey(null)).toBeNull();
  });
});

/* ----------------------------------------------------------------- teste 4 */
describe("teste 4 — telefone reutiliza o proprietário", () => {
  test("mesmo telefone, com ou sem máscara, encontra a mesma pessoa", () => {
    expect(findOwnerByPhone(base, "(13) 99714-1174")?.id).toBe(1);
    expect(findOwnerByPhone(base, "13997141174")?.id).toBe(1);
    expect(findOwnerByPhone(base, "13988887777")?.id).toBe(2);
  });

  test("telefone já cadastrado reutiliza o proprietário em vez de duplicar", () => {
    const decision = resolveOwnerIdentity(base, {
      phone: "13997141174",
      email: "outro@exemplo.com",
    });

    expect(decision.action).toBe("reuse");
    expect(decision.ownerId).toBe(1);
    expect(decision.duplicateOfOwnerId).toBeNull();
  });

  test("telefone vazio NUNCA casa com ninguém", () => {
    /* Casar "vazio com vazio" fundiria todo mundo cadastrado sem contato. */
    const semTelefone: OwnerCandidate[] = [{ id: 9, name: "Sem contato", phone: "", email: null }];

    expect(findOwnerByPhone(semTelefone, "")).toBeNull();
    expect(findOwnerByPhone(semTelefone, null)).toBeNull();
    expect(resolveOwnerIdentity(semTelefone, { phone: "" }).action).toBe("create");
  });

  test("telefone novo cria proprietário novo", () => {
    const decision = resolveOwnerIdentity(base, { phone: "13911112222", email: null });

    expect(decision.action).toBe("create");
    expect(decision.ownerId).toBeNull();
    expect(decision.duplicateOfOwnerId).toBeNull();
  });

  test("reutilizar proprietário não diz nada sobre o imóvel", () => {
    /* O telefone identifica a PESSOA. O imóvel é decidido pelo endereço, em
       capture-address.ts — nada aqui devolve imóvel, e é de propósito. */
    const decision = resolveOwnerIdentity(base, { phone: "13997141174" });

    expect(decision.action).toBe("reuse");
    expect(Object.keys(decision)).not.toContain("captureId");
    expect(Object.keys(decision)).not.toContain("propertyId");
  });
});

describe("e-mail não mescla — só levanta alerta", () => {
  test("e-mail repetido CRIA o proprietário e marca possível duplicado", () => {
    const decision = resolveOwnerIdentity(base, {
      phone: "13911112222",
      email: "maria@exemplo.com",
    });

    expect(decision.action).toBe("create");
    expect(decision.duplicateOfOwnerId).toBe(1);
    expect(decision.reason).toContain("possível duplicado");
  });

  test("o alerta não bloqueia: a ação continua sendo criar", () => {
    const decision = resolveOwnerIdentity(base, {
      phone: "13911112222",
      email: "contato@exemplo.com",
    });

    expect(decision.action).toBe("create");
    expect(decision.duplicateOfOwnerId).toBe(2);
  });

  test("telefone conhecido vence: não há duplicado a revisar", () => {
    /* Se o telefone já reutilizou alguém, o e-mail repetido não gera alerta. */
    const decision = resolveOwnerIdentity(base, {
      phone: "13997141174",
      email: "contato@exemplo.com",
    });

    expect(decision.action).toBe("reuse");
    expect(decision.duplicateOfOwnerId).toBeNull();
  });

  test("e-mail sem par não gera alerta", () => {
    const decision = resolveOwnerIdentity(base, {
      phone: "13911112222",
      email: "novo@exemplo.com",
    });

    expect(decision.action).toBe("create");
    expect(decision.duplicateOfOwnerId).toBeNull();
  });

  test("findEmailDuplicate ignora o próprio proprietário", () => {
    expect(findEmailDuplicate(base, "maria@exemplo.com", 1)).toBeNull();
    expect(findEmailDuplicate(base, "maria@exemplo.com", 2)?.id).toBe(1);
  });

  test("texto do alerta existe só quando há duplicado", () => {
    expect(duplicateAlertText(1)).toContain("#1");
    expect(duplicateAlertText(null)).toBeNull();
    expect(duplicateAlertText(undefined)).toBeNull();
  });
});

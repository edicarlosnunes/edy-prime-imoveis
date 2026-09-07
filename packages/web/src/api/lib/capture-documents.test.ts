/**
 * Ficha Técnica (FC) e Autorização de Venda (AV).
 *
 * Cobre os testes numerados do pedido:
 *  14 — prefixos estáveis por tipo (via serial-base herdado)
 *  15 — documentos herdam o MESMO serial-base, sem sequência paralela
 *  19 — rastreio de status com histórico e transições recusadas
 *  21 — FINALIZAR CAPTAÇÃO só libera com documentação, preço e autorização
 */
import { describe, expect, test } from "bun:test";
import {
  DOC_KINDS,
  DOC_TRACK_STATUSES,
  buildSnapshot,
  canFinalize,
  checkDocTransition,
  isDocTrackStatus,
  pendingItems,
  qrTarget,
  serialFor,
} from "./capture-documents";
import { buildSerial } from "./capture-serial";

const owner = { name: "Maria", phone: "13997141174", email: null, document: null };
const broker = { name: "Edy Prime Imóveis", creci: "134718-F", phone: "13997141174", email: null };
const address = { cep: "11704000", street: "Av. Kennedy", number: "1200", district: "Guilhermina", city: "Praia Grande", state: "SP" };

const fullSource = {
  captureId: 4,
  serial: "AP-2026-000124",
  owner,
  address,
  complements: { unit: "101", block: "B" },
  propertyType: "apartamento",
  askingPrice: 500000,
  estimatedPrice: 480000,
  docStatus: "completo",
  checklistDone: ["owner_id", "owner_cpf", "owner_address", "property_deed", "property_iptu", "property_basics"],
  ownerPhotoCount: 3,
  officialPhotoCount: 8,
  hasSignedAuthorization: true,
  broker,
};

describe("15 — documentos herdam o serial-base", () => {
  test("FC e AV usam o mesmo número-base do imóvel", () => {
    expect(serialFor("ficha_tecnica", "AP-2026-000124")).toBe("FC-AP-2026-000124");
    expect(serialFor("autorizacao", "AP-2026-000124")).toBe("AV-AP-2026-000124");
  });

  test("nenhum documento cria sequência própria", () => {
    const base = buildSerial("casa", 2026, 123);
    expect(base).toBe("CS-2026-000123");
    for (const kind of DOC_KINDS) {
      /* o serial do documento é sempre PREFIXO + serial-base, então o número
         final nunca diverge do imóvel */
      expect(serialFor(kind, base).endsWith(base)).toBe(true);
    }
  });

  test("14 — o prefixo do tipo aparece no serial do documento", () => {
    expect(serialFor("ficha_tecnica", buildSerial("loja", 2026, 7))).toBe("FC-LJ-2026-000007");
    expect(serialFor("autorizacao", buildSerial("terreno", 2026, 8))).toBe("AV-TE-2026-000008");
  });
});

describe("19 — rastreio dos documentos", () => {
  test("os 9 estados do pedido existem", () => {
    expect([...DOC_TRACK_STATUSES]).toEqual([
      "gerada",
      "impressa",
      "com_corretor",
      "entregue_ao_proprietario",
      "assinada",
      "devolvida",
      "arquivada",
      "cancelada",
    ]);
  });

  test("status desconhecido é recusado", () => {
    expect(isDocTrackStatus("assinada")).toBe(true);
    expect(isDocTrackStatus("rasgada")).toBe(false);
    expect(checkDocTransition("gerada", "rasgada").ok).toBe(false);
  });

  test("avanço normal é permitido", () => {
    expect(checkDocTransition("gerada", "impressa").ok).toBe(true);
    expect(checkDocTransition("impressa", "com_corretor").ok).toBe(true);
    expect(checkDocTransition("entregue_ao_proprietario", "assinada").ok).toBe(true);
  });

  test("voltar atrás é permitido: papel volta na vida real", () => {
    expect(checkDocTransition("entregue_ao_proprietario", "impressa").ok).toBe(true);
    expect(checkDocTransition("devolvida", "com_corretor").ok).toBe(true);
  });

  test("repetir o mesmo status não gera evento", () => {
    expect(checkDocTransition("assinada", "assinada").ok).toBe(false);
  });

  test("cancelado não ressuscita", () => {
    for (const next of DOC_TRACK_STATUSES) {
      expect(checkDocTransition("cancelada", next).ok).toBe(false);
    }
  });

  test("arquivado só aceita cancelamento", () => {
    expect(checkDocTransition("arquivada", "assinada").ok).toBe(false);
    expect(checkDocTransition("arquivada", "cancelada").ok).toBe(true);
  });

  test("status atual sujo é tratado como gerada, não como erro", () => {
    expect(checkDocTransition(null, "impressa").ok).toBe(true);
    expect(checkDocTransition("qualquer_coisa", "impressa").ok).toBe(true);
  });
});

describe("pendências para finalizar", () => {
  test("captação completa não tem pendência", () => {
    expect(pendingItems({
      docStatus: "completo",
      checklistDone: fullSource.checklistDone,
      estimatedPrice: 480000,
      officialPhotoCount: 8,
      hasSignedAuthorization: true,
      hasAddress: true,
      hasOwnerPhone: true,
    })).toEqual([]);
  });

  test("captação vazia lista tudo o que falta", () => {
    const pending = pendingItems({});
    expect(pending).toContain("Telefone/WhatsApp do proprietário");
    expect(pending).toContain("Endereço completo (CEP e número)");
    expect(pending).toContain("Matrícula / documento do imóvel");
    expect(pending).toContain("IPTU");
    expect(pending).toContain("Preço validado");
    expect(pending).toContain("Autorização de venda assinada");
  });

  test("item marcado no checklist some das pendências", () => {
    expect(pendingItems({ checklistDone: ["property_iptu"] })).not.toContain("IPTU");
  });

  test("documentação validada pela equipe conta como concluída", () => {
    expect(pendingItems({ docStatus: "validado_pela_equipe" }))
      .not.toContain("Documentação concluída ou validada pela equipe");
  });
});

describe("21 — FINALIZAR CAPTAÇÃO", () => {
  test("libera com documentação, preço validado e autorização assinada", () => {
    expect(canFinalize({
      docStatus: "completo",
      estimatedPrice: 480000,
      hasSignedAuthorization: true,
    }).ok).toBe(true);
  });

  test("sem preço validado não finaliza", () => {
    const r = canFinalize({ docStatus: "completo", estimatedPrice: null, hasSignedAuthorization: true });
    expect(r.ok).toBe(false);
    expect(r.message).toContain("Preço validado");
  });

  test("sem documentação fechada não finaliza", () => {
    const r = canFinalize({ docStatus: "parcial", estimatedPrice: 1, hasSignedAuthorization: true });
    expect(r.ok).toBe(false);
    expect(r.message).toContain("Documentação");
  });

  test("sem autorização assinada não finaliza", () => {
    const r = canFinalize({ docStatus: "completo", estimatedPrice: 1, hasSignedAuthorization: false });
    expect(r.ok).toBe(false);
    expect(r.message).toContain("Autorização");
  });

  test("pendências secundárias não bloqueiam a finalização", () => {
    /* falta foto profissional e CPF: aparece impresso na ficha, mas não trava */
    const r = canFinalize({ docStatus: "completo", estimatedPrice: 1, hasSignedAuthorization: true });
    expect(r.ok).toBe(true);
    expect(r.pending.length).toBeGreaterThan(0);
  });
});

describe("snapshot imprimível", () => {
  const now = new Date("2026-09-07T12:00:00.000Z");

  test("ficha técnica carrega o que o pedido exige", () => {
    const snap = buildSnapshot("ficha_tecnica", fullSource, { now });
    expect(snap.serial).toBe("FC-AP-2026-000124");
    expect(snap.baseSerial).toBe("AP-2026-000124");
    expect(snap.captureId).toBe(4);
    expect(snap.owner.name).toBe("Maria");
    expect(snap.addressLine).toContain("Av. Kennedy");
    expect(snap.addressLine).toContain("1200");
    expect(snap.broker.creci).toBe("134718-F");
    expect(snap.photos).toEqual({ owner: 3, official: 8 });
    expect(snap.clauses).toEqual([]);
    expect(snap.issuedAt).toBe(now.toISOString());
  });

  test("o complemento entra no endereço impresso", () => {
    const snap = buildSnapshot("ficha_tecnica", fullSource, { now });
    expect(snap.addressLine.toLowerCase()).toContain("101");
  });

  test("autorização sem configuração comercial NÃO inventa cláusula", () => {
    const snap = buildSnapshot("autorizacao", fullSource, { now });
    expect(snap.blanks).toContain("Percentual de comissão");
    expect(snap.blanks).toContain("Exclusividade (sim ou não)");
    expect(snap.blanks).toContain("Prazo de vigência");
    expect(snap.clauses.join(" ")).not.toMatch(/\d+%/);
  });

  test("autorização com termos informados escreve as cláusulas", () => {
    const snap = buildSnapshot("autorizacao", fullSource, {
      now,
      terms: { commissionPercent: 6, exclusive: true, termDays: 180, authorizedPrice: 480000 },
    });
    expect(snap.clauses.join(" ")).toContain("6%");
    expect(snap.clauses.join(" ")).toContain("EXCLUSIVIDADE");
    expect(snap.clauses.join(" ")).toContain("180 dias");
    expect(snap.blanks).not.toContain("Percentual de comissão");
    expect(snap.blanks).toContain("Assinatura do proprietário");
  });

  test("autorização sempre autoriza divulgação, fotos e propostas", () => {
    const text = buildSnapshot("autorizacao", fullSource, { now }).clauses.join(" ").toLowerCase();
    expect(text).toContain("intermediar");
    expect(text).toContain("divulgação");
    expect(text).toContain("fotos");
    expect(text).toContain("propostas");
  });

  test("a ficha imprime as pendências que restam", () => {
    const snap = buildSnapshot("ficha_tecnica", { ...fullSource, checklistDone: [], estimatedPrice: null }, { now });
    expect(snap.pending).toContain("Preço validado");
    expect(snap.pending).toContain("IPTU");
  });
});

describe("20 — QR aponta para a ficha interna, autenticada", () => {
  test("a URL é do admin, não do site público", () => {
    expect(qrTarget("https://www.edyprimeimoveis.com.br", 4))
      .toBe("https://www.edyprimeimoveis.com.br/admin/captacao?ficha=4");
  });

  test("barra sobrando não duplica", () => {
    expect(qrTarget("https://x.com//", 9)).toBe("https://x.com/admin/captacao?ficha=9");
  });

  test("o QR não carrega dado do proprietário", () => {
    const url = qrTarget("https://x.com", 4);
    expect(url).not.toContain("Maria");
    expect(url).not.toContain("13997141174");
  });
});

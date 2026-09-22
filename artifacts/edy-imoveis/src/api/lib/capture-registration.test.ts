import { describe, expect, test } from "bun:test";
import {
  ABANDON_AFTER_HOURS,
  deriveRegistrationStatus,
  findResumableCapture,
  isAbandoned,
  normalizeRegistrationStatus,
  registrationCompleteness,
  resolveResume,
} from "./capture-registration";

const HOUR = 3_600_000;
const now = new Date("2026-09-17T12:00:00Z");

const fullFicha = {
  ownerName: "Maria Souza",
  ownerPhone: "13999990000",
  city: "Praia Grande",
  street: "Rua Guimarães Rosa",
  number: "492",
  propertyType: "apartamento",
};

describe("completude da ficha", () => {
  test("ficha vazia: nada preenchido, não iniciada", () => {
    const c = registrationCompleteness({});
    expect(c.filled).toBe(0);
    expect(c.started).toBe(false);
    expect(c.complete).toBe(false);
    expect(c.missingRequired).toContain("ownerPhone");
  });

  test("só telefone não conta como ficha iniciada", () => {
    const c = registrationCompleteness({ ownerPhone: "13999990000" });
    expect(c.filled).toBe(1);
    expect(c.started).toBe(false);
  });

  test("salvamento progressivo aumenta o percentual campo a campo", () => {
    const a = registrationCompleteness({ ownerPhone: "13999990000", ownerName: "Maria" });
    const b = registrationCompleteness({ ...fullFicha });
    expect(a.percent).toBeGreaterThan(0);
    expect(b.percent).toBeGreaterThan(a.percent);
    expect(b.complete).toBe(true);
    expect(b.missingRequired).toEqual([]);
  });

  test("valor zerado/negativo não conta como preenchido", () => {
    const c = registrationCompleteness({ ...fullFicha, askingPrice: 0 });
    expect(c.missingOptional).toContain("askingPrice");
  });
});

describe("status do cadastro", () => {
  test("contato novo sem ficha = NOVO", () => {
    const d = deriveRegistrationStatus({ ownerPhone: "13999990000" }, { lastActivityAt: now }, now);
    expect(d.status).toBe("NOVO");
  });

  test("preenchendo agora = EM_ANDAMENTO", () => {
    const d = deriveRegistrationStatus(
      { ownerPhone: "13999990000", ownerName: "Maria", city: "Santos" },
      { lastActivityAt: new Date(now.getTime() - 2 * HOUR) },
      now,
    );
    expect(d.status).toBe("EM_ANDAMENTO");
    expect(d.reason).toContain("Logradouro");
  });

  test("abandonado há mais de 24h = INCOMPLETO, sem perder nada", () => {
    const d = deriveRegistrationStatus(
      { ownerPhone: "13999990000", ownerName: "Maria", city: "Santos" },
      { lastActivityAt: new Date(now.getTime() - 30 * HOUR) },
      now,
    );
    expect(d.status).toBe("INCOMPLETO");
    expect(d.completeness.filled).toBe(3);
  });

  test("obrigatórios completos = CONCLUIDO, mesmo sem opcionais", () => {
    const d = deriveRegistrationStatus(fullFicha, { lastActivityAt: now }, now);
    expect(d.status).toBe("CONCLUIDO");
  });

  test("duplicidade vira POSSIVEL_DUPLICIDADE e nunca exclusão", () => {
    const d = deriveRegistrationStatus(fullFicha, { possibleDuplicate: true }, now);
    expect(d.status).toBe("POSSIVEL_DUPLICIDADE");
    expect(d.reason).toContain("revisão humana");
  });

  test("status humano (PAUSADO/ARQUIVADO/EM_ANALISE) não é sobrescrito", () => {
    for (const manual of ["PAUSADO", "ARQUIVADO", "EM_ANALISE"] as const) {
      const d = deriveRegistrationStatus(fullFicha, { current: manual, lastActivityAt: now }, now);
      expect(d.status).toBe(manual);
      expect(d.locked).toBe(true);
    }
  });

  test("status desconhecido do banco cai em NOVO sem quebrar", () => {
    expect(normalizeRegistrationStatus("qualquer_coisa")).toBe("NOVO");
    expect(normalizeRegistrationStatus("em andamento")).toBe("EM_ANDAMENTO");
    expect(normalizeRegistrationStatus(null)).toBe("NOVO");
  });

  test("abandono usa a janela configurada", () => {
    expect(isAbandoned(new Date(now.getTime() - (ABANDON_AFTER_HOURS + 1) * HOUR), now)).toBe(true);
    expect(isAbandoned(new Date(now.getTime() - 1 * HOUR), now)).toBe(false);
    expect(isAbandoned(null, now)).toBe(false);
  });
});

describe("retomada por telefone", () => {
  const pendente = {
    id: 10,
    ownerId: 1,
    registrationStatus: "INCOMPLETO",
    stage: "novo_contato",
    unitKey: "cep:11700000|n:492|unit=163",
    addressKey: "praia grande|guimaraes rosa|492|unit=163",
    updatedAt: new Date(now.getTime() - 40 * HOUR),
  };

  test("mesmo telefone voltando sem informar endereço retoma o último pendente", () => {
    const d = resolveResume([pendente]);
    expect(d.action).toBe("resume");
    expect(d.captureId).toBe(10);
    expect(d.message).toContain("de onde parou");
  });

  test("retoma o cadastro do MESMO endereço quando informado", () => {
    const outro = { ...pendente, id: 11, unitKey: "cep:11700000|n:100", addressKey: "praia grande|frei gaspar|100", updatedAt: now };
    const d = resolveResume([outro, pendente], { addressKey: pendente.addressKey });
    expect(d.captureId).toBe(10);
  });

  test("endereço de OUTRO imóvel = cadastro novo, sem duplicar contato", () => {
    const d = resolveResume([pendente], { addressKey: "santos|frei gaspar|100" });
    expect(d.action).toBe("new");
    expect(d.captureId).toBeNull();
  });

  test("ficha CONCLUIDA não é retomada — segundo imóvel é cadastro novo", () => {
    const d = resolveResume([{ ...pendente, registrationStatus: "CONCLUIDO" }]);
    expect(d.action).toBe("new");
  });

  test("cadastro perdido/captado no funil não é retomado como ficha", () => {
    expect(findResumableCapture([{ ...pendente, stage: "perdido" }])).toBeNull();
    expect(findResumableCapture([{ ...pendente, stage: "captado" }])).toBeNull();
  });

  test("pausado/arquivado/duplicidade não são retomados automaticamente", () => {
    for (const status of ["PAUSADO", "ARQUIVADO", "POSSIVEL_DUPLICIDADE", "EM_ANALISE"]) {
      expect(findResumableCapture([{ ...pendente, registrationStatus: status }])).toBeNull();
    }
  });

  test("entre vários pendentes, retoma o de atividade mais recente", () => {
    const antigo = { ...pendente, id: 5, updatedAt: new Date(now.getTime() - 200 * HOUR) };
    const recente = { ...pendente, id: 7, unitKey: null, addressKey: null, updatedAt: new Date(now.getTime() - 3 * HOUR) };
    expect(findResumableCapture([antigo, recente])?.id).toBe(7);
  });
});

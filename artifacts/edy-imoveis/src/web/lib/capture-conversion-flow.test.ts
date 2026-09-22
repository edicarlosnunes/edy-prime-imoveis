import { describe, expect, test } from "bun:test";
import {
  initConversion,
  isCaptureFlow,
  planConversion,
  readCaptureId,
  type ConversionState,
} from "./capture-conversion-flow";

describe("readCaptureId", () => {
  test("le o id da query string", () => {
    expect(readCaptureId("?capture_id=7")).toBe(7);
    expect(readCaptureId("capture_id=7")).toBe(7);
    expect(readCaptureId("?foo=1&capture_id=12&bar=2")).toBe(12);
  });

  test("ausente, vazio ou sujo vira null", () => {
    expect(readCaptureId(null)).toBeNull();
    expect(readCaptureId("")).toBeNull();
    expect(readCaptureId("?outro=3")).toBeNull();
    expect(readCaptureId("?capture_id=abc")).toBeNull();
    expect(readCaptureId("?capture_id=0")).toBeNull();
    expect(readCaptureId("?capture_id=-4")).toBeNull();
    expect(readCaptureId("?capture_id=2.5")).toBeNull();
  });
});

describe("initConversion", () => {
  test("id valido entra no fluxo de captacao", () => {
    const state = initConversion(3);
    expect(state).toEqual({ captureId: 3, propertyId: null, inFlight: false, marked: false });
    expect(isCaptureFlow(state)).toBe(true);
  });

  test("sem id, o formulario e cadastro comum", () => {
    expect(isCaptureFlow(initConversion(null))).toBe(false);
    expect(isCaptureFlow(initConversion(0))).toBe(false);
  });
});

describe("cancelar nunca marca captado", () => {
  test("fechar o formulario sem criar imovel nao dispara nada", () => {
    const plan = planConversion(initConversion(3), { type: "cancelled" });
    expect(plan.action).toBe("none");
    expect(plan.state.marked).toBe(false);
    expect(plan.state.propertyId).toBeNull();
  });

  test("cancelar depois de uma falha continua sem marcar", () => {
    let state = initConversion(3);
    state = planConversion(state, { type: "property_created", propertyId: 9 }).state;
    state = planConversion(state, { type: "mark_failed" }).state;
    const plan = planConversion(state, { type: "cancelled" });
    expect(plan.action).toBe("none");
    expect(plan.state.marked).toBe(false);
  });
});

describe("imovel criado marca captado exatamente uma vez", () => {
  test("primeiro evento pede a marcacao", () => {
    const plan = planConversion(initConversion(3), { type: "property_created", propertyId: 42 });
    expect(plan.action).toBe("mark");
    expect(plan.propertyId).toBe(42);
    expect(plan.state.inFlight).toBe(true);
  });

  test("duplo clique: o segundo evento nao pede nada", () => {
    const first = planConversion(initConversion(3), { type: "property_created", propertyId: 42 });
    const second = planConversion(first.state, { type: "property_created", propertyId: 42 });
    expect(second.action).toBe("none");
  });

  test("apos sucesso, novo evento nao remarca", () => {
    let state: ConversionState = initConversion(3);
    const first = planConversion(state, { type: "property_created", propertyId: 42 });
    state = planConversion(first.state, { type: "mark_ok" }).state;
    expect(state.marked).toBe(true);
    expect(state.inFlight).toBe(false);
    expect(planConversion(state, { type: "property_created", propertyId: 42 }).action).toBe("none");
  });

  test("uma sequencia inteira de eventos gera exatamente 1 marcacao", () => {
    let state = initConversion(3);
    const events = [
      { type: "property_created", propertyId: 42 },
      { type: "property_created", propertyId: 42 },
      { type: "mark_ok" },
      { type: "property_created", propertyId: 42 },
      { type: "cancelled" },
    ] as const;
    let marks = 0;
    for (const event of events) {
      const plan = planConversion(state, event);
      if (plan.action === "mark") marks += 1;
      state = plan.state;
    }
    expect(marks).toBe(1);
  });

  test("falha na marcacao permite tentar de novo", () => {
    let state = initConversion(3);
    state = planConversion(state, { type: "property_created", propertyId: 42 }).state;
    state = planConversion(state, { type: "mark_failed" }).state;
    const retry = planConversion(state, { type: "property_created", propertyId: 42 });
    expect(retry.action).toBe("mark");
    expect(retry.propertyId).toBe(42);
  });
});

describe("fora do fluxo de captacao nada e marcado", () => {
  test("cadastro comum de imovel nao chama markConverted", () => {
    const plan = planConversion(initConversion(null), { type: "property_created", propertyId: 42 });
    expect(plan.action).toBe("none");
    expect(plan.state.propertyId).toBe(42);
  });

  test("id de imovel invalido nao marca", () => {
    expect(planConversion(initConversion(3), { type: "property_created", propertyId: 0 }).action).toBe(
      "none",
    );
  });
});

import {test,expect} from "bun:test";
import {EMPTY_NEGOTIATION,NEGOTIATION_PREFIX,readNegotiation,negotiationText,withNegotiation,withoutNegotiation,publicationDescription} from "./negotiation";

test("payment and debt remain distinct and persist through edit without duplicate descriptions",()=>{
 const value={...EMPTY_NEGOTIATION,cash:"80.000,00",debtAmount:"30.000,00",debtDetails:"IPTU em atraso",debtResponsibility:"Comprador assume" as const};
 const features=JSON.stringify([NEGOTIATION_PREFIX+encodeURIComponent(JSON.stringify(value))]);
 expect(readNegotiation(features)).toEqual(value);
 const description=withNegotiation("Kitnet no Paquetá",value);
 expect(description).toContain("Pagamento ao proprietário: R$ 80.000,00");
 expect(description).toContain("Débitos informados: R$ 30.000,00");
 expect(description).not.toContain("110.000");
 expect(withoutNegotiation(description,value)).toBe("Kitnet no Paquetá");
 expect(withNegotiation(description,value)).toBe(description);
 expect(withNegotiation(withoutNegotiation(description,value),EMPTY_NEGOTIATION)).toBe("Kitnet no Paquetá");
});
test("public captions preserve full conditions despite a long description and hide unselected swap types",()=>{
 const value={...EMPTY_NEGOTIATION,methods:["Veículo" as const],swapTypes:["Casa"],details:"Aceita carro como parte do pagamento."};
 const features=JSON.stringify([NEGOTIATION_PREFIX+encodeURIComponent(JSON.stringify(value))]);
 const result=publicationDescription(withNegotiation("x".repeat(2000),value),features);
 expect(result).toContain(value.details);
 expect(result).toStartWith("Condições de pagamento");
 expect(result).not.toContain("Permuta por: Casa");
 expect(negotiationText(EMPTY_NEGOTIATION)).toBe("");
 expect(readNegotiation("quebrado")).toEqual(EMPTY_NEGOTIATION);
});

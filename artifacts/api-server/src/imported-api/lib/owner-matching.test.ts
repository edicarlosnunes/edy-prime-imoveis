import { describe, expect, test } from "bun:test";
import { matchOwnerByPhone } from "./owner-matching";

describe("matchOwnerByPhone", () => {
  test("matches masked and country-code phone values", () => {
    expect(
      matchOwnerByPhone(
        [{ id: 7, phone: "(13) 99999-9999" }],
        "+55 13 99999-9999",
      ),
    ).toEqual({ id: 7, phone: "(13) 99999-9999" });
  });

  test("does not match invalid or empty phones", () => {
    expect(matchOwnerByPhone([{ id: 7, phone: "13999999999" }], "")).toBeNull();
    expect(matchOwnerByPhone([{ id: 7, phone: "sem telefone" }], "13999999999")).toBeNull();
  });
});
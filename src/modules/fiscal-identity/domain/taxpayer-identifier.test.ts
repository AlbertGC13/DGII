import { describe, expect, it } from "vitest";

import { parseTaxpayerIdentifier } from "./taxpayer-identifier.js";

describe("parseTaxpayerIdentifier", () => {
  it("accepts a synthetic 9-digit RNC without normalization", () => {
    expect(parseTaxpayerIdentifier("000000000")).toEqual({
      ok: true,
      value: { kind: "rnc", value: "000000000" },
    });
  });

  it("accepts a synthetic 11-digit cedula without normalization", () => {
    expect(parseTaxpayerIdentifier("00000000000")).toEqual({
      ok: true,
      value: { kind: "cedula", value: "00000000000" },
    });
  });

  it.each([
    ["non-string", undefined],
    ["too short", "00000000"],
    ["invalid intermediate length", "0000000000"],
    ["too long", "000000000000"],
    ["letters", "00000000A"],
    ["punctuation", "000-000-000"],
    ["leading whitespace", " 000000000"],
    ["trailing whitespace", "000000000 "],
  ])("rejects %s input with the safe malformed-format contract", (_case, input) => {
    const result = parseTaxpayerIdentifier(input);

    expect(result).toEqual({
      ok: false,
      error: {
        code: "ERP-VAL-002",
        kind: "MALFORMED_FORMAT",
        field: "taxpayerIdentifier",
        message: "Taxpayer identifier must contain exactly 9 or 11 ASCII digits.",
      },
    });
    expect(JSON.stringify(result)).not.toContain(String(input));
  });
});

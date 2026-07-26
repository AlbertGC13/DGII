import { describe, expect, it } from "vitest";

import { parseENcf } from "./e-ncf.js";

describe("parseENcf", () => {
  it.each([
    ["31", "E310000000001"],
    ["32", "E320000000001"],
    ["33", "E330000000001"],
    ["34", "E340000000001"],
  ] as const)("accepts MVP type %s", (type, input) => {
    expect(parseENcf(input)).toEqual({
      ok: true,
      value: { value: input, type, sequence: "0000000001" },
    });
  });

  it.each([
    ["non-string", null],
    ["too short", "E31000000001"],
    ["too long", "E3100000000010"],
    ["lowercase prefix", "e310000000001"],
    ["wrong prefix", "A310000000001"],
    ["letter in type", "E3A0000000001"],
    ["letter in sequence", "E31000000000A"],
    ["leading whitespace", " E310000000001"],
    ["trailing whitespace", "E310000000001 "],
  ])("rejects %s input as malformed", (_case, input) => {
    const result = parseENcf(input);

    expect(result).toEqual({
      ok: false,
      error: {
        code: "ERP-VAL-002",
        kind: "MALFORMED_FORMAT",
        field: "eNcf",
        message: "e-NCF must contain exactly 13 characters: E, a two-digit type, and 10 digits.",
      },
    });
    expect(JSON.stringify(result)).not.toContain(String(input));
  });

  it("distinguishes documented type 41 as known but outside the MVP", () => {
    expect(parseENcf("E410000000001")).toEqual({
      ok: false,
      error: {
        code: "ERP-VAL-003",
        kind: "UNSUPPORTED_ECF_TYPE",
        field: "eNcf",
        classification: "KNOWN_NOT_MVP",
        message: "e-CF type is not supported by the MVP.",
      },
    });
  });

  it("distinguishes undocumented type 42 as unknown", () => {
    expect(parseENcf("E420000000001")).toEqual({
      ok: false,
      error: {
        code: "ERP-VAL-003",
        kind: "UNSUPPORTED_ECF_TYPE",
        field: "eNcf",
        classification: "UNKNOWN",
        message: "e-CF type is not supported by the MVP.",
      },
    });
  });
});

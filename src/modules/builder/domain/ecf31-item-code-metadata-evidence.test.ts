import { describe, expect, it } from "vitest";

import * as builderApi from "../index.js";
import * as rootApi from "../../../index.js";
import type { Result } from "../../../index.js";

function value<T>(result: Result<T, unknown>): T {
  if (!result.ok) throw new Error("Expected a successful result.");
  return result.value;
}

function fixture(lines = 2) {
  const lineAmounts = Array.from({ length: lines }, (_, index) => value(rootApi.createEcf31LineAmountEvidence({
    coreLine: value(rootApi.createEcf31CoreLine({ evidence: value(rootApi.captureLineCalculationEvidence({
      sequence: value(rootApi.parseLineSequence(String(index + 1))), quantity: value(rootApi.parseNonnegativeQuantity("1")),
      unitPrice: value(rootApi.parseUnitPrice("1")), declaredAmount: value(rootApi.parseNonnegativeAmount("1")),
    })), itemName: "Synthetic item", billingIndicator: 1, goodOrServiceIndicator: 1 })),
    discountAmount: value(rootApi.parseNonnegativeAmount("0")), surchargeAmount: value(rootApi.parseNonnegativeAmount("0")),
  })));
  const draft = value(rootApi.createEcf31CoreDraft({
    header: value(rootApi.createEcf31CoreHeader({ eNcf: value(rootApi.parseENcf("E310000000001")),
      issuer: { taxpayerIdentifier: value(rootApi.parseTaxpayerIdentifier("000000000")), legalName: "Synthetic issuer", address: "Synthetic address" },
      buyer: { taxpayerIdentifier: value(rootApi.parseTaxpayerIdentifier("00000000000")), legalName: "Synthetic buyer" },
      issueDate: "01-12-2026", incomeType: "01", paymentType: "1" })), lineAmounts,
  }));
  return { draft, lineAmounts };
}

function entries(input: ReturnType<typeof fixture>, codes: readonly (readonly (readonly [string, string])[])[]) {
  return input.lineAmounts.map((source, index) => ({ source, codes: (codes[index] ?? []).map(([type, value]) => ({ type, value })) }));
}

describe("Ecf31ItemCodeMetadataEvidence", () => {
  it("captures complete ordered noncatalog code pairs against exact draft lines", () => {
    const input = fixture();
    const result = value(rootApi.createEcf31ItemCodeMetadataEvidence({ draft: input.draft,
      entries: entries(input, [[['EAN', ' 0123 '], ['Interna', 'x']], [['PLU', '7']]]),
    }));
    expect(result.draft).toBe(input.draft);
    expect(result.entries.map((entry) => entry.source)).toEqual(input.lineAmounts);
    expect(result.entries.map((entry) => entry.codes)).toEqual([[{ type: "EAN", value: " 0123 " }, { type: "Interna", value: "x" }], [{ type: "PLU", value: "7" }]]);
  });

  it("accepts five codes and Unicode boundaries without normalization", () => {
    const input = fixture(1);
    const type = "😀".repeat(14);
    const code = value(rootApi.createEcf31ItemCodeMetadataEvidence({ draft: input.draft,
      entries: entries(input, [[[type, "é".repeat(35)], ["DUN", "1"], ["Other", "2"], ["X", "3"], ["Y", "4"]]]),
    }));
    expect(code.entries[0]?.codes[0]).toEqual({ type, value: "é".repeat(35) });
  });

  it("rejects invalid pairs, bounds, and line identity mismatches", () => {
    const input = fixture();
    const valid = entries(input, [[['A', '1']], []]);
    const other = fixture();
    for (const candidate of [
      { draft: input.draft, entries: entries(input, [[[' ', '1']], []]) },
      { draft: input.draft, entries: entries(input, [[['😀'.repeat(15), '1']], []]) },
      { draft: input.draft, entries: entries(input, [[['A', ' '.repeat(1)]], []]) },
      { draft: input.draft, entries: entries(input, [[['A', 'x'.repeat(36)]], []]) },
      { draft: input.draft, entries: entries(input, [[['A', '1'], ['B', '2'], ['C', '3'], ['D', '4'], ['E', '5'], ['F', '6']], []]) },
      { draft: input.draft, entries: valid.slice(0, 1) }, { draft: input.draft, entries: [...valid].reverse() },
      { draft: input.draft, entries: [{ source: { ...input.lineAmounts[0] }, codes: [] }, valid[1]] },
      { draft: { ...input.draft }, entries: valid }, { draft: input.draft, entries: [{ source: other.lineAmounts[0], codes: [] }, valid[1]] },
    ]) expect(rootApi.createEcf31ItemCodeMetadataEvidence(candidate)).toMatchObject({ ok: false });
  });

  it("returns one fixed safe error for hostile nested shapes", () => {
    const input = fixture();
    const valid = entries(input, [[], []]);
    const accessor = { draft: input.draft, entries: valid };
    Object.defineProperty(accessor, "entries", { enumerable: true, get: () => { throw new Error("secret"); } });
    const sparse = entries(input, [[], []]); sparse.length = 3;
    const arrayAccessor: unknown[] = [];
    Object.defineProperty(arrayAccessor, "0", { enumerable: true, get: () => "trap" });
    const throwingCodes = new Proxy([], { ownKeys: () => { throw new Error("trap"); } });
    const invalidLengthCodes = new Proxy([], { get: (_target, key) => key === "length" ? Number.NaN : undefined });
    const revoked = Proxy.revocable({}, {}); revoked.revoke();
    const hostile = [null, [], Object.create({ draft: input.draft, entries: valid }), Object.setPrototypeOf({ draft: input.draft, entries: valid }, {}),
      { draft: input.draft, entries: valid, extra: true }, { draft: input.draft, entries: valid, [Symbol("x")]: true }, accessor, revoked.proxy,
      { draft: input.draft, entries: sparse }, { draft: input.draft, entries: [{ source: input.lineAmounts[0], codes: new (class extends Array {})() }, valid[1]] },
      { draft: input.draft, entries: [{ source: input.lineAmounts[0], codes: arrayAccessor }, valid[1]] },
      { draft: input.draft, entries: [{ source: input.lineAmounts[0], codes: throwingCodes }, valid[1]] },
      { draft: input.draft, entries: [{ source: input.lineAmounts[0], codes: invalidLengthCodes }, valid[1]] },
      { draft: input.draft, entries: [{ source: input.lineAmounts[0] }, valid[1]] },
      { draft: input.draft, entries: [{ source: input.lineAmounts[0], codes: [{ type: "A" }] }, valid[1]] },
      { draft: input.draft, entries: [{ source: input.lineAmounts[0], codes: [Object.defineProperty({}, "type", { enumerable: true, get: () => "A" })] }, valid[1]] }];
    for (const candidate of hostile) {
      expect(() => rootApi.createEcf31ItemCodeMetadataEvidence(candidate)).not.toThrow();
      expect(rootApi.createEcf31ItemCodeMetadataEvidence(candidate)).toMatchObject({ ok: false, error: { code: "INVALID_ECF31_ITEM_CODE_METADATA_INPUT" } });
    }
  });

  it("deeply freezes defensive copies and authenticates only created evidence", () => {
    const input = fixture(1);
    const source = entries(input, [[['EAN', '1']]]);
    const result = value(rootApi.createEcf31ItemCodeMetadataEvidence({ draft: input.draft, entries: source }));
    const sourceEntry = source[0];
    const sourceCode = sourceEntry?.codes[0];
    if (sourceCode === undefined) throw new Error("Expected a code.");
    sourceCode.value = "changed";
    expect(result.entries[0]?.codes[0]).toEqual({ type: "EAN", value: "1" });
    expect([result, result.entries, result.entries[0], result.entries[0]?.codes, result.entries[0]?.codes[0]].every(Object.isFrozen)).toBe(true);
    expect(rootApi.isEcf31ItemCodeMetadataEvidence(result)).toBe(true);
    expect(rootApi.isEcf31ItemCodeMetadataEvidence({ ...result })).toBe(false);
  });
});

describe("Ecf31ItemCodeMetadataEvidence exports", () => {
  it("exports the same public API from Builder and the package root", () => {
    expect(builderApi.createEcf31ItemCodeMetadataEvidence).toBe(rootApi.createEcf31ItemCodeMetadataEvidence);
    expect(builderApi.isEcf31ItemCodeMetadataEvidence).toBe(rootApi.isEcf31ItemCodeMetadataEvidence);
  });
});

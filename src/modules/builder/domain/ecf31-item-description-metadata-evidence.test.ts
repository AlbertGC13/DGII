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

function entries(input: ReturnType<typeof fixture>, descriptions: readonly (string | undefined)[]) {
  return input.lineAmounts.map((source, index) => descriptions[index] === undefined ? { source } : { source, description: descriptions[index] });
}

describe("Ecf31ItemDescriptionMetadataEvidence", () => {
  it("captures exactly ordered optional descriptions against exact draft lines", () => {
    const input = fixture();
    const result = value(rootApi.createEcf31ItemDescriptionMetadataEvidence({ draft: input.draft,
      entries: entries(input, ["  Cafe\u0301 ", undefined]),
    }));
    expect(result.draft).toBe(input.draft);
    expect(result.entries.map((entry) => entry.source)).toEqual(input.lineAmounts);
    expect(result.entries[0]).toEqual({ source: input.lineAmounts[0], description: "  Cafe\u0301 " });
    expect(result.entries[1]).toEqual({ source: input.lineAmounts[1] });
  });

  it("accepts 1000 Unicode code points without normalization", () => {
    const input = fixture(1);
    const description = "😀".repeat(1000);
    const result = value(rootApi.createEcf31ItemDescriptionMetadataEvidence({ draft: input.draft, entries: entries(input, [description]) }));
    expect(result.entries[0]?.description).toBe(description);
  });

  it("rejects invalid descriptions and exact line identity mismatches", () => {
    const input = fixture();
    const valid = entries(input, ["one", undefined]);
    const other = fixture();
    for (const candidate of [
      { draft: input.draft, entries: entries(input, ["", undefined]) },
      { draft: input.draft, entries: entries(input, [" \t", undefined]) },
      { draft: input.draft, entries: entries(input, ["x".repeat(1001), undefined]) },
      { draft: input.draft, entries: valid.slice(0, 1) }, { draft: input.draft, entries: [...valid].reverse() },
      { draft: input.draft, entries: [{ source: { ...input.lineAmounts[0] } }, valid[1]] },
      { draft: { ...input.draft }, entries: valid }, { draft: input.draft, entries: [{ source: other.lineAmounts[0] }, valid[1]] },
      { draft: input.draft, entries: [{ source: input.lineAmounts[0], description: undefined }, valid[1]] },
    ]) expect(rootApi.createEcf31ItemDescriptionMetadataEvidence(candidate)).toMatchObject({ ok: false });
  });

  it("returns one fixed safe error for hostile wrapper and nested shapes", () => {
    const input = fixture();
    const valid = entries(input, [undefined, undefined]);
    const accessor = { draft: input.draft, entries: valid };
    Object.defineProperty(accessor, "entries", { enumerable: true, get: () => { throw new Error("secret"); } });
    const sparse = entries(input, [undefined, undefined]); sparse.length = 3;
    const arrayAccessor: unknown[] = [];
    Object.defineProperty(arrayAccessor, "0", { enumerable: true, get: () => "trap" });
    const throwingEntries = new Proxy([], { ownKeys: () => { throw new Error("trap"); } });
    const invalidLengthEntries = new Proxy([], { get: (_target, key) => key === "length" ? Number.NaN : undefined });
    const revoked = Proxy.revocable({}, {}); revoked.revoke();
    const hostile = [null, [], Object.create({ draft: input.draft, entries: valid }), Object.setPrototypeOf({ draft: input.draft, entries: valid }, {}),
      { draft: input.draft, entries: valid, extra: true }, { draft: input.draft, entries: valid, [Symbol("x")]: true }, accessor, revoked.proxy,
      { draft: input.draft, entries: sparse }, { draft: input.draft, entries: new (class extends Array {})() },
      { draft: input.draft, entries: arrayAccessor }, { draft: input.draft, entries: throwingEntries }, { draft: input.draft, entries: invalidLengthEntries },
      { draft: input.draft, entries: [{ source: input.lineAmounts[0], extra: true }, valid[1]] },
      { draft: input.draft, entries: [{ source: input.lineAmounts[0], description: Object.defineProperty({}, "x", { get: () => "trap" }) }, valid[1]] },
    ];
    for (const candidate of hostile) {
      expect(() => rootApi.createEcf31ItemDescriptionMetadataEvidence(candidate)).not.toThrow();
      expect(rootApi.createEcf31ItemDescriptionMetadataEvidence(candidate)).toMatchObject({ ok: false, error: { code: "INVALID_ECF31_ITEM_DESCRIPTION_METADATA_INPUT" } });
    }
  });

  it("deeply freezes defensive copies and authenticates only created evidence", () => {
    const input = fixture(1);
    const source = entries(input, ["original"]);
    const result = value(rootApi.createEcf31ItemDescriptionMetadataEvidence({ draft: input.draft, entries: source }));
    const lineAmount = input.lineAmounts[0];
    if (lineAmount === undefined) throw new Error("Expected a line amount.");
    source[0] = { source: lineAmount, description: "changed" };
    expect(result.entries[0]).toEqual({ source: lineAmount, description: "original" });
    expect([result, result.entries, result.entries[0]].every(Object.isFrozen)).toBe(true);
    expect(rootApi.isEcf31ItemDescriptionMetadataEvidence(result)).toBe(true);
    expect(rootApi.isEcf31ItemDescriptionMetadataEvidence({ ...result })).toBe(false);
  });
});

describe("Ecf31ItemDescriptionMetadataEvidence exports", () => {
  it("exports the same public API from Builder and the package root", () => {
    expect(builderApi.createEcf31ItemDescriptionMetadataEvidence).toBe(rootApi.createEcf31ItemDescriptionMetadataEvidence);
    expect(builderApi.isEcf31ItemDescriptionMetadataEvidence).toBe(rootApi.isEcf31ItemDescriptionMetadataEvidence);
  });
});

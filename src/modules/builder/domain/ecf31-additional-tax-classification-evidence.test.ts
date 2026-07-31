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

function entries(input: ReturnType<typeof fixture>, codes: readonly (readonly string[])[]) {
  return input.lineAmounts.map((source, index) => ({ source, codes: codes[index] ?? [] }));
}

describe("e-CF 31 additional-tax classification evidence", () => {
  it("requires complete line-bound classifications and detects qualifying ISC", () => {
    const input = fixture();
    const empty = value(rootApi.createEcf31AdditionalTaxClassificationEvidence({ draft: input.draft, entries: entries(input, [[], []]) }));
    const nonIsc = value(rootApi.createEcf31AdditionalTaxClassificationEvidence({ draft: input.draft, entries: entries(input, [["001", "005"], []]) }));
    const boundary = value(rootApi.createEcf31AdditionalTaxClassificationEvidence({ draft: input.draft, entries: entries(input, [["006"], ["039"]]) }));
    const mixed = value(rootApi.createEcf31AdditionalTaxClassificationEvidence({ draft: input.draft, entries: entries(input, [["001", "006"], ["039"]]) }));
    expect([empty.qualifyingIscAbsent, nonIsc.qualifyingIscAbsent, boundary.qualifyingIscAbsent, mixed.qualifyingIscAbsent]).toEqual([true, true, false, false]);
    expect(boundary.entries.map((entry) => entry.source)).toEqual(input.lineAmounts);
    expect(boundary.entries.at(0)?.source).toBe(input.lineAmounts[0]);
    expect(rootApi.formatEcf31AdditionalTaxCode(value(rootApi.parseEcf31AdditionalTaxCode("006")))).toBe("006");
    expect(rootApi.isEcf31QualifyingIscCode(value(rootApi.parseEcf31AdditionalTaxCode("039")))).toBe(true);
  });

  it("rejects malformed, duplicate, oversized, incomplete, reordered, and forged classifications", () => {
    const input = fixture();
    const valid = entries(input, [["001"], []]);
    const forgedDraft = { ...input.draft };
    const forgedLine = { ...input.lineAmounts[0] };
    for (const candidate of [
      { draft: input.draft, entries: entries(input, [["1"], []]) },
      { draft: input.draft, entries: entries(input, [[1 as unknown as string], []]) },
      { draft: input.draft, entries: entries(input, [["000"], []]) },
      { draft: input.draft, entries: entries(input, [["040"], []]) },
      { draft: input.draft, entries: entries(input, [["001", "001"], []]) },
      { draft: input.draft, entries: entries(input, [["001", "002", "003"], []]) },
      { draft: input.draft, entries: valid.slice(0, 1) },
      { draft: input.draft, entries: [valid[1], valid[0]] },
      { draft: input.draft, entries: [valid[0], valid[0]] },
      { draft: forgedDraft, entries: valid },
      { draft: input.draft, entries: [{ source: forgedLine, codes: [] }, valid[1]] },
    ]) expect(rootApi.createEcf31AdditionalTaxClassificationEvidence(candidate)).toMatchObject({ ok: false });
    expect(rootApi.parseEcf31AdditionalTaxCode("006")).toMatchObject({ ok: true });
    for (const code of ["", "006 ", 6, null, {}, "040"]) expect(rootApi.parseEcf31AdditionalTaxCode(code)).toMatchObject({ ok: false });
  });

  it("rejects sparse, accessor, proxy, and hostile-prototype values without throwing", () => {
    const input = fixture();
    const sparse = entries(input, [[], []]); sparse.length = 3;
    const accessor = { draft: input.draft, entries: entries(input, [[], []]) };
    Object.defineProperty(accessor, "entries", { enumerable: true, get: () => { throw new Error("trap"); } });
    const hostile: unknown = Object.setPrototypeOf({ draft: input.draft, entries: entries(input, [[], []]) }, {});
    const proxy = new Proxy({}, { ownKeys: () => { throw new Error("trap"); } });
    const codeAccessor: unknown[] = [];
    Object.defineProperty(codeAccessor, "0", { enumerable: true, get: () => "006" });
    for (const candidate of [{ draft: input.draft, entries: sparse }, accessor, hostile, proxy,
      { draft: input.draft, entries: [{ source: input.lineAmounts[0], codes: codeAccessor }, { source: input.lineAmounts[1], codes: [] }] }]) {
      expect(() => rootApi.createEcf31AdditionalTaxClassificationEvidence(candidate)).not.toThrow();
      expect(rootApi.createEcf31AdditionalTaxClassificationEvidence(candidate)).toMatchObject({ ok: false });
    }
  });

  it("produces immutable, genuine evidence", () => {
    const input = fixture();
    const output = value(rootApi.createEcf31AdditionalTaxClassificationEvidence({ draft: input.draft, entries: entries(input, [["006"], []]) }));
    expect(Object.isFrozen(output)).toBe(true);
    expect(Object.isFrozen(output.entries)).toBe(true);
    expect(Object.isFrozen(output.entries.at(0)?.codes)).toBe(true);
    expect(Reflect.set(output.entries, "0", output.entries[0])).toBe(false);
    expect(rootApi.isEcf31AdditionalTaxClassificationEvidence(output)).toBe(true);
    expect(rootApi.isEcf31AdditionalTaxClassificationEvidence({ ...output })).toBe(false);
  });
});

describe("e-CF 31 additional-tax classification exports", () => {
  it("exports the domain API from Builder and the package root", () => {
    expect(builderApi.createEcf31AdditionalTaxClassificationEvidence).toBe(rootApi.createEcf31AdditionalTaxClassificationEvidence);
  });
});

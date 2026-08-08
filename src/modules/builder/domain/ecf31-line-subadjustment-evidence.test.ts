import { describe, expect, it } from "vitest";

import * as builderApi from "../index.js";
import * as rootApi from "../../../index.js";
import type { Result } from "../../../index.js";

function value<T>(result: Result<T, unknown>): T {
  if (!result.ok) throw new Error("Expected a successful result.");
  return result.value;
}

function fixture(lines = 2, amounts = [["3", "2"], ["0", "0"]]) {
  const lineAmounts = Array.from({ length: lines }, (_, index) => value(rootApi.createEcf31LineAmountEvidence({
    coreLine: value(rootApi.createEcf31CoreLine({ evidence: value(rootApi.captureLineCalculationEvidence({
      sequence: value(rootApi.parseLineSequence(String(index + 1))), quantity: value(rootApi.parseNonnegativeQuantity("1")),
      unitPrice: value(rootApi.parseUnitPrice("10")), declaredAmount: value(rootApi.parseNonnegativeAmount("10")),
    })), itemName: "Synthetic item", billingIndicator: 1, goodOrServiceIndicator: 1 })),
    discountAmount: value(rootApi.parseNonnegativeAmount(amounts[index]?.[0] ?? "0")),
    surchargeAmount: value(rootApi.parseNonnegativeAmount(amounts[index]?.[1] ?? "0")),
  })));
  return { lineAmounts, draft: value(rootApi.createEcf31CoreDraft({
    header: value(rootApi.createEcf31CoreHeader({ eNcf: value(rootApi.parseENcf("E310000000001")),
      issuer: { taxpayerIdentifier: value(rootApi.parseTaxpayerIdentifier("000000000")), legalName: "Synthetic issuer", address: "Synthetic address" },
      buyer: { taxpayerIdentifier: value(rootApi.parseTaxpayerIdentifier("00000000000")), legalName: "Synthetic buyer" },
      issueDate: "01-12-2026", incomeType: "01", paymentType: "1" })), lineAmounts,
  })) };
}

function subadjustments(input: ReturnType<typeof fixture>) {
  return input.lineAmounts.map((source, index) => ({ source,
    discounts: index === 0 ? [{ type: "$", amount: value(rootApi.parseNonnegativeAmount("1")) }, { type: "%", amount: value(rootApi.parseNonnegativeAmount("2")), percentage: value(rootApi.parsePositivePercentage("20")) }] : [],
    surcharges: index === 0 ? [{ type: "%", amount: value(rootApi.parseNonnegativeAmount("2")), percentage: value(rootApi.parsePositivePercentage("10")) }] : [],
  }));
}

describe("Ecf31LineSubadjustmentEvidence", () => {
  it("captures exact ordered per-line subadjustments without deriving percentage amounts", () => {
    const input = fixture(); const source = subadjustments(input);
    const evidence = value(rootApi.createEcf31LineSubadjustmentEvidence({ draft: input.draft, entries: source }));
    expect(evidence.entries.map((entry) => entry.source)).toEqual(input.lineAmounts);
    expect(evidence.entries[0]?.discounts).toEqual([
      { type: "$", amount: value(rootApi.parseNonnegativeAmount("1")) },
      { type: "%", amount: value(rootApi.parseNonnegativeAmount("2")), percentage: value(rootApi.parsePositivePercentage("20")) },
    ]);
    expect(evidence.entries[0]?.surcharges[0]?.percentage).toBe(source[0]?.surcharges[0]?.percentage);
  });

  it("requires complete ordered source identity, exact totals, and empty zero-total arrays", () => {
    const input = fixture(); const valid = subadjustments(input); const other = fixture();
    const twelve = Array.from({ length: 12 }, () => ({ type: "$", amount: value(rootApi.parseNonnegativeAmount("0.25")) }));
    for (const candidate of [
      { draft: input.draft, entries: valid.slice(0, 1) }, { draft: input.draft, entries: [...valid].reverse() },
      { draft: input.draft, entries: [{ ...valid[0], source: { ...input.lineAmounts[0] } }, valid[1]] },
      { draft: input.draft, entries: [{ ...valid[0], source: other.lineAmounts[0] }, valid[1]] }, { draft: { ...input.draft }, entries: valid },
      { draft: input.draft, entries: [{ ...valid[0], discounts: [...twelve, twelve[0]] }, valid[1]] },
      { draft: input.draft, entries: [valid[0], { ...valid[1], discounts: [{ type: "$", amount: value(rootApi.parseNonnegativeAmount("0")) }] }] },
      { draft: input.draft, entries: [{ ...valid[0], discounts: [{ type: "$", amount: value(rootApi.parseNonnegativeAmount("2")) }] }, valid[1]] },
    ]) expect(rootApi.createEcf31LineSubadjustmentEvidence(candidate)).toMatchObject({ ok: false });
    expect(value(rootApi.createEcf31LineSubadjustmentEvidence({ draft: input.draft, entries: [{ ...valid[0], discounts: twelve }, valid[1]] })).entries[0]?.discounts).toHaveLength(12);
  });

  it("rejects malformed values and percentage combinations with one safe error", () => {
    const input = fixture(); const valid = subadjustments(input);
    const bad = (discounts: unknown) => ({ draft: input.draft, entries: [{ ...valid[0], discounts }, valid[1]] });
    const accessor = { draft: input.draft, entries: valid }; Object.defineProperty(accessor, "entries", { enumerable: true, get: () => { throw new Error("secret"); } });
    const sparse = subadjustments(input); sparse.length = 3;
    const revoked = Proxy.revocable({}, {}); revoked.revoke();
    for (const candidate of [null, [], Object.create({ draft: input.draft, entries: valid }), { draft: input.draft, entries: valid, extra: true },
      { draft: input.draft, entries: valid, [Symbol("x")]: true }, accessor, revoked.proxy, { draft: input.draft, entries: sparse },
      bad([{ type: "$", amount: value(rootApi.parseNonnegativeAmount("3")), percentage: value(rootApi.parsePositivePercentage("1")) }]),
      bad([{ type: "%", amount: value(rootApi.parseNonnegativeAmount("3")) }]),
      bad([{ type: "%", amount: value(rootApi.parseNonnegativeAmount("3")), percentage: value(rootApi.parsePositivePercentage("1")), extra: true }]),
      bad([{ type: "X", amount: value(rootApi.parseNonnegativeAmount("3")) }]), bad([{ type: "$" }]), bad([Object.defineProperty({}, "type", { enumerable: true, get: () => "$" })]),
      bad(new (class extends Array {})()),
    ]) {
      expect(() => rootApi.createEcf31LineSubadjustmentEvidence(candidate)).not.toThrow();
      expect(rootApi.createEcf31LineSubadjustmentEvidence(candidate)).toMatchObject({ ok: false, error: { code: "INVALID_ECF31_LINE_SUBADJUSTMENT_INPUT" } });
    }
  });

  it("defensively copies, deeply freezes, and authenticates evidence", () => {
    const input = fixture(); const source = subadjustments(input);
    const evidence = value(rootApi.createEcf31LineSubadjustmentEvidence({ draft: input.draft, entries: source }));
    const originalAmount = source[0]?.discounts[0]?.amount;
    (source[0]?.discounts[0] as { amount: unknown }).amount = value(rootApi.parseNonnegativeAmount("3"));
    expect(evidence.entries[0]?.discounts[0]?.amount).toBe(originalAmount);
    expect([evidence, evidence.entries, evidence.entries[0], evidence.entries[0]?.discounts, evidence.entries[0]?.discounts[0]].every(Object.isFrozen)).toBe(true);
    expect(rootApi.isEcf31LineSubadjustmentEvidence(evidence)).toBe(true);
    expect(rootApi.isEcf31LineSubadjustmentEvidence({ ...evidence })).toBe(false);
  });
});

describe("Ecf31LineSubadjustmentEvidence exports", () => {
  it("exports the same API from Builder and the package root", () => {
    expect(builderApi.createEcf31LineSubadjustmentEvidence).toBe(rootApi.createEcf31LineSubadjustmentEvidence);
    expect(builderApi.isEcf31LineSubadjustmentEvidence).toBe(rootApi.isEcf31LineSubadjustmentEvidence);
  });
});

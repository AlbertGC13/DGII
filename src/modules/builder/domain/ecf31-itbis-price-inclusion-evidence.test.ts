import { describe, expect, it } from "vitest";

import * as rootApi from "../../../index.js";
import * as builderApi from "../index.js";
import type { Result } from "../../../index.js";

function value<T>(result: Result<T, unknown>): T {
  if (!result.ok) throw new Error("Expected a successful result.");
  return result.value;
}

function source(sequence: string, amount: string, billingIndicator: 0 | 1 | 2 | 3 | 4) {
  const calculation = value(rootApi.captureLineCalculationEvidence({
    sequence: value(rootApi.parseLineSequence(sequence)), quantity: value(rootApi.parseNonnegativeQuantity("1")),
    unitPrice: value(rootApi.parseUnitPrice(amount)), declaredAmount: value(rootApi.parseNonnegativeAmount("0")),
  }));
  const coreLine = value(rootApi.createEcf31CoreLine({
    evidence: calculation, itemName: "Synthetic item", billingIndicator, goodOrServiceIndicator: 1,
  }));
  const lineAmount = value(rootApi.createEcf31LineAmountEvidence({
    coreLine, discountAmount: value(rootApi.parseNonnegativeAmount("0")), surchargeAmount: value(rootApi.parseNonnegativeAmount("0")),
  }));
  return { lineAmount, quantization: value(rootApi.createEcf31MontoItemQuantizationEvidence(lineAmount)) };
}

function candidate(indicator: 0 | 1, entries: readonly [string, 0 | 1 | 2 | 3 | 4][]) {
  const values = entries.map(([amount, billingIndicator], index) => source(String(index + 1), amount, billingIndicator));
  const draft = value(rootApi.createEcf31CoreDraft({
    header: value(rootApi.createEcf31CoreHeader({
      eNcf: value(rootApi.parseENcf("E310000000001")),
      issuer: { taxpayerIdentifier: value(rootApi.parseTaxpayerIdentifier("000000000")), legalName: "Synthetic issuer", address: "Synthetic address" },
      buyer: { taxpayerIdentifier: value(rootApi.parseTaxpayerIdentifier("00000000000")), legalName: "Synthetic buyer" },
      issueDate: "01-12-2026", incomeType: "01", paymentType: "1",
    })), lineAmounts: values.map(({ lineAmount }) => lineAmount),
  }));
  return { draft, montoItemQuantizations: values.map(({ quantization }) => quantization), indicator };
}

function amounts(result: ReturnType<typeof rootApi.createEcf31ItbisPriceInclusionEvidence>) {
  if (!result.ok) return [];
  return result.value.buckets.map((bucket) => [bucket.billingIndicator, rootApi.formatDecimal(bucket.montoItemSum), rootApi.formatDecimal(bucket.preGlobalAdjustmentTaxableBase)]);
}

describe("e-CF 31 ITBIS price-inclusion evidence", () => {
  it("groups genuine matching quantizations into ordered immutable taxable buckets", () => {
    const input = candidate(0, [["1", 1], ["2", 2], ["3", 3]]);
    const result = value(rootApi.createEcf31ItbisPriceInclusionEvidence(input));

    expect(amounts({ ok: true, value: result })).toEqual([[1, "1", "1"], [2, "2", "2"], [3, "3", "3"]]);
    expect(result.draft).toBe(input.draft);
    expect(result.montoItemQuantizations).not.toBe(input.montoItemQuantizations);
    expect(result.montoItemQuantizations).toEqual(input.montoItemQuantizations);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.montoItemQuantizations)).toBe(true);
    expect(Object.isFrozen(result.buckets[0])).toBe(true);
    expect(result.policyId).toBe("ecf31-itbis-price-inclusion-v1");
    expect(rootApi.isEcf31ItbisPriceInclusionEvidence(result)).toBe(true);
    expect(rootApi.isEcf31ItbisPriceInclusionEvidence({ ...result })).toBe(false);
  });

  it("divides aggregate taxable buckets once with exact half-up rounding", () => {
    expect(amounts(rootApi.createEcf31ItbisPriceInclusionEvidence(candidate(1, [["0.02", 1], ["0.02", 1], ["0.58", 2], ["0.57", 2], ["1", 3]]))))
      .toEqual([[1, "0.04", "0.03"], [2, "1.15", "0.99"], [3, "1", "1"]]);
  });

  it("omits absent buckets and ignores exempt and nonbillable sources", () => {
    expect(amounts(rootApi.createEcf31ItbisPriceInclusionEvidence(candidate(0, [["7", 0], ["8", 4], ["9", 2]]))))
      .toEqual([[2, "9", "9"]]);
  });

  it.each([
    [candidate(0, [["1", 0]]), "ECF31_ITBIS_PRICE_INCLUSION_NO_TAXED_LINE"],
    [{ ...candidate(0, [["1", 1]]), indicator: 2 }, "INVALID_ECF31_ITBIS_PRICE_INCLUSION_INDICATOR"],
    [{ ...candidate(0, [["1", 1]]), indicator: "1" }, "INVALID_ECF31_ITBIS_PRICE_INCLUSION_INDICATOR"],
    [{ ...candidate(0, [["1", 1]]), draft: {} }, "INVALID_ECF31_ITBIS_PRICE_INCLUSION_DRAFT"],
    [{ ...candidate(0, [["1", 1]]), montoItemQuantizations: [] }, "INVALID_ECF31_ITBIS_PRICE_INCLUSION_COLLECTION"],
    [{ ...candidate(0, [["1", 1]]), montoItemQuantizations: [{ ...candidate(0, [["1", 1]]).montoItemQuantizations[0] }] }, "INVALID_ECF31_ITBIS_PRICE_INCLUSION_EVIDENCE"],
    [(() => { const input = candidate(0, [["1", 1], ["1", 2]]); return { ...input, montoItemQuantizations: [...input.montoItemQuantizations].reverse() }; })(), "ECF31_ITBIS_PRICE_INCLUSION_MISMATCH"],
    [(() => { const input = candidate(0, [["1", 1], ["1", 2]]); return { ...input, montoItemQuantizations: [input.montoItemQuantizations[0]] }; })(), "ECF31_ITBIS_PRICE_INCLUSION_MISMATCH"],
    [(() => { const input = candidate(0, [["1", 1], ["1", 2]]); return { ...input, montoItemQuantizations: [input.montoItemQuantizations[0], input.montoItemQuantizations[0]] }; })(), "ECF31_ITBIS_PRICE_INCLUSION_MISMATCH"],
  ])("returns only safe catalog errors for invalid contracts", (input, code) => {
    expect(rootApi.createEcf31ItbisPriceInclusionEvidence(input)).toMatchObject({ ok: false, error: { code } });
  });

  it("returns safe errors for overflow and hostile outer or array structures without iterating", () => {
    const overflowing = candidate(0, [["999999999999999999", 1], ["0.01", 1]]);
    const valid = candidate(0, [["1", 1]]);
    const accessorOuter = { draft: valid.draft, indicator: 0 };
    Object.defineProperty(accessorOuter, "montoItemQuantizations", { enumerable: true, get: () => valid.montoItemQuantizations });
    const accessorIndex = [valid.montoItemQuantizations[0]];
    Object.defineProperty(accessorIndex, "0", { enumerable: true, get: () => valid.montoItemQuantizations[0] });
    const infiniteIterator = new Proxy([valid.montoItemQuantizations[0]], { get(target, key, receiver): unknown {
      if (key === Symbol.iterator) return function* infinite(): Generator { yield target[0]; yield* infinite(); };
      return Reflect.get(target, key, receiver) as unknown;
    } });
    const throwing = new Proxy({}, { ownKeys: () => { throw new Error("trap"); } });

    expect(rootApi.createEcf31ItbisPriceInclusionEvidence(overflowing)).toMatchObject({ ok: false, error: { code: "ECF31_ITBIS_PRICE_INCLUSION_OVERFLOW" } });
    for (const input of [null, accessorOuter, { ...valid, montoItemQuantizations: accessorIndex }, throwing]) {
      expect(() => rootApi.createEcf31ItbisPriceInclusionEvidence(input)).not.toThrow();
      expect(rootApi.createEcf31ItbisPriceInclusionEvidence(input)).toMatchObject({ ok: false });
    }
    expect(rootApi.createEcf31ItbisPriceInclusionEvidence({ ...valid, montoItemQuantizations: infiniteIterator })).toMatchObject({ ok: true });
  });

  it("rejects sparse, extra, symbol, proxy, and prototype input shapes safely", () => {
    const valid = candidate(0, [["1", 1]]);
    const sparse = [valid.montoItemQuantizations[0]]; sparse.length = 2;
    const noncanonical = [valid.montoItemQuantizations[0]]; Object.defineProperty(noncanonical, "01", { value: valid.montoItemQuantizations[0] });
    const hidden = [valid.montoItemQuantizations[0]]; Object.defineProperty(hidden, "hidden", { value: 1 });
    const symbol = [valid.montoItemQuantizations[0]]; Object.defineProperty(symbol, Symbol("hidden"), { value: 1 });
    const outerExtra = { draft: valid.draft, montoItemQuantizations: valid.montoItemQuantizations, extra: 1 };
    const outerPrototype = { ...valid }; Object.setPrototypeOf(outerPrototype, {});
    const throwingDescriptor = new Proxy([valid.montoItemQuantizations[0]], { getOwnPropertyDescriptor: () => { throw new Error("trap"); } });
    const fakeLength = new Proxy([valid.montoItemQuantizations[0]], { get(target, key, receiver): unknown {
      return key === "length" ? Number.MAX_SAFE_INTEGER : Reflect.get(target, key, receiver) as unknown;
    } });

    for (const input of [{}, { ...valid, montoItemQuantizations: {} }, { ...valid, montoItemQuantizations: noncanonical }, { ...valid, montoItemQuantizations: hidden }, { ...valid, montoItemQuantizations: symbol }, outerExtra, outerPrototype, { ...valid, montoItemQuantizations: throwingDescriptor }]) {
      expect(() => rootApi.createEcf31ItbisPriceInclusionEvidence(input)).not.toThrow();
      expect(rootApi.createEcf31ItbisPriceInclusionEvidence(input)).toMatchObject({ ok: false, error: { code: "INVALID_ECF31_ITBIS_PRICE_INCLUSION_INPUT" } });
    }
    expect(rootApi.createEcf31ItbisPriceInclusionEvidence({ ...valid, montoItemQuantizations: sparse })).toMatchObject({ ok: false, error: { code: "INVALID_ECF31_ITBIS_PRICE_INCLUSION_INPUT" } });
    expect(rootApi.createEcf31ItbisPriceInclusionEvidence({ ...valid, montoItemQuantizations: fakeLength })).toMatchObject({ ok: true });
  });
});

describe("e-CF 31 ITBIS price-inclusion evidence exports", () => {
  it("exports the factory and predicate from Builder and package root", () => {
    expect(builderApi.createEcf31ItbisPriceInclusionEvidence).toBe(rootApi.createEcf31ItbisPriceInclusionEvidence);
  });
});

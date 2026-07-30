import { describe, expect, it } from "vitest";

import * as rootApi from "../../../index.js";
import * as builderApi from "../index.js";
import type { Result } from "../../../index.js";

function value<T>(result: Result<T, unknown>): T {
  if (!result.ok) throw new Error("Expected a successful result.");
  return result.value;
}

function source(sequence: string, amount: string, billingIndicator: 1 | 2 | 3) {
  const coreLine = value(rootApi.createEcf31CoreLine({
    evidence: value(rootApi.captureLineCalculationEvidence({
      sequence: value(rootApi.parseLineSequence(sequence)), quantity: value(rootApi.parseNonnegativeQuantity("1")),
      unitPrice: value(rootApi.parseUnitPrice(amount)), declaredAmount: value(rootApi.parseNonnegativeAmount("0")),
    })), itemName: "Synthetic item", billingIndicator, goodOrServiceIndicator: 1,
  }));
  return value(rootApi.createEcf31MontoItemQuantizationEvidence(value(rootApi.createEcf31LineAmountEvidence({
    coreLine, discountAmount: value(rootApi.parseNonnegativeAmount("0")), surchargeAmount: value(rootApi.parseNonnegativeAmount("0")),
  }))));
}

function evidence() {
  const quantizations = [source("1", "100", 1), source("2", "50", 2), source("3", "25", 3)];
  const draft = value(rootApi.createEcf31CoreDraft({
    header: value(rootApi.createEcf31CoreHeader({
      eNcf: value(rootApi.parseENcf("E310000000001")),
      issuer: { taxpayerIdentifier: value(rootApi.parseTaxpayerIdentifier("000000000")), legalName: "Synthetic issuer", address: "Synthetic address" },
      buyer: { taxpayerIdentifier: value(rootApi.parseTaxpayerIdentifier("00000000000")), legalName: "Synthetic buyer" },
      issueDate: "01-12-2026", incomeType: "01", paymentType: "1",
    })), lineAmounts: quantizations.map((entry) => entry.sourceEvidence),
  }));
  return {
    priceInclusionEvidence: value(rootApi.createEcf31ItbisPriceInclusionEvidence({ draft, montoItemQuantizations: quantizations, indicator: 0 })),
    adjustment(kind: "discount" | "charge", amount: string, billingIndicator: 1 | 2 | 3) {
      return {
        reconciliationEvidence: value(rootApi.createEcf31GlobalAdjustmentReconciliationEvidence({
          kind, initialEvidence: value(rootApi.createEcf31GlobalAdjustmentInitialEvidence({ globalAmount: value(rootApi.parsePositiveAmount(amount)), lines: quantizations })),
        })), billingIndicator,
      };
    },
  };
}

function amounts(result: ReturnType<typeof rootApi.createEcf31PostGlobalAdjustmentTaxableBaseEvidence>) {
  return result.ok ? result.value.buckets.map((bucket) => [bucket.billingIndicator, rootApi.formatDecimal(bucket.taxableBase)]) : [];
}

describe("e-CF 31 post-global-adjustment taxable base evidence", () => {
  it("uses declared adjustment buckets with multiple discounts and charges", () => {
    const input = evidence();
    const result = rootApi.createEcf31PostGlobalAdjustmentTaxableBaseEvidence({
      priceInclusionEvidence: input.priceInclusionEvidence,
      adjustments: [input.adjustment("discount", "10", 1), input.adjustment("charge", "2", 1), input.adjustment("discount", "5", 2)],
    });

    expect(amounts(result)).toEqual([[1, "92"], [2, "45"], [3, "25"]]);
    const output = value(result);
    expect(Object.isFrozen(output)).toBe(true);
    expect(Object.isFrozen(output.adjustments)).toBe(true);
    expect(Object.isFrozen(output.adjustments[0])).toBe(true);
    expect(Object.isFrozen(output.buckets[0])).toBe(true);
    const firstBucket = output.buckets[0];
    if (firstBucket === undefined) throw new Error("Expected the first taxable base bucket.");
    expect(Reflect.set(output.buckets, "0", output.buckets[0])).toBe(false);
    expect(Reflect.set(firstBucket, "taxableBase", value(rootApi.parseNonnegativeAmount("0")))).toBe(false);
    expect(rootApi.isEcf31PostGlobalAdjustmentTaxableBaseEvidence(output)).toBe(true);
    expect(rootApi.isEcf31PostGlobalAdjustmentTaxableBaseEvidence({ ...output })).toBe(false);
  });

  it("retains zero bases exactly", () => {
    const input = evidence();
    expect(amounts(rootApi.createEcf31PostGlobalAdjustmentTaxableBaseEvidence({
      priceInclusionEvidence: input.priceInclusionEvidence, adjustments: [input.adjustment("discount", "100", 1)],
    }))).toEqual([[1, "0"], [2, "50"], [3, "25"]]);
  });

  it("rejects genuine reconciliation evidence from a different quantization lineage", () => {
    const priceEvidence = evidence();
    const reconciliationEvidence = evidence();

    expect(rootApi.createEcf31PostGlobalAdjustmentTaxableBaseEvidence({
      priceInclusionEvidence: priceEvidence.priceInclusionEvidence,
      adjustments: [reconciliationEvidence.adjustment("discount", "1", 1)],
    })).toMatchObject({ ok: false, error: { code: "ECF31_POST_GLOBAL_ADJUSTMENT_TAXABLE_BASE_RECONCILIATION_LINEAGE_MISMATCH" } });
  });

  it.each([
    [(input: ReturnType<typeof evidence>) => ({ priceInclusionEvidence: input.priceInclusionEvidence, adjustments: [input.adjustment("discount", "101", 1)] }), "ECF31_POST_GLOBAL_ADJUSTMENT_TAXABLE_BASE_NEGATIVE"],
    [(input: ReturnType<typeof evidence>) => ({ priceInclusionEvidence: input.priceInclusionEvidence, adjustments: [{ ...input.adjustment("discount", "1", 1), billingIndicator: 4 }] }), "INVALID_ECF31_POST_GLOBAL_ADJUSTMENT_TAXABLE_BASE_INDICATOR"],
    [(input: ReturnType<typeof evidence>) => ({ priceInclusionEvidence: { ...input.priceInclusionEvidence }, adjustments: [] }), "INVALID_ECF31_POST_GLOBAL_ADJUSTMENT_TAXABLE_BASE_PRICE_INCLUSION_EVIDENCE"],
    [(input: ReturnType<typeof evidence>) => ({ priceInclusionEvidence: input.priceInclusionEvidence, adjustments: [{ reconciliationEvidence: {}, billingIndicator: 1 }] }), "INVALID_ECF31_POST_GLOBAL_ADJUSTMENT_TAXABLE_BASE_RECONCILIATION_EVIDENCE"],
  ])("returns catalog errors for invalid evidence and resulting bases", (createInput, code) => {
    expect(rootApi.createEcf31PostGlobalAdjustmentTaxableBaseEvidence(createInput(evidence()))).toMatchObject({ ok: false, error: { code } });
  });

  it("contains forged, hostile, sparse, mutable, and overflow inputs", () => {
    const input = evidence();
    const sparse = [input.adjustment("discount", "1", 1)]; sparse.length = 2;
    const accessor = { priceInclusionEvidence: input.priceInclusionEvidence };
    Object.defineProperty(accessor, "adjustments", { enumerable: true, get: () => [] });
    const hostile = new Proxy({}, { ownKeys: () => { throw new Error("trap"); } });
    const nullPrototype = Object.assign(Object.create(null) as object, { priceInclusionEvidence: input.priceInclusionEvidence, adjustments: [] });
    const adjustmentAccessor = { billingIndicator: 1 };
    Object.defineProperty(adjustmentAccessor, "reconciliationEvidence", { enumerable: true, get: () => input.adjustment("discount", "1", 1).reconciliationEvidence });
    const adjustmentProxy = new Proxy({}, { ownKeys: () => { throw new Error("trap"); } });
    const invalidPrototype = Object.setPrototypeOf({}, {}) as object;
    const accessorIndex: unknown[] = [input.adjustment("discount", "1", 1)];
    Object.defineProperty(accessorIndex, "0", { enumerable: true, get: () => input.adjustment("discount", "1", 1) });
    const overflowing = input.adjustment("charge", "9999999999999999.99", 1);

    expect(rootApi.createEcf31PostGlobalAdjustmentTaxableBaseEvidence(nullPrototype)).toMatchObject({ ok: true });
    for (const candidate of ["invalid", null, [], invalidPrototype, {}, { unexpected: true, adjustments: [] },
      { priceInclusionEvidence: input.priceInclusionEvidence, adjustments: sparse }, accessor, hostile,
      { priceInclusionEvidence: input.priceInclusionEvidence, adjustments: accessorIndex },
      { priceInclusionEvidence: input.priceInclusionEvidence, adjustments: [adjustmentAccessor] },
      { priceInclusionEvidence: input.priceInclusionEvidence, adjustments: [adjustmentProxy] },
      { priceInclusionEvidence: input.priceInclusionEvidence, adjustments: ["invalid"] },
      { priceInclusionEvidence: input.priceInclusionEvidence, adjustments: [Object.create(null)] },
      { priceInclusionEvidence: input.priceInclusionEvidence, adjustments: [invalidPrototype] }]) {
      expect(() => rootApi.createEcf31PostGlobalAdjustmentTaxableBaseEvidence(candidate)).not.toThrow();
      expect(rootApi.createEcf31PostGlobalAdjustmentTaxableBaseEvidence(candidate)).toMatchObject({ ok: false });
    }
    expect(rootApi.createEcf31PostGlobalAdjustmentTaxableBaseEvidence({ priceInclusionEvidence: input.priceInclusionEvidence, adjustments: [overflowing] }))
      .toMatchObject({ ok: false, error: { code: "ECF31_POST_GLOBAL_ADJUSTMENT_TAXABLE_BASE_OVERFLOW" } });
  });
});

describe("e-CF 31 post-global-adjustment taxable base evidence exports", () => {
  it("exports its factory from Builder and package root", () => {
    expect(builderApi.createEcf31PostGlobalAdjustmentTaxableBaseEvidence)
      .toBe(rootApi.createEcf31PostGlobalAdjustmentTaxableBaseEvidence);
  });
});

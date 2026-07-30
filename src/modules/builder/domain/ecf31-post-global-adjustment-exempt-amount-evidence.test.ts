import { describe, expect, it } from "vitest";

import * as rootApi from "../../../index.js";
import * as builderApi from "../index.js";
import type { Result } from "../../../index.js";

function value<T>(result: Result<T, unknown>): T {
  if (!result.ok) throw new Error("Expected a successful result.");
  return result.value;
}

function fixture(indicators: readonly (0 | 1 | 2 | 3 | 4)[]) {
  const quantizations = indicators.map((billingIndicator, index) => value(rootApi.createEcf31MontoItemQuantizationEvidence(value(rootApi.createEcf31LineAmountEvidence({
    coreLine: value(rootApi.createEcf31CoreLine({ evidence: value(rootApi.captureLineCalculationEvidence({
      sequence: value(rootApi.parseLineSequence(String(index + 1))), quantity: value(rootApi.parseNonnegativeQuantity("1")),
      unitPrice: value(rootApi.parseUnitPrice(String((index + 1) * 10))), declaredAmount: value(rootApi.parseNonnegativeAmount("0")),
    })), itemName: "Synthetic item", billingIndicator, goodOrServiceIndicator: 1 })),
    discountAmount: value(rootApi.parseNonnegativeAmount("0")), surchargeAmount: value(rootApi.parseNonnegativeAmount("0")),
  })))));
  const draft = value(rootApi.createEcf31CoreDraft({
    header: value(rootApi.createEcf31CoreHeader({ eNcf: value(rootApi.parseENcf("E310000000001")),
      issuer: { taxpayerIdentifier: value(rootApi.parseTaxpayerIdentifier("000000000")), legalName: "Synthetic issuer", address: "Synthetic address" },
      buyer: { taxpayerIdentifier: value(rootApi.parseTaxpayerIdentifier("00000000000")), legalName: "Synthetic buyer" },
      issueDate: "01-12-2026", incomeType: "01", paymentType: "1" })),
    lineAmounts: quantizations.map((quantization) => quantization.sourceEvidence),
  }));
  const adjustment = (kind: "discount" | "charge", amount: string) => ({
    reconciliationEvidence: value(rootApi.createEcf31GlobalAdjustmentReconciliationEvidence({ kind,
      initialEvidence: value(rootApi.createEcf31GlobalAdjustmentInitialEvidence({ globalAmount: value(rootApi.parsePositiveAmount(amount)), lines: quantizations })),
    })), billingIndicator: 4 as const,
  });
  return { draft, quantizations, adjustment };
}

function amount(result: ReturnType<typeof rootApi.createEcf31PostGlobalAdjustmentExemptAmountEvidence>) {
  return result.ok && result.value.montoExento !== undefined ? rootApi.formatDecimal(result.value.montoExento) : undefined;
}

describe("e-CF 31 post-global-adjustment exempt amount evidence", () => {
  it("uses only exempt MontoItem values and declared exempt adjustments", () => {
    const input = fixture([4, 1, 4]);
    const result = rootApi.createEcf31PostGlobalAdjustmentExemptAmountEvidence({ draft: input.draft, montoItemQuantizations: input.quantizations,
      adjustments: [input.adjustment("discount", "5"), input.adjustment("charge", "2"), input.adjustment("discount", "1")] });
    const output = value(result);
    expect(amount(result)).toBe("36");
    expect(Object.isFrozen(output)).toBe(true);
    expect(Object.isFrozen(output.montoItemQuantizations)).toBe(true);
    expect(Object.isFrozen(output.adjustments[0])).toBe(true);
    expect(Reflect.set(output.adjustments, "0", output.adjustments[0])).toBe(false);
    expect(rootApi.isEcf31PostGlobalAdjustmentExemptAmountEvidence(output)).toBe(true);
    expect(rootApi.isEcf31PostGlobalAdjustmentExemptAmountEvidence({ ...output })).toBe(false);
  });

  it("preserves absence without an exempt basis and supports exempt-only invoices", () => {
    const absent = fixture([1]);
    const exempt = fixture([4]);
    expect(amount(rootApi.createEcf31PostGlobalAdjustmentExemptAmountEvidence({ draft: absent.draft, montoItemQuantizations: absent.quantizations, adjustments: [] }))).toBeUndefined();
    expect(amount(rootApi.createEcf31PostGlobalAdjustmentExemptAmountEvidence({ draft: exempt.draft, montoItemQuantizations: exempt.quantizations, adjustments: [] }))).toBe("10");
  });

  it("retains a zero exempt amount exactly", () => {
    const input = fixture([4]);
    expect(amount(rootApi.createEcf31PostGlobalAdjustmentExemptAmountEvidence({ draft: input.draft, montoItemQuantizations: input.quantizations,
      adjustments: [input.adjustment("discount", "5"), input.adjustment("discount", "5")] }))).toBe("0");
  });

  it.each([
    [(input: ReturnType<typeof fixture>) => ({ draft: input.draft, montoItemQuantizations: input.quantizations, adjustments: [input.adjustment("discount", "6"), input.adjustment("discount", "5")] }), "ECF31_POST_GLOBAL_ADJUSTMENT_EXEMPT_AMOUNT_NEGATIVE"],
    [(input: ReturnType<typeof fixture>) => ({ draft: input.draft, montoItemQuantizations: input.quantizations, adjustments: [input.adjustment("charge", "9999999999999989.99")] }), "ECF31_POST_GLOBAL_ADJUSTMENT_EXEMPT_AMOUNT_OVERFLOW"],
    [(input: ReturnType<typeof fixture>) => ({ draft: fixture([4]).draft, montoItemQuantizations: input.quantizations, adjustments: [] }), "ECF31_POST_GLOBAL_ADJUSTMENT_EXEMPT_AMOUNT_MISMATCH"],
    [(input: ReturnType<typeof fixture>) => ({ draft: input.draft, montoItemQuantizations: input.quantizations, adjustments: [{ ...fixture([4]).adjustment("discount", "1") }] }), "ECF31_POST_GLOBAL_ADJUSTMENT_EXEMPT_AMOUNT_RECONCILIATION_LINEAGE_MISMATCH"],
    [(input: ReturnType<typeof fixture>) => ({ draft: input.draft, montoItemQuantizations: input.quantizations, adjustments: [{ ...input.adjustment("discount", "1"), billingIndicator: 1 }] }), "INVALID_ECF31_POST_GLOBAL_ADJUSTMENT_EXEMPT_AMOUNT_INDICATOR"],
  ])("returns safe errors for zero, arithmetic, and lineage boundaries", (createInput, code) => {
    const input = fixture(code === "ECF31_POST_GLOBAL_ADJUSTMENT_EXEMPT_AMOUNT_OVERFLOW" ? [4, 4] : [4]);
    expect(rootApi.createEcf31PostGlobalAdjustmentExemptAmountEvidence(createInput(input))).toMatchObject({ ok: false, error: { code } });
  });

  it("rejects forgery, sparse and hostile values without invoking accessors", () => {
    const input = fixture([4]);
    const sparse = [input.quantizations[0]]; sparse.length = 2;
    const accessorIndex: unknown[] = [input.quantizations[0]];
    Object.defineProperty(accessorIndex, "0", { enumerable: true, get: () => input.quantizations[0] });
    const arrayProxy = new Proxy([], { ownKeys: () => { throw new Error("trap"); } });
    const accessor = { draft: input.draft, montoItemQuantizations: input.quantizations };
    Object.defineProperty(accessor, "adjustments", { enumerable: true, get: () => { throw new Error("trap"); } });
    const hostile = new Proxy({}, { ownKeys: () => { throw new Error("trap"); } });
    const adjustmentAccessor = { billingIndicator: 4 };
    Object.defineProperty(adjustmentAccessor, "reconciliationEvidence", { enumerable: true, get: () => { throw new Error("trap"); } });
    const adjustmentProxy = new Proxy({}, { ownKeys: () => { throw new Error("trap"); } });
    const forged = { ...input.adjustment("discount", "1").reconciliationEvidence };
    for (const candidate of [null, [], {}, { draft: input.draft, montoItemQuantizations: sparse, adjustments: [] },
      { draft: input.draft, montoItemQuantizations: arrayProxy, adjustments: [] }, accessor, hostile,
      { draft: input.draft, montoItemQuantizations: accessorIndex, adjustments: [] },
      { draft: input.draft, montoItemQuantizations: input.quantizations, adjustments: ["invalid"] },
      { draft: input.draft, montoItemQuantizations: input.quantizations, adjustments: [adjustmentAccessor] },
      { draft: input.draft, montoItemQuantizations: input.quantizations, adjustments: [adjustmentProxy] },
      { draft: input.draft, montoItemQuantizations: input.quantizations, adjustments: [{ reconciliationEvidence: forged, billingIndicator: 4 }] }]) {
      expect(() => rootApi.createEcf31PostGlobalAdjustmentExemptAmountEvidence(candidate)).not.toThrow();
      expect(rootApi.createEcf31PostGlobalAdjustmentExemptAmountEvidence(candidate)).toMatchObject({ ok: false });
    }
  });

  it("contains each structural boundary without evaluating user properties", () => {
    const input = fixture([4]);
    const invalidPrototype = Object.setPrototypeOf({}, {}) as object;
    const draftAccessor = { montoItemQuantizations: input.quantizations, adjustments: [] };
    Object.defineProperty(draftAccessor, "draft", { enumerable: true, get: () => { throw new Error("trap"); } });
    const nonEnumerable = { draft: input.draft, montoItemQuantizations: input.quantizations, adjustments: [] };
    Object.defineProperty(nonEnumerable, "draft", { enumerable: false });
    const cases: unknown[] = ["bad", Object.create(null), invalidPrototype, { draft: input.draft, montoItemQuantizations: input.quantizations },
      { draft: input.draft, adjustments: [] }, { montoItemQuantizations: input.quantizations, adjustments: [] }, draftAccessor, nonEnumerable,
      { draft: { ...input.draft }, montoItemQuantizations: input.quantizations, adjustments: [] },
      { draft: input.draft, montoItemQuantizations: [{}], adjustments: [] },
      { draft: input.draft, montoItemQuantizations: input.quantizations, adjustments: [{}] },
      { draft: input.draft, montoItemQuantizations: input.quantizations, adjustments: [Object.setPrototypeOf({}, {})] },
      { draft: input.draft, montoItemQuantizations: input.quantizations, adjustments: [{ reconciliationEvidence: input.adjustment("discount", "1").reconciliationEvidence }] },
      { draft: input.draft, montoItemQuantizations: input.quantizations, adjustments: [{ billingIndicator: 4 }] }];
    for (const candidate of cases) expect(rootApi.createEcf31PostGlobalAdjustmentExemptAmountEvidence(candidate)).toMatchObject({ ok: false });
  });
});

describe("e-CF 31 post-global-adjustment exempt amount evidence exports", () => {
  it("exports its factory from Builder and package root", () => {
    expect(builderApi.createEcf31PostGlobalAdjustmentExemptAmountEvidence)
      .toBe(rootApi.createEcf31PostGlobalAdjustmentExemptAmountEvidence);
  });
});

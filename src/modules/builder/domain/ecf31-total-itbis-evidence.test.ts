import { describe, expect, it } from "vitest";

import * as rootApi from "../../../index.js";
import * as builderApi from "../index.js";
import type { Result } from "../../../index.js";

function value<T>(result: Result<T, unknown>): T {
  if (!result.ok) throw new Error("Expected a successful result.");
  return result.value;
}

function fixture(amounts: readonly (readonly [1 | 2 | 3, string])[], codes: readonly string[] = []) {
  const quantizations = amounts.map(([billingIndicator, amount], index) => {
    const coreLine = value(rootApi.createEcf31CoreLine({ evidence: value(rootApi.captureLineCalculationEvidence({
      sequence: value(rootApi.parseLineSequence(String(index + 1))), quantity: value(rootApi.parseNonnegativeQuantity("1")),
      unitPrice: value(rootApi.parseUnitPrice(amount)), declaredAmount: value(rootApi.parseNonnegativeAmount("0")),
    })), itemName: "Synthetic item", billingIndicator, goodOrServiceIndicator: 1 }));
    return value(rootApi.createEcf31MontoItemQuantizationEvidence(value(rootApi.createEcf31LineAmountEvidence({
      coreLine, discountAmount: value(rootApi.parseNonnegativeAmount("0")), surchargeAmount: value(rootApi.parseNonnegativeAmount("0")),
    }))));
  });
  const draft = value(rootApi.createEcf31CoreDraft({ header: value(rootApi.createEcf31CoreHeader({
    eNcf: value(rootApi.parseENcf("E310000000001")),
    issuer: { taxpayerIdentifier: value(rootApi.parseTaxpayerIdentifier("000000000")), legalName: "Synthetic issuer", address: "Synthetic address" },
    buyer: { taxpayerIdentifier: value(rootApi.parseTaxpayerIdentifier("00000000000")), legalName: "Synthetic buyer" },
    issueDate: "01-12-2026", incomeType: "01", paymentType: "1",
  })), lineAmounts: quantizations.map((entry) => entry.sourceEvidence) }));
  const priceInclusionEvidence = value(rootApi.createEcf31ItbisPriceInclusionEvidence({ draft, montoItemQuantizations: quantizations, indicator: 0 }));
  const taxableBaseEvidence = value(rootApi.createEcf31PostGlobalAdjustmentTaxableBaseEvidence({ priceInclusionEvidence, adjustments: [] }));
  const additionalTaxClassificationEvidence = value(rootApi.createEcf31AdditionalTaxClassificationEvidence({
    draft, entries: quantizations.map((entry, index) => ({ source: entry.sourceEvidence, codes: index === 0 ? codes : [] })),
  }));
  return { draft, quantizations, priceInclusionEvidence, taxableBaseEvidence, additionalTaxClassificationEvidence };
}

function totals(result: ReturnType<typeof rootApi.createEcf31TotalItbisEvidence>) {
  if (!result.ok) return result;
  return [result.value.totalItbis1, result.value.totalItbis2, result.value.totalItbis3].map((amount) => amount === undefined ? undefined : rootApi.formatDecimal(amount));
}

function inputOf(input: ReturnType<typeof fixture>) {
  return { taxableBaseEvidence: input.taxableBaseEvidence, additionalTaxClassificationEvidence: input.additionalTaxClassificationEvidence };
}

describe("e-CF 31 TotalITBIS evidence", () => {
  it("derives all represented rate buckets with exact final-product rounding", () => {
    const input = fixture([[1, "1.25"], [2, "1.25"], [3, "7"]]);
    expect(totals(rootApi.createEcf31TotalItbisEvidence(inputOf(input)))).toEqual(["0.23", "0.2", "0"]);
    expect(totals(rootApi.createEcf31TotalItbisEvidence(inputOf(fixture([[1, "1.24"]]))))).toEqual(["0.22", undefined, undefined]);
  });

  it("omits absent buckets and retains a represented bucket at zero", () => {
    const input = fixture([[1, "1"]]);
    const adjustment = value(rootApi.createEcf31GlobalAdjustmentReconciliationEvidence({
      kind: "discount", initialEvidence: value(rootApi.createEcf31GlobalAdjustmentInitialEvidence({
        globalAmount: value(rootApi.parsePositiveAmount("1")), lines: input.quantizations,
      })),
    }));
    const taxableBaseEvidence = value(rootApi.createEcf31PostGlobalAdjustmentTaxableBaseEvidence({
      priceInclusionEvidence: input.priceInclusionEvidence, adjustments: [{ reconciliationEvidence: adjustment, billingIndicator: 1 }],
    }));
    expect(totals(rootApi.createEcf31TotalItbisEvidence({ ...inputOf(input), taxableBaseEvidence }))).toEqual(["0", undefined, undefined]);
    expect(totals(rootApi.createEcf31TotalItbisEvidence(inputOf(fixture([[2, "1"]]))))).toEqual([undefined, "0.16", undefined]);
    expect(totals(rootApi.createEcf31TotalItbisEvidence(inputOf(fixture([[3, "1"]]))))).toEqual([undefined, undefined, "0"]);
  });

  it.each([["005", true], ["006", false], ["039", false]])("accepts only classifications without qualifying ISC %s", (code, accepted) => {
    const input = fixture([[1, "1"]], [code]);
    const result = rootApi.createEcf31TotalItbisEvidence(inputOf(input));
    expect(result.ok).toBe(accepted);
    if (!accepted) expect(result).toMatchObject({ error: { code: "ECF31_TOTAL_ITBIS_QUALIFYING_ISC_UNSUPPORTED" } });
  });

  it("rejects different genuine drafts, forged evidence, hostile values, and overflow safely", () => {
    const input = fixture([[1, "1"]]);
    const other = fixture([[1, "1"]]);
    const overflow = fixture([[1, "999999999999999999"]]);
    const accessor = { taxableBaseEvidence: input.taxableBaseEvidence };
    Object.defineProperty(accessor, "additionalTaxClassificationEvidence", { enumerable: true, get: () => { throw new Error("trap"); } });
    const hostile = new Proxy({}, { ownKeys: () => { throw new Error("trap"); } });
    expect(rootApi.createEcf31TotalItbisEvidence({ taxableBaseEvidence: input.taxableBaseEvidence, additionalTaxClassificationEvidence: other.additionalTaxClassificationEvidence }))
      .toMatchObject({ ok: false, error: { code: "ECF31_TOTAL_ITBIS_DRAFT_MISMATCH" } });
    for (const candidate of [null, [], Object.setPrototypeOf({}, {}), {}, accessor, hostile,
      { taxableBaseEvidence: { ...input.taxableBaseEvidence }, additionalTaxClassificationEvidence: input.additionalTaxClassificationEvidence },
      { taxableBaseEvidence: input.taxableBaseEvidence, additionalTaxClassificationEvidence: {} }]) {
      expect(() => rootApi.createEcf31TotalItbisEvidence(candidate)).not.toThrow();
      expect(rootApi.createEcf31TotalItbisEvidence(candidate)).toMatchObject({ ok: false });
    }
    expect(rootApi.createEcf31TotalItbisEvidence(inputOf(overflow))).toMatchObject({ ok: false, error: { code: "ECF31_TOTAL_ITBIS_OVERFLOW" } });
  });

  it("produces immutable nominal evidence and exports it through Builder and the root", () => {
    const output = value(rootApi.createEcf31TotalItbisEvidence(inputOf(fixture([[1, "1"]]))));
    expect(Object.isFrozen(output)).toBe(true);
    expect(Reflect.set(output, "totalItbis1", value(rootApi.parseNonnegativeAmount("0")))).toBe(false);
    expect(rootApi.isEcf31TotalItbisEvidence(output)).toBe(true);
    expect(rootApi.isEcf31TotalItbisEvidence({ ...output })).toBe(false);
    expect(builderApi.createEcf31TotalItbisEvidence).toBe(rootApi.createEcf31TotalItbisEvidence);
  });
});

import { describe, expect, expectTypeOf, it } from "vitest";

import * as rootApi from "../../../index.js";
import * as builderApi from "../index.js";
import type { Result } from "../../../index.js";

function value<T>(result: Result<T, unknown>): T { if (!result.ok) throw new Error("Expected success."); return result.value; }

function fixture(lines: readonly (readonly [0 | 1 | 2 | 3 | 4, string])[], codes: readonly string[] = []) {
  const quantizations = lines.map(([billingIndicator, amount], index) => {
    const calculation = value(rootApi.captureLineCalculationEvidence({ sequence: value(rootApi.parseLineSequence(String(index + 1))), quantity: value(rootApi.parseNonnegativeQuantity("1")), unitPrice: value(rootApi.parseUnitPrice(amount)), declaredAmount: value(rootApi.parseNonnegativeAmount("0")) }));
    const coreLine = value(rootApi.createEcf31CoreLine({ evidence: calculation, itemName: "Synthetic item", billingIndicator, goodOrServiceIndicator: 1 }));
    return value(rootApi.createEcf31MontoItemQuantizationEvidence(value(rootApi.createEcf31LineAmountEvidence({ coreLine, discountAmount: value(rootApi.parseNonnegativeAmount("0")), surchargeAmount: value(rootApi.parseNonnegativeAmount("0")) }))));
  });
  const draft = value(rootApi.createEcf31CoreDraft({ header: value(rootApi.createEcf31CoreHeader({ eNcf: value(rootApi.parseENcf("E310000000001")), issuer: { taxpayerIdentifier: value(rootApi.parseTaxpayerIdentifier("000000000")), legalName: "Synthetic issuer", address: "Synthetic address" }, buyer: { taxpayerIdentifier: value(rootApi.parseTaxpayerIdentifier("00000000000")), legalName: "Synthetic buyer" }, issueDate: "01-12-2026", incomeType: "01", paymentType: "1" })), lineAmounts: quantizations.map((entry) => entry.sourceEvidence) }));
  const exemptAmountEvidence = value(rootApi.createEcf31PostGlobalAdjustmentExemptAmountEvidence({ draft, montoItemQuantizations: quantizations, adjustments: [] }));
  const additionalTaxClassificationEvidence = value(rootApi.createEcf31AdditionalTaxClassificationEvidence({ draft, entries: quantizations.map((entry, index) => ({ source: entry.sourceEvidence, codes: index === 0 ? codes : [] })) }));
  if (!lines.some(([indicator]) => indicator >= 1 && indicator <= 3)) return { draft, quantizations, exemptAmountEvidence, additionalTaxClassificationEvidence };
  const priceInclusionEvidence = value(rootApi.createEcf31ItbisPriceInclusionEvidence({ draft, montoItemQuantizations: quantizations, indicator: 0 }));
  const taxableBaseEvidence = value(rootApi.createEcf31PostGlobalAdjustmentTaxableBaseEvidence({ priceInclusionEvidence, adjustments: [] }));
  const totalItbisEvidence = codes.some((code) => code >= "006") ? undefined : value(rootApi.createEcf31TotalItbisEvidence({ taxableBaseEvidence, additionalTaxClassificationEvidence }));
  return { draft, quantizations, exemptAmountEvidence, additionalTaxClassificationEvidence, taxableBaseEvidence, totalItbisEvidence };
}

function input(source: ReturnType<typeof fixture>) {
  return "taxableBaseEvidence" in source ? { exemptAmountEvidence: source.exemptAmountEvidence, additionalTaxClassificationEvidence: source.additionalTaxClassificationEvidence, taxableBaseEvidence: source.taxableBaseEvidence, totalItbisEvidence: source.totalItbisEvidence } : { exemptAmountEvidence: source.exemptAmountEvidence, additionalTaxClassificationEvidence: source.additionalTaxClassificationEvidence };
}

function amounts(result: ReturnType<typeof rootApi.createEcf31DerivedHeaderTotalsEvidence>) {
  if (!result.ok) return result;
  return [result.value.headerTotals.montoGravadoI1, result.value.headerTotals.montoGravadoI2, result.value.headerTotals.montoGravadoI3, result.value.headerTotals.montoExento, result.value.headerTotals.totalItbis1, result.value.headerTotals.totalItbis2, result.value.headerTotals.totalItbis3].map((amount) => amount === undefined ? undefined : rootApi.formatDecimal(amount));
}

describe("e-CF 31 derived header totals evidence", () => {
  it("composes exempt-only, taxable-only, mixed, and no-total-bearing drafts without fabricating fields", () => {
    expect(amounts(rootApi.createEcf31DerivedHeaderTotalsEvidence(input(fixture([[4, "10"]]))))).toEqual([undefined, undefined, undefined, "10", undefined, undefined, undefined]);
    expect(amounts(rootApi.createEcf31DerivedHeaderTotalsEvidence(input(fixture([[1, "10"]]))))).toEqual(["10", undefined, undefined, undefined, "1.8", undefined, undefined]);
    expect(amounts(rootApi.createEcf31DerivedHeaderTotalsEvidence(input(fixture([[2, "10"]]))))).toEqual([undefined, "10", undefined, undefined, undefined, "1.6", undefined]);
    expect(amounts(rootApi.createEcf31DerivedHeaderTotalsEvidence(input(fixture([[1, "10"], [2, "10"], [3, "10"], [4, "10"]]))))).toEqual(["10", "10", "10", "10", "1.8", "1.6", "0"]);
    const none = value(rootApi.createEcf31DerivedHeaderTotalsEvidence(input(fixture([[0, "10"]]))));
    expect([rootApi.formatDecimal(none.headerTotals.montoGravadoTotal), rootApi.formatDecimal(none.headerTotals.totalItbis), rootApi.formatDecimal(none.headerTotals.montoTotal)]).toEqual(["0", "0", "0"]);
    expect("montoExento" in none.headerTotals).toBe(false);
  });

  it("preserves represented zero buckets and exact sources", () => {
    const source = fixture([[1, "0"], [3, "5"]]);
    const output = value(rootApi.createEcf31DerivedHeaderTotalsEvidence(input(source)));
    expect(amounts({ ok: true, value: output })).toEqual(["0", undefined, "5", undefined, "0", undefined, "0"]);
    expect([output.exemptAmountEvidence, output.additionalTaxClassificationEvidence, output.taxableBaseEvidence, output.totalItbisEvidence]).toEqual([source.exemptAmountEvidence, source.additionalTaxClassificationEvidence, source.taxableBaseEvidence, source.totalItbisEvidence]);
  });

  it("rejects pair asymmetry, undefined, forbidden pairs, drafts, lineage, references, and unsupported taxes", () => {
    const taxable = fixture([[1, "1"]]);
    const exempt = fixture([[4, "1"]]);
    const other = fixture([[1, "1"]]);
    const badPair = { exemptAmountEvidence: taxable.exemptAmountEvidence, additionalTaxClassificationEvidence: taxable.additionalTaxClassificationEvidence, taxableBaseEvidence: taxable.taxableBaseEvidence };
    const codes = fixture([[1, "1"]], ["001"]);
    for (const candidate of [badPair, { ...input(taxable), taxableBaseEvidence: undefined }, { ...input(taxable), totalItbisEvidence: undefined }, { ...input(exempt), taxableBaseEvidence: taxable.taxableBaseEvidence, totalItbisEvidence: taxable.totalItbisEvidence }, { ...input(taxable), additionalTaxClassificationEvidence: other.additionalTaxClassificationEvidence }, { ...input(taxable), taxableBaseEvidence: other.taxableBaseEvidence, totalItbisEvidence: taxable.totalItbisEvidence }, { ...input(taxable), taxableBaseEvidence: {}, totalItbisEvidence: taxable.totalItbisEvidence }, { ...input(taxable), totalItbisEvidence: {} }, { ...input(taxable), totalItbisEvidence: other.totalItbisEvidence }, input(codes)]) {
      expect(rootApi.createEcf31DerivedHeaderTotalsEvidence(candidate)).toMatchObject({ ok: false });
    }
    expect(rootApi.createEcf31TotalItbisEvidence({ taxableBaseEvidence: codes.taxableBaseEvidence, additionalTaxClassificationEvidence: fixture([[1, "1"]], ["006"]).additionalTaxClassificationEvidence })).toMatchObject({ ok: false });
    expect(rootApi.createEcf31TotalItbisEvidence({ taxableBaseEvidence: codes.taxableBaseEvidence, additionalTaxClassificationEvidence: fixture([[1, "1"]], ["039"]).additionalTaxClassificationEvidence })).toMatchObject({ ok: false });
  });

  it("rejects forged and hostile exact-input shapes safely", () => {
    const source = fixture([[1, "1"]]);
    const accessor = { exemptAmountEvidence: source.exemptAmountEvidence, additionalTaxClassificationEvidence: source.additionalTaxClassificationEvidence, taxableBaseEvidence: source.taxableBaseEvidence };
    Object.defineProperty(accessor, "totalItbisEvidence", { enumerable: true, get: () => { throw new Error("trap"); } });
    const symbol = { ...input(source), [Symbol("extra")]: true };
    const proxy = new Proxy(input(source), {});
    const revoked = Proxy.revocable(input(source), {}); revoked.revoke();
    const throwingProxy = new Proxy(input(source), { getPrototypeOf: () => { throw new Error("trap"); }, ownKeys: () => { throw new Error("trap"); } });
    const nonEnumerable = input(source); Object.defineProperty(nonEnumerable, "totalItbisEvidence", { enumerable: false });
    const inherited: object = Object.create(input(source)) as object;
    for (const candidate of [null, [], {}, { ...input(source), extra: true }, symbol, accessor, proxy, revoked.proxy, throwingProxy, Object.setPrototypeOf(input(source), {}), nonEnumerable, inherited, { ...input(source), exemptAmountEvidence: undefined }, { ...input(source), additionalTaxClassificationEvidence: undefined }, { ...input(source), exemptAmountEvidence: {} }]) {
      expect(() => rootApi.createEcf31DerivedHeaderTotalsEvidence(candidate)).not.toThrow();
      expect(rootApi.createEcf31DerivedHeaderTotalsEvidence(candidate)).toMatchObject({ ok: false });
    }
  });

  it("contains aggregate overflow as a composition failure", () => {
    const source = fixture([[1, "900000000000000000"], [4, "200000000000000000"]]);
    expect(rootApi.createEcf31DerivedHeaderTotalsEvidence(input(source))).toMatchObject({ ok: false, error: { code: "ECF31_DERIVED_HEADER_TOTALS_COMPOSITION_FAILED" } });
  });

  it("is immutable nominal evidence and publicly exported", () => {
    const output = value(rootApi.createEcf31DerivedHeaderTotalsEvidence(input(fixture([[1, "1"]]))));
    expect(Object.isFrozen(output)).toBe(true);
    expect(rootApi.isEcf31DerivedHeaderTotalsEvidence(output)).toBe(true);
    expect(rootApi.isEcf31DerivedHeaderTotalsEvidence({ ...output })).toBe(false);
    expect(builderApi.createEcf31DerivedHeaderTotalsEvidence).toBe(rootApi.createEcf31DerivedHeaderTotalsEvidence);
    expectTypeOf<typeof output>().toExtend<rootApi.Ecf31DerivedHeaderTotalsEvidence>();
  });
});

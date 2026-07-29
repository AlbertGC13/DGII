import { describe, expect, it } from "vitest";

import * as rootApi from "../../../index.js";
import * as builderApi from "../index.js";

const { captureLineCalculationEvidence, createEcf31CoreLine, createEcf31LineAmountEvidence, formatDecimal, parseLineSequence, parseNonnegativeAmount, parseNonnegativeQuantity, parseUnitPrice } = rootApi;

function value<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false }): T {
  if (!result.ok) throw new Error("Expected a successful result.");
  return result.value;
}

function coreLine(computed = "10", declared = "10") {
  const evidence = value(captureLineCalculationEvidence({ sequence: value(parseLineSequence("1")), quantity: value(parseNonnegativeQuantity("1")), unitPrice: value(parseUnitPrice(computed)), declaredAmount: value(parseNonnegativeAmount(declared)) }));
  return value(createEcf31CoreLine({ evidence, itemName: "Synthetic item", billingIndicator: 0, goodOrServiceIndicator: 1 }));
}
function amount(input: string) { return value(parseNonnegativeAmount(input)); }

describe("e-CF 31 line amount evidence", () => {
  it.each([
    ["10", "10", "0", "0", "10", "0"], ["10", "10", "2.25", "0", "7.75", "2.25"],
    ["10", "10", "0", "2.25", "12.25", "-2.25"], ["10", "12", "2.25", "1.5", "9.25", "2.75"],
    ["1", "0", "1", "0", "0", "0"], ["1", "0", "2", "0", "-1", "1"],
  ])("calculates exact adjusted amounts and deltas", (computed, declared, discount, surcharge, adjusted, delta) => {
    const result = createEcf31LineAmountEvidence({ coreLine: coreLine(computed, declared), discountAmount: amount(discount), surchargeAmount: amount(surcharge) });
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(formatDecimal(result.value.adjustedAmount)).toBe(adjusted);
    expect(formatDecimal(result.value.delta)).toBe(delta);
  });

  it("preserves source objects and adjustments in an immutable private value", () => {
    const source = coreLine(); const discountAmount = amount("2"); const surchargeAmount = amount("1");
    const result = value(createEcf31LineAmountEvidence({ coreLine: source, discountAmount, surchargeAmount }));
    expect(result.coreLine).toBe(source);
    expect(result.computedBase).toBe(source.evidence.computedAmount);
    expect(result.declaredAmount).toBe(source.evidence.declaredAmount);
    expect(result.discountAmount).toBe(discountAmount);
    expect(result.surchargeAmount).toBe(surchargeAmount);
    expect(Object.isFrozen(result)).toBe(true);
    expect(rootApi.isEcf31LineAmountEvidence(result)).toBe(true);
    expect(rootApi.isEcf31LineAmountEvidence({ ...result })).toBe(false);
  });

  it.each([
    [null, "INVALID_LINE_AMOUNT_INPUT"], ["amount", "INVALID_LINE_AMOUNT_INPUT"],
    [{ coreLine: { ...coreLine() }, discountAmount: amount("0"), surchargeAmount: amount("0") }, "INVALID_LINE_AMOUNT_CORE_LINE"],
    [{ coreLine: coreLine(), discountAmount: amount("0"), surchargeAmount: {} }, "INVALID_LINE_AMOUNT_DECIMAL"],
  ])("returns catalog errors for invalid inputs", (input, code) => {
    expect(() => createEcf31LineAmountEvidence(input)).not.toThrow();
    expect(createEcf31LineAmountEvidence(input)).toMatchObject({ ok: false, error: { code } });
  });

  it("rejects wrong profiles, negatives, forged decimals, and hostile reads safely", () => {
    const zero = amount("0"); const negative = rootApi.subtractDecimals(zero, amount("0.01"));
    const tooPrecise = rootApi.multiplyDecimals(amount("0.01"), amount("0.01"));
    const throwing = new Proxy({}, { get: () => { throw new Error("trap"); } });
    const revoked = Proxy.revocable({}, {}); revoked.revoke();
    for (const input of [
      { coreLine: coreLine(), discountAmount: value(parseUnitPrice("1")), surchargeAmount: zero },
      { coreLine: coreLine(), discountAmount: negative, surchargeAmount: zero },
      { coreLine: coreLine(), discountAmount: tooPrecise, surchargeAmount: zero },
      { coreLine: coreLine(), discountAmount: Object.freeze({}), surchargeAmount: zero }, throwing, revoked.proxy,
      { get coreLine() { throw new Error("trap"); } },
    ]) expect(() => createEcf31LineAmountEvidence(input)).not.toThrow();
  });
});

describe("e-CF 31 line amount evidence exports", () => {
  it("exports the factory and predicate from Builder and package root", () => {
    expect(builderApi.createEcf31LineAmountEvidence).toBe(rootApi.createEcf31LineAmountEvidence);
    expect(builderApi.isEcf31LineAmountEvidence).toBe(rootApi.isEcf31LineAmountEvidence);
  });
});

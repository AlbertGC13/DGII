import { describe, expect, it } from "vitest";

import * as rootApi from "../../../index.js";
import * as builderApi from "../index.js";
import type { DecimalError, ExactDecimal, Result } from "../../../index.js";

const {
  captureLineCalculationEvidence,
  createEcf31CoreLine,
  createEcf31LineAmountEvidence,
  formatDecimal,
  parseLineSequence,
  parseNonnegativeAmount,
  parseNonnegativeQuantity,
  parseUnitPrice,
} = rootApi;

function value<T>(result: Result<T, unknown>): T {
  if (!result.ok) throw new Error("Expected a successful result.");
  return result.value;
}

function lineAmount(
  unitPrice: string,
  quantity = "1",
  discountAmount = "0",
  surchargeAmount = "0",
) {
  const evidence = value(captureLineCalculationEvidence({
    sequence: value(parseLineSequence("1")),
    quantity: value(parseNonnegativeQuantity(quantity)),
    unitPrice: value(parseUnitPrice(unitPrice)),
    declaredAmount: value(parseNonnegativeAmount("0")),
  }));
  const coreLine = value(createEcf31CoreLine({
    evidence,
    itemName: "Synthetic item",
    billingIndicator: 0,
    goodOrServiceIndicator: 1,
  }));
  return value(createEcf31LineAmountEvidence({
    coreLine,
    discountAmount: value(parseNonnegativeAmount(discountAmount)),
    surchargeAmount: value(parseNonnegativeAmount(surchargeAmount)),
  }));
}

function expectDecimalError(result: Result<unknown, DecimalError>, code: DecimalError["code"]): void {
  expect(result).toMatchObject({ ok: false, error: { code } });
}

describe("e-CF 31 MontoItem quantization evidence", () => {
  it.each([
    ["750.5212", "750.52"],
    ["750.5276", "750.53"],
    ["1.005", "1.01"],
    ["1.0049", "1"],
    ["999.999", "1000"],
    ["0", "0"],
    ["1.2", "1.2"],
    ["1.23", "1.23"],
  ])("quantizes only the final adjusted amount %s to %s", (unitPrice, expected) => {
    const source = lineAmount(unitPrice);
    const result = rootApi.createEcf31MontoItemQuantizationEvidence(source);

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(formatDecimal(result.value.quantizedAmount)).toBe(expected);
    expect(result.value.sourceEvidence).toBe(source);
    expect(result.value.adjustedAmount).toBe(source.adjustedAmount);
    expect(result.value.policyId).toBe("ecf31-monto-item-half-up-v1");
  });

  it("preserves provenance in an immutable private value", () => {
    const source = lineAmount("1.005");
    const result = value(rootApi.createEcf31MontoItemQuantizationEvidence(source));

    expect(Object.isFrozen(result)).toBe(true);
    expect(rootApi.isEcf31MontoItemQuantizationEvidence(result)).toBe(true);
    expect(rootApi.isEcf31MontoItemQuantizationEvidence({ ...result })).toBe(false);
    expect(rootApi.isEcf31MontoItemQuantizationEvidence(null)).toBe(false);
  });

  it("rejects negative adjusted amounts and structural or hostile sources safely", () => {
    const negative = lineAmount("1", "1", "2");
    const genuine = lineAmount("1");
    const throwing = new Proxy({}, { get: () => { throw new Error("trap"); } });
    const revoked = Proxy.revocable({}, {}); revoked.revoke();

    for (const input of [negative, { ...genuine }, throwing, revoked.proxy, null, "amount"]) {
      expect(() => rootApi.createEcf31MontoItemQuantizationEvidence(input)).not.toThrow();
      expect(rootApi.createEcf31MontoItemQuantizationEvidence(input)).toMatchObject({ ok: false });
    }
  });

  it("returns profile overflow after a half-up carry without float conversion", () => {
    const source = lineAmount("1.0001", "999999999999999999");

    expect(rootApi.createEcf31MontoItemQuantizationEvidence(source)).toMatchObject({
      ok: false,
      error: { code: "PRECISION_EXCEEDED" },
    });
  });
});

describe("nonnegative amount half-up quantization", () => {
  it("rejects forged and negative exact-decimal values through catalog errors", () => {
    const zero = value(parseNonnegativeAmount("0"));
    const negative = rootApi.subtractDecimals(zero, value(parseNonnegativeAmount("0.01")));
    const forged = Object.freeze({}) as ExactDecimal;

    expectDecimalError(rootApi.quantizeNonnegativeAmountHalfUp(negative), "OUT_OF_RANGE");
    expectDecimalError(rootApi.quantizeNonnegativeAmountHalfUp(forged), "INVALID_DECIMAL");
  });
});

describe("e-CF 31 MontoItem quantization exports", () => {
  it("exports the factory, predicate, and exact primitive from Builder and package root", () => {
    expect(builderApi.createEcf31MontoItemQuantizationEvidence).toBe(rootApi.createEcf31MontoItemQuantizationEvidence);
    expect(builderApi.quantizeNonnegativeAmountHalfUp).toBe(rootApi.quantizeNonnegativeAmountHalfUp);
  });
});

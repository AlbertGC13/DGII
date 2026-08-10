import { describe, expect, it } from "vitest";

import * as rootApi from "../../../index.js";
import type { DecimalError, ExactDecimal, Result } from "../../../index.js";
import * as builderApi from "../index.js";

const {
  absoluteDecimal,
  addDecimals,
  allocateProportionalAmountHalfUp,
  compareDecimals,
  formatDecimal,
  isExactDecimal,
  multiplyDecimals,
  multiplyDecimalByCount,
  parseNonnegativeAmount,
  parseNonnegativeQuantity,
  parseNonnegativeSubquantity,
  parseEcf31AlcoholDegrees,
  parsePositiveAmount,
  parsePositivePercentage,
  parsePositiveQuantity,
  parseUnitPrice,
  revalidateNonnegativeAmount,
  revalidateNonnegativeQuantity,
  revalidateNonnegativeSubquantity,
  revalidateEcf31AlcoholDegrees,
  revalidatePositiveAmount,
  revalidatePositivePercentage,
  revalidatePositiveQuantity,
  revalidateUnitPrice,
  subtractDecimals,
} = rootApi;

const DECIMAL_ERROR_MESSAGES = {
  INVALID_DECIMAL: "Value must be a genuine exact decimal.",
  INVALID_TYPE: "Decimal input must be a string.",
  INVALID_LEXICAL_FORM: "Decimal input does not use the required canonical-input syntax.",
  SCALE_EXCEEDED: "Decimal input exceeds the target scale.",
  PRECISION_EXCEEDED: "Decimal input exceeds the target precision.",
  OUT_OF_RANGE: "Decimal value is outside the target range.",
} as const satisfies Record<DecimalError["code"], string>;

function expectValue(result: Result<ExactDecimal, DecimalError>): ExactDecimal {
  expect(result.ok).toBe(true);

  if (!result.ok) {
    throw new Error("Expected a successful decimal result.");
  }

  return result.value;
}

function expectErrorCode(
  result: Result<unknown, DecimalError>,
  code: DecimalError["code"],
): void {
  expect(result.ok).toBe(false);

  if (result.ok) {
    throw new Error("Expected a failed decimal result.");
  }

  expect(result.error).toEqual({
    code,
    message: DECIMAL_ERROR_MESSAGES[code],
  });
}

describe("Builder decimal profiles", () => {
  it("parses and revalidates the exact positive Decimal5D1or2 alcohol boundary", () => {
    const maximum = expectValue(parseEcf31AlcoholDegrees("999.99"));
    const tooLarge = addDecimals(maximum, expectValue(parseEcf31AlcoholDegrees("0.01")));

    expect(formatDecimal(maximum)).toBe("999.99");
    expectErrorCode(parseEcf31AlcoholDegrees("0"), "OUT_OF_RANGE");
    expectErrorCode(parseEcf31AlcoholDegrees("1000"), "PRECISION_EXCEEDED");
    expectErrorCode(parseEcf31AlcoholDegrees("1.001"), "SCALE_EXCEEDED");
    expectErrorCode(revalidateEcf31AlcoholDegrees(tooLarge), "PRECISION_EXCEEDED");
    expectErrorCode(revalidateEcf31AlcoholDegrees(Object.freeze({}) as ExactDecimal), "INVALID_DECIMAL");
  });

  it("parses the exact nonnegative Decimal19D1or3 subquantity boundary", () => {
    const subquantity = expectValue(parseNonnegativeSubquantity("9999999999999999.999"));

    expect(formatDecimal(subquantity)).toBe("9999999999999999.999");
    expect(Object.isFrozen(subquantity)).toBe(true);
    expect(Object.keys(subquantity)).toEqual([]);
  });

  it.each([
    ["negative", "-0.001", "INVALID_LEXICAL_FORM"],
    ["too many fractional digits", "1.0001", "SCALE_EXCEEDED"],
    ["too many integer digits", "10000000000000000", "PRECISION_EXCEEDED"],
    ["total-digit overflow", "9999999999999999.9999", "SCALE_EXCEEDED"],
    ["leading whitespace", " 1", "INVALID_LEXICAL_FORM"],
    ["trailing whitespace", "1 ", "INVALID_LEXICAL_FORM"],
    ["plus sign", "+1", "INVALID_LEXICAL_FORM"],
    ["exponent", "1e3", "INVALID_LEXICAL_FORM"],
    ["comma", "1,1", "INVALID_LEXICAL_FORM"],
    ["grouping", "1,000.1", "INVALID_LEXICAL_FORM"],
    ["Unicode digits", "１２.３", "INVALID_LEXICAL_FORM"],
    ["missing integral", ".1", "INVALID_LEXICAL_FORM"],
    ["empty fraction", "1.", "INVALID_LEXICAL_FORM"],
  ] as const)("rejects nonnegative subquantity %s", (_case, input, code) => {
    expectErrorCode(parseNonnegativeSubquantity(input), code);
  });

  it("revalidates only genuine in-profile exact decimals without rounding", () => {
    const valid = expectValue(parseNonnegativeSubquantity("0.001"));
    const tooPrecise = multiplyDecimals(valid, valid);
    const maximum = expectValue(parseNonnegativeSubquantity("9999999999999999.999"));
    const tooLarge = addDecimals(maximum, expectValue(parseNonnegativeSubquantity("0.001")));
    const negative = subtractDecimals(valid, expectValue(parseNonnegativeSubquantity("1")));
    const forged = Object.freeze({}) as ExactDecimal;

    expect(formatDecimal(expectValue(revalidateNonnegativeSubquantity(valid)))).toBe("0.001");
    expectErrorCode(revalidateNonnegativeSubquantity(tooPrecise), "SCALE_EXCEEDED");
    expectErrorCode(revalidateNonnegativeSubquantity(tooLarge), "PRECISION_EXCEEDED");
    expectErrorCode(revalidateNonnegativeSubquantity(negative), "OUT_OF_RANGE");
    expect(() => revalidateNonnegativeSubquantity(forged)).not.toThrow();
    expectErrorCode(revalidateNonnegativeSubquantity(forged), "INVALID_DECIMAL");
  });

  it("parses the exact positive Decimal5D1or2 percentage boundary", () => {
    const percentage = expectValue(parsePositivePercentage("999.99"));

    expect(formatDecimal(percentage)).toBe("999.99");
    expect(Object.isFrozen(percentage)).toBe(true);
  });

  it("canonicalizes accepted positive percentage input deterministically", () => {
    expect(formatDecimal(expectValue(parsePositivePercentage("000.10")))).toBe("0.1");
  });

  it.each([
    ["zero", "0", "OUT_OF_RANGE"],
    ["negative", "-0.01", "INVALID_LEXICAL_FORM"],
    ["overprecision", "0.001", "SCALE_EXCEEDED"],
    ["four integer digits", "1000", "PRECISION_EXCEEDED"],
    ["six total digits", "999.999", "SCALE_EXCEEDED"],
    ["padded whitespace", " 1", "INVALID_LEXICAL_FORM"],
    ["exponent", "1e2", "INVALID_LEXICAL_FORM"],
  ] as const)("rejects positive percentage %s", (_case, input, code) => {
    expectErrorCode(parsePositivePercentage(input), code);
  });

  it("rejects nonstring and hostile percentage inputs safely", () => {
    const throwing = new Proxy({}, { get: () => { throw new Error("trap"); } });
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();

    for (const input of [1, null, undefined, {}, throwing, revoked.proxy]) {
      expect(() => parsePositivePercentage(input)).not.toThrow();
      expectErrorCode(parsePositivePercentage(input), "INVALID_TYPE");
    }
  });

  it("revalidates exact positive percentages without rounding", () => {
    const valid = expectValue(parsePositivePercentage("0.01"));
    const zero = subtractDecimals(valid, valid);
    const tooPrecise = multiplyDecimals(valid, valid);
    const tooLarge = addDecimals(expectValue(parsePositivePercentage("999.99")), valid);

    expect(formatDecimal(expectValue(revalidatePositivePercentage(valid)))).toBe("0.01");
    expectErrorCode(revalidatePositivePercentage(zero), "OUT_OF_RANGE");
    expectErrorCode(revalidatePositivePercentage(tooPrecise), "SCALE_EXCEEDED");
    expectErrorCode(revalidatePositivePercentage(tooLarge), "PRECISION_EXCEEDED");
  });

  it.each([
    ["nonnegative amount", parseNonnegativeAmount, "9999999999999999.99"],
    ["positive amount", parsePositiveAmount, "9999999999999999.99"],
    ["nonnegative quantity", parseNonnegativeQuantity, "9999999999999999.99"],
    ["positive quantity", parsePositiveQuantity, "9999999999999999.99"],
    ["unit price", parseUnitPrice, "9999999999999999.9999"],
  ] as const)("accepts the %s upper lexical boundary", (_case, parse, input) => {
    expect(formatDecimal(expectValue(parse(input)))).toBe(input);
  });


  it.each([
    ["nonnegative amount", parseNonnegativeAmount, "999999999999999999", "1000000000000000000"],
    ["nonnegative quantity", parseNonnegativeQuantity, "999999999999999999", "1000000000000000000"],
    ["unit price", parseUnitPrice, "99999999999999999999", "100000000000000000000"],
  ] as const)("accepts the %s scale-zero total-digit boundary", (_case, parse, maximum, overflow) => {
    expect(formatDecimal(expectValue(parse(maximum)))).toBe(maximum);
    expectErrorCode(parse(overflow), "PRECISION_EXCEEDED");
  });

  it("permits zero in every nonnegative profile", () => {
    expect(formatDecimal(expectValue(parseNonnegativeAmount("0")))).toBe("0");
    expect(formatDecimal(expectValue(parseNonnegativeQuantity("0.00")))).toBe("0");
    expect(formatDecimal(expectValue(parseUnitPrice("000.0000")))).toBe("0");
  });

  it("normalizes leading and trailing zero forms to one canonical value", () => {
    const value = expectValue(parseNonnegativeAmount("000000000001.20"));

    expect(formatDecimal(value)).toBe("1.2");
    expect(Object.isFrozen(value)).toBe(true);
  });

  it("rejects over-width zero and leading-zero lexical forms before normalization", () => {
    expectErrorCode(parseNonnegativeAmount("0000000000000000000"), "PRECISION_EXCEEDED");
    expectErrorCode(parseNonnegativeAmount("0000000000000000001"), "PRECISION_EXCEEDED");
  });

  it.each(["0", "00", "0.0", "00.00"])(
    "rejects positive-profile zero written as %s",
    (input) => {
      expectErrorCode(parsePositiveAmount(input), "OUT_OF_RANGE");
      expectErrorCode(parsePositiveQuantity(input), "OUT_OF_RANGE");
    },
  );

  it.each([
    ["leading whitespace", " 1"],
    ["trailing whitespace", "1 "],
    ["plus sign", "+1"],
    ["minus sign", "-1"],
    ["exponent", "1e2"],
    ["comma decimal separator", "1,2"],
    ["grouping separator", "1,000.00"],
    ["Unicode digits", "１２.３"],
    ["empty fraction", "1."],
    ["missing integral component", ".1"],
    ["empty input", ""],
  ])("rejects %s as a malformed Builder input", (_case, input) => {
    const result = parseNonnegativeAmount(input);

    expectErrorCode(result, "INVALID_LEXICAL_FORM");
    if (input.length > 0) {
      expect(JSON.stringify(result)).not.toContain(input);
    }
  });

  it("rejects JavaScript numbers at the strict string boundary", () => {
    expectErrorCode(parseNonnegativeAmount(0.1), "INVALID_TYPE");
    expectErrorCode(parseUnitPrice(1), "INVALID_TYPE");
  });

  it("distinguishes scale and precision overflow", () => {
    expectErrorCode(parseNonnegativeAmount("1.001"), "SCALE_EXCEEDED");
    expectErrorCode(parseUnitPrice("1.00001"), "SCALE_EXCEEDED");
    expectErrorCode(parseNonnegativeQuantity("1000000000000000000"), "PRECISION_EXCEEDED");
    expectErrorCode(parseUnitPrice("100000000000000000000"), "PRECISION_EXCEEDED");
  });

  it.each([
    ["scale", "1.001", "SCALE_EXCEEDED"],
    ["precision", "1000000000000000000", "PRECISION_EXCEEDED"],
  ] as const)("does not echo rejected input for %s failures", (_case, input, code) => {
    const result = parseNonnegativeAmount(input);

    expectErrorCode(result, code);
    expect(JSON.stringify(result)).not.toContain(input);
  });
});

describe("exact decimal arithmetic", () => {
  it("adds 0.1 and 0.2 exactly", () => {
    const left = expectValue(parseNonnegativeAmount("0.1"));
    const right = expectValue(parseNonnegativeAmount("0.2"));

    expect(formatDecimal(addDecimals(left, right))).toBe("0.3");
  });

  it("aligns mixed scales for addition and subtraction", () => {
    const left = expectValue(parseNonnegativeAmount("1.2"));
    const right = expectValue(parseNonnegativeAmount("0.03"));

    expect(formatDecimal(addDecimals(left, right))).toBe("1.23");
    expect(formatDecimal(subtractDecimals(left, right))).toBe("1.17");
  });

  it("preserves values above Number.MAX_SAFE_INTEGER", () => {
    const left = expectValue(parseNonnegativeAmount("9999999999999999.99"));
    const right = expectValue(parseNonnegativeAmount("9999999999999999.99"));

    expect(formatDecimal(addDecimals(left, right))).toBe("19999999999999999.98");
  });

  it("compares equivalent scales by exact value", () => {
    const integer = expectValue(parseNonnegativeAmount("1"));
    const decimal = expectValue(parseNonnegativeAmount("1.00"));
    const larger = expectValue(parseUnitPrice("1.0001"));

    expect(compareDecimals(integer, decimal)).toBe(0);
    expect(compareDecimals(integer, larger)).toBe(-1);
    expect(compareDecimals(larger, decimal)).toBe(1);
  });

  it("subtracts and multiplies without floating-point conversion", () => {
    const two = expectValue(parseNonnegativeAmount("2"));
    const threeTenths = expectValue(parseNonnegativeAmount("0.3"));

    expect(formatDecimal(subtractDecimals(threeTenths, two))).toBe("-1.7");
    expect(formatDecimal(multiplyDecimals(two, threeTenths))).toBe("0.6");
  });

  it("computes genuine exact values and validates safe count operands", () => {
    const two = expectValue(parseNonnegativeAmount("2"));
    const negative = subtractDecimals(expectValue(parseNonnegativeAmount("0")), two);

    const absolute = expectValue(absoluteDecimal(negative));
    expect(formatDecimal(absolute)).toBe("2");
    expect(isExactDecimal(absolute)).toBe(true);
    expect(formatDecimal(expectValue(absoluteDecimal(two)))).toBe("2");
    const countProduct = expectValue(multiplyDecimalByCount(two, 3));
    expect(formatDecimal(countProduct)).toBe("6");
    expect(isExactDecimal(countProduct)).toBe(true);
    expectErrorCode(absoluteDecimal({}), "INVALID_DECIMAL");
    expectErrorCode(multiplyDecimalByCount({} as unknown, 1n), "INVALID_DECIMAL");
    expectErrorCode(multiplyDecimalByCount(two, "3"), "OUT_OF_RANGE");
    expectErrorCode(multiplyDecimalByCount(two, -1n), "OUT_OF_RANGE");
    expectErrorCode(multiplyDecimalByCount(two, 1.5), "OUT_OF_RANGE");

    const maximum = expectValue(parseNonnegativeAmount("999999999999999999"));
    const overflow = expectValue(multiplyDecimalByCount(maximum, 2));
    expectErrorCode(revalidateNonnegativeAmount(overflow), "PRECISION_EXCEEDED");
  });

  it("fails target revalidation rather than rounding or truncating", () => {
    const oneCent = expectValue(parseNonnegativeAmount("0.01"));
    const tooPrecise = multiplyDecimals(oneCent, oneCent);
    const maximum = expectValue(parseNonnegativeAmount("999999999999999999"));
    const tooLarge = addDecimals(maximum, expectValue(parseNonnegativeAmount("1")));
    const unitPriceMaximum = expectValue(parseUnitPrice("99999999999999999999"));
    const unitPriceTooLarge = addDecimals(unitPriceMaximum, expectValue(parseNonnegativeAmount("1")));
    const negative = subtractDecimals(oneCent, maximum);

    expect(formatDecimal(tooPrecise)).toBe("0.0001");
    expectErrorCode(revalidateNonnegativeAmount(tooPrecise), "SCALE_EXCEEDED");
    expectErrorCode(revalidateNonnegativeQuantity(tooPrecise), "SCALE_EXCEEDED");
    expectValue(revalidateUnitPrice(tooPrecise));

    expectErrorCode(revalidatePositiveAmount(tooLarge), "PRECISION_EXCEEDED");
    expectErrorCode(revalidatePositiveQuantity(tooLarge), "PRECISION_EXCEEDED");
    expectErrorCode(revalidateUnitPrice(unitPriceTooLarge), "PRECISION_EXCEEDED");

    expectErrorCode(revalidateNonnegativeAmount(negative), "OUT_OF_RANGE");
    expectErrorCode(revalidatePositiveAmount(negative), "OUT_OF_RANGE");
  });

  it("rejects multiplication precision overflow while scale remains valid", () => {
    const maximum = expectValue(parseNonnegativeAmount("9999999999999999.99"));
    const two = expectValue(parseNonnegativeAmount("2"));
    const product = multiplyDecimals(maximum, two);

    expect(formatDecimal(product)).toBe("19999999999999999.98");
    expectErrorCode(revalidateNonnegativeAmount(product), "PRECISION_EXCEEDED");
  });

  it("rejects exact zero when revalidating into positive profiles", () => {
    const one = expectValue(parsePositiveAmount("1"));
    const zero = subtractDecimals(one, one);

    expectErrorCode(revalidatePositiveAmount(zero), "OUT_OF_RANGE");
    expectErrorCode(revalidatePositiveQuantity(zero), "OUT_OF_RANGE");
  });

  it("rejects objects forged as exact decimals", () => {
    const forged = Object.freeze({}) as ExactDecimal;

    expect(() => formatDecimal(forged)).toThrow(
      new TypeError("Value is not an ExactDecimal."),
    );
    expect(() => revalidateNonnegativeAmount(forged)).toThrow(
      new TypeError("Value is not an ExactDecimal."),
    );
  });
});

describe("proportional amount allocation", () => {
  it("allocates common-cent ratios with exact half-up rounding", () => {
    const total = expectValue(parseNonnegativeAmount("1"));
    const one = expectValue(parseNonnegativeAmount("1"));

    expect(formatDecimal(expectValue(allocateProportionalAmountHalfUp(total, one, expectValue(parsePositiveAmount("3")))))).toBe("0.33");
    expect(formatDecimal(expectValue(allocateProportionalAmountHalfUp(total, one, expectValue(parsePositiveAmount("8")))))).toBe("0.13");
    expect(formatDecimal(expectValue(allocateProportionalAmountHalfUp(total, one, expectValue(parsePositiveAmount("6")))))).toBe("0.17");
  });

  it("preserves zero, exact ratios, and charge ratios above one", () => {
    const zero = expectValue(parseNonnegativeAmount("0"));
    const ten = expectValue(parseNonnegativeAmount("10"));
    const twenty = expectValue(parseNonnegativeAmount("20"));

    expect(formatDecimal(expectValue(allocateProportionalAmountHalfUp(zero, twenty, expectValue(parsePositiveAmount("3")))))).toBe("0");
    expect(formatDecimal(expectValue(allocateProportionalAmountHalfUp(ten, ten, expectValue(parsePositiveAmount("10")))))).toBe("10");
    expect(formatDecimal(expectValue(allocateProportionalAmountHalfUp(ten, twenty, expectValue(parsePositiveAmount("10")))))).toBe("20");
  });

  it("handles large exact values and returns only opaque valid amounts", () => {
    const total = expectValue(parseNonnegativeAmount("999999999999999999"));
    const result = allocateProportionalAmountHalfUp(
      total,
      expectValue(parseNonnegativeAmount("1")),
      expectValue(parsePositiveAmount("3")),
    );

    expect(formatDecimal(expectValue(result))).toBe("333333333333333333");
    expect(Object.keys(expectValue(result))).toEqual([]);
    expect(Object.isFrozen(expectValue(result))).toBe(true);
  });

  it("returns safe decimal errors for invalid operands and output overflow", () => {
    const one = expectValue(parseNonnegativeAmount("1"));
    const zero = expectValue(parseNonnegativeAmount("0"));
    const negative = subtractDecimals(zero, one);
    const tooPrecise = multiplyDecimals(expectValue(parseNonnegativeAmount("0.01")), expectValue(parseNonnegativeAmount("0.01")));
    const maximum = expectValue(parseNonnegativeAmount("999999999999999999"));

    expectErrorCode(allocateProportionalAmountHalfUp({}, one, expectValue(parsePositiveAmount("1"))), "INVALID_DECIMAL");
    expectErrorCode(allocateProportionalAmountHalfUp(negative, one, expectValue(parsePositiveAmount("1"))), "OUT_OF_RANGE");
    expectErrorCode(allocateProportionalAmountHalfUp(one, negative, expectValue(parsePositiveAmount("1"))), "OUT_OF_RANGE");
    expectErrorCode(allocateProportionalAmountHalfUp(tooPrecise, one, expectValue(parsePositiveAmount("1"))), "SCALE_EXCEEDED");
    expectErrorCode(allocateProportionalAmountHalfUp(one, one, zero), "OUT_OF_RANGE");
    expectErrorCode(allocateProportionalAmountHalfUp(maximum, expectValue(parseNonnegativeAmount("2")), expectValue(parsePositiveAmount("1"))), "PRECISION_EXCEEDED");
  });
});

describe("Builder exports", () => {
  it("exports the Builder API from both the module and package root", () => {
    expect(builderApi.parseNonnegativeAmount).toBe(rootApi.parseNonnegativeAmount);
    expect(builderApi.allocateProportionalAmountHalfUp).toBe(rootApi.allocateProportionalAmountHalfUp);
    expect(builderApi.revalidateUnitPrice).toBe(rootApi.revalidateUnitPrice);
    expect(builderApi.formatDecimal).toBe(rootApi.formatDecimal);
    expect(builderApi.parsePositivePercentage).toBe(rootApi.parsePositivePercentage);
    expect(builderApi.revalidatePositivePercentage).toBe(rootApi.revalidatePositivePercentage);
    expect(builderApi.parseNonnegativeSubquantity).toBe(rootApi.parseNonnegativeSubquantity);
    expect(builderApi.revalidateNonnegativeSubquantity).toBe(rootApi.revalidateNonnegativeSubquantity);
  });
});

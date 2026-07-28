import { describe, expect, it } from "vitest";

import * as rootApi from "../../../index.js";
import type { DecimalError, ExactDecimal, Result } from "../../../index.js";
import * as builderApi from "../index.js";

const {
  addDecimals,
  compareDecimals,
  formatDecimal,
  multiplyDecimals,
  parseNonnegativeAmount,
  parseNonnegativeQuantity,
  parsePositiveAmount,
  parsePositiveQuantity,
  parseUnitPrice,
  revalidateNonnegativeAmount,
  revalidateNonnegativeQuantity,
  revalidatePositiveAmount,
  revalidatePositiveQuantity,
  revalidateUnitPrice,
  subtractDecimals,
} = rootApi;

const DECIMAL_ERROR_MESSAGES = {
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

describe("Builder exports", () => {
  it("exports the Builder API from both the module and package root", () => {
    expect(builderApi.parseNonnegativeAmount).toBe(rootApi.parseNonnegativeAmount);
    expect(builderApi.revalidateUnitPrice).toBe(rootApi.revalidateUnitPrice);
    expect(builderApi.formatDecimal).toBe(rootApi.formatDecimal);
  });
});

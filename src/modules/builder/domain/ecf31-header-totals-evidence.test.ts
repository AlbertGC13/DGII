import { describe, expect, expectTypeOf, it } from "vitest";

import * as rootApi from "../../../index.js";
import * as builderApi from "../index.js";
import type { Ecf31HeaderTotalsInput, ExactDecimal, NonnegativeAmount, Result } from "../../../index.js";

function value<T>(result: Result<T, unknown>): T {
  if (!result.ok) throw new Error("Expected a successful result.");
  return result.value;
}

function amount(input: string): NonnegativeAmount {
  return value(rootApi.parseNonnegativeAmount(input));
}

function totals(input: Record<string, unknown>) {
  return rootApi.createEcf31HeaderTotalsEvidence(input);
}

describe("e-CF 31 header totals evidence", () => {
  it.each([
    [{ montoGravadoI1: amount("10.10"), totalItbis1: amount("1.82") }, "10.1", "1.82", "11.92"],
    [{ montoGravadoI1: amount("10"), montoGravadoI2: amount("20.20"), totalItbis1: amount("1.8"), totalItbis2: amount("3.64") }, "30.2", "5.44", "35.64"],
    [{ montoGravadoI1: amount("1.01"), montoGravadoI2: amount("2.02"), montoGravadoI3: amount("3.03"), totalItbis1: amount("0.18"), totalItbis2: amount("0.36"), totalItbis3: amount("0.54") }, "6.06", "1.08", "7.14"],
  ])("composes one, two, and three present rate components exactly", (input, taxable, itbis, total) => {
    const result = value(totals(input));

    expect(rootApi.formatDecimal(result.montoGravadoTotal)).toBe(taxable);
    expect(rootApi.formatDecimal(result.totalItbis)).toBe(itbis);
    expect(rootApi.formatDecimal(result.montoTotal)).toBe(total);
  });

  it("preserves absent components separately from present zero, including rate three", () => {
    const absent = value(totals({}));
    const taxableZero = amount("0");
    const itbisZero = amount("0");
    const presentZero = value(totals({ montoGravadoI3: taxableZero, totalItbis3: itbisZero }));

    expect("montoGravadoI3" in absent).toBe(false);
    expect("totalItbis3" in absent).toBe(false);
    expect(presentZero.montoGravadoI3).toBe(taxableZero);
    expect(presentZero.totalItbis3).toBe(itbisZero);
    expect(rootApi.formatDecimal(presentZero.montoTotal)).toBe("0");
  });

  it("composes total from only exempt amount and allows a zero total", () => {
    const exemptOnly = value(totals({ montoExento: amount("12.34") }));
    const zero = value(totals({}));

    expect(rootApi.formatDecimal(exemptOnly.montoTotal)).toBe("12.34");
    expect(rootApi.formatDecimal(zero.montoTotal)).toBe("0");
  });

  it("returns catalog errors for invalid signs and aggregate overflow", () => {
    const negative = rootApi.subtractDecimals(amount("0"), amount("0.01"));
    const maximum = amount("999999999999999999");

    expect(totals({ montoGravadoI1: negative })).toMatchObject({ ok: false, error: { code: "OUT_OF_RANGE" } });
    expect(rootApi.formatDecimal(value(totals({ montoGravadoI1: maximum })).montoGravadoTotal)).toBe("999999999999999999");
    expect(totals({ montoGravadoI1: maximum, montoGravadoI2: amount("0.01") })).toMatchObject({ ok: false, error: { code: "PRECISION_EXCEEDED" } });
    expect(totals({ totalItbis1: maximum, totalItbis2: amount("0.01") })).toMatchObject({ ok: false, error: { code: "PRECISION_EXCEEDED" } });
    expect(totals({ montoGravadoI1: maximum, montoExento: amount("0.01") })).toMatchObject({ ok: false, error: { code: "PRECISION_EXCEEDED" } });
  });

  it.each([
    "montoGravadoI1",
    "montoGravadoI2",
    "montoGravadoI3",
    "montoExento",
    "totalItbis1",
    "totalItbis2",
    "totalItbis3",
    "montoImpuestoAdicional",
  ] as const)("rejects a negative %s through a catalog error", (component) => {
    const negative = rootApi.subtractDecimals(amount("0"), amount("0.01"));

    expect(totals({ [component]: negative })).toMatchObject({ ok: false, error: { code: "OUT_OF_RANGE" } });
  });

  it("adds exact two-decimal components without rounding", () => {
    const result = value(totals({
      montoGravadoI1: amount("0.01"),
      montoGravadoI2: amount("0.02"),
      totalItbis1: amount("0.03"),
      montoImpuestoAdicional: value(rootApi.parsePositiveAmount("0.04")),
    }));

    expect(rootApi.formatDecimal(result.montoTotal)).toBe("0.1");
  });

  it("accepts immutable inputs and returns immutable genuine evidence", () => {
    const input = Object.freeze({ montoGravadoI1: amount("5") });
    const result = value(totals(input));

    expect(Object.isFrozen(input)).toBe(true);
    expect(Object.isFrozen(result)).toBe(true);
    expect(rootApi.isEcf31HeaderTotalsEvidence(result)).toBe(true);
    expect(rootApi.isEcf31HeaderTotalsEvidence({ ...result })).toBe(false);
  });

  it("does not admit retentions or informational subtotals through its input type", () => {
    type Input = Ecf31HeaderTotalsInput;

    expectTypeOf<Input>().not.toExtend<{
      totalItbisRetenido: NonnegativeAmount;
      subtotalMontoGravadoTotal: NonnegativeAmount;
    }>();
  });

  it("rejects forged, hostile, and structurally invalid inputs safely", () => {
    const forged = Object.freeze({}) as ExactDecimal;
    const throwing = new Proxy({}, { get: () => { throw new Error("trap"); } });

    for (const input of [{ montoExento: forged }, { montoImpuestoAdicional: forged }, throwing, null, "totals"]) {
      expect(() => totals(input as Record<string, unknown>)).not.toThrow();
      expect(totals(input as Record<string, unknown>)).toMatchObject({ ok: false });
    }
  });
});

describe("e-CF 31 header totals exports", () => {
  it("exports the factory and predicate from Builder and package root", () => {
    expect(builderApi.createEcf31HeaderTotalsEvidence).toBe(rootApi.createEcf31HeaderTotalsEvidence);
    expect(builderApi.isEcf31HeaderTotalsEvidence).toBe(rootApi.isEcf31HeaderTotalsEvidence);
  });
});

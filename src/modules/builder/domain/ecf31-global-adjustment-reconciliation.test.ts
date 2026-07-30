import { describe, expect, it, vi } from "vitest";

import * as rootApi from "../../../index.js";
import * as builderApi from "../index.js";
import type { Result } from "../../../index.js";

function value<T>(result: Result<T, unknown>): T {
  if (!result.ok) throw new Error("Expected a successful result.");
  return result.value;
}

function initial(globalAmount: string, ...amounts: string[]) {
  const lines = amounts.map((amount, index) => value(rootApi.createEcf31MontoItemQuantizationEvidence(
    value(rootApi.createEcf31LineAmountEvidence({
      coreLine: value(rootApi.createEcf31CoreLine({
        evidence: value(rootApi.captureLineCalculationEvidence({
          sequence: value(rootApi.parseLineSequence(String(index + 1))),
          quantity: value(rootApi.parseNonnegativeQuantity("1")),
          unitPrice: value(rootApi.parseUnitPrice(amount)),
          declaredAmount: value(rootApi.parseNonnegativeAmount("0")),
        })),
        itemName: "Synthetic item",
        billingIndicator: 0,
        goodOrServiceIndicator: 1,
      })),
      discountAmount: value(rootApi.parseNonnegativeAmount("0")),
      surchargeAmount: value(rootApi.parseNonnegativeAmount("0")),
    })),
  )));
  return value(rootApi.createEcf31GlobalAdjustmentInitialEvidence({
    globalAmount: value(rootApi.parsePositiveAmount(globalAmount)), lines,
  }));
}

function reconcile(kind: "discount" | "charge", evidence: ReturnType<typeof initial>) {
  return rootApi.createEcf31GlobalAdjustmentReconciliationEvidence({ kind, initialEvidence: evidence });
}

function allocations(result: ReturnType<typeof reconcile>): string[] {
  return value(result).entries.map((entry) => rootApi.formatDecimal(entry.finalAllocation));
}

describe("e-CF 31 global adjustment reconciliation", () => {
  it("subtracts negative residue in priority order while preserving output order", () => {
    const result = reconcile("discount", initial("0.02", "1", "1", "1", "1"));

    expect(allocations(result)).toEqual(["0", "0", "0.01", "0.01"]);
    expect(rootApi.formatDecimal(value(result).reconciledSum)).toBe("0.02");
  });

  it("adds positive residue and orders unequal bases then equal bases by sequence", () => {
    const result = reconcile("discount", initial("0.01", "1", "3", "3"));

    expect(allocations(result)).toEqual(["0", "0.01", "0"]);
    expect(value(result).entries.map((entry) => rootApi.formatDecimal(entry.reconciliationDelta))[1]).toBe("0.01");
  });

  it("reconciles residue through the priority cycle", () => {
    const result = reconcile("charge", initial("0.03", "1", "1", "1", "1"));

    expect(allocations(result)).toEqual(["0", "0.01", "0.01", "0.01"]);
    expect(rootApi.formatDecimal(value(result).originalResidue)).toBe("-0.01");
  });

  it("enforces discount capacity", () => {
    const fullyDiscounted = initial("0.01", "0.01", "0.01", "0.01");

    expect(reconcile("discount", fullyDiscounted)).toMatchObject({ ok: true });
    expect(reconcile("discount", initial("2", "1"))).toMatchObject({ ok: false, error: {
      code: "ECF31_GLOBAL_ADJUSTMENT_DISCOUNT_EXCEEDS_BASIS",
    } });
  });

  it("permits charges above basis and returns safe errors for impossible or overflow outcomes", () => {
    expect(reconcile("charge", initial("2", "1"))).toMatchObject({ ok: true });
    expect(reconcile("charge", initial("9999999999999999.99", "9999999999999999.99"))).toMatchObject({ ok: false });
  });

  it("seals genuine evidence and rejects forged or hostile outer input", () => {
    const evidence = initial("0.01", "1", "1", "1", "1");
    const result = value(reconcile("discount", evidence));
    const hostile = new Proxy({}, { ownKeys: () => { throw new Error("trap"); } });

    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.entries)).toBe(true);
    expect(result.entries.every((entry) => Object.isFrozen(entry))).toBe(true);
    expect(rootApi.isEcf31GlobalAdjustmentReconciliationEvidence(result)).toBe(true);
    expect(rootApi.isEcf31GlobalAdjustmentReconciliationEvidence({ ...result })).toBe(false);
    expect(reconcile("discount", { ...evidence })).toMatchObject({ ok: false });
    expect(rootApi.createEcf31GlobalAdjustmentReconciliationEvidence({ kind: "other", initialEvidence: evidence }))
      .toMatchObject({ ok: false });
    expect(rootApi.createEcf31GlobalAdjustmentReconciliationEvidence(hostile)).toMatchObject({ ok: false });
  });

  it("contains malformed outer shapes without invoking their accessors", () => {
    const evidence = initial("0.01", "1", "1", "1", "1");
    const accessor = { initialEvidence: evidence };
    Object.defineProperty(accessor, "kind", { enumerable: true, get: () => "discount" });
    const nonEnumerable = { kind: "discount", initialEvidence: evidence };
    Object.defineProperty(nonEnumerable, "kind", { enumerable: false });
    const inherited = { kind: "discount", initialEvidence: evidence };
    Object.setPrototypeOf(inherited, {});
    const missingDescriptor = new Proxy({ kind: "discount", initialEvidence: evidence }, {
      getOwnPropertyDescriptor: () => undefined,
    });

    for (const input of ["discount", null, [], { kind: "discount" }, { kind: "discount", initialEvidence: evidence, extra: true },
      { unexpected: "discount", initialEvidence: evidence }, accessor, nonEnumerable, inherited,
      missingDescriptor, { kind: "discount", initialEvidence: {} }]) {
      expect(rootApi.createEcf31GlobalAdjustmentReconciliationEvidence(input)).toMatchObject({ ok: false });
    }
  });

  it("returns safe errors if a forged initial boundary violates internal invariants", () => {
    const genuine = initial("0.01", "1");
    const entry = genuine.entries[0];
    if (entry === undefined) throw new Error("Expected a synthetic entry.");
    const zero = value(rootApi.parseNonnegativeAmount("0"));
    const negativeCent = rootApi.subtractDecimals(zero, value(rootApi.parseNonnegativeAmount("0.01")));
    const run = (forged: object, kind: "discount" | "charge") => {
      const spy = vi.spyOn(WeakSet.prototype, "has").mockReturnValue(true);
      try {
        return rootApi.createEcf31GlobalAdjustmentReconciliationEvidence({ kind, initialEvidence: forged });
      } finally {
        spy.mockRestore();
      }
    };

    expect(run({ ...genuine, entries: [{ ...entry, initialAllocation: zero }], signedResidue: negativeCent }, "charge"))
      .toMatchObject({ ok: false, error: { code: "ECF31_GLOBAL_ADJUSTMENT_RECONCILIATION_IMPOSSIBLE" } });
    expect(run({ ...genuine, entries: [{ ...entry, basis: zero }] }, "discount"))
      .toMatchObject({ ok: false, error: { code: "ECF31_GLOBAL_ADJUSTMENT_RECONCILIATION_IMPOSSIBLE" } });
    expect(run({ ...genuine, entries: [{ ...entry, initialAllocation: zero }] }, "charge"))
      .toMatchObject({ ok: false, error: { code: "ECF31_GLOBAL_ADJUSTMENT_RECONCILIATION_OVERFLOW" } });
    expect(run({ ...genuine, entries: [{ ...entry, initialAllocation: value(rootApi.parseNonnegativeAmount("999999999999999999")) }],
      signedResidue: value(rootApi.parseNonnegativeAmount("0.01")) }, "charge"))
      .toMatchObject({ ok: false, error: { code: "ECF31_GLOBAL_ADJUSTMENT_RECONCILIATION_OVERFLOW" } });
    const excessive = rootApi.addDecimals(value(rootApi.parseNonnegativeAmount("999999999999999999")),
      value(rootApi.parseNonnegativeAmount("0.01")));
    expect(run({ ...genuine, globalAmount: excessive, totalBasis: excessive,
      entries: [{ ...entry, basis: excessive, initialAllocation: excessive }], signedResidue: zero }, "discount"))
      .toMatchObject({ ok: false, error: { code: "ECF31_GLOBAL_ADJUSTMENT_RECONCILIATION_OVERFLOW" } });
  });
});

describe("e-CF 31 global adjustment reconciliation exports", () => {
  it("exports its factory and predicate from Builder and package root", () => {
    expect(builderApi.createEcf31GlobalAdjustmentReconciliationEvidence)
      .toBe(rootApi.createEcf31GlobalAdjustmentReconciliationEvidence);
  });
});

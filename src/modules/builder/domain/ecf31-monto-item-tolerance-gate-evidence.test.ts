import { describe, expect, it } from "vitest";

import * as rootApi from "../../../index.js";
import * as builderApi from "../index.js";
import type { Result } from "../../../index.js";

function value<T>(result: Result<T, unknown>): T {
  if (!result.ok) throw new Error("Expected a successful result.");
  return result.value;
}

function quantization(sequence: string, calculated: string) {
  const evidence = value(rootApi.captureLineCalculationEvidence({
    sequence: value(rootApi.parseLineSequence(sequence)),
    quantity: value(rootApi.parseNonnegativeQuantity("1")),
    unitPrice: value(rootApi.parseUnitPrice(calculated)),
    declaredAmount: value(rootApi.parseNonnegativeAmount("0")),
  }));
  const line = value(rootApi.createEcf31CoreLine({
    evidence,
    itemName: "Synthetic item",
    billingIndicator: 0,
    goodOrServiceIndicator: 1,
  }));
  const amount = value(rootApi.createEcf31LineAmountEvidence({
    coreLine: line,
    discountAmount: value(rootApi.parseNonnegativeAmount("0")),
    surchargeAmount: value(rootApi.parseNonnegativeAmount("0")),
  }));
  return value(rootApi.createEcf31MontoItemQuantizationEvidence(amount));
}

function entry(sequence: string, calculated: string, declared: string) {
  return Object.freeze({
    quantization: quantization(sequence, calculated),
    declaredAmount: value(rootApi.parseNonnegativeAmount(declared)),
  });
}

describe("e-CF 31 MontoItem tolerance gate evidence", () => {
  it("accepts zero and exact per-line +/- 1.00 boundaries", () => {
    const result = rootApi.createEcf31MontoItemToleranceGateEvidence({ entries: [
      entry("1", "0", "0"),
      entry("2", "11", "10"),
      entry("3", "10", "11"),
    ] });

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(rootApi.formatDecimal(result.value.aggregateSignedDelta)).toBe("0");
    expect(rootApi.formatDecimal(result.value.aggregateAbsoluteDelta)).toBe("0");
    expect(rootApi.formatDecimal(result.value.maxGlobalTolerance)).toBe("3");
    expect(result.value.policyId).toBe("ecf31-monto-item-tolerance-v1");
  });

  it("rejects a per-line delta one cent beyond the tolerance", () => {
    expect(rootApi.createEcf31MontoItemToleranceGateEvidence({ entries: [
      entry("1", "11.01", "10"),
    ] })).toMatchObject({ ok: false, error: { code: "MONTO_ITEM_TOLERANCE_PER_LINE_EXCEEDED" } });
  });

  it("uses the absolute difference of sums, not the sum of absolute line deltas", () => {
    const result = rootApi.createEcf31MontoItemToleranceGateEvidence({ entries: [
      entry("1", "11", "10"),
      entry("2", "10", "11"),
    ] });

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    const first = result.value.entries[0];
    const second = result.value.entries[1];
    if (first === undefined || second === undefined) throw new Error("Expected two entries.");
    expect(rootApi.formatDecimal(first.absoluteDelta)).toBe("1");
    expect(rootApi.formatDecimal(second.absoluteDelta)).toBe("1");
    expect(rootApi.formatDecimal(result.value.aggregateAbsoluteDelta)).toBe("0");
    // A per-line limit of 1.00 implies |sum(delta)| <= N * 1.00, so a global-only excess is impossible.
  });

  it("copies immutable output and preserves genuine provenance", () => {
    const source = entry("1", "10", "9");
    const input = { entries: [source] };
    const result = value(rootApi.createEcf31MontoItemToleranceGateEvidence(input));

    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.entries)).toBe(true);
    expect(Object.isFrozen(result.entries[0])).toBe(true);
    expect(result.entries).not.toBe(input.entries);
    expect(rootApi.isEcf31MontoItemToleranceGateEvidence(result)).toBe(true);
    expect(rootApi.isEcf31MontoItemToleranceGateEvidence({ ...result })).toBe(false);
  });

  it("rejects invalid, forged, duplicate, reordered, noncontiguous, and hostile input safely", () => {
    const first = entry("1", "10", "10");
    const second = entry("2", "10", "10");
    const gap = entry("3", "10", "10");
    const forged = Object.freeze({ ...first, quantization: { ...first.quantization } });
    const missing = Object.freeze({ quantization: first.quantization });
    const extra = Object.freeze({ ...first, unexpected: true });
    const invalidDeclared = Object.freeze({ quantization: first.quantization, declaredAmount: {} });
    const negativeDeclared = Object.freeze({ quantization: first.quantization, declaredAmount: rootApi.subtractDecimals(
      value(rootApi.parseNonnegativeAmount("0")), value(rootApi.parseNonnegativeAmount("0.01")),
    ) });
    const throwing = new Proxy({}, { get: () => { throw new Error("trap"); } });
    const throwingEntries = Object.defineProperty({}, "entries", { get: () => { throw new Error("trap"); } });
    const throwingEntry = new Proxy(first, { get: () => { throw new Error("trap"); } });
    const revokedEntries = Proxy.revocable([], {}); revokedEntries.revoke();
    const oversizedEntries = new Proxy([first], {
      get(target, key, receiver): unknown {
        return key === "length"
          ? Number.MAX_SAFE_INTEGER + 1
          : Reflect.get(target, key, receiver) as unknown;
      },
    });
    const revoked = Proxy.revocable({}, {}); revoked.revoke();

    for (const input of [
      null,
      { entries: [] },
      { entries: {} },
      { entries: [forged] },
      { entries: [missing] },
      { entries: [extra] },
      { entries: [invalidDeclared] },
      { entries: [negativeDeclared] },
      { entries: [first, first] },
      { entries: [second, first] },
      { entries: [first, gap] },
      { entries: [first], extra: true },
      throwing,
      throwingEntries,
      { entries: revokedEntries.proxy },
      { entries: oversizedEntries },
      { entries: [throwingEntry] },
      revoked.proxy,
    ]) {
      expect(() => rootApi.createEcf31MontoItemToleranceGateEvidence(input)).not.toThrow();
      expect(rootApi.createEcf31MontoItemToleranceGateEvidence(input)).toMatchObject({ ok: false });
    }
  });

  it("copies hostile arrays by bounded index without invoking their iterator", () => {
    const first = entry("1", "10", "10");
    let iteratorReads = 0;
    const entries = new Proxy([first], { get(target, key, receiver): unknown {
      if (key === Symbol.iterator) { iteratorReads += 1; throw new Error("iterator"); }
      return Reflect.get(target, key, receiver) as unknown;
    } });

    expect(rootApi.createEcf31MontoItemToleranceGateEvidence({ entries })).toMatchObject({ ok: true });
    expect(iteratorReads).toBe(0);
  });

  it("returns an overflow catalog error without leaking values", () => {
    const result = rootApi.createEcf31MontoItemToleranceGateEvidence({ entries: [
      entry("1", "9999999999999999.99", "9999999999999999.99"),
      entry("2", "9999999999999999.99", "9999999999999999.99"),
    ] });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "MONTO_ITEM_TOLERANCE_OVERFLOW",
        message: "MontoItem tolerance arithmetic exceeds the supported amount profile.",
      },
    });
  });
});

describe("e-CF 31 MontoItem tolerance gate exports", () => {
  it("exports the factory and predicate from Builder and package root", () => {
    expect(builderApi.createEcf31MontoItemToleranceGateEvidence)
      .toBe(rootApi.createEcf31MontoItemToleranceGateEvidence);
  });
});

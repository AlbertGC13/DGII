import { describe, expect, it } from "vitest";

import * as rootApi from "../../../index.js";
import * as builderApi from "../index.js";
import type { Result } from "../../../index.js";

function value<T>(result: Result<T, unknown>): T {
  if (!result.ok) throw new Error("Expected a successful result.");
  return result.value;
}

function quantization(sequence: string, amount: string) {
  const evidence = value(rootApi.captureLineCalculationEvidence({
    sequence: value(rootApi.parseLineSequence(sequence)),
    quantity: value(rootApi.parseNonnegativeQuantity("1")),
    unitPrice: value(rootApi.parseUnitPrice(amount)),
    declaredAmount: value(rootApi.parseNonnegativeAmount("0")),
  }));
  const line = value(rootApi.createEcf31CoreLine({
    evidence,
    itemName: "Synthetic item",
    billingIndicator: 0,
    goodOrServiceIndicator: 1,
  }));
  const amountEvidence = value(rootApi.createEcf31LineAmountEvidence({
    coreLine: line,
    discountAmount: value(rootApi.parseNonnegativeAmount("0")),
    surchargeAmount: value(rootApi.parseNonnegativeAmount("0")),
  }));
  return value(rootApi.createEcf31MontoItemQuantizationEvidence(amountEvidence));
}

function initial(globalAmount: string, ...amounts: string[]) {
  return rootApi.createEcf31GlobalAdjustmentInitialEvidence({
    globalAmount: value(rootApi.parsePositiveAmount(globalAmount)),
    lines: amounts.map((amount, index) => quantization(String(index + 1), amount)),
  });
}

describe("e-CF 31 global adjustment initial evidence", () => {
  it("captures exact proportional allocations and provenance", () => {
    const result = value(initial("1", "3", "8", "6"));

    expect(result.entries.map((entry) => rootApi.formatDecimal(entry.initialAllocation))).toEqual(["0.18", "0.47", "0.35"]);
    expect(rootApi.formatDecimal(result.totalBasis)).toBe("17");
    expect(rootApi.formatDecimal(result.allocatedSum)).toBe("1");
    expect(rootApi.formatDecimal(result.signedResidue)).toBe("0");
    expect(result.entries[0]?.source.quantizedAmount).toBe(result.entries[0]?.basis);
    expect(result.entries[0]?.basis).toBe(result.entries[0]?.source.quantizedAmount);
    expect(result.policyId).toBe("ecf31-proportional-global-adjustment-initial-v1");
  });

  it("keeps independently half-up rounded equal allocations and records a negative residue", () => {
    const result = value(initial("0.02", "1", "1", "1", "1"));

    expect(result.entries.map((entry) => rootApi.formatDecimal(entry.initialAllocation))).toEqual(["0.01", "0.01", "0.01", "0.01"]);
    expect(rootApi.formatDecimal(result.allocatedSum)).toBe("0.04");
    expect(rootApi.formatDecimal(result.signedResidue)).toBe("-0.02");
  });

  it("records a positive residue when each independent allocation rounds down", () => {
    const result = value(initial("0.01", "1", "1", "1", "1"));

    expect(result.entries.map((entry) => rootApi.formatDecimal(entry.initialAllocation))).toEqual(["0", "0", "0", "0"]);
    expect(rootApi.formatDecimal(result.signedResidue)).toBe("0.01");
  });

  it("preserves tie outcomes without reconciliation", () => {
    const result = value(initial("0.01", "1", "1", "2"));

    expect(result.entries.map((entry) => rootApi.formatDecimal(entry.initialAllocation))).toEqual(["0", "0", "0.01"]);
    expect(rootApi.formatDecimal(result.signedResidue)).toBe("0");
  });

  it("returns safe catalog errors for zero basis and arithmetic overflow", () => {
    expect(initial("1", "0")).toMatchObject({ ok: false, error: { code: "ECF31_GLOBAL_ADJUSTMENT_ZERO_BASIS" } });
    expect(initial("9999999999999999.99", "9999999999999999.99", "9999999999999999.99"))
      .toEqual({ ok: false, error: {
        code: "ECF31_GLOBAL_ADJUSTMENT_INITIAL_OVERFLOW",
        message: "Global adjustment initial allocation exceeds the supported amount profile.",
      } });
    expect(initial("999999999999999999", "1", "1", "1", "1"))
      .toMatchObject({ ok: false, error: { code: "ECF31_GLOBAL_ADJUSTMENT_INITIAL_OVERFLOW" } });
    expect(initial("9999999999999999.99", "1", "1", "1", "1", "1", "1"))
      .toMatchObject({ ok: false, error: { code: "ECF31_GLOBAL_ADJUSTMENT_INITIAL_OVERFLOW" } });
  });

  it("copies and seals genuine evidence in the original order", () => {
    const first = quantization("1", "1");
    const input = { globalAmount: value(rootApi.parsePositiveAmount("1")), lines: [first] };
    const result = value(rootApi.createEcf31GlobalAdjustmentInitialEvidence(input));

    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.entries)).toBe(true);
    expect(Object.isFrozen(result.entries[0])).toBe(true);
    expect(result.entries).not.toBe(input.lines);
    expect(result.entries[0]?.source).toBe(first);
    expect(rootApi.isEcf31GlobalAdjustmentInitialEvidence(result)).toBe(true);
    expect(rootApi.isEcf31GlobalAdjustmentInitialEvidence({ ...result })).toBe(false);
  });

  it("rejects forged, out-of-order, gapped, duplicate, and hostile input safely", () => {
    const first = quantization("1", "1");
    const second = quantization("2", "1");
    const gap = quantization("3", "1");
    const globalAmount = value(rootApi.parsePositiveAmount("1"));
    const forged = { ...first };
    const throwing = new Proxy({}, { get: () => { throw new Error("trap"); } });
    const throwingKeys = new Proxy({}, { ownKeys: () => { throw new Error("trap"); } });
    const throwingDescriptor = new Proxy([first], { getOwnPropertyDescriptor: () => { throw new Error("trap"); } });
    const revokedLines = Proxy.revocable([], {}); revokedLines.revoke();
    const sparseLines = [first]; sparseLines.length = 2;
    const malformedKeys = [first]; malformedKeys.length = 2;
    Object.defineProperty(malformedKeys, "unexpected", { value: first, enumerable: true });
    const hiddenKey = [first]; Object.defineProperty(hiddenKey, "hidden", { value: first });
    const symbolKey = [first]; Object.defineProperty(symbolKey, Symbol("hidden"), { value: first });
    const accessorIndex = [first]; Object.defineProperty(accessorIndex, "0", { enumerable: true, get: () => first });
    const outerHidden = { globalAmount, lines: [first] }; Object.defineProperty(outerHidden, "hidden", { value: first });
    const outerSymbol = { globalAmount, lines: [first] }; Object.defineProperty(outerSymbol, Symbol("hidden"), { value: first });
    const outerGlobalAccessor = { lines: [first] }; Object.defineProperty(outerGlobalAccessor, "globalAmount", { enumerable: true, get: () => globalAmount });
    const outerLinesAccessor = { globalAmount }; Object.defineProperty(outerLinesAccessor, "lines", { enumerable: true, get: () => [first] });
    const outerPrototype = { globalAmount, lines: [first] };
    Object.setPrototypeOf(outerPrototype, {});
    const outerInvalidKey = { globalAmount, unexpected: [first] };
    const fakeLength = new Proxy([first], { get(target, key, receiver): unknown {
      return key === "length" ? 3 : Reflect.get(target, key, receiver) as unknown;
    } });
    const enormousFakeLength = new Proxy([first], { get(target, key, receiver): unknown {
      return key === "length" ? Number.MAX_SAFE_INTEGER : Reflect.get(target, key, receiver) as unknown;
    } });
    const throwingLine = new Proxy(first, { get: () => { throw new Error("trap"); } });
    const iteratorLines = new Proxy([first], { get(target, key, receiver): unknown {
      if (key === Symbol.iterator) throw new Error("iterator");
      return Reflect.get(target, key, receiver) as unknown;
    } });

    for (const input of [
      null,
      { globalAmount, lines: [] },
      { globalAmount: {}, lines: [first] },
      { globalAmount: value(rootApi.parseNonnegativeAmount("0")), lines: [first] },
      { globalAmount, lines: [forged] },
      { globalAmount, lines: [first, first] },
      { globalAmount, lines: [second, first] },
      { globalAmount, lines: [first, gap] },
      { globalAmount, lines: [first], extra: true },
      throwing,
      throwingKeys,
      { globalAmount, lines: throwingDescriptor },
      { globalAmount, lines: revokedLines.proxy },
      { globalAmount, lines: sparseLines },
      { globalAmount, lines: malformedKeys },
      { globalAmount, lines: hiddenKey },
      { globalAmount, lines: symbolKey },
      { globalAmount, lines: accessorIndex },
      { globalAmount, lines: [throwingLine] },
      outerHidden,
      outerSymbol,
      outerGlobalAccessor,
      outerLinesAccessor,
      outerPrototype,
      outerInvalidKey,
    ]) {
      expect(() => rootApi.createEcf31GlobalAdjustmentInitialEvidence(input)).not.toThrow();
      expect(rootApi.createEcf31GlobalAdjustmentInitialEvidence(input)).toMatchObject({ ok: false });
    }
    expect(rootApi.createEcf31GlobalAdjustmentInitialEvidence({ globalAmount, lines: fakeLength })).toMatchObject({ ok: true });
    expect(rootApi.createEcf31GlobalAdjustmentInitialEvidence({ globalAmount, lines: enormousFakeLength })).toMatchObject({ ok: true });
    expect(rootApi.createEcf31GlobalAdjustmentInitialEvidence({ globalAmount, lines: Object.freeze([first]) })).toMatchObject({ ok: true });
    expect(rootApi.createEcf31GlobalAdjustmentInitialEvidence({ globalAmount, lines: iteratorLines })).toMatchObject({ ok: true });
  });
});

describe("e-CF 31 global adjustment initial evidence exports", () => {
  it("exports the factory and predicate from Builder and package root", () => {
    expect(builderApi.createEcf31GlobalAdjustmentInitialEvidence)
      .toBe(rootApi.createEcf31GlobalAdjustmentInitialEvidence);
  });
});

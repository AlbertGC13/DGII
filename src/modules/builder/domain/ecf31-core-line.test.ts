import { describe, expect, it } from "vitest";

import * as rootApi from "../../../index.js";
import * as builderApi from "../index.js";

const {
  captureLineCalculationEvidence,
  createEcf31CoreLine,
  createEcf31CoreLineCollection,
  parseLineSequence,
  parseNonnegativeAmount,
  parseNonnegativeQuantity,
  parseUnitPrice,
} = rootApi;

function value<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false }): T {
  if (!result.ok) throw new Error("Expected a successful result.");
  return result.value;
}

function evidence(sequence: string) {
  return value(captureLineCalculationEvidence({
    sequence: value(parseLineSequence(sequence)),
    quantity: value(parseNonnegativeQuantity("1.5")),
    unitPrice: value(parseUnitPrice("2.5")),
    declaredAmount: value(parseNonnegativeAmount("3.75")),
  }));
}

describe("e-CF 31 core line", () => {
  it("creates an immutable line and a nonempty collection from genuine evidence", () => {
    const line = createEcf31CoreLine({
      evidence: evidence("1"), itemName: "Synthetic item", billingIndicator: 0, goodOrServiceIndicator: 1,
    });
    expect(line.ok).toBe(true);
    if (!line.ok) return;
    expect(createEcf31CoreLineCollection([line.value]).ok).toBe(true);
  });
});

describe("e-CF 31 core line validation", () => {
  it.each([
    [null, "INVALID_CORE_LINE_INPUT"],
    ["line", "INVALID_CORE_LINE_INPUT"],
    [{ evidence: evidence("1"), itemName: " ", billingIndicator: 0, goodOrServiceIndicator: 1 }, "INVALID_ITEM_NAME"],
    [{ evidence: evidence("1"), itemName: "x".repeat(81), billingIndicator: 0, goodOrServiceIndicator: 1 }, "INVALID_ITEM_NAME"],
    [{ evidence: evidence("1"), itemName: String.fromCodePoint(0x1F600).repeat(81), billingIndicator: 0, goodOrServiceIndicator: 1 }, "INVALID_ITEM_NAME"],
    [{ evidence: { ...evidence("1") }, itemName: "item", billingIndicator: 0, goodOrServiceIndicator: 1 }, "INVALID_CORE_LINE_EVIDENCE"],
    [{ evidence: evidence("1"), itemName: "item", billingIndicator: "0", goodOrServiceIndicator: 1 }, "INVALID_BILLING_INDICATOR"],
    [{ evidence: evidence("1"), itemName: "item", billingIndicator: 5, goodOrServiceIndicator: 1 }, "INVALID_BILLING_INDICATOR"],
    [{ evidence: evidence("1"), itemName: "item", billingIndicator: 0, goodOrServiceIndicator: 0 }, "INVALID_GOOD_OR_SERVICE_INDICATOR"],
  ])("returns a safe catalog error for invalid input", (input, code) => {
    expect(() => createEcf31CoreLine(input)).not.toThrow();
    expect(createEcf31CoreLine(input)).toMatchObject({ ok: false, error: { code } });
  });

  it("preserves evidence and accepted metadata exactly while privately branding the line", () => {
    const originalEvidence = evidence("1");
    const itemName = `  Synthetic item ${String.fromCodePoint(0x1F600)}  `;
    const result = value(createEcf31CoreLine({
      evidence: originalEvidence, itemName, billingIndicator: 4, goodOrServiceIndicator: 2,
    }));

    expect(result).toEqual({ evidence: originalEvidence, itemName, billingIndicator: 4, goodOrServiceIndicator: 2 });
    expect(result.evidence).toBe(originalEvidence);
    expect(Object.isFrozen(result)).toBe(true);
    expect(rootApi.isEcf31CoreLine(result)).toBe(true);
    expect(rootApi.isEcf31CoreLine({ ...result })).toBe(false);
    expect(rootApi.isLineCalculationEvidence(originalEvidence)).toBe(true);
    expect(rootApi.isLineCalculationEvidence({ ...originalEvidence })).toBe(false);
  });

  it("accepts every confirmed indicator and the 80-code-point boundary", () => {
    for (const billingIndicator of [0, 1, 2, 3, 4]) {
      expect(createEcf31CoreLine({ evidence: evidence("1"), itemName: String.fromCodePoint(0x1F600).repeat(80), billingIndicator, goodOrServiceIndicator: 1 }).ok).toBe(true);
    }
    for (const goodOrServiceIndicator of [1, 2]) {
      expect(createEcf31CoreLine({ evidence: evidence("1"), itemName: "item", billingIndicator: 0, goodOrServiceIndicator }).ok).toBe(true);
    }
  });
});

describe("e-CF 31 core line collection", () => {
  it("keeps genuine line objects in order, freezes a copy, and has no cardinality limit", () => {
    const lines = Array.from({ length: 10_001 }, (_, index) => value(createEcf31CoreLine({
      evidence: evidence(String(index + 1)), itemName: "item", billingIndicator: 0, goodOrServiceIndicator: 1,
    })));
    const collection = value(createEcf31CoreLineCollection(lines));

    expect(collection).toEqual(lines);
    expect(collection).not.toBe(lines);
    expect(collection[0]).toBe(lines[0]);
    expect(Object.isFrozen(collection)).toBe(true);
  });

  it.each([
    [[], "INVALID_CORE_LINE_COLLECTION"],
    [[value(createEcf31CoreLine({ evidence: evidence("2"), itemName: "item", billingIndicator: 0, goodOrServiceIndicator: 1 }))], "COLLECTION_STARTS_AFTER_ONE"],
    [[value(createEcf31CoreLine({ evidence: evidence("1"), itemName: "item", billingIndicator: 0, goodOrServiceIndicator: 1 })), value(createEcf31CoreLine({ evidence: evidence("3"), itemName: "item", billingIndicator: 0, goodOrServiceIndicator: 1 }))], "COLLECTION_GAP"],
    [[value(createEcf31CoreLine({ evidence: evidence("1"), itemName: "item", billingIndicator: 0, goodOrServiceIndicator: 1 })), value(createEcf31CoreLine({ evidence: evidence("1"), itemName: "item", billingIndicator: 0, goodOrServiceIndicator: 1 }))], "COLLECTION_DUPLICATE"],
    [[value(createEcf31CoreLine({ evidence: evidence("1"), itemName: "item", billingIndicator: 0, goodOrServiceIndicator: 1 })), value(createEcf31CoreLine({ evidence: evidence("3"), itemName: "item", billingIndicator: 0, goodOrServiceIndicator: 1 })), value(createEcf31CoreLine({ evidence: evidence("2"), itemName: "item", billingIndicator: 0, goodOrServiceIndicator: 1 }))], "COLLECTION_OUT_OF_ORDER"],
    [[{ ...value(createEcf31CoreLine({ evidence: evidence("1"), itemName: "item", billingIndicator: 0, goodOrServiceIndicator: 1 })) }], "INVALID_CORE_LINE_COLLECTION"],
  ])("maps invalid sequence or provenance safely", (input, code) => {
    expect(() => createEcf31CoreLineCollection(input)).not.toThrow();
    expect(createEcf31CoreLineCollection(input)).toMatchObject({ ok: false, error: { code } });
  });
});

describe("e-CF 31 core line hostile boundaries and exports", () => {
  it("returns safe failures for throwing and revoked proxies", () => {
    const revoked = Proxy.revocable({}, {}); revoked.revoke();
    const throwing = new Proxy({}, { get: () => { throw new Error("trap"); } });
    const hostileArray = new Proxy([], { get: () => { throw new Error("trap"); } });

    for (const input of [throwing, revoked.proxy]) {
      expect(rootApi.isLineCalculationEvidence(input)).toBe(false);
      expect(rootApi.isEcf31CoreLine(input)).toBe(false);
      expect(() => createEcf31CoreLine(input)).not.toThrow();
      expect(createEcf31CoreLine(input)).toMatchObject({ ok: false, error: { code: "INVALID_CORE_LINE_INPUT" } });
      expect(() => createEcf31CoreLineCollection(input)).not.toThrow();
      expect(createEcf31CoreLineCollection(input)).toMatchObject({ ok: false, error: { code: "INVALID_CORE_LINE_COLLECTION" } });
    }
    expect(createEcf31CoreLineCollection(hostileArray)).toMatchObject({ ok: false, error: { code: "INVALID_CORE_LINE_COLLECTION" } });
  });

  it("exports the factories and evidence predicate from Builder and the package root", () => {
    expect(builderApi.createEcf31CoreLine).toBe(rootApi.createEcf31CoreLine);
    expect(builderApi.createEcf31CoreLineCollection).toBe(rootApi.createEcf31CoreLineCollection);
    expect(builderApi.isLineCalculationEvidence).toBe(rootApi.isLineCalculationEvidence);
  });
});

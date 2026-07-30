import { describe, expect, it } from "vitest";

import * as rootApi from "../../../index.js";
import * as builderApi from "../index.js";
import type { Result } from "../../../index.js";

function value<T>(result: Result<T, unknown>): T {
  if (!result.ok) throw new Error("Expected a successful result.");
  return result.value;
}

function evidence(unitPrice = "3.7575", declaredAmount = "3.75") {
  const coreLine = value(rootApi.createEcf31CoreLine({
    evidence: value(rootApi.captureLineCalculationEvidence({
      sequence: value(rootApi.parseLineSequence("1")),
      quantity: value(rootApi.parseNonnegativeQuantity("1")),
      unitPrice: value(rootApi.parseUnitPrice(unitPrice)),
      declaredAmount: value(rootApi.parseNonnegativeAmount(declaredAmount)),
    })),
    itemName: "Synthetic item",
    billingIndicator: 0,
    goodOrServiceIndicator: 1,
  }));
  const lineAmount = value(rootApi.createEcf31LineAmountEvidence({
    coreLine,
    discountAmount: value(rootApi.parseNonnegativeAmount("0.01")),
    surchargeAmount: value(rootApi.parseNonnegativeAmount("0.02")),
  }));
  return Object.freeze({
    lineAmount,
    quantization: value(rootApi.createEcf31MontoItemQuantizationEvidence(lineAmount)),
  });
}

function snapshot() {
  return value(rootApi.serializeEcf31LineAdjustment(evidence()));
}

describe("Ecf31LineAdjustmentSnapshotCodec", () => {
  it("serializes a genuine matched pair into an exact immutable canonical snapshot", () => {
    const result = snapshot();

    expect(result).toEqual({
      schema: "ecf31-line-adjustment",
      version: 1,
      coreLine: value(rootApi.serializeEcf31CoreLine(evidence().lineAmount.coreLine)),
      discountAmount: "0.01",
      surchargeAmount: "0.02",
      adjustedAmount: "3.7675",
      adjustedDelta: "-0.0175",
      quantizedAmount: "3.77",
      policyId: "ecf31-monto-item-half-up-v1",
    });
    expect(Reflect.ownKeys(result)).toEqual([
      "schema", "version", "coreLine", "discountAmount", "surchargeAmount", "adjustedAmount",
      "adjustedDelta", "quantizedAmount", "policyId",
    ]);
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(Object.isFrozen(result)).toBe(true);
    expect(() => { (result as { policyId: string }).policyId = "mutated"; }).toThrow(TypeError);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it("restores an immutable genuine matched pair and round-trips its exact snapshot", () => {
    const serialized = snapshot();
    const restored = value(rootApi.restoreEcf31LineAdjustment(JSON.parse(JSON.stringify(serialized))));

    expect(rootApi.isEcf31LineAdjustmentEvidence(restored)).toBe(true);
    expect(rootApi.isEcf31LineAmountEvidence(restored.lineAmount)).toBe(true);
    expect(rootApi.isEcf31MontoItemQuantizationEvidence(restored.quantization)).toBe(true);
    expect(restored.quantization.sourceEvidence).toBe(restored.lineAmount);
    expect(Object.isFrozen(restored)).toBe(true);
    expect(value(rootApi.serializeEcf31LineAdjustment(restored))).toEqual(serialized);
  });

  it("rejects forged, mismatched, malformed, noncanonical, and stale snapshots", () => {
    const validSnapshot = snapshot();
    const other = evidence("1");
    const invalidSnapshots: unknown[] = [
      { ...validSnapshot, schema: "other" },
      { ...validSnapshot, version: 2 },
      { ...validSnapshot, extra: true },
      (() => { const missing = { ...validSnapshot }; Reflect.deleteProperty(missing, "policyId"); return missing; })(),
      { ...validSnapshot, coreLine: { ...validSnapshot.coreLine, extra: true } },
      { ...validSnapshot, discountAmount: "0.010" },
      { ...validSnapshot, surchargeAmount: "-0.01" },
      { ...validSnapshot, adjustedAmount: "3.76750" },
      { ...validSnapshot, adjustedDelta: "0" },
      { ...validSnapshot, quantizedAmount: "3.76" },
      { ...validSnapshot, policyId: "other" },
    ];

    expect(rootApi.serializeEcf31LineAdjustment({
      lineAmount: { ...evidence().lineAmount },
      quantization: evidence().quantization,
    })).toMatchObject({ ok: false });
    expect(rootApi.serializeEcf31LineAdjustment({
      lineAmount: evidence().lineAmount,
      quantization: other.quantization,
    })).toMatchObject({ ok: false });
    for (const input of invalidSnapshots) {
      expect(rootApi.restoreEcf31LineAdjustment(input)).toMatchObject({ ok: false });
    }
  });

  it("contains hostile getters, proxies, and revoked proxies without diagnostics", () => {
    const getterTrap = { ...snapshot() };
    Object.defineProperty(getterTrap, "schema", { enumerable: true, get() { throw new Error("trap"); } });
    const proxyTrap = new Proxy({}, { ownKeys: () => { throw new Error("trap"); } });
    const revoked = Proxy.revocable({}, {}); revoked.revoke();
    const pairTrap = new Proxy({}, { get: () => { throw new Error("trap"); } });

    for (const input of [null, Object.create(null), getterTrap, proxyTrap, revoked.proxy]) {
      expect(() => rootApi.restoreEcf31LineAdjustment(input)).not.toThrow();
      expect(rootApi.restoreEcf31LineAdjustment(input)).toMatchObject({ ok: false });
      expect(JSON.stringify(rootApi.restoreEcf31LineAdjustment(input))).not.toContain("trap");
    }
    expect(() => rootApi.serializeEcf31LineAdjustment(pairTrap)).not.toThrow();
    expect(rootApi.serializeEcf31LineAdjustment(pairTrap)).toMatchObject({ ok: false });
  });
});

it("exports the line-adjustment codec from Builder and the package root", () => {
  expect(builderApi.serializeEcf31LineAdjustment).toBe(rootApi.serializeEcf31LineAdjustment);
  expect(builderApi.restoreEcf31LineAdjustment).toBe(rootApi.restoreEcf31LineAdjustment);
});

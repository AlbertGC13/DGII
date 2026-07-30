import { describe, expect, it } from "vitest";

import * as rootApi from "../../../index.js";
import * as builderApi from "../index.js";
import type { Result } from "../../../index.js";

function value<T>(result: Result<T, unknown>): T {
  if (!result.ok) throw new Error("Expected a successful result.");
  return result.value;
}

function evidence() {
  const header = value(rootApi.createEcf31CoreHeader({
    eNcf: value(rootApi.parseENcf("E310000000001")),
    issuer: { taxpayerIdentifier: value(rootApi.parseTaxpayerIdentifier("000000000")), legalName: "Synthetic issuer", address: "Synthetic address" },
    buyer: { taxpayerIdentifier: value(rootApi.parseTaxpayerIdentifier("00000000000")), legalName: "Synthetic buyer" },
    issueDate: "01-12-2026", incomeType: "01", paymentType: "1",
  }));
  const lineAmounts = ["1", "2"].map((sequence) => value(rootApi.createEcf31LineAmountEvidence({
    coreLine: value(rootApi.createEcf31CoreLine({
      evidence: value(rootApi.captureLineCalculationEvidence({
        sequence: value(rootApi.parseLineSequence(sequence)),
        quantity: value(rootApi.parseNonnegativeQuantity("1")),
        unitPrice: value(rootApi.parseUnitPrice("1")),
        declaredAmount: value(rootApi.parseNonnegativeAmount("1")),
      })),
      itemName: `Synthetic item ${sequence}`, billingIndicator: 0, goodOrServiceIndicator: 1,
    })),
    discountAmount: value(rootApi.parseNonnegativeAmount("0")),
    surchargeAmount: value(rootApi.parseNonnegativeAmount("0")),
  })));
  const draft = value(rootApi.createEcf31CoreDraft({ header, lineAmounts }));
  const montoItemQuantizations = lineAmounts.map((lineAmount) => value(rootApi.createEcf31MontoItemQuantizationEvidence(lineAmount)));
  return value(rootApi.createEcf31PersistableDraftEvidence({
    draft, montoItemQuantizations, headerTotals: value(rootApi.createEcf31HeaderTotalsEvidence({})),
  }));
}

function snapshot() {
  return value(rootApi.serializeEcf31PersistableDraftEvidence(evidence()));
}

describe("Ecf31PersistableDraftEvidenceSnapshotCodec", () => {
  it("serializes genuine evidence into an immutable exact-key ordered snapshot", () => {
    const source = evidence();
    const result = value(rootApi.serializeEcf31PersistableDraftEvidence(source));

    expect(result).toEqual({
      schema: "ecf31-draft-evidence-v1",
      header: value(rootApi.serializeEcf31CoreHeader(source.draft.header)),
      lineAdjustments: source.montoItemQuantizations.map((quantization) => value(rootApi.serializeEcf31LineAdjustment({
        lineAmount: quantization.sourceEvidence, quantization,
      }))),
      headerTotals: value(rootApi.serializeEcf31HeaderTotals(source.headerTotals)),
    });
    expect(Reflect.ownKeys(result)).toEqual(["schema", "header", "lineAdjustments", "headerTotals"]);
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.lineAdjustments)).toBe(true);
    expect(() => { (result.lineAdjustments as unknown[]).push({}); }).toThrow(TypeError);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    expect(rootApi.serializeEcf31PersistableDraftEvidence({ ...source })).toMatchObject({ ok: false });
  });

  it("restores genuine evidence, recreates matching identities, and preserves snapshot order", () => {
    const serialized = snapshot();
    const restored = value(rootApi.restoreEcf31PersistableDraftEvidence(JSON.parse(JSON.stringify(serialized))));

    expect(rootApi.isEcf31PersistableDraftEvidence(restored)).toBe(true);
    expect(restored.montoItemQuantizations.map((quantization) => quantization.sourceEvidence)).toEqual(restored.draft.lineAmounts);
    expect(value(rootApi.serializeEcf31PersistableDraftEvidence(restored)).lineAdjustments
      .map((lineAdjustment) => lineAdjustment.coreLine.sequence)).toEqual(["1", "2"]);
    expect(Object.isFrozen(restored)).toBe(true);
    expect(Object.isFrozen(restored.montoItemQuantizations)).toBe(true);
    expect(value(rootApi.serializeEcf31PersistableDraftEvidence(restored))).toEqual(serialized);
  });

  it("rejects unknown, missing, empty, reordered, and corrupted nested snapshots", () => {
    const valid = snapshot();
    const invalidSnapshots: unknown[] = [
      { ...valid, schema: "other" },
      { ...valid, extra: true },
      (() => { const missing = { ...valid }; Reflect.deleteProperty(missing, "headerTotals"); return missing; })(),
      { ...valid, lineAdjustments: [] },
      { ...valid, lineAdjustments: [...valid.lineAdjustments].reverse() },
      { ...valid, header: { ...valid.header, extra: true } },
      { ...valid, lineAdjustments: [{ ...valid.lineAdjustments[0], quantizedAmount: "0" }, valid.lineAdjustments[1]] },
      { ...valid, headerTotals: { ...valid.headerTotals, montoTotal: "1" } },
    ];

    for (const input of invalidSnapshots) {
      expect(rootApi.restoreEcf31PersistableDraftEvidence(input)).toMatchObject({ ok: false });
    }
  });

  it("contains forged and hostile values without diagnostics", () => {
    const getterTrap = { ...snapshot() };
    Object.defineProperty(getterTrap, "schema", { enumerable: true, get() { throw new Error("trap"); } });
    const proxyTrap = new Proxy({}, { ownKeys: () => { throw new Error("trap"); } });
    const revoked = Proxy.revocable({}, {}); revoked.revoke();
    const evidenceTrap = new Proxy({}, { get: () => { throw new Error("trap"); } });
    const adjustmentArrayTrap = new Proxy([], { get: () => { throw new Error("trap"); } });

    for (const input of [null, Object.create(null), getterTrap, proxyTrap, revoked.proxy]) {
      expect(() => rootApi.restoreEcf31PersistableDraftEvidence(input)).not.toThrow();
      expect(rootApi.restoreEcf31PersistableDraftEvidence(input)).toMatchObject({ ok: false });
      expect(JSON.stringify(rootApi.restoreEcf31PersistableDraftEvidence(input))).not.toContain("trap");
    }
    expect(rootApi.restoreEcf31PersistableDraftEvidence({ ...snapshot(), lineAdjustments: adjustmentArrayTrap }))
      .toMatchObject({ ok: false });
    expect(() => rootApi.serializeEcf31PersistableDraftEvidence(evidenceTrap)).not.toThrow();
    expect(rootApi.serializeEcf31PersistableDraftEvidence(evidenceTrap)).toMatchObject({ ok: false });
  });
});

it("exports the persistable draft evidence codec from Builder and the package root", () => {
  expect(builderApi.serializeEcf31PersistableDraftEvidence).toBe(rootApi.serializeEcf31PersistableDraftEvidence);
  expect(builderApi.restoreEcf31PersistableDraftEvidence).toBe(rootApi.restoreEcf31PersistableDraftEvidence);
});

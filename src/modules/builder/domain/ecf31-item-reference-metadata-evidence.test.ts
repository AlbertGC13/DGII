import { describe, expect, it } from "vitest";

import * as builderApi from "../index.js";
import * as rootApi from "../../../index.js";
import type { Result } from "../../../index.js";

function value<T>(result: Result<T, unknown>): T {
  if (!result.ok) throw new Error("Expected a successful result.");
  return result.value;
}

function fixture(lines = 2) {
  const lineAmounts = Array.from({ length: lines }, (_, index) => value(rootApi.createEcf31LineAmountEvidence({
    coreLine: value(rootApi.createEcf31CoreLine({ evidence: value(rootApi.captureLineCalculationEvidence({
      sequence: value(rootApi.parseLineSequence(String(index + 1))), quantity: value(rootApi.parseNonnegativeQuantity("1")),
      unitPrice: value(rootApi.parseUnitPrice("1")), declaredAmount: value(rootApi.parseNonnegativeAmount("1")),
    })), itemName: "Synthetic item", billingIndicator: 1, goodOrServiceIndicator: 1 })),
    discountAmount: value(rootApi.parseNonnegativeAmount("0")), surchargeAmount: value(rootApi.parseNonnegativeAmount("0")),
  })));
  return { lineAmounts, draft: value(rootApi.createEcf31CoreDraft({
    header: value(rootApi.createEcf31CoreHeader({ eNcf: value(rootApi.parseENcf("E310000000001")),
      issuer: { taxpayerIdentifier: value(rootApi.parseTaxpayerIdentifier("000000000")), legalName: "Synthetic issuer", address: "Synthetic address" },
      buyer: { taxpayerIdentifier: value(rootApi.parseTaxpayerIdentifier("00000000000")), legalName: "Synthetic buyer" },
      issueDate: "01-12-2026", incomeType: "01", paymentType: "1" })), lineAmounts,
  })) };
}

function entries(input: ReturnType<typeof fixture>, references: readonly (readonly [string, string] | undefined)[]) {
  return input.lineAmounts.map((source, index) => {
    const reference = references[index];
    return reference === undefined ? { source } : { source, quantity: reference[0], unit: reference[1] };
  });
}

describe("Ecf31ItemReferenceMetadataEvidence", () => {
  it("captures paired optional reference quantity and canonical unit per exact draft line", () => {
    const input = fixture();
    const evidence = value(rootApi.createEcf31ItemReferenceMetadataEvidence({
      draft: input.draft, entries: entries(input, [["0.50", "18"], undefined]),
    }));
    const first = evidence.entries[0];
    if (first?.quantity === undefined) throw new Error("Expected a reference quantity.");

    expect(rootApi.formatEcf31ReferenceQuantity(first.quantity)).toBe("0.5");
    expect(evidence).toEqual({ draft: input.draft, entries: [
      { source: input.lineAmounts[0], quantity: evidence.entries[0]?.quantity, unit: "18" },
      { source: input.lineAmounts[1] },
    ] });
  });

  it("rejects unpaired, undefined, negative, over-scale, and noncanonical references with safe catalog errors", () => {
    const input = fixture();
    for (const candidate of [
      { source: input.lineAmounts[0], quantity: "1" }, { source: input.lineAmounts[0], unit: "1" },
      { source: input.lineAmounts[0], quantity: undefined, unit: "1" }, { source: input.lineAmounts[0], quantity: "-1", unit: "1" },
      { source: input.lineAmounts[0], quantity: "1.001", unit: "1" }, { source: input.lineAmounts[0], quantity: "1", unit: "01" },
    ]) {
      const result = rootApi.createEcf31ItemReferenceMetadataEvidence({ draft: input.draft, entries: [candidate, { source: input.lineAmounts[1] }] });
      expect(result).toEqual({ ok: false, error: {
        code: "INVALID_ECF31_ITEM_REFERENCE_METADATA_INPUT", message: "E-CF 31 item-reference metadata input is invalid.",
      } });
    }
  });

  it("rejects forged, reordered, count-mismatched, cloned, accessor, proxy, symbol, and extra inputs safely", () => {
    const input = fixture();
    const valid = entries(input, [["1", "1"], undefined]);
    const accessor = { draft: input.draft, entries: valid };
    Object.defineProperty(accessor, "entries", { enumerable: true, get: () => { throw new Error("trap"); } });
    const revoked = Proxy.revocable({}, {}); revoked.revoke();
    const hostile: unknown[] = [
      { draft: input.draft, entries: valid.slice(0, 1) }, { draft: input.draft, entries: [...valid].reverse() },
      { draft: { ...input.draft }, entries: valid }, { draft: input.draft, entries: [{ source: { ...input.lineAmounts[0] }, quantity: "1", unit: "1" }, valid[1]] },
      { draft: input.draft, entries: [{ ...valid[0], extra: true }, valid[1]] }, { draft: input.draft, entries: valid, [Symbol("x")]: true },
      accessor, revoked.proxy, new Proxy({}, { ownKeys: () => { throw new Error("trap"); } }),
    ];
    for (const candidate of hostile) {
      expect(() => rootApi.createEcf31ItemReferenceMetadataEvidence(candidate)).not.toThrow();
      expect(rootApi.createEcf31ItemReferenceMetadataEvidence(candidate)).toMatchObject({ ok: false, error: { code: "INVALID_ECF31_ITEM_REFERENCE_METADATA_INPUT" } });
    }
  });

  it("freezes the graph and authenticates only evidence created by the factory", () => {
    const input = fixture(1);
    const source = entries(input, [["62", "62"]]);
    const evidence = value(rootApi.createEcf31ItemReferenceMetadataEvidence({ draft: input.draft, entries: source }));
    const line = input.lineAmounts[0];
    if (line === undefined) throw new Error("Expected a line amount.");
    source[0] = { source: line, quantity: "1", unit: "1" };

    expect([evidence, evidence.entries, evidence.entries[0]].every(Object.isFrozen)).toBe(true);
    expect(rootApi.isEcf31ItemReferenceMetadataEvidence(evidence)).toBe(true);
    expect(rootApi.isEcf31ItemReferenceMetadataEvidence({ ...evidence })).toBe(false);
  });
});

it("exports item reference metadata from Builder and the package root", () => {
  expect(builderApi.createEcf31ItemReferenceMetadataEvidence).toBe(rootApi.createEcf31ItemReferenceMetadataEvidence);
});

import { describe, expect, it } from "vitest";

import * as rootApi from "../../../index.js";
import * as builderApi from "../index.js";
import type { Result } from "../../../index.js";

function value<T>(result: Result<T, unknown>): T {
  if (!result.ok) throw new Error("Expected a successful result.");
  return result.value;
}

function fixture() {
  const lineAmounts = ["1", "2"].map((sequence) => value(rootApi.createEcf31LineAmountEvidence({
    coreLine: value(rootApi.createEcf31CoreLine({
      evidence: value(rootApi.captureLineCalculationEvidence({
        sequence: value(rootApi.parseLineSequence(sequence)), quantity: value(rootApi.parseNonnegativeQuantity("1")),
        unitPrice: value(rootApi.parseUnitPrice("1")), declaredAmount: value(rootApi.parseNonnegativeAmount("1")),
      })),
      itemName: `Synthetic item ${sequence}`, billingIndicator: 0, goodOrServiceIndicator: 1,
    })),
    discountAmount: value(rootApi.parseNonnegativeAmount("0")), surchargeAmount: value(rootApi.parseNonnegativeAmount("0")),
  })));
  return {
    draft: value(rootApi.createEcf31CoreDraft({
      header: value(rootApi.createEcf31CoreHeader({
        eNcf: value(rootApi.parseENcf("E310000000001")),
        issuer: { taxpayerIdentifier: value(rootApi.parseTaxpayerIdentifier("000000000")), legalName: "Synthetic issuer", address: "Synthetic address" },
        buyer: { taxpayerIdentifier: value(rootApi.parseTaxpayerIdentifier("00000000000")), legalName: "Synthetic buyer" },
        issueDate: "01-12-2026", incomeType: "01", paymentType: "1",
      })),
      lineAmounts,
    })),
    lineAmounts,
  };
}

describe("e-CF 31 other-currency detail evidence", () => {
  it("captures independent supplied values in immutable entries while allowing their absence", () => {
    const input = fixture();
    const evidence = value(rootApi.createEcf31OtherCurrencyDetailEvidence({
      draft: input.draft,
      entries: [
        { source: input.lineAmounts[0], precioOtraMoneda: "1234567890123456.1234", descuento: "1.25", montoItemOtraMoneda: "1234567890123456.12" },
        { source: input.lineAmounts[1] },
      ],
    }));

    const first = evidence.entries[0];
    if (first?.precioOtraMoneda === undefined || first.descuento === undefined || first.montoItemOtraMoneda === undefined) throw new Error("Missing supplied value.");
    expect(rootApi.formatDecimal(first.precioOtraMoneda)).toBe("1234567890123456.1234");
    expect(rootApi.formatDecimal(first.descuento)).toBe("1.25");
    expect(rootApi.formatDecimal(first.montoItemOtraMoneda)).toBe("1234567890123456.12");
    expect(evidence.entries[1]).toEqual({ source: input.lineAmounts[1] });
    expect(Object.isFrozen(evidence)).toBe(true);
    expect(Object.isFrozen(evidence.entries)).toBe(true);
    expect(Object.isFrozen(evidence.entries[0])).toBe(true);
    expect(rootApi.isEcf31OtherCurrencyDetailEvidence(evidence)).toBe(true);
    expect(rootApi.isEcf31OtherCurrencyDetailEvidence({ ...evidence })).toBe(false);
  });

  it("rejects empty groups, out-of-profile values, undefined fields, and non-identical or reordered sources", () => {
    const input = fixture();
    const entries = [
      { source: input.lineAmounts[0] },
      { source: input.lineAmounts[1] },
    ];
    const invalid: unknown[] = [
      { draft: input.draft, entries: [] },
      { draft: input.draft, entries: [{ source: input.lineAmounts[0] }, { source: input.lineAmounts[1] }] },
      { draft: input.draft, entries: [{ source: input.lineAmounts[0], precioOtraMoneda: "12345678901234567.1234" }, entries[1]] },
      { draft: input.draft, entries: [{ source: input.lineAmounts[0], descuento: "1.234" }, entries[1]] },
      { draft: input.draft, entries: [{ source: input.lineAmounts[0], recargo: undefined }, entries[1]] },
      { draft: input.draft, entries: [...entries].reverse() },
      { draft: input.draft, entries: [{ source: { ...input.lineAmounts[0] } }, entries[1]] },
    ];

    for (const candidate of invalid) {
      expect(() => rootApi.createEcf31OtherCurrencyDetailEvidence(candidate)).not.toThrow();
      expect(rootApi.createEcf31OtherCurrencyDetailEvidence(candidate)).toMatchObject({ ok: false });
    }
  });

  it("safely rejects forged, foreign, descriptor-hostile, and proxy-hostile values", () => {
    const input = fixture();
    const foreign = fixture();
    const accessor = { draft: input.draft, entries: [] };
    Object.defineProperty(accessor, "entries", { enumerable: true, get: () => { throw new Error("trap"); } });
    const proxy = new Proxy({}, { ownKeys: () => { throw new Error("trap"); } });
    const revoked = Proxy.revocable({}, {}); revoked.revoke();

    for (const candidate of [
      { draft: input.draft, entries: [{ source: foreign.lineAmounts[0], precioOtraMoneda: "1" }, { source: foreign.lineAmounts[1] }] },
      accessor, proxy, revoked.proxy,
    ]) {
      expect(() => rootApi.createEcf31OtherCurrencyDetailEvidence(candidate)).not.toThrow();
      expect(rootApi.createEcf31OtherCurrencyDetailEvidence(candidate)).toMatchObject({ ok: false });
    }
  });
});

describe("e-CF 31 other-currency detail evidence exports", () => {
  it("exports the factory and predicate from Builder and the package root", () => {
    expect(builderApi.createEcf31OtherCurrencyDetailEvidence).toBe(rootApi.createEcf31OtherCurrencyDetailEvidence);
    expect(builderApi.isEcf31OtherCurrencyDetailEvidence).toBe(rootApi.isEcf31OtherCurrencyDetailEvidence);
  });
});

import { describe, expect, it } from "vitest";

import * as rootApi from "../../../index.js";
import * as builderApi from "../index.js";
import type { Result } from "../../../index.js";

function value<T>(result: Result<T, unknown>): T {
  if (!result.ok) throw new Error("Expected a successful result.");
  return result.value;
}

function header() {
  return value(rootApi.createEcf31CoreHeader({
    eNcf: value(rootApi.parseENcf("E310000000001")),
    issuer: { taxpayerIdentifier: value(rootApi.parseTaxpayerIdentifier("000000000")), legalName: "Synthetic issuer", address: "Synthetic address" },
    buyer: { taxpayerIdentifier: value(rootApi.parseTaxpayerIdentifier("00000000000")), legalName: "Synthetic buyer" },
    issueDate: "01-12-2026", incomeType: "01", paymentType: "1",
  }));
}

function line(sequence: number, unitPrice = "10", quantity = "1", discount = "0", surcharge = "0") {
  return value(rootApi.createEcf31LineAmountEvidence({
    coreLine: value(rootApi.createEcf31CoreLine({
      evidence: value(rootApi.captureLineCalculationEvidence({
        sequence: value(rootApi.parseLineSequence(String(sequence))),
        quantity: value(rootApi.parseNonnegativeQuantity(quantity)),
        unitPrice: value(rootApi.parseUnitPrice(unitPrice)),
        declaredAmount: value(rootApi.parseNonnegativeAmount("0")),
      })), itemName: "Synthetic item", billingIndicator: 1, goodOrServiceIndicator: 1,
    })),
    discountAmount: value(rootApi.parseNonnegativeAmount(discount)),
    surchargeAmount: value(rootApi.parseNonnegativeAmount(surcharge)),
  }));
}

function draft(count = 1, first?: ReturnType<typeof line>) {
  return value(rootApi.createEcf31CoreDraft({
    header: header(),
    lineAmounts: Array.from({ length: count }, (_, index) => index === 0 && first !== undefined ? first : line(index + 1)),
  }));
}

function classification(source: ReturnType<typeof draft>, codes: readonly (readonly string[])[]) {
  return value(rootApi.createEcf31AdditionalTaxClassificationEvidence({
    draft: source,
    entries: source.lineAmounts.map((lineAmount, index) => ({ source: lineAmount, codes: codes[index] ?? [] })),
  }));
}

describe("Ecf31DetallesItemsEvidence", () => {
  it("derives ordered line-local MontoItem values and preserves captured tax-code order", () => {
    const first = line(1, "10", "2", "1", "0.5");
    const source = draft(2, first);
    const taxes = classification(source, [["005", "006"], ["039"]]);
    const result = value(rootApi.createEcf31DetallesItemsEvidence({
      draft: source,
      additionalTaxClassificationEvidence: taxes,
    }));

    expect(result.entries.map((entry) => rootApi.formatDecimal(entry.montoItem.quantizedAmount))).toEqual(["19.5", "10"]);
    expect(result.entries.map((entry) => entry.lineAmount)).toEqual(source.lineAmounts);
    expect(result.entries.map((entry) => entry.additionalTaxCodes)).toEqual([["005", "006"], ["039"]]);
  });

  it("uses empty codes when classification is absent and does not accept caller MontoItem or global adjustments", () => {
    const source = draft();
    const result = value(rootApi.createEcf31DetallesItemsEvidence({ draft: source }));

    expect(result.entries[0]?.additionalTaxCodes).toEqual([]);
    for (const input of [
      { draft: source, montoItem: value(rootApi.parseNonnegativeAmount("999")) },
      { draft: source, globalAdjustments: [] },
    ]) expect(rootApi.createEcf31DetallesItemsEvidence(input)).toMatchObject({ ok: false });
  });

  it("rejects non-genuine, mismatched, zero-quantity, and over-1000 evidence without partial output", () => {
    const source = draft(2);
    const other = draft(2);
    const validClassification = classification(source, [[], []]);
    const mismatchedClassification = classification(other, [[], []]);
    const crossLineClassification = { ...validClassification, entries: [...validClassification.entries].reverse() };
    const zeroQuantityDraft = draft(1, line(1, "10", "0"));
    const negativeMontoItemDraft = draft(1, line(1, "1", "1", "2"));

    for (const input of [
      { draft: { ...source } },
      { draft: source, additionalTaxClassificationEvidence: { ...validClassification } },
      { draft: source, additionalTaxClassificationEvidence: mismatchedClassification },
      { draft: source, additionalTaxClassificationEvidence: crossLineClassification },
      { draft: zeroQuantityDraft },
      { draft: negativeMontoItemDraft },
      { draft: draft(1001) },
    ]) expect(rootApi.createEcf31DetallesItemsEvidence(input)).toMatchObject({ ok: false });
  });

  it("rejects hostile outer shapes through one safe catalog error", () => {
    const source = draft();
    const accessor = { draft: source };
    Object.defineProperty(accessor, "draft", { enumerable: true, get: () => { throw new Error("trap"); } });
    const inherited: unknown = Object.create({ draft: source }) as unknown;
    const customPrototype: unknown = Object.setPrototypeOf({ draft: source }, {}) as unknown;
    const symbol = Symbol("unexpected");
    const symbolKey = { draft: source, [symbol]: true };
    const proxy: unknown = new Proxy({}, { ownKeys: () => { throw new Error("trap"); } });
    const subclassedArray: unknown = new (class extends Array {})();

    for (const input of [null, accessor, inherited, customPrototype, symbolKey, proxy, subclassedArray]) {
      expect(() => rootApi.createEcf31DetallesItemsEvidence(input)).not.toThrow();
      expect(rootApi.createEcf31DetallesItemsEvidence(input)).toMatchObject({ ok: false, error: { code: "INVALID_ECF31_DETALLES_ITEMS_INPUT" } });
    }
  });

  it("returns immutable, authenticated evidence and collections", () => {
    const result = value(rootApi.createEcf31DetallesItemsEvidence({ draft: draft() }));

    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.entries)).toBe(true);
    expect(Object.isFrozen(result.entries[0])).toBe(true);
    expect(Object.isFrozen(result.entries[0]?.additionalTaxCodes)).toBe(true);
    expect(Reflect.set(result.entries, "0", result.entries[0])).toBe(false);
    expect(rootApi.isEcf31DetallesItemsEvidence(result)).toBe(true);
    expect(rootApi.isEcf31DetallesItemsEvidence({ ...result })).toBe(false);
  });
});

describe("Ecf31DetallesItemsEvidence exports", () => {
  it("exports the domain API from Builder and the package root", () => {
    expect(builderApi.createEcf31DetallesItemsEvidence).toBe(rootApi.createEcf31DetallesItemsEvidence);
    expect(builderApi.isEcf31DetallesItemsEvidence).toBe(rootApi.isEcf31DetallesItemsEvidence);
  });
});

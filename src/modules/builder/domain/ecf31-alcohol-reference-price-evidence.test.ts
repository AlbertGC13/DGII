import { describe, expect, it } from "vitest";

import * as rootApi from "../../../index.js";
import * as builderApi from "../index.js";
import type { Result } from "../../../index.js";

function value<T>(result: Result<T, unknown>): T {
  if (!result.ok) throw new Error("Expected a successful result.");
  return result.value;
}

function fixture() {
  const header = value(rootApi.createEcf31CoreHeader({
    eNcf: value(rootApi.parseENcf("E310000000001")),
    issuer: { taxpayerIdentifier: value(rootApi.parseTaxpayerIdentifier("000000000")), legalName: "Synthetic issuer", address: "Synthetic address" },
    buyer: { taxpayerIdentifier: value(rootApi.parseTaxpayerIdentifier("00000000000")), legalName: "Synthetic buyer" },
    issueDate: "01-12-2026", incomeType: "01", paymentType: "1",
  }));
  const lineAmounts = ["1", "2", "3"].map((sequence) => value(rootApi.createEcf31LineAmountEvidence({
    coreLine: value(rootApi.createEcf31CoreLine({
      evidence: value(rootApi.captureLineCalculationEvidence({
        sequence: value(rootApi.parseLineSequence(sequence)), quantity: value(rootApi.parseNonnegativeQuantity("1")),
        unitPrice: value(rootApi.parseUnitPrice("1")), declaredAmount: value(rootApi.parseNonnegativeAmount("1")),
      })), itemName: `Synthetic item ${sequence}`, billingIndicator: 1, goodOrServiceIndicator: 1,
    })), discountAmount: value(rootApi.parseNonnegativeAmount("0")), surchargeAmount: value(rootApi.parseNonnegativeAmount("0")),
  })));
  const draft = value(rootApi.createEcf31CoreDraft({ header, lineAmounts }));
  const classification = value(rootApi.createEcf31AdditionalTaxClassificationEvidence({
    draft, entries: lineAmounts.map((source, index) => ({ source, codes: index === 0 ? ["006"] : index === 1 ? ["023"] : ["006", "023"] })),
  }));
  return {
    draft,
    classification,
    entries: [
      { source: lineAmounts[0], alcoholDegrees: value(rootApi.parseEcf31AlcoholDegrees("99.99")) },
      { source: lineAmounts[1], referenceUnitPrice: value(rootApi.parsePositiveAmount("9999999999999999.99")) },
      { source: lineAmounts[2], alcoholDegrees: value(rootApi.parseEcf31AlcoholDegrees("1")), referenceUnitPrice: value(rootApi.parsePositiveAmount("1")) },
    ],
  };
}

describe("e-CF 31 alcohol and reference-price evidence", () => {
  it("binds immutable required values to the genuine classified draft lines", () => {
    const input = fixture();
    const evidence = value(rootApi.createEcf31AlcoholReferencePriceEvidence(input));

    expect(evidence.draft).toBe(input.draft);
    expect(evidence.classification).toBe(input.classification);
    expect(evidence.entries.map((entry) => entry.source)).toEqual(input.draft.lineAmounts);
    expect(rootApi.formatDecimal(evidence.entries[0]?.alcoholDegrees ?? value(rootApi.parseEcf31AlcoholDegrees("1")))).toBe("99.99");
    expect(rootApi.formatDecimal(evidence.entries[1]?.referenceUnitPrice ?? value(rootApi.parsePositiveAmount("1")))).toBe("9999999999999999.99");
    expect(Object.isFrozen(evidence)).toBe(true);
    expect(Object.isFrozen(evidence.entries)).toBe(true);
    expect(Object.isFrozen(evidence.entries[0])).toBe(true);
    expect(rootApi.isEcf31AlcoholReferencePriceEvidence(evidence)).toBe(true);
    expect(rootApi.isEcf31AlcoholReferencePriceEvidence({ ...evidence })).toBe(false);
  });

  it.each([
    (input: ReturnType<typeof fixture>) => ({ ...input, entries: [{ source: input.draft.lineAmounts[0] }, input.entries[1], input.entries[2]] }),
    (input: ReturnType<typeof fixture>) => ({ ...input, entries: [input.entries[0], { source: input.draft.lineAmounts[1] }, input.entries[2]] }),
    (input: ReturnType<typeof fixture>) => ({ ...input, entries: [input.entries[0], input.entries[1], { source: input.draft.lineAmounts[2], alcoholDegrees: input.entries[2]?.alcoholDegrees }]}),
    (input: ReturnType<typeof fixture>) => ({ ...input, entries: [...input.entries].reverse() }),
    (input: ReturnType<typeof fixture>) => ({ ...input, entries: [...input.entries, input.entries[0]] }),
    (input: ReturnType<typeof fixture>) => ({ ...input, entries: [{ ...input.entries[0], referenceUnitPrice: value(rootApi.parsePositiveAmount("1")) }, input.entries[1], input.entries[2]] }),
    (input: ReturnType<typeof fixture>) => ({ ...input, entries: [{ source: input.draft.lineAmounts[0], alcoholDegrees: undefined }, input.entries[1], input.entries[2]] }),
    (input: ReturnType<typeof fixture>) => ({ ...input, entries: [input.entries[0], { ...input.entries[1], referenceUnitPrice: value(rootApi.parseUnitPrice("1.2345")) }, input.entries[2]] }),
  ])("rejects missing, extra, foreign-profile, and reordered values", (mutate) => {
    expect(rootApi.createEcf31AlcoholReferencePriceEvidence(mutate(fixture()))).toMatchObject({ ok: false });
  });

  it("forbids both values when no line has a qualifying code", () => {
    const input = fixture();
    const classification = value(rootApi.createEcf31AdditionalTaxClassificationEvidence({
      draft: input.draft, entries: input.draft.lineAmounts.map((source) => ({ source, codes: [] })),
    }));
    const absent = { draft: input.draft, classification, entries: input.draft.lineAmounts.map((source) => ({ source })) };

    expect(rootApi.createEcf31AlcoholReferencePriceEvidence(absent)).toMatchObject({ ok: true });
    expect(rootApi.createEcf31AlcoholReferencePriceEvidence({ ...absent, entries: [{
      source: input.draft.lineAmounts[0], alcoholDegrees: value(rootApi.parseEcf31AlcoholDegrees("1")),
    }, ...absent.entries.slice(1)] })).toMatchObject({ ok: false });
  });

  it("rejects foreign, forged, sparse, accessor, proxy, and extra-key input without throwing", () => {
    const input = fixture();
    const foreign = fixture();
    const sparse = [...input.entries]; sparse.length = 4;
    const accessor = { ...input.entries[0] };
    Object.defineProperty(accessor, "alcoholDegrees", { enumerable: true, get() { throw new Error("trap"); } });
    const extra = { ...input.entries[0], extra: true };
    const hostile = new Proxy({}, { ownKeys() { throw new Error("trap"); } });

    for (const candidate of [
      { ...input, draft: foreign.draft }, { ...input, classification: foreign.classification },
      { ...input, entries: sparse }, { ...input, entries: [accessor, input.entries[1], input.entries[2]] },
      { ...input, entries: [extra, input.entries[1], input.entries[2]] }, new Proxy(input, {}), hostile,
    ]) {
      expect(() => rootApi.createEcf31AlcoholReferencePriceEvidence(candidate)).not.toThrow();
      expect(rootApi.createEcf31AlcoholReferencePriceEvidence(candidate)).toMatchObject({ ok: false });
    }
  });
});

it("exports alcohol and reference-price evidence from Builder and the package root", () => {
  expect(builderApi.createEcf31AlcoholReferencePriceEvidence).toBe(rootApi.createEcf31AlcoholReferencePriceEvidence);
  expect(builderApi.parseEcf31AlcoholDegrees).toBe(rootApi.parseEcf31AlcoholDegrees);
});

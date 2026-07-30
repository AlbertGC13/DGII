import { describe, expect, it } from "vitest";

import * as rootApi from "../../../index.js";
import * as builderApi from "../index.js";
import type { Result } from "../../../index.js";

function value<T>(result: Result<T, unknown>): T {
  if (!result.ok) throw new Error("Expected a successful result.");
  return result.value;
}

function lineAmount(sequence: string) {
  const calculation = value(rootApi.captureLineCalculationEvidence({
    sequence: value(rootApi.parseLineSequence(sequence)),
    quantity: value(rootApi.parseNonnegativeQuantity("1")),
    unitPrice: value(rootApi.parseUnitPrice("1")),
    declaredAmount: value(rootApi.parseNonnegativeAmount("1")),
  }));
  const coreLine = value(rootApi.createEcf31CoreLine({
    evidence: calculation,
    itemName: "Synthetic item",
    billingIndicator: 0,
    goodOrServiceIndicator: 1,
  }));
  return value(rootApi.createEcf31LineAmountEvidence({
    coreLine,
    discountAmount: value(rootApi.parseNonnegativeAmount("0")),
    surchargeAmount: value(rootApi.parseNonnegativeAmount("0")),
  }));
}

function draft(lineCount: number) {
  const header = value(rootApi.createEcf31CoreHeader({
    eNcf: value(rootApi.parseENcf("E310000000001")),
    issuer: {
      taxpayerIdentifier: value(rootApi.parseTaxpayerIdentifier("000000000")),
      legalName: "Synthetic issuer",
      address: "Synthetic address",
    },
    buyer: {
      taxpayerIdentifier: value(rootApi.parseTaxpayerIdentifier("00000000000")),
      legalName: "Synthetic buyer",
    },
    issueDate: "01-12-2026",
    incomeType: "01",
    paymentType: "1",
  }));
  const lineAmounts = Array.from({ length: lineCount }, (_, index) => lineAmount(String(index + 1)));
  return value(rootApi.createEcf31CoreDraft({ header, lineAmounts }));
}

function quantizations(source: ReturnType<typeof draft>) {
  return source.lineAmounts.map((line) => value(rootApi.createEcf31MontoItemQuantizationEvidence(line)));
}

function totals() {
  return value(rootApi.createEcf31HeaderTotalsEvidence({}));
}

describe("Ecf31PersistableDraftEvidence", () => {
  it("connects a one-line genuine draft, matching evidence, and genuine totals without reconciliation", () => {
    const coreDraft = draft(1);
    const montoItemQuantizations = quantizations(coreDraft);
    const result = value(rootApi.createEcf31PersistableDraftEvidence({
      draft: coreDraft,
      montoItemQuantizations,
      headerTotals: totals(),
    }));

    expect(result.draft).toBe(coreDraft);
    expect(result.montoItemQuantizations).not.toBe(montoItemQuantizations);
    expect(result.montoItemQuantizations[0]).toBe(montoItemQuantizations[0]);
    expect(result.montoItemQuantizations.at(0)?.sourceEvidence).toBe(coreDraft.lineAmounts[0]);
    expect(rootApi.formatDecimal(result.headerTotals.montoTotal)).toBe("0");
  });

  it("preserves identity and order for multiple draft lines", () => {
    const coreDraft = draft(3);
    const montoItemQuantizations = quantizations(coreDraft);
    const result = value(rootApi.createEcf31PersistableDraftEvidence({
      draft: coreDraft,
      montoItemQuantizations,
      headerTotals: totals(),
    }));

    expect(result.montoItemQuantizations).toHaveLength(3);
    expect(result.montoItemQuantizations.map((evidence) => evidence.sourceEvidence)).toEqual(coreDraft.lineAmounts);
    expect(result.montoItemQuantizations.at(1)?.sourceEvidence).toBe(coreDraft.lineAmounts[1]);
  });

  it("freezes its aggregate and its copied evidence collection", () => {
    const coreDraft = draft(1);
    const result = value(rootApi.createEcf31PersistableDraftEvidence({
      draft: coreDraft,
      montoItemQuantizations: quantizations(coreDraft),
      headerTotals: totals(),
    }));

    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.montoItemQuantizations)).toBe(true);
    expect(() => (result.montoItemQuantizations as Array<unknown>).push({})).toThrow(TypeError);
    expect(rootApi.isEcf31PersistableDraftEvidence(result)).toBe(true);
    expect(rootApi.isEcf31PersistableDraftEvidence({ ...result })).toBe(false);
  });

  it.each([
    [null, "INVALID_PERSISTABLE_DRAFT_EVIDENCE_INPUT"],
    ["draft", "INVALID_PERSISTABLE_DRAFT_EVIDENCE_INPUT"],
    [{ draft: {}, montoItemQuantizations: [], headerTotals: {} }, "INVALID_PERSISTABLE_DRAFT"],
  ])("returns catalog errors for invalid aggregate inputs", (input, code) => {
    expect(() => rootApi.createEcf31PersistableDraftEvidence(input)).not.toThrow();
    expect(rootApi.createEcf31PersistableDraftEvidence(input)).toMatchObject({ ok: false, error: { code } });
  });

  it("rejects forged totals and evidence plus missing, extra, duplicate, and reordered evidence", () => {
    const coreDraft = draft(2);
    const [first, second] = quantizations(coreDraft);
    const genuineTotals = totals();
    const invalidInputs = [
      { draft: coreDraft, montoItemQuantizations: [first, second], headerTotals: { ...genuineTotals } },
      { draft: coreDraft, montoItemQuantizations: [{ ...first }, second], headerTotals: genuineTotals },
      { draft: coreDraft, montoItemQuantizations: [first], headerTotals: genuineTotals },
      { draft: coreDraft, montoItemQuantizations: [first, second, first], headerTotals: genuineTotals },
      { draft: coreDraft, montoItemQuantizations: [first, first], headerTotals: genuineTotals },
      { draft: coreDraft, montoItemQuantizations: [second, first], headerTotals: genuineTotals },
    ];

    for (const input of invalidInputs) {
      expect(rootApi.createEcf31PersistableDraftEvidence(input)).toMatchObject({ ok: false });
    }
  });

  it("contains hostile getters, proxies, and iterators without diagnostics", () => {
    const coreDraft = draft(1);
    const throwingInput = { get draft() { throw new Error("trap"); } };
    const throwingCollection = new Proxy([], { get: () => { throw new Error("trap"); } });
    const iteratorTrap = quantizations(coreDraft);
    Object.defineProperty(iteratorTrap, Symbol.iterator, { get: () => { throw new Error("trap"); } });
    const revoked = Proxy.revocable({}, {}); revoked.revoke();

    for (const input of [
      throwingInput,
      { draft: coreDraft, montoItemQuantizations: throwingCollection, headerTotals: totals() },
      { draft: coreDraft, montoItemQuantizations: iteratorTrap, headerTotals: totals() },
      { draft: revoked.proxy, montoItemQuantizations: quantizations(coreDraft), headerTotals: totals() },
    ]) {
      expect(() => rootApi.createEcf31PersistableDraftEvidence(input)).not.toThrow();
      expect(rootApi.createEcf31PersistableDraftEvidence(input)).toMatchObject({ ok: false });
      expect(JSON.stringify(rootApi.createEcf31PersistableDraftEvidence(input))).not.toContain("trap");
    }
    expect(rootApi.isEcf31PersistableDraftEvidence(null)).toBe(false);
  });
});

it("exports persistable draft evidence from Builder and the package root", () => {
  expect(builderApi.createEcf31PersistableDraftEvidence).toBe(rootApi.createEcf31PersistableDraftEvidence);
  expect(builderApi.isEcf31PersistableDraftEvidence).toBe(rootApi.isEcf31PersistableDraftEvidence);
});

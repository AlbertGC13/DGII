import { describe, expect, it, vi } from "vitest";

import * as rootApi from "../../../index.js";
import * as builderApi from "../index.js";

const { captureLineCalculationEvidence, createEcf31CoreHeader, createEcf31CoreLine, createEcf31CoreDraft, createEcf31LineAmountEvidence, parseENcf, parseLineSequence, parseNonnegativeAmount, parseNonnegativeQuantity, parseTaxpayerIdentifier, parseUnitPrice } = rootApi;

function value<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false }): T {
  if (!result.ok) throw new Error("Expected a successful result.");
  return result.value;
}

function header() {
  return value(createEcf31CoreHeader({
    eNcf: value(parseENcf("E310000000001")),
    issuer: { taxpayerIdentifier: value(parseTaxpayerIdentifier("000000000")), legalName: "Synthetic issuer", address: "Synthetic address" },
    buyer: { taxpayerIdentifier: value(parseTaxpayerIdentifier("00000000000")), legalName: "Synthetic buyer" },
    issueDate: "01-12-2026", incomeType: "01", paymentType: "1",
  }));
}

function lineAmount(sequence: string) {
  const coreLine = value(createEcf31CoreLine({
    evidence: value(captureLineCalculationEvidence({
      sequence: value(parseLineSequence(sequence)), quantity: value(parseNonnegativeQuantity("1")),
      unitPrice: value(parseUnitPrice("1")), declaredAmount: value(parseNonnegativeAmount("1")),
    })), itemName: "Synthetic item", billingIndicator: 0, goodOrServiceIndicator: 1,
  }));
  return value(createEcf31LineAmountEvidence({ coreLine, discountAmount: value(parseNonnegativeAmount("0")), surchargeAmount: value(parseNonnegativeAmount("0")) }));
}

describe("Ecf31CoreDraft", () => {
  it("composes genuine header and ordered line amount evidence without issuing or recomputing amounts", () => {
    const genuineHeader = header();
    const lines = [lineAmount("1"), lineAmount("2")];
    const result = value(createEcf31CoreDraft({ header: genuineHeader, lineAmounts: lines }));
    expect(result.header).toBe(genuineHeader);
    expect(result.lineAmounts).toEqual(lines);
    expect(result.lineAmounts).not.toBe(lines);
    expect(result.lineAmounts[0]).toBe(lines[0]);
    expect(Object.isFrozen(result.lineAmounts)).toBe(true);
    expect(Object.isFrozen(result)).toBe(true);
    expect(rootApi.isEcf31CoreDraft(result)).toBe(true);
    expect(rootApi.isEcf31CoreDraft({ ...result })).toBe(false);
  });

  it("accepts more than 10,000 contiguous line amount evidence entries", () => {
    const lines = Array.from({ length: 10_001 }, (_, index) => lineAmount(String(index + 1)));
    const result = value(createEcf31CoreDraft({ header: header(), lineAmounts: lines }));
    expect(result.lineAmounts).toHaveLength(10_001);
    expect(result.lineAmounts[10_000]).toBe(lines[10_000]);
  });

  it.each([
    [null, "INVALID_CORE_DRAFT_INPUT"], ["draft", "INVALID_CORE_DRAFT_INPUT"],
    [{ header: { ...header() }, lineAmounts: [lineAmount("1")] }, "INVALID_CORE_DRAFT_HEADER"],
    [{ header: header(), lineAmounts: [] }, "INVALID_CORE_DRAFT_LINE_AMOUNTS"],
    [{ header: header(), lineAmounts: [{ ...lineAmount("1") }] }, "INVALID_CORE_DRAFT_LINE_AMOUNTS"],
    [{ header: header(), lineAmounts: [lineAmount("2")] }, "COLLECTION_STARTS_AFTER_ONE"],
    [{ header: header(), lineAmounts: [lineAmount("1"), lineAmount("3")] }, "COLLECTION_GAP"],
    [{ header: header(), lineAmounts: [lineAmount("1"), lineAmount("1")] }, "COLLECTION_DUPLICATE"],
    [{ header: header(), lineAmounts: [lineAmount("1"), lineAmount("3"), lineAmount("2")] }, "COLLECTION_OUT_OF_ORDER"],
  ])("returns safe catalog errors for malformed, forged, and noncontiguous inputs", (input, code) => {
    expect(() => createEcf31CoreDraft(input)).not.toThrow();
    expect(createEcf31CoreDraft(input)).toMatchObject({ ok: false, error: { code } });
    expect(JSON.stringify(createEcf31CoreDraft(input))).not.toContain("Synthetic");
  });

  it("contains hostile untrusted reads, copies, nested values, and iterators", () => {
    const revoked = Proxy.revocable([], {}); revoked.revoke();
    const throwingArray = new Proxy([], { get: () => { throw new Error("trap"); } });
    const throwingInput = { get header() { throw new Error("trap"); } };
    const throwingLine = new Proxy({}, { get: () => { throw new Error("trap"); } });
    const iteratorTrap = [lineAmount("1")];
    Object.defineProperty(iteratorTrap, Symbol.iterator, { get: () => { throw new Error("trap"); } });
    for (const input of [throwingInput, { header: header(), lineAmounts: revoked.proxy }, { header: header(), lineAmounts: throwingArray }, { header: header(), lineAmounts: [throwingLine] }, { header: header(), lineAmounts: iteratorTrap }]) {
      expect(() => createEcf31CoreDraft(input)).not.toThrow();
      expect(createEcf31CoreDraft(input)).toMatchObject({ ok: false });
    }
    expect(rootApi.isEcf31CoreDraft(revoked.proxy)).toBe(false);
  });

  it("does not swallow internal validation failures", () => {
    const map = vi.spyOn(Array.prototype, "map").mockImplementation(() => { throw new Error("unexpected map failure"); });
    try {
      expect(() => createEcf31CoreDraft({ header: header(), lineAmounts: [lineAmount("1")] })).toThrow("unexpected map failure");
    } finally {
      map.mockRestore();
    }
  });
});

it("exports the Ecf31CoreDraft contract from Builder and the package root", () => {
  expect(builderApi.createEcf31CoreDraft).toBe(rootApi.createEcf31CoreDraft);
  expect(builderApi.isEcf31CoreDraft).toBe(rootApi.isEcf31CoreDraft);
});

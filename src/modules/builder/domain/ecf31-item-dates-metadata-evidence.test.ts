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

function entries(input: ReturnType<typeof fixture>) {
  return input.lineAmounts.map((source, index) => index === 0
    ? { source, elaborationDate: "29-02-2000", itemExpirationDate: "29-02-2028" }
    : { source, itemExpirationDate: "01-03-2028" });
}

describe("Ecf31ItemDatesMetadataEvidence", () => {
  it("captures independently optional canonical real Gregorian dates", () => {
    const input = fixture();
    const evidence = value(rootApi.createEcf31ItemDatesMetadataEvidence({ draft: input.draft, entries: entries(input) }));

    expect(evidence).toEqual({ draft: input.draft, entries: [
      { source: input.lineAmounts[0], elaborationDate: "29-02-2000", itemExpirationDate: "29-02-2028" },
      { source: input.lineAmounts[1], itemExpirationDate: "01-03-2028" },
    ] });
  });

  it("rejects noncanonical, impossible, nonstring, and out-of-range dates with a fixed error", () => {
    const input = fixture(1);
    for (const date of ["29-02-1900", "31-04-2028", "01-01-1899", "01-01-2100", "1-01-2028", "01-1-2028", "01-01-28", "01/01/2028", " 01-01-2028", "01-01-2028 ", "2028-01-01", "", 0, null, {}]) {
      expect(rootApi.createEcf31ItemDatesMetadataEvidence({ draft: input.draft, entries: [{ source: input.lineAmounts[0], elaborationDate: date }] })).toMatchObject({ ok: false, error: { code: "INVALID_ECF31_ITEM_DATE" } });
    }
  });

  it("rejects clones, reversals, missing or extra entries, foreign sources, and explicit undefined", () => {
    const input = fixture();
    const valid = entries(input);
    const other = fixture();
    for (const candidate of [
      { draft: { ...input.draft }, entries: valid }, { draft: input.draft, entries: [...valid].reverse() },
      { draft: input.draft, entries: valid.slice(0, 1) }, { draft: input.draft, entries: [...valid, valid[0]] },
      { draft: input.draft, entries: [{ source: other.lineAmounts[0] }, valid[1]] },
      { draft: input.draft, entries: [{ source: input.lineAmounts[0], elaborationDate: undefined }, valid[1]] },
    ]) expect(rootApi.createEcf31ItemDatesMetadataEvidence(candidate)).toMatchObject({ ok: false, error: { code: "INVALID_ECF31_ITEM_DATES_METADATA_INPUT" } });
  });

  it("safely rejects proxies, accessors, sparse or subclass arrays, symbols, and unexpected keys", () => {
    const input = fixture();
    const valid = entries(input);
    const accessor = { draft: input.draft, entries: valid };
    Object.defineProperty(accessor, "entries", { enumerable: true, get: () => { throw new Error("trap"); } });
    const sparse = valid.slice(); sparse.length = 3;
    const accessorEntries = valid.slice();
    Object.defineProperty(accessorEntries, "0", { enumerable: true, get: () => { throw new Error("trap"); } });
    const revoked = Proxy.revocable({}, {}); revoked.revoke();
    const revokedEntries = Proxy.revocable(valid, {}); revokedEntries.revoke();
    const hostile = [accessor, revoked.proxy, new Proxy({}, { ownKeys: () => { throw new Error("trap"); } }),
      new (class { draft = input.draft; entries = valid; })(),
      { draft: input.draft, entries: sparse }, { draft: input.draft, entries: new (class extends Array {})() },
      { draft: input.draft, entries: accessorEntries }, { draft: input.draft, entries: new Proxy(valid, {}) },
      { draft: input.draft, entries: revokedEntries.proxy },
      { draft: input.draft, entries: valid, [Symbol("x")]: true }, { draft: input.draft, entries: [{ ...valid[0], extra: true }, valid[1]] },
    ];
    for (const candidate of hostile) {
      expect(() => rootApi.createEcf31ItemDatesMetadataEvidence(candidate)).not.toThrow();
      expect(rootApi.createEcf31ItemDatesMetadataEvidence(candidate)).toMatchObject({ ok: false, error: { code: "INVALID_ECF31_ITEM_DATES_METADATA_INPUT" } });
    }
  });

  it("defensively copies, deeply freezes, authenticates only created evidence, and exports the API", () => {
    const input = fixture(1);
    const source = entries(input);
    const evidence = value(rootApi.createEcf31ItemDatesMetadataEvidence({ draft: input.draft, entries: source }));
    const lineAmount = input.lineAmounts[0];
    if (lineAmount === undefined) throw new Error("Expected a line amount.");
    source[0] = { source: lineAmount, elaborationDate: "01-01-2028", itemExpirationDate: "01-03-2028" };

    expect(evidence.entries[0]).toEqual({ source: input.lineAmounts[0], elaborationDate: "29-02-2000", itemExpirationDate: "29-02-2028" });
    expect([evidence, evidence.entries, evidence.entries[0]].every(Object.isFrozen)).toBe(true);
    expect(rootApi.isEcf31ItemDatesMetadataEvidence(evidence)).toBe(true);
    expect(rootApi.isEcf31ItemDatesMetadataEvidence({ ...evidence })).toBe(false);
    const revoked = Proxy.revocable(evidence, {}); revoked.revoke();
    expect(() => rootApi.isEcf31ItemDatesMetadataEvidence(revoked.proxy)).not.toThrow();
    expect(rootApi.isEcf31ItemDatesMetadataEvidence(revoked.proxy)).toBe(false);
    expect(builderApi.createEcf31ItemDatesMetadataEvidence).toBe(rootApi.createEcf31ItemDatesMetadataEvidence);
  });
});

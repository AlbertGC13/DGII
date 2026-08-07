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

function entries(input: ReturnType<typeof fixture>, units: readonly (string | undefined)[]) {
  return input.lineAmounts.map((source, index) => units[index] === undefined ? { source } : { source, unit: units[index] });
}

describe("Ecf31UnitOfMeasureCode", () => {
  it("parses and formats every canonical code from 1 through 62", () => {
    for (let number = 1; number <= 62; number += 1) {
      const parsed = value(rootApi.parseEcf31UnitOfMeasureCode(String(number)));
      expect(rootApi.formatEcf31UnitOfMeasureCode(parsed)).toBe(String(number));
    }
  });

  it("rejects noncanonical, out-of-range, and nonstring codes with a fixed error", () => {
    for (const input of ["", "0", "00", "01", "1 ", "63", 18, null, {}, Symbol("18")]) {
      expect(rootApi.parseEcf31UnitOfMeasureCode(input)).toEqual({ ok: false, error: {
        code: "INVALID_ECF31_UNIT_OF_MEASURE_CODE", message: "Unit of measure code must be a canonical string from 1 through 62.",
      } });
    }
  });
});

describe("Ecf31ItemUnitMetadataEvidence", () => {
  it("captures ordered optional units, including code 18 and ISC-classified lines", () => {
    const input = fixture();
    const isc = value(rootApi.createEcf31AdditionalTaxClassificationEvidence({ draft: input.draft,
      entries: input.lineAmounts.map((source, index) => ({ source, codes: index === 0 ? ["006"] : [] })),
    }));
    const evidence = value(rootApi.createEcf31ItemUnitMetadataEvidence({ draft: input.draft, entries: entries(input, ["18", undefined]) }));
    expect(isc.qualifyingIscAbsent).toBe(false);
    expect(evidence).toEqual({ draft: input.draft, entries: [{ source: input.lineAmounts[0], unit: "18" }, { source: input.lineAmounts[1] }] });
  });

  it("rejects forged, reordered, missing, extra, cloned, and malformed line input", () => {
    const input = fixture();
    const valid = entries(input, ["1", undefined]);
    const other = fixture();
    for (const candidate of [
      { draft: input.draft, entries: valid.slice(0, 1) }, { draft: input.draft, entries: [...valid].reverse() },
      { draft: input.draft, entries: [...valid, valid[0]] }, { draft: { ...input.draft }, entries: valid },
      { draft: input.draft, entries: [{ source: { ...input.lineAmounts[0] }, unit: "1" }, valid[1]] },
      { draft: input.draft, entries: [{ source: other.lineAmounts[0], unit: "1" }, valid[1]] },
      { draft: input.draft, entries: [{ source: input.lineAmounts[0], unit: undefined }, valid[1]] },
      { draft: input.draft, entries: [{ source: input.lineAmounts[0], unit: "01" }, valid[1]] },
    ]) expect(rootApi.createEcf31ItemUnitMetadataEvidence(candidate)).toMatchObject({ ok: false, error: { code: "INVALID_ECF31_ITEM_UNIT_METADATA_INPUT" } });
  });

  it("safely rejects hostile outer, nested, proxy, accessor, sparse, subclass, symbol, and extra values", () => {
    const input = fixture();
    const valid = entries(input, [undefined, undefined]);
    const accessor = { draft: input.draft, entries: valid };
    Object.defineProperty(accessor, "entries", { enumerable: true, get: () => { throw new Error("secret"); } });
    const sparse = entries(input, [undefined, undefined]); sparse.length = 3;
    const nestedAccessor: unknown[] = [];
    Object.defineProperty(nestedAccessor, "0", { enumerable: true, get: () => "trap" });
    const revoked = Proxy.revocable({}, {}); revoked.revoke();
    const throwingEntries = new Proxy([], { ownKeys: () => { throw new Error("trap"); } });
    const invalidLengthEntries = new Proxy([], { get: (_target, key) => key === "length" ? Number.NaN : undefined });
    const hostile = [null, [], Object.create({ draft: input.draft, entries: valid }), Object.setPrototypeOf({ draft: input.draft, entries: valid }, {}),
      { draft: input.draft, entries: valid, extra: true }, { draft: input.draft, entries: valid, [Symbol("x")]: true }, accessor, revoked.proxy,
      { draft: input.draft, entries: sparse }, { draft: input.draft, entries: new (class extends Array {})() }, { draft: input.draft, entries: nestedAccessor },
      { draft: input.draft, entries: throwingEntries }, { draft: input.draft, entries: invalidLengthEntries },
      new Proxy({}, { ownKeys: () => { throw new Error("trap"); } }), { draft: input.draft, entries: [{ source: input.lineAmounts[0], unit: "1", extra: true }, valid[1]] },
    ];
    for (const candidate of hostile) {
      expect(() => rootApi.createEcf31ItemUnitMetadataEvidence(candidate)).not.toThrow();
      expect(rootApi.createEcf31ItemUnitMetadataEvidence(candidate)).toEqual({ ok: false, error: {
        code: "INVALID_ECF31_ITEM_UNIT_METADATA_INPUT", message: "E-CF 31 item-unit metadata input is invalid.",
      } });
    }
  });

  it("defensively copies, deeply freezes, and authenticates only created evidence", () => {
    const input = fixture(1);
    const source = entries(input, ["62"]);
    const evidence = value(rootApi.createEcf31ItemUnitMetadataEvidence({ draft: input.draft, entries: source }));
    const lineAmount = input.lineAmounts[0];
    if (lineAmount === undefined) throw new Error("Expected a line amount.");
    source[0] = { source: lineAmount, unit: "1" };
    expect(evidence.entries[0]).toEqual({ source: input.lineAmounts[0], unit: "62" });
    expect([evidence, evidence.entries, evidence.entries[0]].every(Object.isFrozen)).toBe(true);
    expect(rootApi.isEcf31ItemUnitMetadataEvidence(evidence)).toBe(true);
    expect(rootApi.isEcf31ItemUnitMetadataEvidence({ ...evidence })).toBe(false);
  });
});

it("exports the unit API from Builder and the package root", () => {
  expect(builderApi.createEcf31ItemUnitMetadataEvidence).toBe(rootApi.createEcf31ItemUnitMetadataEvidence);
  expect(builderApi.parseEcf31UnitOfMeasureCode).toBe(rootApi.parseEcf31UnitOfMeasureCode);
});

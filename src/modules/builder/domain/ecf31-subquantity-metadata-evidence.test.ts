import { describe, expect, it } from "vitest";

import * as rootApi from "../../../index.js";
import * as builderApi from "../index.js";
import type { Result } from "../../../index.js";

function value<T>(result: Result<T, unknown>): T {
  if (!result.ok) throw new Error("Expected a successful result.");
  return result.value;
}

function draft() {
  const header = value(rootApi.createEcf31CoreHeader({
    eNcf: value(rootApi.parseENcf("E310000000001")),
    issuer: { taxpayerIdentifier: value(rootApi.parseTaxpayerIdentifier("000000000")), legalName: "Synthetic issuer", address: "Synthetic address" },
    buyer: { taxpayerIdentifier: value(rootApi.parseTaxpayerIdentifier("00000000000")), legalName: "Synthetic buyer" },
    issueDate: "01-12-2026", incomeType: "01", paymentType: "1",
  }));
  const lineAmounts = ["1", "2"].map((sequence) => value(rootApi.createEcf31LineAmountEvidence({
    coreLine: value(rootApi.createEcf31CoreLine({
      evidence: value(rootApi.captureLineCalculationEvidence({
        sequence: value(rootApi.parseLineSequence(sequence)), quantity: value(rootApi.parseNonnegativeQuantity("1")),
        unitPrice: value(rootApi.parseUnitPrice("1")), declaredAmount: value(rootApi.parseNonnegativeAmount("1")),
      })), itemName: `Synthetic item ${sequence}`, billingIndicator: 1, goodOrServiceIndicator: 1,
    })), discountAmount: value(rootApi.parseNonnegativeAmount("0")), surchargeAmount: value(rootApi.parseNonnegativeAmount("0")),
  })));
  return value(rootApi.createEcf31CoreDraft({ header, lineAmounts }));
}

function validInput() {
  const source = draft();
  return {
    draft: source,
    entries: source.lineAmounts.map((line, index) => ({
      source: line,
      subquantities: index === 0
        ? [{ subquantity: value(rootApi.parseNonnegativeSubquantity("9999999999999999.999")), unit: value(rootApi.parseEcf31UnitOfMeasureCode("18")) }]
        : [],
    })),
  };
}

describe("e-CF 31 subquantity metadata evidence", () => {
  it("captures exactly one ordered immutable entry per genuine draft line", () => {
    const input = validInput();
    const result = value(rootApi.createEcf31SubquantityMetadataEvidence(input));

    expect(result.entries).toHaveLength(2);
    expect(result.entries.map((entry) => entry.source)).toEqual(input.draft.lineAmounts);
    expect(result.entries[0]?.subquantities.map((pair) => [rootApi.formatDecimal(pair.subquantity), rootApi.formatEcf31UnitOfMeasureCode(pair.unit)]))
      .toEqual([["9999999999999999.999", "18"]]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.entries)).toBe(true);
    expect(Object.isFrozen(result.entries[0])).toBe(true);
    expect(Object.isFrozen(result.entries[0]?.subquantities)).toBe(true);
    expect(Object.isFrozen(result.entries[0]?.subquantities[0])).toBe(true);
    expect(result.entries).not.toBe(input.entries);
    expect(rootApi.isEcf31SubquantityMetadataEvidence(result)).toBe(true);
    expect(rootApi.isEcf31SubquantityMetadataEvidence({ ...result })).toBe(false);
  });

  it.each([
    (input: ReturnType<typeof validInput>) => ({ ...input, entries: [] }),
    (input: ReturnType<typeof validInput>) => ({ ...input, entries: [...input.entries].reverse() }),
    (input: ReturnType<typeof validInput>) => ({ ...input, entries: [input.entries[0], input.entries[0]] }),
    (input: ReturnType<typeof validInput>) => ({ ...input, entries: [...input.entries, input.entries[0]] }),
    (input: ReturnType<typeof validInput>) => ({ ...input, entries: [{ ...input.entries[0], source: input.draft.lineAmounts[1] }, input.entries[1]] }),
    (input: ReturnType<typeof validInput>) => ({ ...input, entries: [{ source: input.draft.lineAmounts[0], subquantities: [{ subquantity: value(rootApi.parseNonnegativeSubquantity("1")) }] }, input.entries[1]] }),
    (input: ReturnType<typeof validInput>) => ({ ...input, entries: [{ source: input.draft.lineAmounts[0], subquantities: [{ subquantity: undefined, unit: value(rootApi.parseEcf31UnitOfMeasureCode("1")) }] }, input.entries[1]] }),
    (input: ReturnType<typeof validInput>) => ({ ...input, entries: [{ source: input.draft.lineAmounts[0], subquantities: Array.from({ length: 6 }, () => ({ subquantity: value(rootApi.parseNonnegativeSubquantity("1")), unit: value(rootApi.parseEcf31UnitOfMeasureCode("1")) })) }, input.entries[1]] }),
    (input: ReturnType<typeof validInput>) => ({ ...input, entries: [{ source: input.draft.lineAmounts[0], subquantities: [{ subquantity: "1", unit: "1" }] }, input.entries[1]] }),
    (input: ReturnType<typeof validInput>) => ({ ...input, entries: [{ source: input.draft.lineAmounts[0], subquantities: [{ subquantity: value(rootApi.parseUnitPrice("1.2345")), unit: value(rootApi.parseEcf31UnitOfMeasureCode("1")) }] }, input.entries[1]] }),
    (input: ReturnType<typeof validInput>) => ({ ...input, entries: [{ source: input.draft.lineAmounts[0], subquantities: [{ subquantity: value(rootApi.parseNonnegativeSubquantity("1")), unit: "01" }] }, input.entries[1]] }),
  ])("returns one safe catalog error for invalid contracts", (mutate) => {
    expect(rootApi.createEcf31SubquantityMetadataEvidence(mutate(validInput()))).toEqual({
      ok: false,
      error: { code: "INVALID_ECF31_SUBQUANTITY_METADATA_INPUT", message: "E-CF 31 subquantity metadata input is invalid." },
    });
  });

  it("rejects clones and hostile, accessor, symbol, sparse, subclassed, proxy, and revoked input safely", () => {
    const input = validInput();
    const foreign = validInput();
    const sparse = [...input.entries]; sparse.length = 3;
    const accessor = { ...input.entries[0] };
    Object.defineProperty(accessor, "subquantities", { enumerable: true, get() { throw new Error("trap"); } });
    const symbol = { ...input.entries[0] }; Object.defineProperty(symbol, Symbol("extra"), { value: true });
    class Entries extends Array {}
    const subclassed = new Entries(); subclassed.push(...input.entries);
    const revoked = Proxy.revocable({}, {}); revoked.revoke();
    const hostile = new Proxy({}, { ownKeys() { throw new Error("trap"); } });

    for (const candidate of [
      { ...input, draft: { ...input.draft } }, { ...input, entries: sparse }, { ...input, entries: [accessor, input.entries[1]] },
      { ...input, entries: [symbol, input.entries[1]] }, { ...input, entries: subclassed },
      { ...input, entries: [{ ...input.entries[0], source: foreign.draft.lineAmounts[0] }, input.entries[1]] },
      new Proxy(input, {}), revoked.proxy, hostile,
    ]) {
      expect(() => rootApi.createEcf31SubquantityMetadataEvidence(candidate)).not.toThrow();
      expect(rootApi.createEcf31SubquantityMetadataEvidence(candidate)).toEqual({
        ok: false,
        error: { code: "INVALID_ECF31_SUBQUANTITY_METADATA_INPUT", message: "E-CF 31 subquantity metadata input is invalid." },
      });
    }
  });
});

it("exports subquantity metadata evidence from Builder and the package root", () => {
  expect(builderApi.createEcf31SubquantityMetadataEvidence).toBe(rootApi.createEcf31SubquantityMetadataEvidence);
  expect(builderApi.isEcf31SubquantityMetadataEvidence).toBe(rootApi.isEcf31SubquantityMetadataEvidence);
});

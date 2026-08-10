import { describe, expect, it } from "vitest";

import * as builderApi from "../index.js";
import * as rootApi from "../../../index.js";
import type { Result } from "../../../index.js";
import { createEcf31RetentionMetadataEvidence, formatEcf31RetentionIndicator, parseEcf31RetentionIndicator } from "./ecf31-retention-metadata-evidence.js";
import type { Ecf31RetentionIndicator } from "./ecf31-retention-metadata-evidence.js";
import { formatDecimal } from "./exact-decimal.js";
import type { NonnegativeAmount } from "./exact-decimal.js";

function value<T>(result: Result<T, unknown>): T {
  if (!result.ok) throw new Error("Expected a successful result.");
  return result.value;
}

function amount(entry: { itbisRetainedAmount?: NonnegativeAmount } | undefined, field: "itbisRetainedAmount"): NonnegativeAmount;
function amount(entry: { isrRetainedAmount?: NonnegativeAmount } | undefined, field: "isrRetainedAmount"): NonnegativeAmount;
function amount(entry: { itbisRetainedAmount?: NonnegativeAmount; isrRetainedAmount?: NonnegativeAmount } | undefined, field: "itbisRetainedAmount" | "isrRetainedAmount"): NonnegativeAmount {
  if (entry === undefined) throw new Error("missing entry");
  const candidate = entry[field];
  if (candidate === undefined) throw new Error(`missing ${field}`);
  return candidate;
}

function indicator(entry: { indicator?: Ecf31RetentionIndicator } | undefined): Ecf31RetentionIndicator {
  if (entry === undefined || entry.indicator === undefined) throw new Error("missing indicator");
  return entry.indicator;
}

function fixture(lines = 3) {
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

describe("Ecf31RetentionMetadataEvidence", () => {
  it("captures independently optional indicator and retention amounts per line in source order", () => {
    const input = fixture();
    const entries = [
      { source: input.lineAmounts[0], indicator: 1, itbisRetainedAmount: "10.50", isrRetainedAmount: "2" },
      { source: input.lineAmounts[1], indicator: 2 },
      { source: input.lineAmounts[2], itbisRetainedAmount: "0" },
    ];
    const evidence = value(createEcf31RetentionMetadataEvidence({ draft: input.draft, entries }));

    expect(evidence.draft).toBe(input.draft);
    expect(evidence.entries.length).toBe(3);
    expect(evidence.entries[0]?.source).toBe(input.lineAmounts[0]);
    expect(evidence.entries[0]?.indicator).toBe(1);
    expect(formatDecimal(amount(evidence.entries[0], "itbisRetainedAmount"))).toBe("10.5");
    expect(formatDecimal(amount(evidence.entries[0], "isrRetainedAmount"))).toBe("2");
    expect(formatEcf31RetentionIndicator(indicator(evidence.entries[0]))).toBe("1");
    expect(evidence.entries[1]?.source).toBe(input.lineAmounts[1]);
    expect(evidence.entries[1]?.indicator).toBe(2);
    expect(evidence.entries[1]?.itbisRetainedAmount).toBeUndefined();
    expect(formatEcf31RetentionIndicator(indicator(evidence.entries[1]))).toBe("2");
    expect(evidence.entries[2]?.source).toBe(input.lineAmounts[2]);
    expect(evidence.entries[2]?.indicator).toBeUndefined();
    expect(formatDecimal(amount(evidence.entries[2], "itbisRetainedAmount"))).toBe("0");
    expect(evidence.entries[2]?.isrRetainedAmount).toBeUndefined();
  });

  it("allows source-only entries and accepts zero amounts without coupling fields", () => {
    const input = fixture(1);
    const evidence = value(createEcf31RetentionMetadataEvidence({ draft: input.draft, entries: [{ source: input.lineAmounts[0] }] }));

    expect(evidence.entries).toEqual([{ source: input.lineAmounts[0] }]);
    const withAmountOnly = value(createEcf31RetentionMetadataEvidence({ draft: input.draft, entries: [{ source: input.lineAmounts[0], isrRetainedAmount: "0.00" }] }));
    expect(formatDecimal(amount(withAmountOnly.entries[0], "isrRetainedAmount"))).toBe("0");
    expect(withAmountOnly.entries[0]?.indicator).toBeUndefined();
  });

  it.each([1, 2] as const)("parses the official retention/perception indicator %i", (indicatorValue) => {
    const parsed = parseEcf31RetentionIndicator(indicatorValue);
    expect(parsed.ok).toBe(true);
    expect(formatEcf31RetentionIndicator(value(parsed))).toBe(String(indicatorValue));
  });

  it("rejects non-official indicator values with a fixed error", () => {
    for (const indicatorValue of [0, 3, -1, "1", "2", 1.5, NaN, Infinity, null, true, {}, []]) {
      expect(parseEcf31RetentionIndicator(indicatorValue)).toMatchObject({ ok: false, error: { code: "INVALID_ECF31_RETENTION_INDICATOR" } });
    }
    const input = fixture(1);
    expect(createEcf31RetentionMetadataEvidence({ draft: input.draft, entries: [{ source: input.lineAmounts[0], indicator: 3 }] })).toMatchObject({ ok: false, error: { code: "INVALID_ECF31_RETENTION_INDICATOR" } });
  });

  it("rejects negative, overscale, and noncanonical amounts with a fixed error", () => {
    const input = fixture(1);
    for (const amountValue of ["-0.01", "1.001", "abc", "1.2.3", "", " 1", "1 ", 0, null, {}, true]) {
      expect(createEcf31RetentionMetadataEvidence({ draft: input.draft, entries: [{ source: input.lineAmounts[0], itbisRetainedAmount: amountValue }] })).toMatchObject({ ok: false, error: { code: "INVALID_ECF31_RETENTION_AMOUNT" } });
      expect(createEcf31RetentionMetadataEvidence({ draft: input.draft, entries: [{ source: input.lineAmounts[0], isrRetainedAmount: amountValue }] })).toMatchObject({ ok: false, error: { code: "INVALID_ECF31_RETENTION_AMOUNT" } });
    }
  });

  it("rejects clones, reversals, missing or extra entries, foreign sources, explicit undefined, proxies, and hostile wrappers", () => {
    const input = fixture();
    const retained = { source: input.lineAmounts[0], indicator: 1, itbisRetainedAmount: "1" };
    const valid = [
      retained,
      { source: input.lineAmounts[1] },
      { source: input.lineAmounts[2], isrRetainedAmount: "2" },
    ];
    const other = fixture();
    const revoked = Proxy.revocable(retained, {}); revoked.revoke();
    for (const candidate of [
      { draft: { ...input.draft }, entries: valid },
      { draft: input.draft, entries: [...valid].reverse() },
      { draft: input.draft, entries: valid.slice(0, 2) },
      { draft: input.draft, entries: [...valid, retained] },
      { draft: input.draft, entries: [{ source: other.lineAmounts[0] }, valid[1], valid[2]] },
      { draft: input.draft, entries: [{ source: input.lineAmounts[0], indicator: undefined }, valid[1], valid[2]] },
      { draft: input.draft, entries: [{ source: input.lineAmounts[0], itbisRetainedAmount: undefined }, valid[1], valid[2]] },
      { draft: input.draft, entries: [new Proxy(retained, {}), valid[1], valid[2]] },
      { draft: input.draft, entries: [revoked.proxy, valid[1], valid[2]] },
      { draft: input.draft, entries: [{ source: input.lineAmounts[0], indicator: 1, extra: true }, valid[1], valid[2]] },
    ]) {
      expect(createEcf31RetentionMetadataEvidence(candidate)).toMatchObject({ ok: false, error: { code: "INVALID_ECF31_RETENTION_METADATA_INPUT" } });
    }
    expect(createEcf31RetentionMetadataEvidence(null)).toMatchObject({ ok: false, error: { code: "INVALID_ECF31_RETENTION_METADATA_INPUT" } });
    expect(createEcf31RetentionMetadataEvidence({ draft: input.draft })).toMatchObject({ ok: false, error: { code: "INVALID_ECF31_RETENTION_METADATA_INPUT" } });
    expect(createEcf31RetentionMetadataEvidence({ entries: valid })).toMatchObject({ ok: false, error: { code: "INVALID_ECF31_RETENTION_METADATA_INPUT" } });
  });

  it("authenticates genuine evidence and rejects forged, foreign, and proxied lookalikes", () => {
    const input = fixture(1);
    const genuine = value(createEcf31RetentionMetadataEvidence({ draft: input.draft, entries: [{ source: input.lineAmounts[0], indicator: 1, itbisRetainedAmount: "1" }] }));

    expect(rootApi.isEcf31RetentionMetadataEvidence(genuine)).toBe(true);
    expect(builderApi.isEcf31RetentionMetadataEvidence(genuine)).toBe(true);
    expect(rootApi.isEcf31RetentionMetadataEvidence({ ...genuine })).toBe(false);
    expect(rootApi.isEcf31RetentionMetadataEvidence({ draft: input.draft, entries: [{ source: input.lineAmounts[0], indicator: 1, itbisRetainedAmount: "1" }] })).toBe(false);
    expect(rootApi.isEcf31RetentionMetadataEvidence(new Proxy(genuine, {}))).toBe(false);
    expect(Object.isFrozen(genuine)).toBe(true);
    expect(Object.isFrozen(genuine.entries)).toBe(true);
    expect(genuine.entries[0]?.source).toBe(input.lineAmounts[0]);
  });
});

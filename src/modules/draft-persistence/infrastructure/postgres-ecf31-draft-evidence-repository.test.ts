import { describe, expect, it, vi } from "vitest";

import * as api from "../../../index.js";
import type { Result } from "../../../index.js";

function value<T>(result: Result<T, unknown>): T {
  if (!result.ok) throw new Error("Expected a successful result.");
  return result.value;
}

function evidence() {
  const header = value(api.createEcf31CoreHeader({
    eNcf: value(api.parseENcf("E310000000001")),
    issuer: { taxpayerIdentifier: value(api.parseTaxpayerIdentifier("000000000")), legalName: "Synthetic issuer", address: "Synthetic address" },
    buyer: { taxpayerIdentifier: value(api.parseTaxpayerIdentifier("00000000000")), legalName: "Synthetic buyer" },
    issueDate: "01-12-2026", incomeType: "01", paymentType: "1",
  }));
  const lineAmount = value(api.createEcf31LineAmountEvidence({
    coreLine: value(api.createEcf31CoreLine({
      evidence: value(api.captureLineCalculationEvidence({
        sequence: value(api.parseLineSequence("1")), quantity: value(api.parseNonnegativeQuantity("1")),
        unitPrice: value(api.parseUnitPrice("1")), declaredAmount: value(api.parseNonnegativeAmount("1")),
      })), itemName: "Synthetic item", billingIndicator: 0, goodOrServiceIndicator: 1,
    })), discountAmount: value(api.parseNonnegativeAmount("0")), surchargeAmount: value(api.parseNonnegativeAmount("0")),
  }));
  return value(api.createEcf31PersistableDraftEvidence({
    draft: value(api.createEcf31CoreDraft({ header, lineAmounts: [lineAmount] })),
    montoItemQuantizations: [value(api.createEcf31MontoItemQuantizationEvidence(lineAmount))],
    headerTotals: value(api.createEcf31HeaderTotalsEvidence({})),
  }));
}

const input = () => ({ scopeId: "synthetic-scope", eNcf: "E310000000001", idempotencyKey: "key", fingerprint: "fingerprint", evidence: evidence() });

describe("PostgresEcf31DraftEvidenceRepository", () => {
  it("saves through only the supplied client with a parameterized canonical snapshot", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ outcome: "stored" }] });
    const client = { query, connect: () => { throw new Error("pool access"); }, release: () => { throw new Error("release"); } };

    await expect(api.saveEcf31DraftEvidence(client, input())).resolves.toEqual({ outcome: "stored" });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[0]).toBe("SELECT outcome FROM store_ecf31_draft_evidence($1, $2, $3, $4, $5::jsonb)");
    expect(query.mock.calls[0]?.[1]).toEqual([
      "synthetic-scope", "E310000000001", "key", "fingerprint",
      JSON.stringify(value(api.serializeEcf31PersistableDraftEvidence(input().evidence))),
    ]);
  });

  it("maps only known storage outcomes and invalid or unavailable states without diagnostics", async () => {
    for (const outcome of ["replayed", "conflict", "missing_allocation"] as const) {
      await expect(api.saveEcf31DraftEvidence({ query: vi.fn().mockResolvedValue({ rows: [{ outcome }] }) }, input()))
        .resolves.toEqual({ outcome });
    }
    const secret = "constraint secret-input stack";
    for (const client of [
      { query: vi.fn().mockResolvedValue({ rows: [{ outcome: "unexpected" }] }) },
      { query: vi.fn().mockResolvedValue({ rows: [] }) },
      { query: vi.fn().mockRejectedValue(new Error(secret)) },
    ]) {
      const result = await api.saveEcf31DraftEvidence(client, input());
      expect(result).toEqual({ outcome: "persistence_unavailable" });
      expect(JSON.stringify(result)).not.toContain(secret);
    }
    for (const invalid of [
      { ...input(), scopeId: "" }, { ...input(), eNcf: "" }, { ...input(), idempotencyKey: "" },
      { ...input(), fingerprint: "" }, { ...input(), evidence: {} },
      null,
      new Proxy({}, { get: () => { throw new Error("input trap"); } }),
    ]) await expect(api.saveEcf31DraftEvidence({ query: vi.fn() }, invalid)).resolves.toEqual({ outcome: "invalid_input" });
    await expect(api.saveEcf31DraftEvidence({ query: vi.fn().mockResolvedValue({ rows: [new Proxy({}, { get: () => { throw new Error("row trap"); } })] }) }, input()))
      .resolves.toEqual({ outcome: "persistence_unavailable" });
  });

  it("finds only parameterized trusted identities and restores genuine evidence", async () => {
    const saved = value(api.serializeEcf31PersistableDraftEvidence(evidence()));
    const query = vi.fn().mockResolvedValue({ rows: [{ snapshot: saved }] });

    const result = await api.findEcf31DraftEvidence({ query }, { scopeId: "scope'; select 1; --", eNcf: "E310000000001" });
    expect(result.outcome).toBe("found");
    expect(result.outcome === "found" && api.isEcf31PersistableDraftEvidence(result.evidence)).toBe(true);
    expect(query.mock.calls[0]).toEqual([
      "SELECT snapshot FROM ecf31_draft_evidence_snapshots WHERE scope_id = $1 AND e_ncf = $2",
      ["scope'; select 1; --", "E310000000001"],
    ]);
  });

  it("contains not-found, corrupt stored data, and query failures as catalog outcomes", async () => {
    for (const response of [
      { rows: [] },
      { rows: [{ snapshot: { schema: "invalid" } }] },
    ]) {
      const result = await api.findEcf31DraftEvidence({ query: vi.fn().mockResolvedValue(response) }, { scopeId: "scope", eNcf: "E310000000001" });
      expect(["not_found", "corrupt_stored_evidence"]).toContain(result.outcome);
    }
    const result = await api.findEcf31DraftEvidence({ query: vi.fn().mockRejectedValue(new Error("query secret")) }, { scopeId: "scope", eNcf: "E310000000001" });
    expect(result).toEqual({ outcome: "persistence_unavailable" });
    expect(JSON.stringify(result)).not.toContain("secret");
    await expect(api.findEcf31DraftEvidence({ query: vi.fn() }, null))
      .resolves.toEqual({ outcome: "invalid_input" });
    await expect(api.findEcf31DraftEvidence({ query: vi.fn() }, { scopeId: "scope", eNcf: "" }))
      .resolves.toEqual({ outcome: "invalid_input" });
    await expect(api.findEcf31DraftEvidence({ query: vi.fn() }, new Proxy({}, { get: () => { throw new Error("input trap"); } })))
      .resolves.toEqual({ outcome: "invalid_input" });
    await expect(api.findEcf31DraftEvidence({ query: vi.fn().mockResolvedValue({ rows: [{ snapshot: {} }, { snapshot: {} }] }) }, { scopeId: "scope", eNcf: "E310000000001" }))
      .resolves.toEqual({ outcome: "persistence_unavailable" });
  });
});

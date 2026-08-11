import { describe, expect, it, vi } from "vitest";

import * as api from "../../../index.js";

const input = () => ({
  scopeId: "synthetic-scope",
  ecfType: "E31" as const,
  idempotencyKey: "synthetic-key",
  fingerprint: "synthetic-fingerprint",
  requestedOn: "2030-06-15",
});

describe("allocateFiscalSequence", () => {
  it("uses only the caller-owned client and the canonical function parameters", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ outcome: "allocated", allocated_value: "42" }] });
    const client = { query, connect: () => { throw new Error("pool access"); } };

    await expect(api.allocateFiscalSequence(client, input())).resolves.toMatchObject({
      outcome: "allocated", allocatedValue: 42n,
    });
    const result = await api.allocateFiscalSequence({
      query: vi.fn().mockResolvedValue({ rows: [{ outcome: "replayed", allocated_value: "42" }] }),
    }, input());
    expect(result.outcome === "replayed" && api.isENcf(result.eNcf)).toBe(true);
    expect(query).toHaveBeenCalledWith(
      "SELECT outcome, allocated_value::text AS allocated_value FROM allocate_fiscal_sequence($1, $2, $3, $4, $5)",
      ["synthetic-scope", "E31", "synthetic-key", "synthetic-fingerprint", "2030-06-15"],
    );
  });

  it("maps all seven SQL outcomes and gives values only to allocated or replayed", async () => {
    for (const outcome of ["invalid_request", "unprovisioned", "idempotency_conflict", "outside_validity", "exhausted"] as const) {
      await expect(api.allocateFiscalSequence({ query: vi.fn().mockResolvedValue({ rows: [{ outcome, allocated_value: null }] }) }, input()))
        .resolves.toEqual({ outcome });
    }
    for (const outcome of ["allocated", "replayed"] as const) {
      const result = await api.allocateFiscalSequence({ query: vi.fn().mockResolvedValue({ rows: [{ outcome, allocated_value: "9999999999" }] }) }, input());
      expect(result).toMatchObject({ outcome, allocatedValue: 9_999_999_999n });
      expect(result.outcome === outcome && result.eNcf.value).toBe("E319999999999");
      expect(result.outcome === outcome && api.isENcf(result.eNcf)).toBe(true);
    }
  });

  it("rejects unknown invalid inputs before querying", async () => {
    const query = vi.fn();
    for (const invalid of [
      null, {}, { ...input(), scopeId: "" }, { ...input(), scopeId: "  " },
      { scopeId: "synthetic-scope", idempotencyKey: "synthetic-key", fingerprint: "synthetic-fingerprint", requestedOn: "2030-06-15" },
      { ...input(), ecfType: "E32" },
      { ...input(), idempotencyKey: "" }, { ...input(), fingerprint: "" },
      { ...input(), requestedOn: "2030-02-29" }, { ...input(), requestedOn: "2030-6-15" },
      { ...input(), requestedOn: "2030-06-15T00:00:00Z" },
      new Proxy({}, { get: () => { throw new Error("input trap"); } }),
    ]) await expect(api.allocateFiscalSequence({ query }, invalid)).resolves.toEqual({ outcome: "invalid_request" });
    expect(query).not.toHaveBeenCalled();
  });

  it("contains exceptions and malformed, missing, multiple, or invalid allocated rows without diagnostics", async () => {
    const secret = "synthetic database secret";
    for (const response of [
      { rows: [] }, { rows: [{ outcome: "allocated", allocated_value: null }] },
      { rows: [{ outcome: "allocated", allocated_value: "42.0" }] },
      { rows: [{ outcome: "allocated", allocated_value: "10000000000" }] },
      { rows: [{ outcome: "replayed", allocated_value: "42" }, { outcome: "replayed", allocated_value: "42" }] },
      { rows: [{ outcome: "unprovisioned", allocated_value: "42" }] },
      { rows: [new Proxy({}, { get: () => { throw new Error(secret); } })] },
    ]) {
      const result = await api.allocateFiscalSequence({ query: vi.fn().mockResolvedValue(response) }, input());
      expect(result).toEqual({ outcome: "persistence_unavailable" });
      expect(JSON.stringify(result)).not.toContain(secret);
    }
    await expect(api.allocateFiscalSequence({ query: vi.fn().mockRejectedValue(new Error(secret)) }, input()))
      .resolves.toEqual({ outcome: "persistence_unavailable" });
  });
});

describe("sequence-allocation exports", () => {
  it("exports the public adapter from its module and the package root", async () => {
    const moduleApi = await import("../index.js");
    expect(moduleApi.allocateFiscalSequence).toBe(api.allocateFiscalSequence);
  });
});

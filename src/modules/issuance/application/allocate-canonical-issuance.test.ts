import { describe, expect, it, vi } from "vitest";

import * as api from "../../../index.js";

const command = () => ({
  issuer: { tenantId: "synthetic-issuer-tenant", rnc: "000000000" }, ecfType: "31", requestedOn: "2030-06-15",
  buyerIdentity: {}, declaredTotals: { montoTotal: "15", totalItbis: "2.25", montoGravadoTotal: "12.75", montoExento: "0" },
  items: [{ numeroLinea: "1", nombreItem: "Synthetic item", indicadorFacturacion: "1", indicadorBienoServicio: "1",
    cantidadItem: "1.5", precioUnitarioItem: "10", montoItem: "15" }],
});

function value<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false }): T {
  if (!result.ok) throw new Error("Expected a successful result.");
  return result.value;
}

describe("allocateCanonicalIssuance", () => {
  it("derives the canonical fingerprint and allocates through the caller-owned client", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ outcome: "allocated", allocated_value: "42" }] });
    const expectedFingerprint = value(api.fingerprintCanonicalIssuanceCommand(value(api.canonicalizeIssuanceCommand(command()))));

    const result = await api.allocateCanonicalIssuance({ query }, { idempotencyKey: "synthetic-key", command: command() });

    expect(result).toMatchObject({ outcome: "allocated", allocatedValue: 42n, fingerprint: expectedFingerprint });
    expect(result.outcome === "allocated" && api.isENcf(result.eNcf)).toBe(true);
    expect(query).toHaveBeenCalledWith(expect.any(String), ["synthetic-issuer-tenant", "E31", "synthetic-key", expectedFingerprint, "2030-06-15"]);
  });

  it("replays identical commands while keeping the derived fingerprint and maps conflicts without it", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ outcome: "allocated", allocated_value: "42" }] })
      .mockResolvedValueOnce({ rows: [{ outcome: "replayed", allocated_value: "42" }] })
      .mockResolvedValueOnce({ rows: [{ outcome: "idempotency_conflict", allocated_value: null }] });
    const input = { idempotencyKey: "synthetic-key", command: command() };

    const allocated = await api.allocateCanonicalIssuance({ query }, input);
    const replayed = await api.allocateCanonicalIssuance({ query }, input);
    const conflicted = await api.allocateCanonicalIssuance({ query }, { ...input, command: { ...command(), declaredTotals: { ...command().declaredTotals, montoTotal: "16" } } });

    expect(replayed).toEqual({ ...allocated, outcome: "replayed" });
    expect(conflicted).toEqual({ outcome: "idempotency_conflict" });
    expect("fingerprint" in conflicted).toBe(false);
  });

  it("rejects invalid keys, commands, non-E31 canonical types, and caller fingerprints without querying", async () => {
    const query = vi.fn();
    for (const input of [
      null, {}, { idempotencyKey: "", command: command() }, { idempotencyKey: " ", command: command() },
      { idempotencyKey: "synthetic-key", command: { ...command(), ecfType: "32" } },
      { idempotencyKey: "synthetic-key", command: command(), fingerprint: "caller-controlled" },
      { idempotencyKey: "synthetic-key", command: { ...command(), items: [] } },
    ]) await expect(api.allocateCanonicalIssuance({ query }, input)).resolves.toEqual({ outcome: "invalid_request" });
    expect(query).not.toHaveBeenCalled();
  });
});

describe("canonical issuance allocation exports", () => {
  it("exports the application wrapper from its module and the package root", async () => {
    const moduleApi = await import("../index.js");
    expect(moduleApi.allocateCanonicalIssuance).toBe(api.allocateCanonicalIssuance);
  });
});

import { describe, expect, it } from "vitest";

import * as rootApi from "../../../index.js";
import * as builderApi from "../index.js";
import type { Result } from "../../../index.js";

function value<T>(result: Result<T, unknown>): T {
  if (!result.ok) throw new Error("Expected a successful result.");
  return result.value;
}

function totals() {
  return value(rootApi.createEcf31HeaderTotalsEvidence({
    montoGravadoI1: value(rootApi.parseNonnegativeAmount("10.10")),
    montoGravadoI2: value(rootApi.parseNonnegativeAmount("0")),
    montoExento: value(rootApi.parseNonnegativeAmount("2.20")),
    totalItbis1: value(rootApi.parseNonnegativeAmount("1.82")),
    totalItbis2: value(rootApi.parseNonnegativeAmount("0")),
    montoImpuestoAdicional: value(rootApi.parsePositiveAmount("0.01")),
  }));
}

function snapshot() {
  return value(rootApi.serializeEcf31HeaderTotals(totals()));
}

describe("Ecf31HeaderTotalsSnapshotCodec", () => {
  it("serializes only genuine evidence into an exact immutable canonical snapshot", () => {
    const result = snapshot();

    expect(result).toEqual({
      schema: "ecf31-header-totals",
      version: 1,
      montoGravadoI1: "10.1",
      montoGravadoI2: "0",
      montoGravadoTotal: "10.1",
      montoExento: "2.2",
      totalItbis1: "1.82",
      totalItbis2: "0",
      totalItbis: "1.82",
      montoImpuestoAdicional: "0.01",
      montoTotal: "14.13",
    });
    expect(Reflect.ownKeys(result)).toEqual([
      "schema", "version", "montoGravadoI1", "montoGravadoI2", "montoGravadoTotal", "montoExento",
      "totalItbis1", "totalItbis2", "totalItbis", "montoImpuestoAdicional", "montoTotal",
    ]);
    expect("montoGravadoI3" in result).toBe(false);
    expect("totalItbis3" in result).toBe(false);
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(Object.isFrozen(result)).toBe(true);
    expect(() => { (result as { montoTotal: string }).montoTotal = "0"; }).toThrow(TypeError);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    expect(rootApi.serializeEcf31HeaderTotals({ ...totals() })).toMatchObject({ ok: false });
  });

  it("restores genuine evidence and preserves absent components separately from present zero", () => {
    const serialized = snapshot();
    const restored = value(rootApi.restoreEcf31HeaderTotals(JSON.parse(JSON.stringify(serialized))));

    expect(rootApi.isEcf31HeaderTotalsEvidence(restored)).toBe(true);
    expect(Object.isFrozen(restored)).toBe(true);
    expect(restored.montoGravadoI2).toBeDefined();
    expect(restored.totalItbis2).toBeDefined();
    expect("montoGravadoI3" in restored).toBe(false);
    expect("totalItbis3" in restored).toBe(false);
    expect(value(rootApi.serializeEcf31HeaderTotals(restored))).toEqual(serialized);

    const empty = value(rootApi.restoreEcf31HeaderTotals(value(rootApi.serializeEcf31HeaderTotals(
      value(rootApi.createEcf31HeaderTotalsEvidence({})),
    ))));
    expect(value(rootApi.serializeEcf31HeaderTotals(empty))).toEqual({
      schema: "ecf31-header-totals", version: 1, montoGravadoTotal: "0", totalItbis: "0", montoTotal: "0",
    });
    const rateThree = value(rootApi.serializeEcf31HeaderTotals(value(rootApi.createEcf31HeaderTotalsEvidence({
      montoGravadoI3: value(rootApi.parseNonnegativeAmount("3")),
      totalItbis3: value(rootApi.parseNonnegativeAmount("0.54")),
    }))));
    expect(rateThree.montoGravadoI3).toBe("3");
    expect(rateThree.totalItbis3).toBe("0.54");
  });

  it("rejects unknown, missing, noncanonical, out-of-profile, and stale snapshots", () => {
    const validSnapshot = snapshot();
    const invalidSnapshots: unknown[] = [
      { ...validSnapshot, schema: "other" },
      { ...validSnapshot, version: 2 },
      { ...validSnapshot, extra: true },
      (() => { const missing = { ...validSnapshot }; Reflect.deleteProperty(missing, "montoTotal"); return missing; })(),
      { ...validSnapshot, montoGravadoI1: "10.10" },
      { ...validSnapshot, montoGravadoI2: "-0.01" },
      { ...validSnapshot, montoImpuestoAdicional: "0" },
      { ...validSnapshot, montoImpuestoAdicional: "0.010" },
      { ...validSnapshot, montoTotal: "-1" },
      { ...validSnapshot, montoGravadoTotal: "10.11" },
      { ...validSnapshot, totalItbis: "1.83" },
      { ...validSnapshot, montoTotal: "14.14" },
    ];

    for (const input of invalidSnapshots) {
      expect(rootApi.restoreEcf31HeaderTotals(input)).toMatchObject({ ok: false });
    }
  });

  it("contains hostile getters, proxies, and revoked proxies without diagnostics", () => {
    const getterTrap = { ...snapshot() };
    Object.defineProperty(getterTrap, "schema", { enumerable: true, get() { throw new Error("trap"); } });
    const proxyTrap = new Proxy({}, { ownKeys: () => { throw new Error("trap"); } });
    const revoked = Proxy.revocable({}, {}); revoked.revoke();
    const evidenceTrap = new Proxy({}, { get: () => { throw new Error("trap"); } });

    for (const input of [null, Object.create(null), getterTrap, proxyTrap, revoked.proxy]) {
      expect(() => rootApi.restoreEcf31HeaderTotals(input)).not.toThrow();
      expect(rootApi.restoreEcf31HeaderTotals(input)).toMatchObject({ ok: false });
      expect(JSON.stringify(rootApi.restoreEcf31HeaderTotals(input))).not.toContain("trap");
    }
    expect(() => rootApi.serializeEcf31HeaderTotals(evidenceTrap)).not.toThrow();
    expect(rootApi.serializeEcf31HeaderTotals(evidenceTrap)).toMatchObject({ ok: false });
  });
});

it("exports the header-totals codec from Builder and the package root", () => {
  expect(builderApi.serializeEcf31HeaderTotals).toBe(rootApi.serializeEcf31HeaderTotals);
  expect(builderApi.restoreEcf31HeaderTotals).toBe(rootApi.restoreEcf31HeaderTotals);
});

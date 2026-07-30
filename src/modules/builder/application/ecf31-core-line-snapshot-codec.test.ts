import { describe, expect, it } from "vitest";

import * as rootApi from "../../../index.js";
import * as builderApi from "../index.js";
import type { Result } from "../../../index.js";

function value<T>(result: Result<T, unknown>): T {
  if (!result.ok) throw new Error("Expected a successful result.");
  return result.value;
}

function line(
  quantity = "1.5",
  unitPrice = "2.5",
  declaredAmount = "3.75",
) {
  const evidence = value(rootApi.captureLineCalculationEvidence({
    sequence: value(rootApi.parseLineSequence("1")),
    quantity: value(rootApi.parseNonnegativeQuantity(quantity)),
    unitPrice: value(rootApi.parseUnitPrice(unitPrice)),
    declaredAmount: value(rootApi.parseNonnegativeAmount(declaredAmount)),
  }));
  return value(rootApi.createEcf31CoreLine({
    evidence,
    itemName: "Synthetic item",
    billingIndicator: 4,
    goodOrServiceIndicator: 2,
  }));
}

function snapshot() {
  return value(rootApi.serializeEcf31CoreLine(line()));
}

describe("Ecf31CoreLineSnapshotCodec", () => {
  it("serializes only a genuine line into an exact, immutable canonical JSON snapshot", () => {
    const result = snapshot();

    expect(result).toEqual({
      schema: "ecf31-core-line",
      version: 1,
      sequence: "1",
      quantity: "1.5",
      unitPrice: "2.5",
      computedAmount: "3.75",
      declaredAmount: "3.75",
      delta: "0",
      itemName: "Synthetic item",
      billingIndicator: 4,
      goodOrServiceIndicator: 2,
    });
    expect(Reflect.ownKeys(result)).toEqual([
      "schema", "version", "sequence", "quantity", "unitPrice", "computedAmount", "declaredAmount", "delta",
      "itemName", "billingIndicator", "goodOrServiceIndicator",
    ]);
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(Object.isFrozen(result)).toBe(true);
    expect(() => { (result as { itemName: string }).itemName = "Mutated"; }).toThrow(TypeError);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    expect(value(rootApi.serializeEcf31CoreLine(value(rootApi.restoreEcf31CoreLine(
      JSON.parse(JSON.stringify(result)),
    ))))).toEqual(result);
  });

  it("round-trips genuine lines with maximum operand scale, zero values, and a valid negative delta", () => {
    for (const source of [
      line("9999999999999999.99", "9999999999999999.9999", "0"),
      line("0.00", "0.0000", "0.00"),
      line("1", "2.5", "0"),
    ]) {
      const serialized = value(rootApi.serializeEcf31CoreLine(source));
      const restored = value(rootApi.restoreEcf31CoreLine(serialized));

      expect(rootApi.isEcf31CoreLine(restored)).toBe(true);
      expect(restored).not.toBe(source);
      expect(value(rootApi.serializeEcf31CoreLine(restored))).toEqual(serialized);
    }
    expect(value(rootApi.serializeEcf31CoreLine(line("1", "2.5", "0"))).delta).toBe("-2.5");
  });

  it("rejects forged lines and corrupt, noncanonical, or structurally invalid snapshots", () => {
    const validSnapshot = snapshot();
    const invalidSnapshots: unknown[] = [
      { ...validSnapshot, schema: "other" },
      { ...validSnapshot, version: 2 },
      { ...validSnapshot, version: "1" },
      { ...validSnapshot, extra: true },
      (() => { const missing = { ...validSnapshot }; Reflect.deleteProperty(missing, "delta"); return missing; })(),
      { ...validSnapshot, sequence: "0" },
      { ...validSnapshot, sequence: "01" },
      { ...validSnapshot, quantity: "1.234" },
      { ...validSnapshot, unitPrice: "2.12345" },
      { ...validSnapshot, declaredAmount: "-1" },
      { ...validSnapshot, computedAmount: "3.750" },
      { ...validSnapshot, computedAmount: "3.74" },
      { ...validSnapshot, delta: "0.0" },
      { ...validSnapshot, delta: "1" },
      { ...validSnapshot, itemName: " " },
      { ...validSnapshot, billingIndicator: "4" },
      { ...validSnapshot, goodOrServiceIndicator: 3 },
    ];

    expect(rootApi.serializeEcf31CoreLine({ ...line() })).toMatchObject({ ok: false });
    for (const input of invalidSnapshots) {
      expect(rootApi.restoreEcf31CoreLine(input)).toMatchObject({ ok: false });
    }
  });

  it("contains hostile getters and proxies without exposing diagnostics", () => {
    const getterTrap = { ...snapshot() };
    Object.defineProperty(getterTrap, "schema", {
      enumerable: true,
      get() { throw new Error("trap"); },
    });
    const proxyTrap = new Proxy({}, { ownKeys: () => { throw new Error("trap"); } });
    const revoked = Proxy.revocable({}, {}); revoked.revoke();
    const lineProxy = new Proxy({}, { get: () => { throw new Error("trap"); } });

    for (const input of [null, Object.create(null), getterTrap, proxyTrap, revoked.proxy]) {
      expect(() => rootApi.restoreEcf31CoreLine(input)).not.toThrow();
      expect(rootApi.restoreEcf31CoreLine(input)).toMatchObject({ ok: false });
      expect(JSON.stringify(rootApi.restoreEcf31CoreLine(input))).not.toContain("trap");
    }
    expect(() => rootApi.serializeEcf31CoreLine(lineProxy)).not.toThrow();
    expect(rootApi.serializeEcf31CoreLine(lineProxy)).toMatchObject({ ok: false });
  });
});

it("exports the codec from Builder and the package root", () => {
  expect(builderApi.serializeEcf31CoreLine).toBe(rootApi.serializeEcf31CoreLine);
  expect(builderApi.restoreEcf31CoreLine).toBe(rootApi.restoreEcf31CoreLine);
});

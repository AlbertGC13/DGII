import { describe, expect, it } from "vitest";

import * as rootApi from "../../../index.js";
import * as builderApi from "../index.js";
import type { Result } from "../../../index.js";

function value<T>(result: Result<T, unknown>): T {
  if (!result.ok) throw new Error("Expected a successful result.");
  return result.value;
}

function header(buyerIdentifier = "00000000000") {
  return value(rootApi.createEcf31CoreHeader({
    eNcf: value(rootApi.parseENcf("E310000000001")),
    issuer: {
      taxpayerIdentifier: value(rootApi.parseTaxpayerIdentifier("000000000")),
      legalName: "Synthetic issuer",
      address: "Synthetic address",
    },
    buyer: {
      taxpayerIdentifier: value(rootApi.parseTaxpayerIdentifier(buyerIdentifier)),
      legalName: "Synthetic buyer",
    },
    issueDate: "01-12-2026",
    incomeType: "01",
    paymentType: "1",
  }));
}

function snapshot() {
  return value(rootApi.serializeEcf31CoreHeader(header()));
}

describe("Ecf31CoreHeaderSnapshotCodec", () => {
  it("serializes only a genuine header into an exact, immutable JSON-compatible snapshot", () => {
    const result = snapshot();

    expect(result).toEqual({
      schema: "ecf31-core-header",
      version: 1,
      eNcf: "E310000000001",
      issuer: {
        taxpayerIdentifier: "000000000",
        legalName: "Synthetic issuer",
        address: "Synthetic address",
      },
      buyer: {
        taxpayerIdentifier: "00000000000",
        legalName: "Synthetic buyer",
      },
      issueDate: "01-12-2026",
      incomeType: "01",
      paymentType: "1",
    });
    expect(Reflect.ownKeys(result)).toEqual([
      "schema", "version", "eNcf", "issuer", "buyer", "issueDate", "incomeType", "paymentType",
    ]);
    expect(Reflect.ownKeys(result.issuer)).toEqual(["taxpayerIdentifier", "legalName", "address"]);
    expect(Reflect.ownKeys(result.buyer)).toEqual(["taxpayerIdentifier", "legalName"]);
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.issuer)).toBe(true);
    expect(Object.isFrozen(result.buyer)).toBe(true);
    expect(() => { (result.issuer as { legalName: string }).legalName = "Mutated"; }).toThrow(TypeError);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it("restores a genuine header and preserves all lexical values for RNC and cedula buyers", () => {
    for (const source of [header("000000000"), header("00000000000")]) {
      const restored = value(rootApi.restoreEcf31CoreHeader(value(rootApi.serializeEcf31CoreHeader(source))));

      expect(rootApi.isEcf31CoreHeader(restored)).toBe(true);
      expect(restored).not.toBe(source);
      expect(value(rootApi.serializeEcf31CoreHeader(restored))).toEqual(value(rootApi.serializeEcf31CoreHeader(source)));
    }
  });

  it("round-trips a cedula issuer without changing the v1 snapshot contract", () => {
    const source = value(rootApi.createEcf31CoreHeader({
      eNcf: value(rootApi.parseENcf("E310000000001")),
      issuer: {
        taxpayerIdentifier: value(rootApi.parseTaxpayerIdentifier("00000000000")),
        legalName: "Synthetic issuer",
        address: "Synthetic address",
      },
      buyer: {
        taxpayerIdentifier: value(rootApi.parseTaxpayerIdentifier("000000000")),
        legalName: "Synthetic buyer",
      },
      issueDate: "01-12-2026",
      incomeType: "01",
      paymentType: "1",
    }));

    const snapshot = value(rootApi.serializeEcf31CoreHeader(source));
    const restored = value(rootApi.restoreEcf31CoreHeader(snapshot));

    expect(snapshot.schema).toBe("ecf31-core-header");
    expect(snapshot.version).toBe(1);
    expect(Reflect.ownKeys(snapshot)).toEqual(["schema", "version", "eNcf", "issuer", "buyer", "issueDate", "incomeType", "paymentType"]);
    expect(Reflect.ownKeys(snapshot.issuer)).toEqual(["taxpayerIdentifier", "legalName", "address"]);
    expect(Reflect.ownKeys(snapshot.buyer)).toEqual(["taxpayerIdentifier", "legalName"]);
    expect(restored.issuer.taxpayerIdentifier).toEqual({ kind: "cedula", value: "00000000000" });
    expect(value(rootApi.serializeEcf31CoreHeader(restored))).toEqual(snapshot);
  });

  it("rejects forged headers and snapshots with unknown versions, incorrect shape, types, or field values", () => {
    const validSnapshot = snapshot();
    const invalidSnapshots: unknown[] = [
      { ...validSnapshot, version: 2 },
      { ...validSnapshot, extra: true },
      (() => { const missing = { ...validSnapshot }; Reflect.deleteProperty(missing, "buyer"); return missing; })(),
      { ...validSnapshot, version: "1" },
      { ...validSnapshot, eNcf: "E990000000001" },
      { ...validSnapshot, issuer: { ...validSnapshot.issuer, taxpayerIdentifier: "00000000X" } },
      { ...validSnapshot, buyer: { ...validSnapshot.buyer, taxpayerIdentifier: "00000000X" } },
      { ...validSnapshot, issueDate: "2026-12-01" },
      { ...validSnapshot, incomeType: "99" },
      { ...validSnapshot, paymentType: "9" },
      { ...validSnapshot, issuer: { ...validSnapshot.issuer, ignored: true } },
      { ...validSnapshot, buyer: { taxpayerIdentifier: "00000000000" } },
    ];

    expect(rootApi.serializeEcf31CoreHeader({ ...header() })).toMatchObject({ ok: false });
    for (const input of invalidSnapshots) {
      expect(rootApi.restoreEcf31CoreHeader(input)).toMatchObject({ ok: false });
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
    const headerProxy = new Proxy({}, { get: () => { throw new Error("trap"); } });

    for (const input of [null, Object.create(null), getterTrap, proxyTrap, revoked.proxy]) {
      expect(() => rootApi.restoreEcf31CoreHeader(input)).not.toThrow();
      expect(rootApi.restoreEcf31CoreHeader(input)).toMatchObject({ ok: false });
      expect(JSON.stringify(rootApi.restoreEcf31CoreHeader(input))).not.toContain("trap");
    }
    expect(() => rootApi.serializeEcf31CoreHeader(headerProxy)).not.toThrow();
    expect(rootApi.serializeEcf31CoreHeader(headerProxy)).toMatchObject({ ok: false });
  });
});

it("exports the codec from Builder and the package root", () => {
  expect(builderApi.serializeEcf31CoreHeader).toBe(rootApi.serializeEcf31CoreHeader);
  expect(builderApi.restoreEcf31CoreHeader).toBe(rootApi.restoreEcf31CoreHeader);
});

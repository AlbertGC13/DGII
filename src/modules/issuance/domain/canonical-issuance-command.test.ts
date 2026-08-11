import { describe, expect, it } from "vitest";

import * as rootApi from "../../../index.js";

const validCommand = {
  issuer: { tenantId: "tenant-synthetic", rnc: "000000000" },
  ecfType: "31",
  requestedOn: "2030-06-15",
  buyerIdentity: { rnc: null, cedula: "000-00000-000", foreignIdentifier: null },
  declaredTotals: {
    montoTotal: "15.00",
    totalItbis: "2.25",
    montoGravadoTotal: "12.75",
    montoExento: "0",
  },
  items: [{
    numeroLinea: "1",
    nombreItem: "Synthetic item",
    indicadorFacturacion: "1",
    indicadorBienoServicio: "1",
    cantidadItem: "1.5",
    precioUnitarioItem: "10.0000",
    montoItem: "15",
    montoDescuento: "",
    montoRecargo: null,
  }],
};

function value<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false }): T {
  if (!result.ok) throw new Error("Expected a successful result.");
  return result.value;
}

function fingerprint(input: unknown): string {
  return value(rootApi.fingerprintCanonicalIssuanceCommand(value(rootApi.canonicalizeIssuanceCommand(input))));
}

describe("canonical issuance command", () => {
  it("constructs a fresh, recursively ordered V1 command and a known SHA-256 fingerprint", () => {
    const command = value(rootApi.canonicalizeIssuanceCommand(validCommand));
    const expectedJson = "{\"issuer\":{\"tenantId\":\"tenant-synthetic\",\"rnc\":\"000000000\"},\"ecfType\":\"31\",\"requestedOn\":\"2030-06-15\",\"buyerIdentity\":{\"rnc\":null,\"cedula\":\"00000000000\",\"foreignIdentifier\":null},\"declaredTotals\":{\"montoTotal\":\"15\",\"totalItbis\":\"2.25\",\"montoGravadoTotal\":\"12.75\",\"montoExento\":\"0\"},\"items\":[{\"numeroLinea\":\"1\",\"nombreItem\":\"Synthetic item\",\"indicadorFacturacion\":\"1\",\"indicadorBienoServicio\":\"1\",\"cantidadItem\":\"1.5\",\"precioUnitarioItem\":\"10\",\"montoItem\":\"15\",\"montoDescuento\":null,\"montoRecargo\":null}]}";

    expect(command).not.toBe(validCommand);
    expect(command.issuer).not.toBe(validCommand.issuer);
    expect(Object.isFrozen(command)).toBe(true);
    expect(Object.isFrozen(command.items)).toBe(true);
    expect(JSON.stringify(command)).toBe(expectedJson);
    expect(value(rootApi.fingerprintCanonicalIssuanceCommand(command))).toBe(
      "d82abb64b1b7858d343456deb5260cce9b05caed60969640e2fd57f8d02641f8",
    );
  });

  it("normalizes absent, null, and empty optional values to null", () => {
    const input: { buyerIdentity: Record<string, unknown>; items: Array<Record<string, unknown>> } = {
      buyerIdentity: { foreignIdentifier: " - " },
      items: [{ ...validCommand.items[0] }],
    };
    const firstItem = input.items[0];
    if (firstItem === undefined) throw new Error("Expected synthetic item.");
    delete firstItem["montoDescuento"];
    firstItem["montoRecargo"] = "";

    const command = value(rootApi.canonicalizeIssuanceCommand({ ...validCommand, ...input }));
    expect(command.buyerIdentity).toEqual({ rnc: null, cedula: null, foreignIdentifier: null });
    expect(command.items[0]).toMatchObject({ montoDescuento: null, montoRecargo: null });
  });

  it("validates supported e-CF types, domestic buyer identity, dates, exact decimals, and caller item order", () => {
    const cases = [
      { ...validCommand, ecfType: "41" },
      { ...validCommand, requestedOn: "2030-02-30" },
      { ...validCommand, buyerIdentity: { rnc: "000000000", cedula: "00000000000" } },
      { ...validCommand, declaredTotals: { ...validCommand.declaredTotals, montoTotal: 15 } },
      { ...validCommand, items: [{ ...validCommand.items[0], numeroLinea: "2" }] },
      { ...validCommand, items: [{ ...validCommand.items[0] }, { ...validCommand.items[0], numeroLinea: "1" }] },
    ];

    for (const input of cases) {
      expect(rootApi.canonicalizeIssuanceCommand(input)).toMatchObject({
        ok: false,
        error: { code: "INVALID_CANONICAL_ISSUANCE_COMMAND" },
      });
    }
  });

  it("requires items, exact decimal strings, and accepted item indicators", () => {
    const decimalInputs = [
      { declaredTotals: { ...validCommand.declaredTotals, montoTotal: 15 } },
      { declaredTotals: { ...validCommand.declaredTotals, totalItbis: 2 } },
      { declaredTotals: { ...validCommand.declaredTotals, montoGravadoTotal: 12 } },
      { declaredTotals: { ...validCommand.declaredTotals, montoExento: 0 } },
      ...["cantidadItem", "precioUnitarioItem", "montoItem", "montoDescuento", "montoRecargo"].map((field) => ({
        items: [{ ...validCommand.items[0], [field]: 1 }],
      })),
    ];
    for (const input of [{ ...validCommand, items: [] }, ...decimalInputs.map((change) => ({ ...validCommand, ...change })),
      { ...validCommand, items: [{ ...validCommand.items[0], indicadorFacturacion: "5" }] },
      { ...validCommand, items: [{ ...validCommand.items[0], indicadorBienoServicio: "0" }] }]) {
      expect(rootApi.canonicalizeIssuanceCommand(input)).toMatchObject({ ok: false });
    }
    for (const indicadorFacturacion of ["0", "4"]) {
      for (const indicadorBienoServicio of ["1", "2"]) {
        expect(rootApi.canonicalizeIssuanceCommand({ ...validCommand, items: [{ ...validCommand.items[0], indicadorFacturacion, indicadorBienoServicio }] }).ok).toBe(true);
      }
    }
  });

  it("hashes equivalent decimal lexical forms identically and material changes differently", () => {
    const equivalent = {
      ...validCommand,
      declaredTotals: { montoTotal: "15.0", totalItbis: "2.25", montoGravadoTotal: "12.75", montoExento: "0.0" },
      items: [{ ...validCommand.items[0], cantidadItem: "1.50", precioUnitarioItem: "10.000", montoItem: "15.0" }],
    };
    expect(fingerprint(equivalent)).toBe(fingerprint(validCommand));
    expect(fingerprint({ ...validCommand, declaredTotals: { ...validCommand.declaredTotals, montoTotal: "15.01" } })).not.toBe(fingerprint(validCommand));
    expect(fingerprint({ ...validCommand, items: [{ ...validCommand.items[0], montoItem: "15.01" }] })).not.toBe(fingerprint(validCommand));
  });

  it("preserves reordered valid caller lines and hashes their UTF-8 contents deterministically", () => {
    const second = { ...validCommand.items[0], numeroLinea: "2", nombreItem: "Café ñandú", montoItem: "20" };
    const ordered = { ...validCommand, items: [validCommand.items[0], second] };
    const reordered = { ...validCommand, items: [{ ...second, numeroLinea: "1" }, { ...validCommand.items[0], numeroLinea: "2" }] };
    const unicode = { ...validCommand, items: [{ ...validCommand.items[0], nombreItem: "Café ñandú" }] };

    expect(value(rootApi.canonicalizeIssuanceCommand(reordered)).items.map((item) => item.nombreItem)).toEqual(["Café ñandú", "Synthetic item"]);
    expect(fingerprint(reordered)).not.toBe(fingerprint(ordered));
    expect(fingerprint(unicode)).toBe("fa9f9c4af58accde176eff1374a0859c25e6588c19439e39b85f50ded11b0625");
  });

  it("cleans foreign identifiers and enforces buyer identity exclusivity", () => {
    const foreign = { ...validCommand, buyerIdentity: { foreignIdentifier: " AB - 12 " } };
    expect(value(rootApi.canonicalizeIssuanceCommand(foreign)).buyerIdentity).toEqual({ rnc: null, cedula: null, foreignIdentifier: "AB12" });
    expect(rootApi.canonicalizeIssuanceCommand({ ...foreign, buyerIdentity: { rnc: "000000000", foreignIdentifier: "AB12" } })).toMatchObject({ ok: false });
  });

  it("does not evaluate hostile properties and rejects forged canonical commands", () => {
    const accessor = { ...validCommand };
    Object.defineProperty(accessor, "issuer", { enumerable: true, get: () => { throw new Error("trap"); } });
    const throwing = new Proxy({}, { get: () => { throw new Error("trap"); } });
    const command = value(rootApi.canonicalizeIssuanceCommand(validCommand));

    expect(() => rootApi.canonicalizeIssuanceCommand(accessor)).not.toThrow();
    expect(() => rootApi.canonicalizeIssuanceCommand(throwing)).not.toThrow();
    expect(rootApi.fingerprintCanonicalIssuanceCommand({ ...command })).toMatchObject({
      ok: false,
      error: { code: "INVALID_CANONICAL_ISSUANCE_COMMAND" },
    });
  });
});

describe("canonical issuance exports", () => {
  it("exports the public API from the issuance module and package root", async () => {
    const issuanceApi = await import("../index.js");
    expect(issuanceApi.canonicalizeIssuanceCommand).toBe(rootApi.canonicalizeIssuanceCommand);
    expect(issuanceApi.fingerprintCanonicalIssuanceCommand).toBe(rootApi.fingerprintCanonicalIssuanceCommand);
  });
});

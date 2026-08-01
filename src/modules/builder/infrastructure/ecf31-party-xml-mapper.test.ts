import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import * as api from "../../../index.js";
import type { Result } from "../../../shared/domain/result.js";
import { mapEcf31PartyXmlElements } from "./ecf31-party-xml-mapper.js";
import { serializeXmlDocument } from "./xml-writer.js";

function value<T>(result: Result<T, unknown>): T {
  if (!result.ok) throw new Error("Expected a successful result.");
  return result.value;
}

function header(issuerIdentifier = "000000000", buyerIdentifier = "00000000000") {
  return value(api.createEcf31CoreHeader({
    eNcf: value(api.parseENcf("E310000000001")),
    issuer: {
      taxpayerIdentifier: value(api.parseTaxpayerIdentifier(issuerIdentifier)),
      legalName: "Issuer & Sons <DR>",
      address: "Calle \"Uno\" & 'Dos'",
    },
    buyer: {
      taxpayerIdentifier: value(api.parseTaxpayerIdentifier(buyerIdentifier)),
      legalName: "Buyer & Co <Local>",
    },
    issueDate: "01-12-2026",
    incomeType: "01",
    paymentType: "1",
  }));
}

function input(issuerIdentifier?: string, buyerIdentifier?: string) {
  return { header: header(issuerIdentifier, buyerIdentifier) };
}

function serialize(inputValue: unknown): Readonly<{ emisor: string; comprador: string }> {
  const mapped = value(mapEcf31PartyXmlElements(inputValue));
  return {
    emisor: value(serializeXmlDocument(mapped.emisor)),
    comprador: value(serializeXmlDocument(mapped.comprador)),
  };
}

function expectFailure(inputValue: unknown, code: string): void {
  expect(() => mapEcf31PartyXmlElements(inputValue)).not.toThrow();
  expect(mapEcf31PartyXmlElements(inputValue)).toMatchObject({ ok: false, error: { code } });
}

describe("e-CF 31 party XML mapper", () => {
  it("serializes the minimal Emisor and Comprador fragments in exact XSD order", () => {
    expect(serialize(input())).toEqual({
      emisor: '<?xml version="1.0" encoding="utf-8"?><Emisor><RNCEmisor>000000000</RNCEmisor><RazonSocialEmisor>Issuer &amp; Sons &lt;DR&gt;</RazonSocialEmisor><DireccionEmisor>Calle &quot;Uno&quot; &amp; &apos;Dos&apos;</DireccionEmisor><FechaEmision>01-12-2026</FechaEmision></Emisor>',
      comprador: '<?xml version="1.0" encoding="utf-8"?><Comprador><RNCComprador>00000000000</RNCComprador><RazonSocialComprador>Buyer &amp; Co &lt;Local&gt;</RazonSocialComprador></Comprador>',
    });
  });

  it.each([
    ["000000000", "000000000"],
    ["00000000000", "00000000000"],
  ])("supports %s issuer and %s buyer taxpayer identifiers", (issuerIdentifier, buyerIdentifier) => {
    const xml = serialize(input(issuerIdentifier, buyerIdentifier));

    expect(xml.emisor).toContain(`<RNCEmisor>${issuerIdentifier}</RNCEmisor>`);
    expect(xml.comprador).toContain(`<RNCComprador>${buyerIdentifier}</RNCComprador>`);
  });

  it("omits unsupported fields without empty or self-closing elements", () => {
    const { emisor, comprador } = serialize(input());
    const xml = `${emisor}${comprador}`;

    expect(xml).not.toMatch(/Municipio|Provincia|Pais|Extranjero|Contacto|Telefono|Correo|DireccionComprador|Registro|Entrega|Comercial/);
    expect(xml).not.toContain("/>");
    expect(xml).not.toMatch(/<([A-Za-z][A-Za-z0-9._-]*)><\/\1>/);
  });

  it("rejects invalid outer input shapes and hostile properties", () => {
    const candidate = input();
    const accessor: unknown = { get header() { throw new Error("trap"); } };
    const inherited: unknown = Object.create({ header: candidate.header });
    const customPrototype: unknown = Object.create({});
    Object.defineProperty(customPrototype, "header", { enumerable: true, value: candidate.header });
    const revoked = Proxy.revocable({}, {}); revoked.revoke();
    const throwing = new Proxy({}, { ownKeys: () => { throw new Error("trap"); } });

    for (const hostile of [null, [], {}, { header: candidate.header, extra: true }, accessor, inherited, customPrototype, revoked.proxy, throwing]) {
      expectFailure(hostile, "INVALID_ECF31_PARTY_XML_INPUT");
    }
  });

  it("rejects forged, cloned, and hostile header values", () => {
    const candidate = input();
    const revoked = Proxy.revocable({}, {}); revoked.revoke();

    for (const hostile of [{ ...candidate.header }, null, [], revoked.proxy]) {
      expectFailure({ header: hostile }, "INVALID_ECF31_PARTY_XML_HEADER");
    }
  });

  it("contains XML writer failures behind the fixed safe mapping error", () => {
    const invalidXmlHeader = value(api.createEcf31CoreHeader({
      eNcf: value(api.parseENcf("E310000000001")),
      issuer: {
        taxpayerIdentifier: value(api.parseTaxpayerIdentifier("000000000")),
        legalName: "Invalid\u0000issuer",
        address: "Synthetic address",
      },
      buyer: {
        taxpayerIdentifier: value(api.parseTaxpayerIdentifier("00000000000")),
        legalName: "Synthetic buyer",
      },
      issueDate: "01-12-2026",
      incomeType: "01",
      paymentType: "1",
    }));

    expect(mapEcf31PartyXmlElements({ header: invalidXmlHeader })).toEqual({
      ok: false,
      error: {
        code: "ECF31_PARTY_XML_MAPPING_FAILED",
        message: "e-CF 31 party XML mapping failed.",
      },
    });
  });

  it("returns frozen opaque nodes and does not expose mapper or writer through public barrels", () => {
    const mapped = value(mapEcf31PartyXmlElements(input()));
    const builderIndex = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
    const rootIndex = readFileSync(new URL("../../../index.ts", import.meta.url), "utf8");

    expect(Object.isFrozen(mapped)).toBe(true);
    expect(Object.isFrozen(mapped.emisor)).toBe(true);
    expect(Object.isFrozen(mapped.comprador)).toBe(true);
    expect(`${builderIndex}\n${rootIndex}`).not.toMatch(/ecf31-party-xml-mapper|mapEcf31PartyXmlElements|xml-writer|serializeXml/);
  });
});

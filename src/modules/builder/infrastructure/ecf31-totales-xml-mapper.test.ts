import { describe, expect, it } from "vitest";

import * as rootApi from "../../../index.js";
import * as builderApi from "../index.js";
import type { Result } from "../../../index.js";
import { mapEcf31TotalesXmlElement } from "./ecf31-totales-xml-mapper.js";
import { serializeXmlDocument } from "./xml-writer.js";

function value<T>(result: Result<T, unknown>): T { if (!result.ok) throw new Error("Expected success."); return result.value; }

function evidence(lines: readonly (readonly [0 | 1 | 2 | 3 | 4, string])[]) {
  const quantizations = lines.map(([billingIndicator, amount], index) => {
    const calculation = value(rootApi.captureLineCalculationEvidence({ sequence: value(rootApi.parseLineSequence(String(index + 1))), quantity: value(rootApi.parseNonnegativeQuantity("1")), unitPrice: value(rootApi.parseUnitPrice(amount)), declaredAmount: value(rootApi.parseNonnegativeAmount("0")) }));
    const coreLine = value(rootApi.createEcf31CoreLine({ evidence: calculation, itemName: "Synthetic item", billingIndicator, goodOrServiceIndicator: 1 }));
    return value(rootApi.createEcf31MontoItemQuantizationEvidence(value(rootApi.createEcf31LineAmountEvidence({ coreLine, discountAmount: value(rootApi.parseNonnegativeAmount("0")), surchargeAmount: value(rootApi.parseNonnegativeAmount("0")) }))));
  });
  const header = value(rootApi.createEcf31CoreHeader({ eNcf: value(rootApi.parseENcf("E310000000001")), issuer: { taxpayerIdentifier: value(rootApi.parseTaxpayerIdentifier("000000000")), legalName: "Synthetic issuer", address: "Synthetic address" }, buyer: { taxpayerIdentifier: value(rootApi.parseTaxpayerIdentifier("00000000000")), legalName: "Synthetic buyer" }, issueDate: "01-12-2026", incomeType: "01", paymentType: "1" }));
  const draft = value(rootApi.createEcf31CoreDraft({ header, lineAmounts: quantizations.map((entry) => entry.sourceEvidence) }));
  const exemptAmountEvidence = value(rootApi.createEcf31PostGlobalAdjustmentExemptAmountEvidence({ draft, montoItemQuantizations: quantizations, adjustments: [] }));
  const additionalTaxClassificationEvidence = value(rootApi.createEcf31AdditionalTaxClassificationEvidence({ draft, entries: quantizations.map((entry) => ({ source: entry.sourceEvidence, codes: [] })) }));
  if (!lines.some(([indicator]) => indicator >= 1 && indicator <= 3)) return value(rootApi.createEcf31DerivedHeaderTotalsEvidence({ exemptAmountEvidence, additionalTaxClassificationEvidence }));
  const priceInclusionEvidence = value(rootApi.createEcf31ItbisPriceInclusionEvidence({ draft, montoItemQuantizations: quantizations, indicator: 0 }));
  const taxableBaseEvidence = value(rootApi.createEcf31PostGlobalAdjustmentTaxableBaseEvidence({ priceInclusionEvidence, adjustments: [] }));
  const totalItbisEvidence = value(rootApi.createEcf31TotalItbisEvidence({ taxableBaseEvidence, additionalTaxClassificationEvidence }));
  return value(rootApi.createEcf31DerivedHeaderTotalsEvidence({ exemptAmountEvidence, additionalTaxClassificationEvidence, taxableBaseEvidence, totalItbisEvidence }));
}

function serialize(source: unknown): string { return value(serializeXmlDocument(value(mapEcf31TotalesXmlElement(source)))); }

function expectInputFailure(source: unknown): void {
  expect(() => mapEcf31TotalesXmlElement(source)).not.toThrow();
  expect(mapEcf31TotalesXmlElement(source)).toEqual({ ok: false, error: { code: "INVALID_ECF31_TOTALES_XML_INPUT", message: "e-CF 31 Totales XML mapper input is invalid." } });
}

describe("e-CF 31 Totales XML mapper", () => {
  it.each([
    [[[0, "12.30"]], "<Totales><MontoTotal>0</MontoTotal></Totales>"],
    [[[4, "12.30"]], "<Totales><MontoExento>12.3</MontoExento><MontoTotal>12.3</MontoTotal></Totales>"],
    [[[1, "10"]], "<Totales><MontoGravadoTotal>10</MontoGravadoTotal><MontoGravadoI1>10</MontoGravadoI1><ITBIS1>18</ITBIS1><TotalITBIS>1.8</TotalITBIS><TotalITBIS1>1.8</TotalITBIS1><MontoTotal>11.8</MontoTotal></Totales>"],
    [[[2, "10"]], "<Totales><MontoGravadoTotal>10</MontoGravadoTotal><MontoGravadoI2>10</MontoGravadoI2><ITBIS2>16</ITBIS2><TotalITBIS>1.6</TotalITBIS><TotalITBIS2>1.6</TotalITBIS2><MontoTotal>11.6</MontoTotal></Totales>"],
    [[[3, "10"]], "<Totales><MontoGravadoTotal>10</MontoGravadoTotal><MontoGravadoI3>10</MontoGravadoI3><ITBIS3>0</ITBIS3><TotalITBIS>0</TotalITBIS><TotalITBIS3>0</TotalITBIS3><MontoTotal>10</MontoTotal></Totales>"],
    [[[1, "10"], [2, "10"], [3, "10"], [4, "10"]], "<Totales><MontoGravadoTotal>30</MontoGravadoTotal><MontoGravadoI1>10</MontoGravadoI1><MontoGravadoI2>10</MontoGravadoI2><MontoGravadoI3>10</MontoGravadoI3><MontoExento>10</MontoExento><ITBIS1>18</ITBIS1><ITBIS2>16</ITBIS2><ITBIS3>0</ITBIS3><TotalITBIS>3.4</TotalITBIS><TotalITBIS1>1.8</TotalITBIS1><TotalITBIS2>1.6</TotalITBIS2><TotalITBIS3>0</TotalITBIS3><MontoTotal>43.4</MontoTotal></Totales>"],
    [[[1, "0"]], "<Totales><MontoGravadoTotal>0</MontoGravadoTotal><MontoGravadoI1>0</MontoGravadoI1><ITBIS1>18</ITBIS1><TotalITBIS>0</TotalITBIS><TotalITBIS1>0</TotalITBIS1><MontoTotal>0</MontoTotal></Totales>"],
  ] as const)("serializes represented totals in official order without empty tags", (lines, expected) => {
    expect(serialize({ evidence: evidence(lines) })).toBe(`<?xml version="1.0" encoding="utf-8"?>${expected}`);
  });

  it("deliberately omits MontoNoFacturable for indicator-0-only evidence without genuine non-billable monetary evidence", () => {
    expect(serialize({ evidence: evidence([[0, "12.30"]]) })).not.toContain("<MontoNoFacturable>");
  });

  it("returns a frozen opaque XML element and rejects cloned evidence", () => {
    const genuine = evidence([[1, "10"]]);
    const mapped = value(mapEcf31TotalesXmlElement({ evidence: genuine }));

    expect(Object.isFrozen(mapped)).toBe(true);
    expect(Reflect.ownKeys(mapped)).toEqual([]);
    expect(mapEcf31TotalesXmlElement({ evidence: { ...genuine } })).toEqual({ ok: false, error: { code: "INVALID_ECF31_TOTALES_XML_EVIDENCE", message: "e-CF 31 Totales XML mapper requires genuine derived header totals evidence." } });
  });

  it("rejects hostile exact-shape inputs with fixed safe errors", () => {
    const genuine = evidence([[1, "10"]]);
    const accessor: object = {};
    Object.defineProperty(accessor, "evidence", { enumerable: true, get: () => { throw new Error("trap"); } });
    const revoked = Proxy.revocable({ evidence: genuine }, {}); revoked.revoke();
    const candidates = [null, [], {}, { evidence: undefined }, { evidence: genuine, extra: true }, { evidence: genuine, [Symbol("extra")]: true }, accessor, Object.create({ evidence: genuine }), new Proxy({ evidence: genuine }, {}), revoked.proxy, new Proxy({ evidence: genuine }, { ownKeys: () => { throw new Error("trap"); } })];

    for (const candidate of candidates) expectInputFailure(candidate);
  });

  it("keeps the mapper internal to Builder and the package root", () => {
    expect("mapEcf31TotalesXmlElement" in rootApi).toBe(false);
    expect("mapEcf31TotalesXmlElement" in builderApi).toBe(false);
  });
});

import { types } from "node:util";

import { describe, expect, it } from "vitest";

import * as api from "../../../index.js";
import type { Result } from "../../../shared/domain/result.js";
import * as builderApi from "../index.js";
import { mapEcf31EncabezadoXmlElement } from "./ecf31-encabezado-xml-mapper.js";
import { serializeXmlDocument } from "./xml-writer.js";

function value<T>(result: Result<T, unknown>): T { if (!result.ok) throw new Error("Expected success."); return result.value; }

function evidence(indicators: readonly (0 | 1 | 2 | 3 | 4)[], paymentType: "1" | "2" | "3" = "1", issuerName = "Synthetic issuer") {
  const header = value(api.createEcf31CoreHeader({
    eNcf: value(api.parseENcf("E310000000001")),
    issuer: { taxpayerIdentifier: value(api.parseTaxpayerIdentifier("000000000")), legalName: issuerName, address: "Synthetic address" },
    buyer: { taxpayerIdentifier: value(api.parseTaxpayerIdentifier("00000000000")), legalName: "Synthetic buyer" },
    issueDate: "01-12-2026", incomeType: "01", paymentType,
  }));
  const quantizations = indicators.map((billingIndicator, index) => {
    const calculation = value(api.captureLineCalculationEvidence({ sequence: value(api.parseLineSequence(String(index + 1))), quantity: value(api.parseNonnegativeQuantity("1")), unitPrice: value(api.parseUnitPrice("10")), declaredAmount: value(api.parseNonnegativeAmount("0")) }));
    const coreLine = value(api.createEcf31CoreLine({ evidence: calculation, itemName: "Synthetic item", billingIndicator, goodOrServiceIndicator: 1 }));
    const lineAmount = value(api.createEcf31LineAmountEvidence({ coreLine, discountAmount: value(api.parseNonnegativeAmount("0")), surchargeAmount: value(api.parseNonnegativeAmount("0")) }));
    return value(api.createEcf31MontoItemQuantizationEvidence(lineAmount));
  });
  const draft = value(api.createEcf31CoreDraft({ header, lineAmounts: quantizations.map((entry) => entry.sourceEvidence) }));
  const issuanceEvidence = value(api.createEcf31IdDocIssuanceEvidence({ header, sequenceExpirationDate: "31-12-2026", ...(paymentType === "2" ? { paymentDueDate: "02-12-2026" } : {}) }));
  const exemptAmountEvidence = value(api.createEcf31PostGlobalAdjustmentExemptAmountEvidence({ draft, montoItemQuantizations: quantizations, adjustments: [] }));
  const additionalTaxClassificationEvidence = value(api.createEcf31AdditionalTaxClassificationEvidence({ draft, entries: quantizations.map((entry) => ({ source: entry.sourceEvidence, codes: [] })) }));
  const taxable = indicators.some((indicator) => indicator >= 1 && indicator <= 3);
  const priceInclusionEvidence = taxable ? value(api.createEcf31ItbisPriceInclusionEvidence({ draft, montoItemQuantizations: quantizations, indicator: 0 })) : undefined;
  if (taxable) {
    const taxableBaseEvidence = value(api.createEcf31PostGlobalAdjustmentTaxableBaseEvidence({ priceInclusionEvidence, adjustments: [] }));
    const totalItbisEvidence = value(api.createEcf31TotalItbisEvidence({ taxableBaseEvidence, additionalTaxClassificationEvidence }));
    return { issuanceEvidence, draft, derivedHeaderTotalsEvidence: value(api.createEcf31DerivedHeaderTotalsEvidence({ exemptAmountEvidence, additionalTaxClassificationEvidence, taxableBaseEvidence, totalItbisEvidence })), priceInclusionEvidence };
  }
  return { issuanceEvidence, draft, derivedHeaderTotalsEvidence: value(api.createEcf31DerivedHeaderTotalsEvidence({ exemptAmountEvidence, additionalTaxClassificationEvidence })) };
}

function serialize(input: unknown): string { return value(serializeXmlDocument(value(mapEcf31EncabezadoXmlElement(input)))); }
function expectFailure(input: unknown, code: string): void {
  expect(() => mapEcf31EncabezadoXmlElement(input)).not.toThrow();
  expect(mapEcf31EncabezadoXmlElement(input)).toMatchObject({ ok: false, error: { code } });
}

describe("e-CF 31 Encabezado XML mapper", () => {
  it("serializes the taxable bounded child sequence with Version first", () => {
    const xml = serialize(evidence([1]));
    expect(xml).toBe('<?xml version="1.0" encoding="utf-8"?><Encabezado><Version>1.0</Version><IdDoc><TipoeCF>31</TipoeCF><eNCF>E310000000001</eNCF><FechaVencimientoSecuencia>31-12-2026</FechaVencimientoSecuencia><IndicadorMontoGravado>0</IndicadorMontoGravado><TipoIngresos>01</TipoIngresos><TipoPago>1</TipoPago></IdDoc><Emisor><RNCEmisor>000000000</RNCEmisor><RazonSocialEmisor>Synthetic issuer</RazonSocialEmisor><DireccionEmisor>Synthetic address</DireccionEmisor><FechaEmision>01-12-2026</FechaEmision></Emisor><Comprador><RNCComprador>00000000000</RNCComprador><RazonSocialComprador>Synthetic buyer</RazonSocialComprador></Comprador><Totales><MontoGravadoTotal>10</MontoGravadoTotal><MontoGravadoI1>10</MontoGravadoI1><ITBIS1>18</ITBIS1><TotalITBIS>1.8</TotalITBIS><TotalITBIS1>1.8</TotalITBIS1><MontoTotal>11.8</MontoTotal></Totales></Encabezado>');
  });

  it("serializes non-taxable evidence and preserves the credit deadline", () => {
    const xml = serialize(evidence([4], "2"));
    expect(xml).toBe('<?xml version="1.0" encoding="utf-8"?><Encabezado><Version>1.0</Version><IdDoc><TipoeCF>31</TipoeCF><eNCF>E310000000001</eNCF><FechaVencimientoSecuencia>31-12-2026</FechaVencimientoSecuencia><TipoIngresos>01</TipoIngresos><TipoPago>2</TipoPago><FechaLimitePago>02-12-2026</FechaLimitePago></IdDoc><Emisor><RNCEmisor>000000000</RNCEmisor><RazonSocialEmisor>Synthetic issuer</RazonSocialEmisor><DireccionEmisor>Synthetic address</DireccionEmisor><FechaEmision>01-12-2026</FechaEmision></Emisor><Comprador><RNCComprador>00000000000</RNCComprador><RazonSocialComprador>Synthetic buyer</RazonSocialComprador></Comprador><Totales><MontoExento>10</MontoExento><MontoTotal>10</MontoTotal></Totales></Encabezado>');
  });

  it("omits every unsupported optional header section and empty element", () => {
    const xml = serialize(evidence([0]));
    expect(xml).not.toMatch(/InformacionesAdicionales|Transporte|OtraMoneda|\/>|<([A-Za-z][A-Za-z0-9._-]*)><\/\1>/);
  });

  it("rejects mismatched genuine issuance, price-inclusion, and derived-total draft lineages", () => {
    const candidate = evidence([1]);
    const other = evidence([1]);
    expectFailure({ ...candidate, issuanceEvidence: other.issuanceEvidence }, "ECF31_ENCABEZADO_XML_LINEAGE_MISMATCH");
    expectFailure({ ...candidate, priceInclusionEvidence: other.priceInclusionEvidence }, "ECF31_ENCABEZADO_XML_LINEAGE_MISMATCH");
    expectFailure({ ...candidate, derivedHeaderTotalsEvidence: other.derivedHeaderTotalsEvidence }, "ECF31_ENCABEZADO_XML_LINEAGE_MISMATCH");
  });

  it("rejects same-draft price-inclusion evidence outside the derived taxable-base lineage", () => {
    const candidate = evidence([1]);
    if (candidate.priceInclusionEvidence === undefined) throw new Error("Expected price-inclusion evidence.");
    const otherPriceInclusionEvidence = value(api.createEcf31ItbisPriceInclusionEvidence({ draft: candidate.draft, montoItemQuantizations: candidate.priceInclusionEvidence.montoItemQuantizations, indicator: 1 }));
    expectFailure({ ...candidate, priceInclusionEvidence: otherPriceInclusionEvidence }, "ECF31_ENCABEZADO_XML_LINEAGE_MISMATCH");
  });

  it("rejects cloned and forged genuine evidence", () => {
    const candidate = evidence([1]);
    expectFailure({ ...candidate, issuanceEvidence: { ...candidate.issuanceEvidence } }, "INVALID_ECF31_ENCABEZADO_XML_ISSUANCE_EVIDENCE");
    expectFailure({ ...candidate, draft: { ...candidate.draft } }, "INVALID_ECF31_ENCABEZADO_XML_DRAFT");
    expectFailure({ ...candidate, derivedHeaderTotalsEvidence: { ...candidate.derivedHeaderTotalsEvidence } }, "INVALID_ECF31_ENCABEZADO_XML_DERIVED_HEADER_TOTALS_EVIDENCE");
    expectFailure({ ...candidate, priceInclusionEvidence: { ...candidate.priceInclusionEvidence } }, "INVALID_ECF31_ENCABEZADO_XML_PRICE_INCLUSION_EVIDENCE");
    expectFailure({ ...candidate, priceInclusionEvidence: undefined }, "INVALID_ECF31_ENCABEZADO_XML_PRICE_INCLUSION_EVIDENCE");
  });

  it("rejects exact-shape hostile inputs with fixed safe errors", () => {
    const candidate = evidence([0]);
    const accessor = { ...candidate };
    Object.defineProperty(accessor, "draft", { enumerable: true, get: () => { throw new Error("trap"); } });
    const customPrototype = { ...candidate };
    Object.setPrototypeOf(customPrototype, {});
    const revoked = Proxy.revocable(candidate, {}); revoked.revoke();
    const hostile = [null, [], {}, { ...candidate, extra: true }, { ...candidate, [Symbol("extra")]: true }, Object.create(candidate), customPrototype, accessor, new Proxy(candidate, {}), revoked.proxy, new Proxy(candidate, { ownKeys: () => { throw new Error("trap"); } })];
    for (const input of hostile) expectFailure(input, "INVALID_ECF31_ENCABEZADO_XML_INPUT");
    expect(types.isProxy(candidate)).toBe(false);
  });

  it("contains realistically reachable child mapping failures without partial XML", () => {
    expectFailure(evidence([0], "1", "Invalid\u0000issuer"), "ECF31_ENCABEZADO_XML_MAPPING_FAILED");
  });

  it("returns a frozen opaque XML element through the public mapper", () => {
    const mapped = value(mapEcf31EncabezadoXmlElement(evidence([0])));
    expect(Object.isFrozen(mapped)).toBe(true);
    expect(Reflect.ownKeys(mapped)).toEqual([]);
    expect("mapEcf31EncabezadoXmlElement" in api).toBe(true);
    expect("mapEcf31EncabezadoXmlElement" in builderApi).toBe(true);
  });
});

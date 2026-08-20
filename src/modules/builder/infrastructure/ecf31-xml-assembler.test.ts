import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import * as api from "../../../index.js";
import type { Result } from "../../../shared/domain/result.js";
import { assembleEcf31Xml } from "./ecf31-xml-assembler.js";
import { validateOfflineDgiiXml } from "./offline-dgii-xsd-validator.js";

const certificateFixture = fileURLToPath(new URL("../../../../test/fixtures/certificates/synthetic-test-certificate.p12", import.meta.url));

function value<T>(result: Result<T, unknown>): T { if (!result.ok) throw new Error("Expected success."); return result.value; }

function evidence() {
  const header = value(api.createEcf31CoreHeader({
    eNcf: value(api.parseENcf("E310000000001")),
    issuer: { taxpayerIdentifier: value(api.parseTaxpayerIdentifier("000000000")), legalName: "Synthetic issuer", address: "Synthetic address" },
    buyer: { taxpayerIdentifier: value(api.parseTaxpayerIdentifier("00000000000")), legalName: "Synthetic buyer" },
    issueDate: "01-12-2026", incomeType: "01", paymentType: "1",
  }));
  const calculation = value(api.captureLineCalculationEvidence({
    sequence: value(api.parseLineSequence("1")), quantity: value(api.parseNonnegativeQuantity("1")),
    unitPrice: value(api.parseUnitPrice("10")), declaredAmount: value(api.parseNonnegativeAmount("0")),
  }));
  const line = value(api.createEcf31CoreLine({ evidence: calculation, itemName: "Synthetic item", billingIndicator: 1, goodOrServiceIndicator: 1 }));
  const lineAmount = value(api.createEcf31LineAmountEvidence({ coreLine: line, discountAmount: value(api.parseNonnegativeAmount("0")), surchargeAmount: value(api.parseNonnegativeAmount("0")) }));
  const draft = value(api.createEcf31CoreDraft({ header, lineAmounts: [lineAmount] }));
  const quantization = value(api.createEcf31MontoItemQuantizationEvidence(lineAmount));
  const classification = value(api.createEcf31AdditionalTaxClassificationEvidence({ draft, entries: [{ source: lineAmount, codes: [] }] }));
  const priceInclusionEvidence = value(api.createEcf31ItbisPriceInclusionEvidence({ draft, montoItemQuantizations: [quantization], indicator: 0 }));
  const taxableBaseEvidence = value(api.createEcf31PostGlobalAdjustmentTaxableBaseEvidence({ priceInclusionEvidence, adjustments: [] }));
  const totalItbisEvidence = value(api.createEcf31TotalItbisEvidence({ taxableBaseEvidence, additionalTaxClassificationEvidence: classification }));
  const exemptAmountEvidence = value(api.createEcf31PostGlobalAdjustmentExemptAmountEvidence({ draft, montoItemQuantizations: [quantization], adjustments: [] }));
  return {
    issuanceEvidence: value(api.createEcf31IdDocIssuanceEvidence({ header, sequenceExpirationDate: "31-12-2026" })),
    draft,
    derivedHeaderTotalsEvidence: value(api.createEcf31DerivedHeaderTotalsEvidence({ exemptAmountEvidence, additionalTaxClassificationEvidence: classification, taxableBaseEvidence, totalItbisEvidence })),
    priceInclusionEvidence,
    detallesItemsEvidence: value(api.createEcf31DetallesItemsEvidence({ draft, additionalTaxClassificationEvidence: classification })),
  };
}

describe("e-CF 31 XML assembler", () => {
  it("assembles the complete signed-root precursor in official order without empty tags", () => {
    const xml = assembleEcf31Xml({ ...evidence(), fechaHoraFirma: "01-12-2026 12:00:00" });

    expect(xml).toMatchObject({ ok: true });
    if (!xml.ok) return;
    expect(xml.value).toBe('<?xml version="1.0" encoding="utf-8"?><ECF><Encabezado><Version>1.0</Version><IdDoc><TipoeCF>31</TipoeCF><eNCF>E310000000001</eNCF><FechaVencimientoSecuencia>31-12-2026</FechaVencimientoSecuencia><IndicadorMontoGravado>0</IndicadorMontoGravado><TipoIngresos>01</TipoIngresos><TipoPago>1</TipoPago></IdDoc><Emisor><RNCEmisor>000000000</RNCEmisor><RazonSocialEmisor>Synthetic issuer</RazonSocialEmisor><DireccionEmisor>Synthetic address</DireccionEmisor><FechaEmision>01-12-2026</FechaEmision></Emisor><Comprador><RNCComprador>00000000000</RNCComprador><RazonSocialComprador>Synthetic buyer</RazonSocialComprador></Comprador><Totales><MontoGravadoTotal>10</MontoGravadoTotal><MontoGravadoI1>10</MontoGravadoI1><ITBIS1>18</ITBIS1><TotalITBIS>1.8</TotalITBIS><TotalITBIS1>1.8</TotalITBIS1><MontoTotal>11.8</MontoTotal></Totales></Encabezado><DetallesItems><Item><NumeroLinea>1</NumeroLinea><IndicadorFacturacion>1</IndicadorFacturacion><NombreItem>Synthetic item</NombreItem><IndicadorBienoServicio>1</IndicadorBienoServicio><CantidadItem>1</CantidadItem><PrecioUnitarioItem>10</PrecioUnitarioItem><MontoItem>10</MontoItem></Item></DetallesItems><FechaHoraFirma>01-12-2026 12:00:00</FechaHoraFirma></ECF>');
    expect(xml.value).not.toMatch(/<([A-Za-z][A-Za-z0-9._-]*)><\/\1>|\/>/u);
  });

  it("rejects mismatched lineage, hostile wrappers, and invalid signing timestamps without throwing", () => {
    const candidate = evidence();
    const other = evidence();
    const inputs = [
      { ...candidate, draft: other.draft, fechaHoraFirma: "01-12-2026 12:00:00" },
      { ...candidate, fechaHoraFirma: "invalid" },
      { ...candidate, fechaHoraFirma: undefined },
      { ...candidate, fechaHoraFirma: "01-12-2026 12:00:00", extra: true },
      new Proxy({ ...candidate, fechaHoraFirma: "01-12-2026 12:00:00" }, {}),
    ];

    for (const input of inputs) {
      expect(() => assembleEcf31Xml(input)).not.toThrow();
      expect(assembleEcf31Xml(input)).toMatchObject({ ok: false });
    }
  });

  it("rejects an input whose expected key is not an enumerable data property", () => {
    const candidate = { ...evidence(), fechaHoraFirma: "01-12-2026 12:00:00" };
    const { draft, ...rest } = candidate;
    const hidden = Object.defineProperty({ ...rest }, "draft", { value: draft, enumerable: false, configurable: true });

    expect(assembleEcf31Xml(hidden)).toEqual({ ok: false, error: { code: "INVALID_ECF31_XML_ASSEMBLER_INPUT" } });
  });

  it("omits the optional price inclusion evidence without assuming a default", () => {
    const { issuanceEvidence, draft, derivedHeaderTotalsEvidence, detallesItemsEvidence } = evidence();
    const withoutPriceInclusion = { issuanceEvidence, draft, derivedHeaderTotalsEvidence, detallesItemsEvidence, fechaHoraFirma: "01-12-2026 12:00:00" };

    expect(() => assembleEcf31Xml(withoutPriceInclusion)).not.toThrow();
    expect(assembleEcf31Xml(withoutPriceInclusion)).toMatchObject({ ok: false });
  });

  it("rejects detalles evidence belonging to a different draft than the header lineage", () => {
    // The header inputs stay internally consistent so both mappers succeed; only the detalles
    // evidence comes from another draft, which is the sole condition the lineage guard exists for.
    const candidate = evidence();
    const other = evidence();

    expect(assembleEcf31Xml({ ...candidate, detallesItemsEvidence: other.detallesItemsEvidence, fechaHoraFirma: "01-12-2026 12:00:00" }))
      .toEqual({ ok: false, error: { code: "ECF31_XML_ASSEMBLER_LINEAGE_MISMATCH" } });
  });

  it("signs, validates offline, and verifies the assembled complete document before reception", async () => {
    const identity = value(api.parseTaxpayerIdentifier("000000000"));
    const certificate = value(api.loadInMemoryPkcs12({ bytes: await readFile(certificateFixture), password: "synthetic-test-password", expectedSignerIdentity: identity }));
    const assembled = value(assembleEcf31Xml({ ...evidence(), fechaHoraFirma: "01-12-2026 12:00:00" }));
    const signed = value(api.signXmlWithAuthenticatedCertificate({ xml: assembled, certificateMaterial: certificate }));
    const serialized = value(api.serializeSignedXmlArtifact(signed));

    await expect(validateOfflineDgiiXml(serialized, "ecf-31-v1.0")).resolves.toEqual({ ok: true, value: { valid: true } });
    expect(api.verifyDgiiXmlSignature({ xml: serialized }).ok).toBe(true);
  });
});

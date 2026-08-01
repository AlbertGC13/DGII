import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import * as api from "../../../index.js";
import type { Result } from "../../../shared/domain/result.js";
import { mapEcf31IdDocXmlElement } from "./ecf31-iddoc-xml-mapper.js";
import { serializeXmlDocument } from "./xml-writer.js";

const DECLARATION = '<?xml version="1.0" encoding="utf-8"?>';

function value<T>(result: Result<T, unknown>): T {
  if (!result.ok) throw new Error("Expected a successful result.");
  return result.value;
}

function source(sequence: string, billingIndicator: 0 | 1 | 2 | 3 | 4) {
  const calculation = value(api.captureLineCalculationEvidence({
    sequence: value(api.parseLineSequence(sequence)), quantity: value(api.parseNonnegativeQuantity("1")),
    unitPrice: value(api.parseUnitPrice("0")), declaredAmount: value(api.parseNonnegativeAmount("0")),
  }));
  const coreLine = value(api.createEcf31CoreLine({
    evidence: calculation, itemName: "Synthetic item", billingIndicator, goodOrServiceIndicator: 1,
  }));
  return value(api.createEcf31LineAmountEvidence({
    coreLine, discountAmount: value(api.parseNonnegativeAmount("0")), surchargeAmount: value(api.parseNonnegativeAmount("0")),
  }));
}

function draft(indicators: readonly (0 | 1 | 2 | 3 | 4)[], paymentType: "1" | "2" | "3" = "1") {
  const header = value(api.createEcf31CoreHeader({
    eNcf: value(api.parseENcf("E310000000001")),
    issuer: { taxpayerIdentifier: value(api.parseTaxpayerIdentifier("000000000")), legalName: "Synthetic issuer", address: "Synthetic address" },
    buyer: { taxpayerIdentifier: value(api.parseTaxpayerIdentifier("00000000000")), legalName: "Synthetic buyer" },
    issueDate: "01-12-2026", incomeType: "01", paymentType,
  }));
  return value(api.createEcf31CoreDraft({ header, lineAmounts: indicators.map((indicator, index) => source(String(index + 1), indicator)) }));
}

function input(
  indicators: readonly (0 | 1 | 2 | 3 | 4)[],
  options: Readonly<{ indicator?: 0 | 1; paymentType?: "1" | "2" | "3" }> = {},
) {
  const coreDraft = draft(indicators, options.paymentType);
  const issuanceEvidence = value(api.createEcf31IdDocIssuanceEvidence({
    header: coreDraft.header, sequenceExpirationDate: "31-12-2026",
    ...(options.paymentType === "2" ? { paymentDueDate: "02-12-2026" } : {}),
  }));
  const taxable = indicators.some((indicator) => indicator === 1 || indicator === 2 || indicator === 3);
  const priceInclusionEvidence = taxable ? value(api.createEcf31ItbisPriceInclusionEvidence({
    draft: coreDraft, indicator: options.indicator ?? 0,
    montoItemQuantizations: coreDraft.lineAmounts.map((lineAmount) => value(api.createEcf31MontoItemQuantizationEvidence(lineAmount))),
  })) : undefined;
  return { issuanceEvidence, draft: coreDraft, ...(priceInclusionEvidence === undefined ? {} : { priceInclusionEvidence }) };
}

function serialize(inputValue: unknown): string {
  return value(serializeXmlDocument(value(mapEcf31IdDocXmlElement(inputValue))));
}

function expectFailure(inputValue: unknown, code: string): void {
  expect(() => mapEcf31IdDocXmlElement(inputValue)).not.toThrow();
  expect(mapEcf31IdDocXmlElement(inputValue)).toMatchObject({ ok: false, error: { code } });
}

describe("e-CF 31 IdDoc XML mapper", () => {
  it("serializes the non-taxable 0/4 omission in exact XSD order", () => {
    expect(serialize(input([0, 4]))).toBe(`${DECLARATION}<IdDoc><TipoeCF>31</TipoeCF><eNCF>E310000000001</eNCF><FechaVencimientoSecuencia>31-12-2026</FechaVencimientoSecuencia><TipoIngresos>01</TipoIngresos><TipoPago>1</TipoPago></IdDoc>`);
  });

  it.each([0, 1] as const)("serializes taxable price-inclusion indicator %i", (indicator) => {
    expect(serialize(input([1], { indicator }))).toBe(`${DECLARATION}<IdDoc><TipoeCF>31</TipoeCF><eNCF>E310000000001</eNCF><FechaVencimientoSecuencia>31-12-2026</FechaVencimientoSecuencia><IndicadorMontoGravado>${String(indicator)}</IndicadorMontoGravado><TipoIngresos>01</TipoIngresos><TipoPago>1</TipoPago></IdDoc>`);
  });

  it.each(["1", "3"] as const)("serializes payment type %s without a deadline", (paymentType) => {
    expect(serialize(input([0], { paymentType }))).toContain(`<TipoPago>${paymentType}</TipoPago></IdDoc>`);
  });

  it("serializes the credit deadline after payment type", () => {
    expect(serialize(input([0], { paymentType: "2" }))).toContain("<TipoPago>2</TipoPago><FechaLimitePago>02-12-2026</FechaLimitePago>");
  });

  it.each([1, 2, 3] as const)("requires price-inclusion evidence for taxable indicator %i, even at zero amount", (indicator) => {
    const candidate = input([indicator]);
    expectFailure({ issuanceEvidence: candidate.issuanceEvidence, draft: candidate.draft }, "ECF31_IDDOC_XML_PRICE_INCLUSION_REQUIRED");
  });

  it("rejects forged or cloned evidence and draft values", () => {
    const candidate = input([1]);
    expectFailure({ ...candidate, issuanceEvidence: { ...candidate.issuanceEvidence } }, "INVALID_ECF31_IDDOC_XML_ISSUANCE_EVIDENCE");
    expectFailure({ ...candidate, draft: { ...candidate.draft } }, "INVALID_ECF31_IDDOC_XML_DRAFT");
    expectFailure({ ...candidate, priceInclusionEvidence: { ...candidate.priceInclusionEvidence } }, "INVALID_ECF31_IDDOC_XML_PRICE_INCLUSION_EVIDENCE");
  });

  it("rejects mismatched genuine issuance-header and price-draft lineages", () => {
    const candidate = input([1]);
    const other = input([1]);
    expectFailure({ ...candidate, issuanceEvidence: other.issuanceEvidence }, "ECF31_IDDOC_XML_LINEAGE_MISMATCH");
    expectFailure({ ...candidate, priceInclusionEvidence: other.priceInclusionEvidence }, "ECF31_IDDOC_XML_LINEAGE_MISMATCH");
  });

  it("rejects a supplied foreign or forged price evidence for a 0/4 draft", () => {
    const nonTaxable = input([0, 4]);
    const taxable = input([1]);
    expectFailure({ ...nonTaxable, priceInclusionEvidence: taxable.priceInclusionEvidence }, "ECF31_IDDOC_XML_LINEAGE_MISMATCH");
    expectFailure({ ...nonTaxable, priceInclusionEvidence: {} }, "INVALID_ECF31_IDDOC_XML_PRICE_INCLUSION_EVIDENCE");
  });

  it("contains invalid outer shapes, accessors, prototypes, and hostile proxies", () => {
    const candidate = input([0]);
    const accessor: unknown = Object.create(null, { issuanceEvidence: { enumerable: true, get: () => { throw new Error("trap"); } }, draft: { enumerable: true, value: candidate.draft } });
    const inherited: unknown = Object.create({ issuanceEvidence: candidate.issuanceEvidence, draft: candidate.draft });
    const revoked = Proxy.revocable({}, {}); revoked.revoke();
    const throwing = new Proxy({}, { ownKeys: () => { throw new Error("trap"); } });
    for (const hostile of [null, [], {}, { issuanceEvidence: candidate.issuanceEvidence }, { draft: candidate.draft }, { ...candidate, extra: true }, accessor, inherited, revoked.proxy, throwing]) {
      expectFailure(hostile, "INVALID_ECF31_IDDOC_XML_INPUT");
    }
  });

  it("returns a frozen opaque node without empty tags or public exports", () => {
    const mapped = value(mapEcf31IdDocXmlElement(input([0])));
    const xml = value(serializeXmlDocument(mapped));
    const builderIndex = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
    const rootIndex = readFileSync(new URL("../../../index.ts", import.meta.url), "utf8");

    expect(Object.isFrozen(mapped)).toBe(true);
    expect(xml).not.toContain("/>");
    expect(xml).not.toMatch(/<([A-Za-z][A-Za-z0-9._-]*)><\/\1>/);
    expect(`${builderIndex}\n${rootIndex}`).not.toMatch(/ecf31-iddoc-xml-mapper|mapEcf31IdDocXmlElement|xml-writer|serializeXml/);
  });
});

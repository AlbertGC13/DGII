import { describe, expect, it } from "vitest";

import * as rootApi from "../../../index.js";
import * as builderApi from "../index.js";
import type { Result } from "../../../index.js";
import { mapEcf31DetallesItemsXmlElement } from "./ecf31-detalles-items-xml-mapper.js";
import { serializeXmlDocument } from "./xml-writer.js";

function value<T>(result: Result<T, unknown>): T { if (!result.ok) throw new Error("Expected success."); return result.value; }

function evidence(lines: readonly Readonly<{ name?: string; quantity?: string; price?: string; discount?: string; surcharge?: string; codes?: readonly string[] }>[]) {
  const lineAmounts = lines.map((line, index) => value(rootApi.createEcf31LineAmountEvidence({
    coreLine: value(rootApi.createEcf31CoreLine({
      evidence: value(rootApi.captureLineCalculationEvidence({
        sequence: value(rootApi.parseLineSequence(String(index + 1))),
        quantity: value(rootApi.parseNonnegativeQuantity(line.quantity ?? "1")),
        unitPrice: value(rootApi.parseUnitPrice(line.price ?? "10")),
        declaredAmount: value(rootApi.parseNonnegativeAmount("0")),
      })),
      itemName: line.name ?? `Synthetic item ${String(index + 1)}`,
      billingIndicator: 1,
      goodOrServiceIndicator: 1,
    })),
    discountAmount: value(rootApi.parseNonnegativeAmount(line.discount ?? "0")),
    surchargeAmount: value(rootApi.parseNonnegativeAmount(line.surcharge ?? "0")),
  })));
  const header = value(rootApi.createEcf31CoreHeader({
    eNcf: value(rootApi.parseENcf("E310000000001")),
    issuer: { taxpayerIdentifier: value(rootApi.parseTaxpayerIdentifier("000000000")), legalName: "Synthetic issuer", address: "Synthetic address" },
    buyer: { taxpayerIdentifier: value(rootApi.parseTaxpayerIdentifier("00000000000")), legalName: "Synthetic buyer" },
    issueDate: "01-12-2026", incomeType: "01", paymentType: "1",
  }));
  const draft = value(rootApi.createEcf31CoreDraft({ header, lineAmounts }));
  const classification = value(rootApi.createEcf31AdditionalTaxClassificationEvidence({
    draft,
    entries: draft.lineAmounts.map((source, index) => ({ source, codes: lines[index]?.codes ?? [] })),
  }));
  return value(rootApi.createEcf31DetallesItemsEvidence({ draft, additionalTaxClassificationEvidence: classification }));
}

function itemCodeMetadata(
  source: ReturnType<typeof evidence>,
  codes: readonly (readonly (readonly [string, string])[])[],
) {
  return value(rootApi.createEcf31ItemCodeMetadataEvidence({
    draft: source.draft,
    entries: source.draft.lineAmounts.map((line, index) => ({
      source: line,
      codes: (codes[index] ?? []).map(([type, value]) => ({ type, value })),
    })),
  }));
}

function itemDescriptionMetadata(source: ReturnType<typeof evidence>, descriptions: readonly (string | undefined)[]) {
  return value(rootApi.createEcf31ItemDescriptionMetadataEvidence({
    draft: source.draft,
    entries: source.draft.lineAmounts.map((line, index) => {
      const description = descriptions[index];
      return description === undefined ? { source: line } : { source: line, description };
    }),
  }));
}

function serialize(input: unknown): string {
  return value(serializeXmlDocument(value(mapEcf31DetallesItemsXmlElement(input))));
}

function expectFailure(input: unknown, code: string): void {
  expect(() => mapEcf31DetallesItemsXmlElement(input)).not.toThrow();
  expect(mapEcf31DetallesItemsXmlElement(input)).toMatchObject({ ok: false, error: { code } });
}

describe("e-CF 31 DetallesItems XML mapper", () => {
  it("serializes one and multiple authentic items in evidence order with exact field order and scales", () => {
    expect(serialize({ evidence: evidence([{ quantity: "2", price: "10.125" }]) })).toBe(
      '<?xml version="1.0" encoding="utf-8"?><DetallesItems><Item><NumeroLinea>1</NumeroLinea><IndicadorFacturacion>1</IndicadorFacturacion><NombreItem>Synthetic item 1</NombreItem><IndicadorBienoServicio>1</IndicadorBienoServicio><CantidadItem>2</CantidadItem><PrecioUnitarioItem>10.125</PrecioUnitarioItem><MontoItem>20.25</MontoItem></Item></DetallesItems>',
    );
    expect(serialize({ evidence: evidence([{ quantity: "1.5", price: "2.3333" }, { quantity: "3", price: "4" }]) })).toContain(
      "<DetallesItems><Item><NumeroLinea>1</NumeroLinea><IndicadorFacturacion>1</IndicadorFacturacion><NombreItem>Synthetic item 1</NombreItem><IndicadorBienoServicio>1</IndicadorBienoServicio><CantidadItem>1.5</CantidadItem><PrecioUnitarioItem>2.3333</PrecioUnitarioItem><MontoItem>3.5</MontoItem></Item><Item><NumeroLinea>2</NumeroLinea>",
    );
  });

  it("uses writer escaping and omits every unsupported or empty optional tag", () => {
    const xml = serialize({ evidence: evidence([{ name: 'Synthetic <&> " item' }]) });

    expect(xml).toContain("<NombreItem>Synthetic &lt;&amp;&gt; &quot; item</NombreItem>");
    expect(xml).not.toMatch(/<(?:TablaCodigosItem|TablaImpuestoAdicional|DescuentoMonto|RecargoMonto|Retencion|OtraMonedaDetalle)[/>]/);
  });

  it("serializes authenticated item-code metadata after NumeroLinea in exact source order", () => {
    const source = evidence([{}, {}]);
    const metadata = itemCodeMetadata(source, [[['EAN', ' 0123 & '], ['Interna', '<x>']], []]);

    expect(serialize({ evidence: source, itemCodeMetadataEvidence: metadata })).toContain(
      "<Item><NumeroLinea>1</NumeroLinea><TablaCodigosItem><CodigosItem><TipoCodigo>EAN</TipoCodigo><CodigoItem> 0123 &amp; </CodigoItem></CodigosItem><CodigosItem><TipoCodigo>Interna</TipoCodigo><CodigoItem>&lt;x&gt;</CodigoItem></CodigosItem></TablaCodigosItem><IndicadorFacturacion>1</IndicadorFacturacion>",
    );
    expect(serialize({ evidence: source, itemCodeMetadataEvidence: metadata })).toContain(
      "<Item><NumeroLinea>2</NumeroLinea><IndicadorFacturacion>1</IndicadorFacturacion>",
    );
  });

  it("omits item-code tables for absent and empty authenticated metadata", () => {
    const source = evidence([{}]);
    const metadata = itemCodeMetadata(source, [[]]);

    expect(serialize({ evidence: source })).not.toContain("TablaCodigosItem");
    expect(serialize({ evidence: source, itemCodeMetadataEvidence: metadata })).not.toContain("TablaCodigosItem");
  });

  it("serializes authenticated descriptions after IndicadorBienoServicio in exact source order", () => {
    const source = evidence([{}, {}]);
    const metadata = itemDescriptionMetadata(source, ['  Description <&> " ', undefined]);

    expect(serialize({ evidence: source, descriptionMetadataEvidence: metadata })).toContain(
      '<Item><NumeroLinea>1</NumeroLinea><IndicadorFacturacion>1</IndicadorFacturacion><NombreItem>Synthetic item 1</NombreItem><IndicadorBienoServicio>1</IndicadorBienoServicio><DescripcionItem>  Description &lt;&amp;&gt; &quot; </DescripcionItem><CantidadItem>1</CantidadItem>',
    );
    expect(serialize({ evidence: source, descriptionMetadataEvidence: metadata })).toContain(
      '<Item><NumeroLinea>2</NumeroLinea><IndicadorFacturacion>1</IndicadorFacturacion><NombreItem>Synthetic item 2</NombreItem><IndicadorBienoServicio>1</IndicadorBienoServicio><CantidadItem>1</CantidadItem>',
    );
  });

  it("omits absent description metadata and combines authenticated descriptions with item codes", () => {
    const source = evidence([{}]);
    const descriptions = itemDescriptionMetadata(source, ["Description"]);
    const codes = itemCodeMetadata(source, [[['EAN', '1']]]);

    expect(serialize({ evidence: source })).not.toContain("DescripcionItem");
    expect(serialize({ evidence: source, itemCodeMetadataEvidence: codes, descriptionMetadataEvidence: descriptions })).toContain(
      "<NumeroLinea>1</NumeroLinea><TablaCodigosItem><CodigosItem><TipoCodigo>EAN</TipoCodigo><CodigoItem>1</CodigoItem></CodigosItem></TablaCodigosItem><IndicadorFacturacion>1</IndicadorFacturacion><NombreItem>Synthetic item 1</NombreItem><IndicadorBienoServicio>1</IndicadorBienoServicio><DescripcionItem>Description</DescripcionItem><CantidadItem>1</CantidadItem>",
    );
  });

  it.each([
    [{ discount: "0.01" }, "ECF31_DETALLES_ITEMS_XML_DISCOUNT_UNSUPPORTED"],
    [{ surcharge: "0.01" }, "ECF31_DETALLES_ITEMS_XML_SURCHARGE_UNSUPPORTED"],
    [{ codes: ["001"] }, "ECF31_DETALLES_ITEMS_XML_ITEM_CODES_UNSUPPORTED"],
    [{ codes: ["005"] }, "ECF31_DETALLES_ITEMS_XML_ITEM_CODES_UNSUPPORTED"],
    [{ codes: ["006"] }, "ECF31_DETALLES_ITEMS_XML_ADDITIONAL_TAX_CODES_UNSUPPORTED"],
    [{ codes: ["039"] }, "ECF31_DETALLES_ITEMS_XML_ADDITIONAL_TAX_CODES_UNSUPPORTED"],
  ] as const)("rejects unsupported bounded evidence %#", (line, code) => {
    expectFailure({ evidence: evidence([line]) }, code);
  });

  it("rejects clones, forgeries, hostile wrappers, and writer failures without partial XML", () => {
    const genuine = evidence([{}]);
    const accessor: object = {};
    Object.defineProperty(accessor, "evidence", { enumerable: true, get: () => { throw new Error("trap"); } });
    const revoked = Proxy.revocable({ evidence: genuine }, {}); revoked.revoke();
    const hostile = [null, [], {}, { evidence: undefined }, { evidence: genuine, extra: true }, { evidence: genuine, [Symbol("extra")]: true }, accessor, Object.create({ evidence: genuine }), Object.setPrototypeOf({ evidence: genuine }, {}), new Proxy({ evidence: genuine }, {}), revoked.proxy, new Proxy({ evidence: genuine }, { ownKeys: () => { throw new Error("trap"); } })];

    for (const input of hostile) expectFailure(input, "INVALID_ECF31_DETALLES_ITEMS_XML_INPUT");
    expectFailure({ evidence: { ...genuine } }, "INVALID_ECF31_DETALLES_ITEMS_XML_EVIDENCE");
    expectFailure({ evidence: evidence([{ name: "\u0001" }]) }, "ECF31_DETALLES_ITEMS_XML_MAPPING_FAILED");
  });

  it("rejects unauthenticated or mismatched item-code metadata and hostile optional input", () => {
    const source = evidence([{}]);
    const other = evidence([{}]);
    const genuine = itemCodeMetadata(source, [[['EAN', '1']]]);
    const accessor: object = { evidence: source };
    Object.defineProperty(accessor, "itemCodeMetadataEvidence", { enumerable: true, get: () => { throw new Error("trap"); } });

    expectFailure({ evidence: source, itemCodeMetadataEvidence: undefined }, "INVALID_ECF31_DETALLES_ITEMS_XML_INPUT");
    expectFailure(accessor, "INVALID_ECF31_DETALLES_ITEMS_XML_INPUT");
    expectFailure({ evidence: source, itemCodeMetadataEvidence: { ...genuine } }, "INVALID_ECF31_DETALLES_ITEMS_XML_ITEM_CODE_METADATA");
    expectFailure({ evidence: source, itemCodeMetadataEvidence: itemCodeMetadata(other, [[['EAN', '1']]]) }, "ECF31_DETALLES_ITEMS_XML_ITEM_CODE_METADATA_LINEAGE_MISMATCH");
    expectFailure({ evidence: source, itemCodeMetadataEvidence: new Proxy(genuine, {}) }, "INVALID_ECF31_DETALLES_ITEMS_XML_ITEM_CODE_METADATA");
    expectFailure({ evidence: source, itemCodeMetadataEvidence: itemCodeMetadata(source, [[['EAN', "\u0001"]]]) }, "ECF31_DETALLES_ITEMS_XML_MAPPING_FAILED");
  });

  it("rejects unauthenticated, foreign, hostile, and XML-invalid description metadata safely", () => {
    const source = evidence([{}]);
    const other = evidence([{}]);
    const genuine = itemDescriptionMetadata(source, ["Description"]);
    const accessor: object = { evidence: source };
    Object.defineProperty(accessor, "descriptionMetadataEvidence", { enumerable: true, get: () => { throw new Error("trap"); } });

    expectFailure({ evidence: source, descriptionMetadataEvidence: undefined }, "INVALID_ECF31_DETALLES_ITEMS_XML_INPUT");
    expectFailure(accessor, "INVALID_ECF31_DETALLES_ITEMS_XML_INPUT");
    expectFailure({ evidence: source, descriptionMetadataEvidence: { ...genuine } }, "INVALID_ECF31_DETALLES_ITEMS_XML_DESCRIPTION_METADATA");
    expectFailure({ evidence: source, descriptionMetadataEvidence: new Proxy(genuine, {}) }, "INVALID_ECF31_DETALLES_ITEMS_XML_DESCRIPTION_METADATA");
    expectFailure({ evidence: source, descriptionMetadataEvidence: itemDescriptionMetadata(other, ["Description"]) }, "ECF31_DETALLES_ITEMS_XML_DESCRIPTION_METADATA_LINEAGE_MISMATCH");
    expectFailure({ evidence: source, descriptionMetadataEvidence: itemDescriptionMetadata(source, ["\u0001"]) }, "ECF31_DETALLES_ITEMS_XML_MAPPING_FAILED");
  });

  it("returns a frozen opaque element, preserves immutable genuine lineage, and stays internal", () => {
    const genuine = evidence([{}]);
    const mapped = value(mapEcf31DetallesItemsXmlElement({ evidence: genuine }));

    expect(Object.isFrozen(mapped)).toBe(true);
    expect(Reflect.ownKeys(mapped)).toEqual([]);
    expect(genuine.entries[0]?.lineAmount).toBe(genuine.draft.lineAmounts[0]);
    expect(genuine.entries[0]?.montoItem.sourceEvidence).toBe(genuine.entries[0]?.lineAmount);
    expect("mapEcf31DetallesItemsXmlElement" in rootApi).toBe(false);
    expect("mapEcf31DetallesItemsXmlElement" in builderApi).toBe(false);
  });
});

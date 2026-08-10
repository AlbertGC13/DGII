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

function itemUnitMetadata(source: ReturnType<typeof evidence>, units: readonly (string | undefined)[]) {
  return value(rootApi.createEcf31ItemUnitMetadataEvidence({
    draft: source.draft,
    entries: source.draft.lineAmounts.map((line, index) => {
      const unit = units[index];
      return unit === undefined ? { source: line } : { source: line, unit };
    }),
  }));
}

function itemReferenceMetadata(source: ReturnType<typeof evidence>, references: readonly (Readonly<{ quantity: string; unit: string }> | undefined)[]) {
  return value(rootApi.createEcf31ItemReferenceMetadataEvidence({
    draft: source.draft,
    entries: source.draft.lineAmounts.map((line, index) => {
      const reference = references[index];
      return reference === undefined ? { source: line } : { source: line, ...reference };
    }),
  }));
}

function itemDatesMetadata(source: ReturnType<typeof evidence>) {
  return value(rootApi.createEcf31ItemDatesMetadataEvidence({
    draft: source.draft,
    entries: source.draft.lineAmounts.map((line, index) => index === 0
      ? { source: line, elaborationDate: "29-02-2000", itemExpirationDate: "29-02-2028" }
      : { source: line }),
  }));
}

function subquantityMetadata(
  source: ReturnType<typeof evidence>,
  subquantities: readonly (readonly Readonly<{ subquantity: string; unit: string }>[])[],
) {
  return value(rootApi.createEcf31SubquantityMetadataEvidence({
    draft: source.draft,
    entries: source.draft.lineAmounts.map((line, index) => ({
      source: line,
      subquantities: (subquantities[index] ?? []).map((pair) => ({
        subquantity: value(rootApi.parseNonnegativeSubquantity(pair.subquantity)),
        unit: value(rootApi.parseEcf31UnitOfMeasureCode(pair.unit)),
      })),
    })),
  }));
}

function alcoholReferenceEvidence(
  source: ReturnType<typeof evidence>,
  specs: readonly (Readonly<{ codes: readonly string[]; alcohol?: string; referencePrice?: string }> | undefined)[],
) {
  const classification = value(rootApi.createEcf31AdditionalTaxClassificationEvidence({
    draft: source.draft,
    entries: source.draft.lineAmounts.map((line, index) => ({
      source: line,
      codes: specs[index]?.codes ?? [],
    })),
  }));
  const entries = source.draft.lineAmounts.map((line, index) => {
    const spec = specs[index];
    const codes = spec?.codes ?? [];
    const alcohol = spec?.alcohol;
    const referencePrice = spec?.referencePrice;
    const requiresAlcohol = codes.some((code) => code >= "006" && code <= "018");
    const requiresPrice = codes.some((code) => code >= "023" && code <= "039");
    const entry: { source: typeof line; alcoholDegrees?: unknown; referenceUnitPrice?: unknown } = { source: line };
    if (requiresAlcohol && alcohol !== undefined) entry.alcoholDegrees = value(rootApi.parseEcf31AlcoholDegrees(alcohol));
    if (requiresPrice && referencePrice !== undefined) entry.referenceUnitPrice = value(rootApi.parsePositiveAmount(referencePrice));
    return entry;
  });
  return value(rootApi.createEcf31AlcoholReferencePriceEvidence({ draft: source.draft, classification, entries }));
}

function retentionMetadata(
  source: ReturnType<typeof evidence>,
  entries: readonly Readonly<{ indicator?: 1 | 2; itbisRetainedAmount?: string; isrRetainedAmount?: string }>[],
) {
  return value(rootApi.createEcf31RetentionMetadataEvidence({
    draft: source.draft,
    entries: source.draft.lineAmounts.map((line, index) => {
      const entry = entries[index] ?? {};
      return {
        source: line,
        ...(entry.indicator === undefined ? {} : { indicator: entry.indicator }),
        ...(entry.itbisRetainedAmount === undefined ? {} : { itbisRetainedAmount: entry.itbisRetainedAmount }),
        ...(entry.isrRetainedAmount === undefined ? {} : { isrRetainedAmount: entry.isrRetainedAmount }),
      };
    }),
  }));
}

function otherCurrencyDetailEvidence(
  source: ReturnType<typeof evidence>,
  entries: readonly Readonly<{ precioOtraMoneda?: string; descuento?: string; recargo?: string; montoItemOtraMoneda?: string }>[],
) {
  return value(rootApi.createEcf31OtherCurrencyDetailEvidence({
    draft: source.draft,
    entries: source.draft.lineAmounts.map((line, index) => ({ source: line, ...(entries[index] ?? {}) })),
  }));
}

type SubadjustmentInput = Readonly<{ type: "$" | "%"; amount: string; percentage?: string }>;

function lineSubadjustments(
  source: ReturnType<typeof evidence>,
  entries: readonly Readonly<{ discounts?: readonly SubadjustmentInput[]; surcharges?: readonly SubadjustmentInput[] }>[],
) {
  const mapSubadjustment = (input: SubadjustmentInput) => input.type === "$"
    ? { type: input.type, amount: value(rootApi.parseNonnegativeAmount(input.amount)) }
    : {
      type: input.type,
      amount: value(rootApi.parseNonnegativeAmount(input.amount)),
      percentage: value(rootApi.parsePositivePercentage(input.percentage)),
    };
  return value(rootApi.createEcf31LineSubadjustmentEvidence({
    draft: source.draft,
    entries: source.draft.lineAmounts.map((line, index) => ({
      source: line,
      discounts: (entries[index]?.discounts ?? []).map(mapSubadjustment),
      surcharges: (entries[index]?.surcharges ?? []).map(mapSubadjustment),
    })),
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

  it("serializes authenticated units immediately after CantidadItem and composes all item metadata", () => {
    const source = evidence([{}, {}]);
    const codes = itemCodeMetadata(source, [[['EAN', '1']], []]);
    const descriptions = itemDescriptionMetadata(source, ["Description", undefined]);
    const units = itemUnitMetadata(source, ["62", undefined]);

    expect(serialize({ evidence: source, itemCodeMetadataEvidence: codes, descriptionMetadataEvidence: descriptions, itemUnitMetadataEvidence: units })).toContain(
      "<NumeroLinea>1</NumeroLinea><TablaCodigosItem><CodigosItem><TipoCodigo>EAN</TipoCodigo><CodigoItem>1</CodigoItem></CodigosItem></TablaCodigosItem><IndicadorFacturacion>1</IndicadorFacturacion><NombreItem>Synthetic item 1</NombreItem><IndicadorBienoServicio>1</IndicadorBienoServicio><DescripcionItem>Description</DescripcionItem><CantidadItem>1</CantidadItem><UnidadMedida>62</UnidadMedida><PrecioUnitarioItem>10</PrecioUnitarioItem>",
    );
    expect(serialize({ evidence: source, itemUnitMetadataEvidence: units })).toContain(
      "<NumeroLinea>2</NumeroLinea><IndicadorFacturacion>1</IndicadorFacturacion><NombreItem>Synthetic item 2</NombreItem><IndicadorBienoServicio>1</IndicadorBienoServicio><CantidadItem>1</CantidadItem><PrecioUnitarioItem>10</PrecioUnitarioItem>",
    );
  });

  it("serializes paired authenticated reference metadata after UnidadMedida without changing later item order", () => {
    const source = evidence([{ price: "100", discount: "15", surcharge: "3", codes: ["006"] }, {}]);
    const units = itemUnitMetadata(source, ["62", undefined]);
    const references = itemReferenceMetadata(source, [{ quantity: "0.50", unit: "24" }, undefined]);
    const adjustments = lineSubadjustments(source, [{ discounts: [{ type: "$", amount: "15" }], surcharges: [{ type: "$", amount: "3" }] }, {}]);

    expect(serialize({ evidence: source, itemUnitMetadataEvidence: units, itemReferenceMetadataEvidence: references, lineSubadjustmentEvidence: adjustments })).toContain(
      "<CantidadItem>1</CantidadItem><UnidadMedida>62</UnidadMedida><CantidadReferencia>0.5</CantidadReferencia><UnidadReferencia>24</UnidadReferencia><PrecioUnitarioItem>100</PrecioUnitarioItem><DescuentoMonto>15</DescuentoMonto>",
    );
    expect(serialize({ evidence: source, itemReferenceMetadataEvidence: references, lineSubadjustmentEvidence: adjustments })).toContain(
      "<Item><NumeroLinea>2</NumeroLinea><IndicadorFacturacion>1</IndicadorFacturacion><NombreItem>Synthetic item 2</NombreItem><IndicadorBienoServicio>1</IndicadorBienoServicio><CantidadItem>1</CantidadItem><PrecioUnitarioItem>10</PrecioUnitarioItem>",
    );
  });

  it("rejects forged, foreign, reordered, incomplete, extra, proxied, and explicitly undefined reference metadata safely", () => {
    const source = evidence([{}, {}]);
    const genuine = itemReferenceMetadata(source, [{ quantity: "1", unit: "24" }, { quantity: "2", unit: "62" }]);
    const other = evidence([{}, {}]);
    const revoked = Proxy.revocable(genuine, {}); revoked.revoke();

    expectFailure({ evidence: source, itemReferenceMetadataEvidence: undefined }, "INVALID_ECF31_DETALLES_ITEMS_XML_INPUT");
    for (const metadata of [{ ...genuine }, { ...genuine, entries: [...genuine.entries].reverse() }, { ...genuine, entries: [] }, { ...genuine, entries: [...genuine.entries, genuine.entries[0]] }, new Proxy(genuine, {}), revoked.proxy]) {
      expectFailure({ evidence: source, itemReferenceMetadataEvidence: metadata }, "INVALID_ECF31_DETALLES_ITEMS_XML_ITEM_REFERENCE_METADATA");
    }
    expectFailure({ evidence: source, itemReferenceMetadataEvidence: itemReferenceMetadata(other, [{ quantity: "1", unit: "24" }, { quantity: "2", unit: "62" }]) }, "ECF31_DETALLES_ITEMS_XML_ITEM_REFERENCE_METADATA_LINEAGE_MISMATCH");
  });

  it("serializes authenticated item dates immediately before PrecioUnitarioItem and omits absent fields", () => {
    const source = evidence([{}, {}]);
    const dates = itemDatesMetadata(source);
    const units = itemUnitMetadata(source, ["62", undefined]);

    expect(serialize({ evidence: source, itemUnitMetadataEvidence: units, itemDatesMetadataEvidence: dates })).toContain(
      "<CantidadItem>1</CantidadItem><UnidadMedida>62</UnidadMedida><FechaElaboracion>29-02-2000</FechaElaboracion><FechaVencimientoItem>29-02-2028</FechaVencimientoItem><PrecioUnitarioItem>10</PrecioUnitarioItem>",
    );
    expect(serialize({ evidence: source, itemDatesMetadataEvidence: dates })).toContain(
      "<Item><NumeroLinea>2</NumeroLinea><IndicadorFacturacion>1</IndicadorFacturacion><NombreItem>Synthetic item 2</NombreItem><IndicadorBienoServicio>1</IndicadorBienoServicio><CantidadItem>1</CantidadItem><PrecioUnitarioItem>10</PrecioUnitarioItem>",
    );
  });

  it("serializes ordered authenticated subquantity pairs after references and before dates", () => {
    const source = evidence([{}, {}]);
    const references = itemReferenceMetadata(source, [{ quantity: "2", unit: "24" }, undefined]);
    const dates = itemDatesMetadata(source);
    const subquantities = subquantityMetadata(source, [[{ subquantity: "0.500", unit: "18" }, { subquantity: "1.125", unit: "62" }], []]);

    expect(serialize({ evidence: source, itemReferenceMetadataEvidence: references, subquantityMetadataEvidence: subquantities, itemDatesMetadataEvidence: dates })).toContain(
      "<CantidadReferencia>2</CantidadReferencia><UnidadReferencia>24</UnidadReferencia><TablaSubcantidad><SubcantidadItem><Subcantidad>0.5</Subcantidad><CodigoSubcantidad>18</CodigoSubcantidad></SubcantidadItem><SubcantidadItem><Subcantidad>1.125</Subcantidad><CodigoSubcantidad>62</CodigoSubcantidad></SubcantidadItem></TablaSubcantidad><FechaElaboracion>29-02-2000</FechaElaboracion><FechaVencimientoItem>29-02-2028</FechaVencimientoItem><PrecioUnitarioItem>10</PrecioUnitarioItem>",
    );
    expect(serialize({ evidence: source, subquantityMetadataEvidence: subquantities })).toContain(
      "<Item><NumeroLinea>2</NumeroLinea><IndicadorFacturacion>1</IndicadorFacturacion><NombreItem>Synthetic item 2</NombreItem><IndicadorBienoServicio>1</IndicadorBienoServicio><CantidadItem>1</CantidadItem><PrecioUnitarioItem>10</PrecioUnitarioItem>",
    );
  });

  it("rejects forged, foreign, reordered, count-mismatched, proxied, revoked, and undefined subquantity metadata safely", () => {
    const source = evidence([{}, {}]);
    const genuine = subquantityMetadata(source, [[{ subquantity: "1", unit: "24" }], [{ subquantity: "2", unit: "62" }]]);
    const other = evidence([{}, {}]);
    const revoked = Proxy.revocable(genuine, {}); revoked.revoke();

    expectFailure({ evidence: source, subquantityMetadataEvidence: undefined }, "INVALID_ECF31_DETALLES_ITEMS_XML_INPUT");
    for (const metadata of [{ ...genuine }, { ...genuine, entries: [...genuine.entries].reverse() }, { ...genuine, entries: [] }, { ...genuine, entries: [...genuine.entries, genuine.entries[0]] }, new Proxy(genuine, {}), revoked.proxy]) {
      expectFailure({ evidence: source, subquantityMetadataEvidence: metadata }, "INVALID_ECF31_DETALLES_ITEMS_XML_SUBQUANTITY_METADATA");
    }
    expectFailure({ evidence: source, subquantityMetadataEvidence: subquantityMetadata(other, [[{ subquantity: "1", unit: "24" }], [{ subquantity: "2", unit: "62" }]]) }, "ECF31_DETALLES_ITEMS_XML_SUBQUANTITY_METADATA_LINEAGE_MISMATCH");
  });

  it("serializes authenticated alcohol and reference price after TablaSubcantidad and before dates in official order", () => {
    const source = evidence([{ codes: ["006", "039"] }, {}]);
    const subquantities = subquantityMetadata(source, [[{ subquantity: "0.500", unit: "18" }], []]);
    const dates = itemDatesMetadata(source);
    const alcohol = alcoholReferenceEvidence(source, [{ codes: ["006", "039"], alcohol: "35.5", referencePrice: "899.9" }, { codes: [] }]);

    expect(serialize({ evidence: source, subquantityMetadataEvidence: subquantities, alcoholReferencePriceEvidence: alcohol, itemDatesMetadataEvidence: dates })).toContain(
      "<TablaSubcantidad><SubcantidadItem><Subcantidad>0.5</Subcantidad><CodigoSubcantidad>18</CodigoSubcantidad></SubcantidadItem></TablaSubcantidad><GradosAlcohol>35.5</GradosAlcohol><PrecioUnitarioReferencia>899.9</PrecioUnitarioReferencia><FechaElaboracion>29-02-2000</FechaElaboracion><FechaVencimientoItem>29-02-2028</FechaVencimientoItem><PrecioUnitarioItem>10</PrecioUnitarioItem>",
    );
    expect(serialize({ evidence: source, alcoholReferencePriceEvidence: alcohol })).toContain(
      "<Item><NumeroLinea>2</NumeroLinea><IndicadorFacturacion>1</IndicadorFacturacion><NombreItem>Synthetic item 2</NombreItem><IndicadorBienoServicio>1</IndicadorBienoServicio><CantidadItem>1</CantidadItem><PrecioUnitarioItem>10</PrecioUnitarioItem>",
    );
    expect(serialize({ evidence: source, alcoholReferencePriceEvidence: alcohol })).not.toMatch(/<Item><NumeroLinea>2[\s\S]*?GradosAlcohol/);
  });

  it("serializes alcohol-only and reference-price-only lines independently in exact decimals", () => {
    const source = evidence([{ codes: ["006"] }, { codes: ["039"] }, {}]);
    const alcohol = alcoholReferenceEvidence(source, [
      { codes: ["006"], alcohol: "40" },
      { codes: ["039"], referencePrice: "12.25" },
      { codes: [] },
    ]);

    expect(serialize({ evidence: source, alcoholReferencePriceEvidence: alcohol })).toContain(
      "<CantidadItem>1</CantidadItem><GradosAlcohol>40</GradosAlcohol><PrecioUnitarioItem>10</PrecioUnitarioItem>",
    );
    expect(serialize({ evidence: source, alcoholReferencePriceEvidence: alcohol })).toContain(
      "<Item><NumeroLinea>2</NumeroLinea><IndicadorFacturacion>1</IndicadorFacturacion><NombreItem>Synthetic item 2</NombreItem><IndicadorBienoServicio>1</IndicadorBienoServicio><CantidadItem>1</CantidadItem><PrecioUnitarioReferencia>12.25</PrecioUnitarioReferencia><PrecioUnitarioItem>10</PrecioUnitarioItem>",
    );
    const xml = serialize({ evidence: source, alcoholReferencePriceEvidence: alcohol });
    expect(xml).toContain("<GradosAlcohol>40</GradosAlcohol><PrecioUnitarioItem>10</PrecioUnitarioItem>");
    expect(xml).toContain("<CantidadItem>1</CantidadItem><PrecioUnitarioReferencia>12.25</PrecioUnitarioReferencia><PrecioUnitarioItem>10</PrecioUnitarioItem>");
    expect(xml).toContain("<Item><NumeroLinea>3</NumeroLinea><IndicadorFacturacion>1</IndicadorFacturacion><NombreItem>Synthetic item 3</NombreItem><IndicadorBienoServicio>1</IndicadorBienoServicio><CantidadItem>1</CantidadItem><PrecioUnitarioItem>10</PrecioUnitarioItem><MontoItem>10</MontoItem></Item>");
  });

  it("omits alcohol and reference fields when evidence is absent and composes with units and references", () => {
    const source = evidence([{ codes: ["006"] }, {}]);
    const units = itemUnitMetadata(source, ["62", undefined]);
    const references = itemReferenceMetadata(source, [{ quantity: "2", unit: "24" }, undefined]);
    const alcohol = alcoholReferenceEvidence(source, [{ codes: ["006"], alcohol: "35.5" }, { codes: [] }]);

    expect(serialize({ evidence: source })).not.toContain("GradosAlcohol");
    expect(serialize({ evidence: source, alcoholReferencePriceEvidence: alcohol })).not.toContain("PrecioUnitarioReferencia");
    expect(serialize({ evidence: source, itemUnitMetadataEvidence: units, itemReferenceMetadataEvidence: references, alcoholReferencePriceEvidence: alcohol })).toContain(
      "<CantidadItem>1</CantidadItem><UnidadMedida>62</UnidadMedida><CantidadReferencia>2</CantidadReferencia><UnidadReferencia>24</UnidadReferencia><GradosAlcohol>35.5</GradosAlcohol><PrecioUnitarioItem>10</PrecioUnitarioItem>",
    );
  });

  it("serializes genuine retention metadata in official order with independently optional children", () => {
    const source = evidence([{}, {}, {}, {}, {}]);
    const retention = retentionMetadata(source, [
      { indicator: 1, itbisRetainedAmount: "12.50", isrRetainedAmount: "0" },
      { indicator: 2 },
      { itbisRetainedAmount: "4.25" },
      { isrRetainedAmount: "8" },
      {},
    ]);
    const xml = serialize({ evidence: source, retentionMetadataEvidence: retention });

    expect(xml).toContain("<IndicadorFacturacion>1</IndicadorFacturacion><Retencion><IndicadorAgenteRetencionoPercepcion>1</IndicadorAgenteRetencionoPercepcion><MontoITBISRetenido>12.5</MontoITBISRetenido><MontoISRRetenido>0</MontoISRRetenido></Retencion><NombreItem>Synthetic item 1</NombreItem>");
    expect(xml).toContain("<Item><NumeroLinea>2</NumeroLinea><IndicadorFacturacion>1</IndicadorFacturacion><Retencion><IndicadorAgenteRetencionoPercepcion>2</IndicadorAgenteRetencionoPercepcion></Retencion><NombreItem>Synthetic item 2</NombreItem>");
    expect(xml).toContain("<Item><NumeroLinea>3</NumeroLinea><IndicadorFacturacion>1</IndicadorFacturacion><Retencion><MontoITBISRetenido>4.25</MontoITBISRetenido></Retencion><NombreItem>Synthetic item 3</NombreItem>");
    expect(xml).toContain("<Item><NumeroLinea>4</NumeroLinea><IndicadorFacturacion>1</IndicadorFacturacion><Retencion><MontoISRRetenido>8</MontoISRRetenido></Retencion><NombreItem>Synthetic item 4</NombreItem>");
    expect(xml).toMatch(/<Item><NumeroLinea>5<\/NumeroLinea><IndicadorFacturacion>1<\/IndicadorFacturacion><NombreItem>Synthetic item 5<\/NombreItem>/);
    expect(xml).not.toMatch(/<Retencion\s*\/>|<Retencion><\/Retencion>/);
  });

  it("rejects forged, foreign, reordered, count-mismatched, proxied, revoked, and undefined retention metadata safely", () => {
    const source = evidence([{}, {}]);
    const genuine = retentionMetadata(source, [{ indicator: 1 }, { itbisRetainedAmount: "1" }]);
    const other = evidence([{}, {}]);
    const revoked = Proxy.revocable(genuine, {}); revoked.revoke();

    expectFailure({ evidence: source, retentionMetadataEvidence: undefined }, "INVALID_ECF31_DETALLES_ITEMS_XML_INPUT");
    for (const metadata of [{ ...genuine }, { ...genuine, entries: [...genuine.entries].reverse() }, { ...genuine, entries: [] }, { ...genuine, entries: [...genuine.entries, genuine.entries[0]] }, new Proxy(genuine, {}), revoked.proxy]) {
      expectFailure({ evidence: source, retentionMetadataEvidence: metadata }, "INVALID_ECF31_DETALLES_ITEMS_XML_RETENTION_METADATA");
    }
    expectFailure({ evidence: source, retentionMetadataEvidence: retentionMetadata(other, [{ indicator: 1 }, { itbisRetainedAmount: "1" }]) }, "ECF31_DETALLES_ITEMS_XML_RETENTION_METADATA_LINEAGE_MISMATCH");
  });

  it("serializes genuine other-currency detail after additional tax and omits empty line groups", () => {
    const source = evidence([{ codes: ["006"] }, {}, {}, {}, {}]);
    const otherCurrency = otherCurrencyDetailEvidence(source, [
      { precioOtraMoneda: "12.3456", descuento: "1.50", recargo: "0", montoItemOtraMoneda: "10.85" },
      { precioOtraMoneda: "2" },
      { descuento: "3.25" },
      { recargo: "4.5" },
      {},
    ]);
    const xml = serialize({ evidence: source, otherCurrencyDetailEvidence: otherCurrency });

    expect(xml).toContain("<TablaImpuestoAdicional><ImpuestoAdicional><TipoImpuesto>006</TipoImpuesto></ImpuestoAdicional></TablaImpuestoAdicional><OtraMonedaDetalle><PrecioOtraMoneda>12.3456</PrecioOtraMoneda><DescuentoOtraMoneda>1.5</DescuentoOtraMoneda><RecargoOtraMoneda>0</RecargoOtraMoneda><MontoItemOtraMoneda>10.85</MontoItemOtraMoneda></OtraMonedaDetalle><MontoItem>10</MontoItem>");
    expect(xml).toContain("<Item><NumeroLinea>2</NumeroLinea><IndicadorFacturacion>1</IndicadorFacturacion><NombreItem>Synthetic item 2</NombreItem><IndicadorBienoServicio>1</IndicadorBienoServicio><CantidadItem>1</CantidadItem><PrecioUnitarioItem>10</PrecioUnitarioItem><OtraMonedaDetalle><PrecioOtraMoneda>2</PrecioOtraMoneda></OtraMonedaDetalle><MontoItem>10</MontoItem>");
    expect(xml).toContain("<Item><NumeroLinea>3</NumeroLinea><IndicadorFacturacion>1</IndicadorFacturacion><NombreItem>Synthetic item 3</NombreItem><IndicadorBienoServicio>1</IndicadorBienoServicio><CantidadItem>1</CantidadItem><PrecioUnitarioItem>10</PrecioUnitarioItem><OtraMonedaDetalle><DescuentoOtraMoneda>3.25</DescuentoOtraMoneda></OtraMonedaDetalle><MontoItem>10</MontoItem>");
    expect(xml).toContain("<Item><NumeroLinea>4</NumeroLinea><IndicadorFacturacion>1</IndicadorFacturacion><NombreItem>Synthetic item 4</NombreItem><IndicadorBienoServicio>1</IndicadorBienoServicio><CantidadItem>1</CantidadItem><PrecioUnitarioItem>10</PrecioUnitarioItem><OtraMonedaDetalle><RecargoOtraMoneda>4.5</RecargoOtraMoneda></OtraMonedaDetalle><MontoItem>10</MontoItem>");
    expect(xml).toMatch(/<Item><NumeroLinea>5<\/NumeroLinea>[\s\S]*?<PrecioUnitarioItem>10<\/PrecioUnitarioItem><MontoItem>10<\/MontoItem><\/Item>/);
    expect(xml).not.toMatch(/<OtraMonedaDetalle\s*\/>|<OtraMonedaDetalle><\/OtraMonedaDetalle>/);
  });

  it("rejects forged, foreign, reordered, count-mismatched, proxied, revoked, and undefined other-currency detail safely", () => {
    const source = evidence([{}, {}]);
    const genuine = otherCurrencyDetailEvidence(source, [{ precioOtraMoneda: "1" }, { montoItemOtraMoneda: "2" }]);
    const other = evidence([{}, {}]);
    const revoked = Proxy.revocable(genuine, {}); revoked.revoke();

    expectFailure({ evidence: source, otherCurrencyDetailEvidence: undefined }, "INVALID_ECF31_DETALLES_ITEMS_XML_INPUT");
    for (const metadata of [{ ...genuine }, { ...genuine, entries: [...genuine.entries].reverse() }, { ...genuine, entries: [] }, { ...genuine, entries: [...genuine.entries, genuine.entries[0]] }, new Proxy(genuine, {}), revoked.proxy]) {
      expectFailure({ evidence: source, otherCurrencyDetailEvidence: metadata }, "INVALID_ECF31_DETALLES_ITEMS_XML_OTHER_CURRENCY_DETAIL_EVIDENCE");
    }
    expectFailure({ evidence: source, otherCurrencyDetailEvidence: otherCurrencyDetailEvidence(other, [{ precioOtraMoneda: "1" }, { montoItemOtraMoneda: "2" }]) }, "ECF31_DETALLES_ITEMS_XML_OTHER_CURRENCY_DETAIL_LINEAGE_MISMATCH");
  });

  it("rejects forged, foreign, reordered, count-mismatched, proxied, revoked, and explicitly undefined alcohol reference metadata safely", () => {
    const source = evidence([{ codes: ["006"] }, { codes: ["039"] }]);
    const genuine = alcoholReferenceEvidence(source, [{ codes: ["006"], alcohol: "40" }, { codes: ["039"], referencePrice: "12.25" }]);
    const other = evidence([{ codes: ["006"] }, { codes: ["039"] }]);
    const revoked = Proxy.revocable(genuine, {}); revoked.revoke();

    expectFailure({ evidence: source, alcoholReferencePriceEvidence: undefined }, "INVALID_ECF31_DETALLES_ITEMS_XML_INPUT");
    for (const metadata of [{ ...genuine }, { ...genuine, entries: [...genuine.entries].reverse() }, { ...genuine, entries: [] }, { ...genuine, entries: [...genuine.entries, genuine.entries[0]] }, new Proxy(genuine, {}), revoked.proxy]) {
      expectFailure({ evidence: source, alcoholReferencePriceEvidence: metadata }, "INVALID_ECF31_DETALLES_ITEMS_XML_ALCOHOL_REFERENCE_PRICE_METADATA");
    }
    expectFailure({ evidence: source, alcoholReferencePriceEvidence: alcoholReferenceEvidence(other, [{ codes: ["006"], alcohol: "40" }, { codes: ["039"], referencePrice: "12.25" }]) }, "ECF31_DETALLES_ITEMS_XML_ALCOHOL_REFERENCE_PRICE_METADATA_LINEAGE_MISMATCH");
  });

  it("serializes authenticated fixed and percentage subadjustments in official order without deriving amounts", () => {
    const source = evidence([{ price: "100", discount: "15", surcharge: "3" }, { price: "10", surcharge: "1" }]);
    const adjustments = lineSubadjustments(source, [
      {
        discounts: [{ type: "$", amount: "5" }, { type: "%", amount: "10", percentage: "7.25" }],
        surcharges: [{ type: "%", amount: "1", percentage: "0.5" }, { type: "$", amount: "2" }],
      },
      { surcharges: [{ type: "$", amount: "1" }] },
    ]);

    expect(serialize({ evidence: source, lineSubadjustmentEvidence: adjustments })).toContain(
      "<PrecioUnitarioItem>100</PrecioUnitarioItem><DescuentoMonto>15</DescuentoMonto><TablaSubDescuento><SubDescuento><TipoSubDescuento>$</TipoSubDescuento><MontoSubDescuento>5</MontoSubDescuento></SubDescuento><SubDescuento><TipoSubDescuento>%</TipoSubDescuento><SubDescuentoPorcentaje>7.25</SubDescuentoPorcentaje><MontoSubDescuento>10</MontoSubDescuento></SubDescuento></TablaSubDescuento><RecargoMonto>3</RecargoMonto><TablaSubRecargo><SubRecargo><TipoSubRecargo>%</TipoSubRecargo><SubRecargoPorcentaje>0.5</SubRecargoPorcentaje><MontoSubRecargo>1</MontoSubRecargo></SubRecargo><SubRecargo><TipoSubRecargo>$</TipoSubRecargo><MontoSubRecargo>2</MontoSubRecargo></SubRecargo></TablaSubRecargo><MontoItem>88</MontoItem>",
    );
    expect(serialize({ evidence: source, lineSubadjustmentEvidence: adjustments })).toContain(
      "<Item><NumeroLinea>2</NumeroLinea><IndicadorFacturacion>1</IndicadorFacturacion><NombreItem>Synthetic item 2</NombreItem><IndicadorBienoServicio>1</IndicadorBienoServicio><CantidadItem>1</CantidadItem><PrecioUnitarioItem>10</PrecioUnitarioItem><RecargoMonto>1</RecargoMonto><TablaSubRecargo><SubRecargo><TipoSubRecargo>$</TipoSubRecargo><MontoSubRecargo>1</MontoSubRecargo></SubRecargo></TablaSubRecargo><MontoItem>11</MontoItem>",
    );
  });

  it("serializes one and two authenticated additional-tax codes after subcharges and before MontoItem", () => {
    const source = evidence([{ price: "100", surcharge: "1", codes: ["001", "005"] }, { codes: ["006", "039"] }]);
    const adjustments = lineSubadjustments(source, [{ surcharges: [{ type: "$", amount: "1" }] }, {}]);

    expect(serialize({ evidence: source, lineSubadjustmentEvidence: adjustments })).toContain(
      "<RecargoMonto>1</RecargoMonto><TablaSubRecargo><SubRecargo><TipoSubRecargo>$</TipoSubRecargo><MontoSubRecargo>1</MontoSubRecargo></SubRecargo></TablaSubRecargo><TablaImpuestoAdicional><ImpuestoAdicional><TipoImpuesto>001</TipoImpuesto></ImpuestoAdicional><ImpuestoAdicional><TipoImpuesto>005</TipoImpuesto></ImpuestoAdicional></TablaImpuestoAdicional><MontoItem>101</MontoItem>",
    );
    expect(serialize({ evidence: source, lineSubadjustmentEvidence: adjustments })).toContain(
      "<Item><NumeroLinea>2</NumeroLinea><IndicadorFacturacion>1</IndicadorFacturacion><NombreItem>Synthetic item 2</NombreItem><IndicadorBienoServicio>1</IndicadorBienoServicio><CantidadItem>1</CantidadItem><PrecioUnitarioItem>10</PrecioUnitarioItem><TablaImpuestoAdicional><ImpuestoAdicional><TipoImpuesto>006</TipoImpuesto></ImpuestoAdicional><ImpuestoAdicional><TipoImpuesto>039</TipoImpuesto></ImpuestoAdicional></TablaImpuestoAdicional><MontoItem>10</MontoItem>",
    );
  });

  it("omits additional-tax tables for authenticated zero-code lines", () => {
    const source = evidence([{ codes: ["006"] }, {}]);
    const xml = serialize({ evidence: source });

    expect(xml).toContain("<TipoImpuesto>006</TipoImpuesto>");
    expect(xml).toMatch(/<Item><NumeroLinea>2<\/NumeroLinea>[\s\S]*?<PrecioUnitarioItem>10<\/PrecioUnitarioItem><MontoItem>10<\/MontoItem><\/Item>/);
    expect(xml).not.toMatch(/<Item><NumeroLinea>2<\/NumeroLinea>[\s\S]*?<TablaImpuestoAdicional>/);
  });

  it("rejects cloned, proxied, foreign, reordered, incomplete, extra, and explicitly undefined subadjustment evidence safely", () => {
    const source = evidence([{ discount: "1" }, { surcharge: "1" }]);
    const genuine = lineSubadjustments(source, [
      { discounts: [{ type: "$", amount: "1" }] },
      { surcharges: [{ type: "$", amount: "1" }] },
    ]);
    const other = evidence([{ discount: "1" }, { surcharge: "1" }]);
    const foreign = lineSubadjustments(other, [
      { discounts: [{ type: "$", amount: "1" }] },
      { surcharges: [{ type: "$", amount: "1" }] },
    ]);
    const revoked = Proxy.revocable(genuine, {}); revoked.revoke();

    expectFailure({ evidence: source, lineSubadjustmentEvidence: undefined }, "INVALID_ECF31_DETALLES_ITEMS_XML_INPUT");
    for (const subadjustments of [{ ...genuine }, { ...genuine, entries: [...genuine.entries].reverse() }, { ...genuine, entries: [] }, { ...genuine, entries: [...genuine.entries, genuine.entries[0]] }, new Proxy(genuine, {}), revoked.proxy]) {
      expectFailure({ evidence: source, lineSubadjustmentEvidence: subadjustments }, "INVALID_ECF31_DETALLES_ITEMS_XML_LINE_SUBADJUSTMENT_EVIDENCE");
    }
    expectFailure({ evidence: source, lineSubadjustmentEvidence: foreign }, "ECF31_DETALLES_ITEMS_XML_LINE_SUBADJUSTMENT_LINEAGE_MISMATCH");
  });

  it("rejects cloned, foreign, proxied, and explicitly undefined item-date metadata safely", () => {
    const source = evidence([{}]);
    const dates = itemDatesMetadata(source);
    const other = evidence([{}]);
    const revoked = Proxy.revocable(dates, {}); revoked.revoke();

    expectFailure({ evidence: source, itemDatesMetadataEvidence: undefined }, "INVALID_ECF31_DETALLES_ITEMS_XML_INPUT");
    for (const metadata of [{ ...dates }, new Proxy(dates, {}), revoked.proxy]) {
      expectFailure({ evidence: source, itemDatesMetadataEvidence: metadata }, "INVALID_ECF31_DETALLES_ITEMS_XML_ITEM_DATES_METADATA");
    }
    expectFailure({ evidence: source, itemDatesMetadataEvidence: itemDatesMetadata(other) }, "ECF31_DETALLES_ITEMS_XML_ITEM_DATES_METADATA_LINEAGE_MISMATCH");
  });

  it.each([
    [{ discount: "0.01" }, "ECF31_DETALLES_ITEMS_XML_DISCOUNT_UNSUPPORTED"],
    [{ surcharge: "0.01" }, "ECF31_DETALLES_ITEMS_XML_SURCHARGE_UNSUPPORTED"],
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

  it("rejects unauthenticated, reordered, incomplete, extra, foreign, proxied, and hostile unit metadata safely", () => {
    const source = evidence([{}, {}]);
    const genuine = itemUnitMetadata(source, ["1", "2"]);
    const other = evidence([{}, {}]);
    const revoked = Proxy.revocable(genuine, {}); revoked.revoke();
    const accessor: object = { evidence: source };
    Object.defineProperty(accessor, "itemUnitMetadataEvidence", { enumerable: true, get: () => { throw new Error("trap"); } });

    expectFailure({ evidence: source, itemUnitMetadataEvidence: undefined }, "INVALID_ECF31_DETALLES_ITEMS_XML_INPUT");
    expectFailure({ evidence: source, itemUnitMetadataEvidence: genuine, extra: true }, "INVALID_ECF31_DETALLES_ITEMS_XML_INPUT");
    expectFailure(accessor, "INVALID_ECF31_DETALLES_ITEMS_XML_INPUT");
    for (const metadata of [{ ...genuine }, { ...genuine, entries: [...genuine.entries].reverse() }, { ...genuine, entries: [] }, { ...genuine, entries: [...genuine.entries, genuine.entries[0]] }, new Proxy(genuine, {}), revoked.proxy]) {
      expectFailure({ evidence: source, itemUnitMetadataEvidence: metadata }, "INVALID_ECF31_DETALLES_ITEMS_XML_ITEM_UNIT_METADATA");
    }
    expectFailure({ evidence: source, itemUnitMetadataEvidence: itemUnitMetadata(other, ["1", "2"]) }, "ECF31_DETALLES_ITEMS_XML_ITEM_UNIT_METADATA_LINEAGE_MISMATCH");
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

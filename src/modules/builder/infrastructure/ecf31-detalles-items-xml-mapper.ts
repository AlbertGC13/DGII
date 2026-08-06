import { types } from "node:util";

import type { Result } from "../../../shared/domain/result.js";
import { isEcf31CoreDraft } from "../domain/ecf31-core-draft.js";
import { isEcf31CoreLine } from "../domain/ecf31-core-line.js";
import { isEcf31DetallesItemsEvidence } from "../domain/ecf31-detalles-items-evidence.js";
import type { Ecf31DetallesItemsEvidence } from "../domain/ecf31-detalles-items-evidence.js";
import { formatDecimal, revalidatePositiveQuantity } from "../domain/exact-decimal.js";
import { isEcf31LineAmountEvidence } from "../domain/ecf31-line-amount-evidence.js";
import { isEcf31MontoItemQuantizationEvidence } from "../domain/ecf31-monto-item-quantization-evidence.js";
import { formatLineSequence } from "../domain/line-calculation-evidence.js";
import { createXmlParentElement, createXmlTextElement } from "./xml-writer.js";
import type { XmlElement } from "./xml-writer.js";

export type Ecf31DetallesItemsXmlMapperErrorCode =
  | "INVALID_ECF31_DETALLES_ITEMS_XML_INPUT"
  | "INVALID_ECF31_DETALLES_ITEMS_XML_EVIDENCE"
  | "ECF31_DETALLES_ITEMS_XML_LINEAGE_MISMATCH"
  | "ECF31_DETALLES_ITEMS_XML_DISCOUNT_UNSUPPORTED"
  | "ECF31_DETALLES_ITEMS_XML_SURCHARGE_UNSUPPORTED"
  | "ECF31_DETALLES_ITEMS_XML_ITEM_CODES_UNSUPPORTED"
  | "ECF31_DETALLES_ITEMS_XML_ADDITIONAL_TAX_CODES_UNSUPPORTED"
  | "ECF31_DETALLES_ITEMS_XML_MAPPING_FAILED";
export type Ecf31DetallesItemsXmlMapperError = Readonly<{
  code: Ecf31DetallesItemsXmlMapperErrorCode;
  message: string;
}>;

type Input = Readonly<{ evidence: unknown }>;

const MESSAGES: Readonly<Record<Ecf31DetallesItemsXmlMapperErrorCode, string>> = Object.freeze({
  INVALID_ECF31_DETALLES_ITEMS_XML_INPUT: "e-CF 31 DetallesItems XML mapper input is invalid.",
  INVALID_ECF31_DETALLES_ITEMS_XML_EVIDENCE: "e-CF 31 DetallesItems XML mapper requires genuine DetallesItems evidence.",
  ECF31_DETALLES_ITEMS_XML_LINEAGE_MISMATCH: "e-CF 31 DetallesItems XML mapper evidence lineage does not match its draft.",
  ECF31_DETALLES_ITEMS_XML_DISCOUNT_UNSUPPORTED: "e-CF 31 DetallesItems XML mapper does not support line discounts.",
  ECF31_DETALLES_ITEMS_XML_SURCHARGE_UNSUPPORTED: "e-CF 31 DetallesItems XML mapper does not support line surcharges.",
  ECF31_DETALLES_ITEMS_XML_ITEM_CODES_UNSUPPORTED: "e-CF 31 DetallesItems XML mapper does not support item codes.",
  ECF31_DETALLES_ITEMS_XML_ADDITIONAL_TAX_CODES_UNSUPPORTED: "e-CF 31 DetallesItems XML mapper does not support additional-tax codes.",
  ECF31_DETALLES_ITEMS_XML_MAPPING_FAILED: "e-CF 31 DetallesItems XML mapping failed.",
});

function failure(code: Ecf31DetallesItemsXmlMapperErrorCode): Result<never, Ecf31DetallesItemsXmlMapperError> {
  return { ok: false, error: Object.freeze({ code, message: MESSAGES[code] }) };
}

function readInput(input: unknown): Input | undefined {
  try {
    if (typeof input !== "object" || input === null || Array.isArray(input) || types.isProxy(input)
      || Object.getPrototypeOf(input) !== Object.prototype) return undefined;
    const keys = Reflect.ownKeys(input);
    if (keys.length !== 1 || keys[0] !== "evidence") return undefined;
    const evidence = Object.getOwnPropertyDescriptor(input, "evidence");
    if (evidence === undefined || !("value" in evidence) || !evidence.enumerable || evidence.value === undefined) return undefined;
    return Object.freeze({ evidence: evidence.value as unknown });
  } catch {
    return undefined;
  }
}

function hasValidLineage(evidence: Ecf31DetallesItemsEvidence): boolean {
  /* v8 ignore next -- genuine evidence is authenticated and frozen; this protects future evidence implementations. */
  if (!isEcf31CoreDraft(evidence.draft) || evidence.entries.length < 1 || evidence.entries.length > 1000
    || evidence.entries.length !== evidence.draft.lineAmounts.length) return false;
  return evidence.entries.every((entry, index) => {
    const lineAmount = evidence.draft.lineAmounts[index];
    /* v8 ignore next -- a genuine S4d1 evidence entry cannot be structurally forged. */
    return lineAmount !== undefined && entry.lineAmount === lineAmount
      && isEcf31LineAmountEvidence(entry.lineAmount)
      && isEcf31MontoItemQuantizationEvidence(entry.montoItem)
      && entry.montoItem.sourceEvidence === entry.lineAmount
      && isEcf31CoreLine(entry.lineAmount.coreLine)
      && revalidatePositiveQuantity(entry.lineAmount.coreLine.evidence.quantity).ok;
  });
}

function textElement(name: string, value: string): XmlElement {
  const result = createXmlTextElement(name, value);
  if (!result.ok) throw new Error("XML mapping failed.");
  return result.value;
}

function itemElement(evidence: Ecf31DetallesItemsEvidence, index: number): XmlElement {
  const entry = evidence.entries[index] as Ecf31DetallesItemsEvidence["entries"][number];
  const line = entry.lineAmount.coreLine;
  const calculation = line.evidence;
  const item = createXmlParentElement("Item", [
    textElement("NumeroLinea", formatLineSequence(calculation.sequence).value),
    textElement("IndicadorFacturacion", String(line.billingIndicator)),
    textElement("NombreItem", line.itemName),
    textElement("IndicadorBienoServicio", String(line.goodOrServiceIndicator)),
    textElement("CantidadItem", formatDecimal(calculation.quantity)),
    textElement("PrecioUnitarioItem", formatDecimal(calculation.unitPrice)),
    textElement("MontoItem", formatDecimal(entry.montoItem.quantizedAmount)),
  ]);
  /* v8 ignore next -- fixed item name and authenticated field values make the writer result successful. */
  if (!item.ok) throw new Error("XML mapping failed.");
  return item.value;
}

function unsupportedFeature(evidence: Ecf31DetallesItemsEvidence): Ecf31DetallesItemsXmlMapperErrorCode | undefined {
  for (const entry of evidence.entries) {
    if (formatDecimal(entry.lineAmount.discountAmount) !== "0") return "ECF31_DETALLES_ITEMS_XML_DISCOUNT_UNSUPPORTED";
    if (formatDecimal(entry.lineAmount.surchargeAmount) !== "0") return "ECF31_DETALLES_ITEMS_XML_SURCHARGE_UNSUPPORTED";
    if (entry.additionalTaxCodes.some((code) => code <= "005")) return "ECF31_DETALLES_ITEMS_XML_ITEM_CODES_UNSUPPORTED";
    if (entry.additionalTaxCodes.length > 0) return "ECF31_DETALLES_ITEMS_XML_ADDITIONAL_TAX_CODES_UNSUPPORTED";
  }
  return undefined;
}

export function mapEcf31DetallesItemsXmlElement(input: unknown): Result<XmlElement, Ecf31DetallesItemsXmlMapperError> {
  const candidate = readInput(input);
  if (candidate === undefined) return failure("INVALID_ECF31_DETALLES_ITEMS_XML_INPUT");
  if (!isEcf31DetallesItemsEvidence(candidate.evidence)) return failure("INVALID_ECF31_DETALLES_ITEMS_XML_EVIDENCE");
  const evidence = candidate.evidence;
  /* v8 ignore next -- authenticated evidence is frozen; the defensive lineage guard protects future implementations. */
  if (!hasValidLineage(evidence)) return failure("ECF31_DETALLES_ITEMS_XML_LINEAGE_MISMATCH");
  const unsupported = unsupportedFeature(evidence);
  if (unsupported !== undefined) return failure(unsupported);
  try {
    const items = evidence.entries.map((_, index) => itemElement(evidence, index));
    const result = createXmlParentElement("DetallesItems", items);
    /* v8 ignore next -- one through 1000 writer-authenticated Item elements form a nonempty valid parent. */
    if (!result.ok) return failure("ECF31_DETALLES_ITEMS_XML_MAPPING_FAILED");
    return { ok: true, value: result.value };
  } catch {
    return failure("ECF31_DETALLES_ITEMS_XML_MAPPING_FAILED");
  }
}

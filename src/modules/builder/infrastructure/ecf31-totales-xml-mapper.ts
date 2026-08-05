import { types } from "node:util";

import type { Result } from "../../../shared/domain/result.js";
import { isEcf31DerivedHeaderTotalsEvidence } from "../domain/ecf31-derived-header-totals-evidence.js";
import { formatDecimal } from "../domain/exact-decimal.js";
import type { Ecf31HeaderTotalsEvidence } from "../domain/ecf31-header-totals-evidence.js";
import { createXmlParentElement, createXmlTextElement } from "./xml-writer.js";
import type { XmlElement } from "./xml-writer.js";

export type Ecf31TotalesXmlMapperErrorCode =
  | "INVALID_ECF31_TOTALES_XML_INPUT"
  | "INVALID_ECF31_TOTALES_XML_EVIDENCE"
  | "ECF31_TOTALES_XML_MAPPING_FAILED";
export type Ecf31TotalesXmlMapperError = Readonly<{ code: Ecf31TotalesXmlMapperErrorCode; message: string }>;

type Input = Readonly<{ evidence: unknown }>;

const MESSAGES: Readonly<Record<Ecf31TotalesXmlMapperErrorCode, string>> = Object.freeze({
  INVALID_ECF31_TOTALES_XML_INPUT: "e-CF 31 Totales XML mapper input is invalid.",
  INVALID_ECF31_TOTALES_XML_EVIDENCE: "e-CF 31 Totales XML mapper requires genuine derived header totals evidence.",
  ECF31_TOTALES_XML_MAPPING_FAILED: "e-CF 31 Totales XML mapping failed.",
});

function failure(code: Ecf31TotalesXmlMapperErrorCode): Result<never, Ecf31TotalesXmlMapperError> {
  return { ok: false, error: Object.freeze({ code, message: MESSAGES[code] }) };
}

function readInput(input: unknown): Input | undefined {
  try {
    if (typeof input !== "object" || input === null || Array.isArray(input) || types.isProxy(input) || Object.getPrototypeOf(input) !== Object.prototype) return undefined;
    const keys = Reflect.ownKeys(input);
    if (keys.length !== 1 || keys[0] !== "evidence") return undefined;
    const evidence = Object.getOwnPropertyDescriptor(input, "evidence");
    if (evidence === undefined || !("value" in evidence) || !evidence.enumerable || evidence.value === undefined) return undefined;
    return Object.freeze({ evidence: evidence.value as unknown });
  } catch {
    return undefined;
  }
}

function textElement(name: string, value: string): XmlElement {
  const result = createXmlTextElement(name, value);
  /* v8 ignore next -- fixed names and genuine decimal formatting are writer-safe. */
  if (!result.ok) throw new Error("XML mapping failed.");
  return result.value;
}

function mapTotales(totals: Ecf31HeaderTotalsEvidence): XmlElement {
  const rate1 = totals.montoGravadoI1;
  const rate2 = totals.montoGravadoI2;
  const rate3 = totals.montoGravadoI3;
  const totalItbis1 = totals.totalItbis1;
  const totalItbis2 = totals.totalItbis2;
  const totalItbis3 = totals.totalItbis3;
  const hasRate1 = rate1 !== undefined && totalItbis1 !== undefined;
  const hasRate2 = rate2 !== undefined && totalItbis2 !== undefined;
  const hasRate3 = rate3 !== undefined && totalItbis3 !== undefined;
  const taxable = hasRate1 || hasRate2 || hasRate3;
  const fields = [
    ...(taxable ? [textElement("MontoGravadoTotal", formatDecimal(totals.montoGravadoTotal))] : []),
    ...(hasRate1 ? [textElement("MontoGravadoI1", formatDecimal(rate1))] : []),
    ...(hasRate2 ? [textElement("MontoGravadoI2", formatDecimal(rate2))] : []),
    ...(hasRate3 ? [textElement("MontoGravadoI3", formatDecimal(rate3))] : []),
    ...("montoExento" in totals ? [textElement("MontoExento", formatDecimal(totals.montoExento))] : []),
    ...(hasRate1 ? [textElement("ITBIS1", "18")] : []),
    ...(hasRate2 ? [textElement("ITBIS2", "16")] : []),
    ...(hasRate3 ? [textElement("ITBIS3", "0")] : []),
    ...(taxable ? [textElement("TotalITBIS", formatDecimal(totals.totalItbis))] : []),
    ...(hasRate1 ? [textElement("TotalITBIS1", formatDecimal(totalItbis1))] : []),
    ...(hasRate2 ? [textElement("TotalITBIS2", formatDecimal(totalItbis2))] : []),
    ...(hasRate3 ? [textElement("TotalITBIS3", formatDecimal(totalItbis3))] : []),
    textElement("MontoTotal", formatDecimal(totals.montoTotal)),
  ];
  const result = createXmlParentElement("Totales", fields);
  /* v8 ignore next -- the required MontoTotal guarantees a non-empty genuine child list. */
  if (!result.ok) throw new Error("XML mapping failed.");
  return result.value;
}

export function mapEcf31TotalesXmlElement(input: unknown): Result<XmlElement, Ecf31TotalesXmlMapperError> {
  const candidate = readInput(input);
  if (candidate === undefined) return failure("INVALID_ECF31_TOTALES_XML_INPUT");
  if (!isEcf31DerivedHeaderTotalsEvidence(candidate.evidence)) return failure("INVALID_ECF31_TOTALES_XML_EVIDENCE");
  try {
    return { ok: true, value: mapTotales(candidate.evidence.headerTotals) };
  } catch {
    /* v8 ignore next -- genuine evidence produces writer-safe decimal text. */
    return failure("ECF31_TOTALES_XML_MAPPING_FAILED");
  }
}

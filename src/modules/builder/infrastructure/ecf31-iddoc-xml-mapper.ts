import type { Result } from "../../../shared/domain/result.js";
import { isEcf31CoreDraft } from "../domain/ecf31-core-draft.js";
import type { Ecf31CoreDraft } from "../domain/ecf31-core-draft.js";
import { isEcf31IdDocIssuanceEvidence } from "../domain/ecf31-iddoc-issuance-evidence.js";
import type { Ecf31IdDocIssuanceEvidence } from "../domain/ecf31-iddoc-issuance-evidence.js";
import { isEcf31ItbisPriceInclusionEvidence } from "../domain/ecf31-itbis-price-inclusion-evidence.js";
import type { Ecf31ItbisPriceInclusionEvidence } from "../domain/ecf31-itbis-price-inclusion-evidence.js";
import { createXmlParentElement, createXmlTextElement } from "./xml-writer.js";
import type { XmlElement } from "./xml-writer.js";

export type Ecf31IdDocXmlMapperErrorCode =
  | "INVALID_ECF31_IDDOC_XML_INPUT"
  | "INVALID_ECF31_IDDOC_XML_ISSUANCE_EVIDENCE"
  | "INVALID_ECF31_IDDOC_XML_DRAFT"
  | "INVALID_ECF31_IDDOC_XML_PRICE_INCLUSION_EVIDENCE"
  | "ECF31_IDDOC_XML_LINEAGE_MISMATCH"
  | "ECF31_IDDOC_XML_PRICE_INCLUSION_REQUIRED"
  | "ECF31_IDDOC_XML_MAPPING_FAILED";

export type Ecf31IdDocXmlMapperError = Readonly<{
  code: Ecf31IdDocXmlMapperErrorCode;
  message: string;
}>;

type Input = Readonly<{
  issuanceEvidence: unknown;
  draft: unknown;
  priceInclusionEvidence: unknown;
  hasPriceInclusionEvidence: boolean;
}>;

const MESSAGES: Readonly<Record<Ecf31IdDocXmlMapperErrorCode, string>> = Object.freeze({
  INVALID_ECF31_IDDOC_XML_INPUT: "e-CF 31 IdDoc XML mapper input is invalid.",
  INVALID_ECF31_IDDOC_XML_ISSUANCE_EVIDENCE: "e-CF 31 IdDoc XML mapper requires genuine issuance evidence.",
  INVALID_ECF31_IDDOC_XML_DRAFT: "e-CF 31 IdDoc XML mapper requires a genuine core draft.",
  INVALID_ECF31_IDDOC_XML_PRICE_INCLUSION_EVIDENCE: "e-CF 31 IdDoc XML mapper requires genuine ITBIS price-inclusion evidence.",
  ECF31_IDDOC_XML_LINEAGE_MISMATCH: "e-CF 31 IdDoc XML mapper evidence must match the same draft header.",
  ECF31_IDDOC_XML_PRICE_INCLUSION_REQUIRED: "e-CF 31 IdDoc XML mapper requires price-inclusion evidence for taxable lines.",
  ECF31_IDDOC_XML_MAPPING_FAILED: "e-CF 31 IdDoc XML mapping failed.",
});

function failure(code: Ecf31IdDocXmlMapperErrorCode): Result<never, Ecf31IdDocXmlMapperError> {
  return { ok: false, error: Object.freeze({ code, message: MESSAGES[code] }) };
}

function readInput(input: unknown): Input | undefined {
  try {
    if (typeof input !== "object" || input === null || Array.isArray(input)
      || (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)) return undefined;
    const keys = Reflect.ownKeys(input);
    if ((keys.length !== 2 && keys.length !== 3) || !keys.includes("issuanceEvidence") || !keys.includes("draft")
      || keys.some((key) => key !== "issuanceEvidence" && key !== "draft" && key !== "priceInclusionEvidence")) return undefined;
    const issuanceEvidence = Object.getOwnPropertyDescriptor(input, "issuanceEvidence");
    const draft = Object.getOwnPropertyDescriptor(input, "draft");
    const priceInclusionEvidence = Object.getOwnPropertyDescriptor(input, "priceInclusionEvidence");
    if (issuanceEvidence === undefined || draft === undefined || !("value" in issuanceEvidence) || !("value" in draft)
      || !issuanceEvidence.enumerable || !draft.enumerable
      || (priceInclusionEvidence !== undefined && (!("value" in priceInclusionEvidence) || !priceInclusionEvidence.enumerable))) return undefined;
    return Object.freeze({
      issuanceEvidence: issuanceEvidence.value as unknown,
      draft: draft.value as unknown,
      priceInclusionEvidence: priceInclusionEvidence?.value as unknown,
      hasPriceInclusionEvidence: priceInclusionEvidence !== undefined,
    });
  } catch {
    return undefined;
  }
}

function hasTaxableLine(draft: Ecf31CoreDraft): boolean {
  return draft.lineAmounts.some(({ coreLine }) => {
    const { billingIndicator } = coreLine;
    return billingIndicator === 1 || billingIndicator === 2 || billingIndicator === 3;
  });
}

function createIdDoc(
  issuanceEvidence: Ecf31IdDocIssuanceEvidence,
  draft: Ecf31CoreDraft,
  priceInclusionEvidence: Ecf31ItbisPriceInclusionEvidence | undefined,
): XmlElement {
  const fields = [
    createXmlTextElement("TipoeCF", draft.header.eNcf.type),
    createXmlTextElement("eNCF", draft.header.eNcf.value),
    createXmlTextElement("FechaVencimientoSecuencia", issuanceEvidence.sequenceExpirationDate),
    ...(priceInclusionEvidence === undefined ? [] : [createXmlTextElement("IndicadorMontoGravado", String(priceInclusionEvidence.indicator))]),
    createXmlTextElement("TipoIngresos", draft.header.incomeType),
    createXmlTextElement("TipoPago", draft.header.paymentType),
    ...(issuanceEvidence.paymentDueDate === undefined ? [] : [createXmlTextElement("FechaLimitePago", issuanceEvidence.paymentDueDate)]),
  ];
  // Genuine domain evidence constrains each field to XML-writer-safe text.
  const children = fields.map((field) => (field as Readonly<{ ok: true; value: XmlElement }>).value);
  const parent = createXmlParentElement("IdDoc", children);
  return (parent as Readonly<{ ok: true; value: XmlElement }>).value;
}

export function mapEcf31IdDocXmlElement(input: unknown): Result<XmlElement, Ecf31IdDocXmlMapperError> {
  const candidate = readInput(input);
  if (candidate === undefined) return failure("INVALID_ECF31_IDDOC_XML_INPUT");
  if (!isEcf31IdDocIssuanceEvidence(candidate.issuanceEvidence)) return failure("INVALID_ECF31_IDDOC_XML_ISSUANCE_EVIDENCE");
  if (!isEcf31CoreDraft(candidate.draft)) return failure("INVALID_ECF31_IDDOC_XML_DRAFT");
  if (candidate.issuanceEvidence.header !== candidate.draft.header) return failure("ECF31_IDDOC_XML_LINEAGE_MISMATCH");
  if (candidate.hasPriceInclusionEvidence && !isEcf31ItbisPriceInclusionEvidence(candidate.priceInclusionEvidence)) {
    return failure("INVALID_ECF31_IDDOC_XML_PRICE_INCLUSION_EVIDENCE");
  }
  const priceInclusionEvidence = candidate.priceInclusionEvidence as Ecf31ItbisPriceInclusionEvidence | undefined;
  if (priceInclusionEvidence !== undefined && priceInclusionEvidence.draft !== candidate.draft) return failure("ECF31_IDDOC_XML_LINEAGE_MISMATCH");
  if (hasTaxableLine(candidate.draft) && priceInclusionEvidence === undefined) return failure("ECF31_IDDOC_XML_PRICE_INCLUSION_REQUIRED");
  try {
    const element = createIdDoc(candidate.issuanceEvidence, candidate.draft, priceInclusionEvidence);
    return { ok: true, value: element };
  } catch {
    /* v8 ignore next -- containment for unexpected runtime failures only. */
    return failure("ECF31_IDDOC_XML_MAPPING_FAILED");
  }
}

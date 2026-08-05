import { types } from "node:util";

import type { Result } from "../../../shared/domain/result.js";
import { isEcf31CoreDraft } from "../domain/ecf31-core-draft.js";
import { isEcf31DerivedHeaderTotalsEvidence } from "../domain/ecf31-derived-header-totals-evidence.js";
import { isEcf31IdDocIssuanceEvidence } from "../domain/ecf31-iddoc-issuance-evidence.js";
import { isEcf31ItbisPriceInclusionEvidence } from "../domain/ecf31-itbis-price-inclusion-evidence.js";
import type { Ecf31ItbisPriceInclusionEvidence } from "../domain/ecf31-itbis-price-inclusion-evidence.js";
import { mapEcf31IdDocXmlElement } from "./ecf31-iddoc-xml-mapper.js";
import { mapEcf31PartyXmlElements } from "./ecf31-party-xml-mapper.js";
import { mapEcf31TotalesXmlElement } from "./ecf31-totales-xml-mapper.js";
import { createXmlParentElement, createXmlTextElement } from "./xml-writer.js";
import type { XmlElement } from "./xml-writer.js";

export type Ecf31EncabezadoXmlMapperErrorCode =
  | "INVALID_ECF31_ENCABEZADO_XML_INPUT"
  | "INVALID_ECF31_ENCABEZADO_XML_ISSUANCE_EVIDENCE"
  | "INVALID_ECF31_ENCABEZADO_XML_DRAFT"
  | "INVALID_ECF31_ENCABEZADO_XML_DERIVED_HEADER_TOTALS_EVIDENCE"
  | "INVALID_ECF31_ENCABEZADO_XML_PRICE_INCLUSION_EVIDENCE"
  | "ECF31_ENCABEZADO_XML_LINEAGE_MISMATCH"
  | "ECF31_ENCABEZADO_XML_MAPPING_FAILED";
export type Ecf31EncabezadoXmlMapperError = Readonly<{ code: Ecf31EncabezadoXmlMapperErrorCode; message: string }>;

type Input = Readonly<{
  issuanceEvidence: unknown;
  draft: unknown;
  derivedHeaderTotalsEvidence: unknown;
  hasPriceInclusionEvidence: boolean;
  priceInclusionEvidence?: unknown;
}>;

const MESSAGES: Readonly<Record<Ecf31EncabezadoXmlMapperErrorCode, string>> = Object.freeze({
  INVALID_ECF31_ENCABEZADO_XML_INPUT: "e-CF 31 Encabezado XML mapper input is invalid.",
  INVALID_ECF31_ENCABEZADO_XML_ISSUANCE_EVIDENCE: "e-CF 31 Encabezado XML mapper requires genuine issuance evidence.",
  INVALID_ECF31_ENCABEZADO_XML_DRAFT: "e-CF 31 Encabezado XML mapper requires a genuine core draft.",
  INVALID_ECF31_ENCABEZADO_XML_DERIVED_HEADER_TOTALS_EVIDENCE: "e-CF 31 Encabezado XML mapper requires genuine derived header totals evidence.",
  INVALID_ECF31_ENCABEZADO_XML_PRICE_INCLUSION_EVIDENCE: "e-CF 31 Encabezado XML mapper requires genuine ITBIS price-inclusion evidence.",
  ECF31_ENCABEZADO_XML_LINEAGE_MISMATCH: "e-CF 31 Encabezado XML mapper evidence must match one draft and header.",
  ECF31_ENCABEZADO_XML_MAPPING_FAILED: "e-CF 31 Encabezado XML mapping failed.",
});

function failure(code: Ecf31EncabezadoXmlMapperErrorCode): Result<never, Ecf31EncabezadoXmlMapperError> {
  return { ok: false, error: Object.freeze({ code, message: MESSAGES[code] }) };
}

function readInput(input: unknown): Input | undefined {
  try {
    if (typeof input !== "object" || input === null || Array.isArray(input) || types.isProxy(input) || Object.getPrototypeOf(input) !== Object.prototype) return undefined;
    const keys = Reflect.ownKeys(input);
    const hasPriceInclusionEvidence = keys.includes("priceInclusionEvidence");
    if (keys.length !== (hasPriceInclusionEvidence ? 4 : 3)
      || !keys.includes("issuanceEvidence") || !keys.includes("draft") || !keys.includes("derivedHeaderTotalsEvidence")
      || keys.some((key) => key !== "issuanceEvidence" && key !== "draft" && key !== "derivedHeaderTotalsEvidence" && key !== "priceInclusionEvidence")) return undefined;
    const read = (key: keyof Input): unknown => {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      return descriptor !== undefined && "value" in descriptor && descriptor.enumerable === true ? descriptor.value : undefined;
    };
    const issuanceEvidence = read("issuanceEvidence");
    const draft = read("draft");
    const derivedHeaderTotalsEvidence = read("derivedHeaderTotalsEvidence");
    if (issuanceEvidence === undefined || draft === undefined || derivedHeaderTotalsEvidence === undefined) return undefined;
    return Object.freeze({ issuanceEvidence, draft, derivedHeaderTotalsEvidence, hasPriceInclusionEvidence, ...(hasPriceInclusionEvidence ? { priceInclusionEvidence: read("priceInclusionEvidence") } : {}) });
  } catch {
    return undefined;
  }
}

export function mapEcf31EncabezadoXmlElement(input: unknown): Result<XmlElement, Ecf31EncabezadoXmlMapperError> {
  const candidate = readInput(input);
  if (candidate === undefined) return failure("INVALID_ECF31_ENCABEZADO_XML_INPUT");
  if (!isEcf31IdDocIssuanceEvidence(candidate.issuanceEvidence)) return failure("INVALID_ECF31_ENCABEZADO_XML_ISSUANCE_EVIDENCE");
  if (!isEcf31CoreDraft(candidate.draft)) return failure("INVALID_ECF31_ENCABEZADO_XML_DRAFT");
  if (!isEcf31DerivedHeaderTotalsEvidence(candidate.derivedHeaderTotalsEvidence)) return failure("INVALID_ECF31_ENCABEZADO_XML_DERIVED_HEADER_TOTALS_EVIDENCE");
  let priceInclusionEvidence: Ecf31ItbisPriceInclusionEvidence | undefined;
  if (candidate.hasPriceInclusionEvidence) {
    if (!isEcf31ItbisPriceInclusionEvidence(candidate.priceInclusionEvidence)) return failure("INVALID_ECF31_ENCABEZADO_XML_PRICE_INCLUSION_EVIDENCE");
    priceInclusionEvidence = candidate.priceInclusionEvidence;
  }
  if (candidate.issuanceEvidence.header !== candidate.draft.header || candidate.derivedHeaderTotalsEvidence.exemptAmountEvidence.draft !== candidate.draft
    || (priceInclusionEvidence !== undefined && priceInclusionEvidence.draft !== candidate.draft)
    || priceInclusionEvidence !== candidate.derivedHeaderTotalsEvidence.taxableBaseEvidence?.priceInclusionEvidence) return failure("ECF31_ENCABEZADO_XML_LINEAGE_MISMATCH");

  const idDoc = mapEcf31IdDocXmlElement({ issuanceEvidence: candidate.issuanceEvidence, draft: candidate.draft, ...(priceInclusionEvidence === undefined ? {} : { priceInclusionEvidence }) });
  const parties = mapEcf31PartyXmlElements({ header: candidate.draft.header });
  const totals = mapEcf31TotalesXmlElement({ evidence: candidate.derivedHeaderTotalsEvidence });
  const version = createXmlTextElement("Version", "1.0");
  if (!idDoc.ok || !parties.ok || !totals.ok || !version.ok) return failure("ECF31_ENCABEZADO_XML_MAPPING_FAILED");
  const encabezado = createXmlParentElement("Encabezado", [version.value, idDoc.value, parties.value.emisor, parties.value.comprador, totals.value]);
  /* v8 ignore next -- fixed genuine children make this XML-writer call safe. */
  if (!encabezado.ok) return failure("ECF31_ENCABEZADO_XML_MAPPING_FAILED");
  return { ok: true, value: encabezado.value };
}

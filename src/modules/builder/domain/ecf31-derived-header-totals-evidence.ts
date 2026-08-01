import { types } from "node:util";

import type { Result } from "../../../shared/domain/result.js";
import { isEcf31AdditionalTaxClassificationEvidence } from "./ecf31-additional-tax-classification-evidence.js";
import type { Ecf31AdditionalTaxClassificationEvidence } from "./ecf31-additional-tax-classification-evidence.js";
import { createEcf31HeaderTotalsEvidence } from "./ecf31-header-totals-evidence.js";
import type { Ecf31HeaderTotalsEvidence } from "./ecf31-header-totals-evidence.js";
import { isEcf31PostGlobalAdjustmentExemptAmountEvidence } from "./ecf31-post-global-adjustment-exempt-amount-evidence.js";
import type { Ecf31PostGlobalAdjustmentExemptAmountEvidence } from "./ecf31-post-global-adjustment-exempt-amount-evidence.js";
import { isEcf31PostGlobalAdjustmentTaxableBaseEvidence } from "./ecf31-post-global-adjustment-taxable-base-evidence.js";
import type { Ecf31PostGlobalAdjustmentTaxableBaseEvidence } from "./ecf31-post-global-adjustment-taxable-base-evidence.js";
import { isEcf31TotalItbisEvidence } from "./ecf31-total-itbis-evidence.js";
import type { Ecf31TotalItbisEvidence } from "./ecf31-total-itbis-evidence.js";

export const ECF31_DERIVED_HEADER_TOTALS_POLICY_ID = "ecf31-derived-header-totals-v1";

export type Ecf31DerivedHeaderTotalsEvidence = Readonly<{
  exemptAmountEvidence: Ecf31PostGlobalAdjustmentExemptAmountEvidence;
  additionalTaxClassificationEvidence: Ecf31AdditionalTaxClassificationEvidence;
  taxableBaseEvidence?: Ecf31PostGlobalAdjustmentTaxableBaseEvidence;
  totalItbisEvidence?: Ecf31TotalItbisEvidence;
  headerTotals: Ecf31HeaderTotalsEvidence;
  policyId: typeof ECF31_DERIVED_HEADER_TOTALS_POLICY_ID;
}>;
export type Ecf31DerivedHeaderTotalsEvidenceErrorCode =
  | "INVALID_ECF31_DERIVED_HEADER_TOTALS_INPUT"
  | "INVALID_ECF31_DERIVED_HEADER_TOTALS_EVIDENCE"
  | "ECF31_DERIVED_HEADER_TOTALS_DRAFT_OR_LINEAGE_MISMATCH"
  | "ECF31_DERIVED_HEADER_TOTALS_TAXABLE_PAIR_REQUIRED"
  | "ECF31_DERIVED_HEADER_TOTALS_TAXABLE_PAIR_FORBIDDEN"
  | "INVALID_ECF31_DERIVED_HEADER_TOTALS_TAXABLE_EVIDENCE"
  | "INVALID_ECF31_DERIVED_HEADER_TOTALS_TOTAL_ITBIS_EVIDENCE"
  | "ECF31_DERIVED_HEADER_TOTALS_QUANTIZATION_OR_TOTAL_ITBIS_LINEAGE_MISMATCH"
  | "ECF31_DERIVED_HEADER_TOTALS_ADDITIONAL_TAX_UNSUPPORTED"
  | "ECF31_DERIVED_HEADER_TOTALS_COMPOSITION_FAILED";
export type Ecf31DerivedHeaderTotalsEvidenceError = Readonly<{ code: Ecf31DerivedHeaderTotalsEvidenceErrorCode; message: string }>;

const MESSAGES: Readonly<Record<Ecf31DerivedHeaderTotalsEvidenceErrorCode, string>> = Object.freeze({
  INVALID_ECF31_DERIVED_HEADER_TOTALS_INPUT: "Derived header totals input is invalid.",
  INVALID_ECF31_DERIVED_HEADER_TOTALS_EVIDENCE: "Derived header totals require genuine source evidence.",
  ECF31_DERIVED_HEADER_TOTALS_DRAFT_OR_LINEAGE_MISMATCH: "Derived header totals evidence must share one complete draft lineage.",
  ECF31_DERIVED_HEADER_TOTALS_TAXABLE_PAIR_REQUIRED: "Taxable drafts require both taxable-base and TotalITBIS evidence.",
  ECF31_DERIVED_HEADER_TOTALS_TAXABLE_PAIR_FORBIDDEN: "Non-taxable drafts must not include taxable evidence.",
  INVALID_ECF31_DERIVED_HEADER_TOTALS_TAXABLE_EVIDENCE: "Derived header totals require genuine taxable-base evidence.",
  INVALID_ECF31_DERIVED_HEADER_TOTALS_TOTAL_ITBIS_EVIDENCE: "Derived header totals require genuine TotalITBIS evidence.",
  ECF31_DERIVED_HEADER_TOTALS_QUANTIZATION_OR_TOTAL_ITBIS_LINEAGE_MISMATCH: "Derived header totals taxable and TotalITBIS evidence must retain exact lineage.",
  ECF31_DERIVED_HEADER_TOTALS_ADDITIONAL_TAX_UNSUPPORTED: "Derived header totals do not support additional taxes.",
  ECF31_DERIVED_HEADER_TOTALS_COMPOSITION_FAILED: "Derived header totals cannot be composed within the amount profile.",
});
const evidenceValues = new WeakSet<Ecf31DerivedHeaderTotalsEvidence>();

function failure(code: Ecf31DerivedHeaderTotalsEvidenceErrorCode): Result<never, Ecf31DerivedHeaderTotalsEvidenceError> { return { ok: false, error: { code, message: MESSAGES[code] } }; }

type Candidate = Readonly<{ exemptAmountEvidence: unknown; additionalTaxClassificationEvidence: unknown; taxableBaseEvidence?: unknown; totalItbisEvidence?: unknown }>;
function readInput(input: unknown): Candidate | undefined {
  try {
    // ECMAScript cannot detect transparent Proxy values; this Node-only package rejects them before reflection.
    if (typeof input !== "object" || input === null || Array.isArray(input) || types.isProxy(input) || Object.getPrototypeOf(input) !== Object.prototype) return undefined;
    const keys = Reflect.ownKeys(input);
    const taxable = keys.includes("taxableBaseEvidence");
    if (keys.length !== (taxable ? 4 : 2) || !keys.includes("exemptAmountEvidence") || !keys.includes("additionalTaxClassificationEvidence") || taxable !== keys.includes("totalItbisEvidence")) return undefined;
    const read = (key: keyof Candidate): unknown => {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      return descriptor !== undefined && "value" in descriptor && descriptor.enumerable === true ? descriptor.value : undefined;
    };
    const exemptAmountEvidence = read("exemptAmountEvidence"); const additionalTaxClassificationEvidence = read("additionalTaxClassificationEvidence");
    if (exemptAmountEvidence === undefined || additionalTaxClassificationEvidence === undefined) return undefined;
    return Object.freeze(taxable ? { exemptAmountEvidence, additionalTaxClassificationEvidence, taxableBaseEvidence: read("taxableBaseEvidence"), totalItbisEvidence: read("totalItbisEvidence") } : { exemptAmountEvidence, additionalTaxClassificationEvidence });
  } catch {
    return undefined;
  }
}

export function createEcf31DerivedHeaderTotalsEvidence(input: unknown): Result<Ecf31DerivedHeaderTotalsEvidence, Ecf31DerivedHeaderTotalsEvidenceError> {
  const candidate = readInput(input);
  if (candidate === undefined) return failure("INVALID_ECF31_DERIVED_HEADER_TOTALS_INPUT");
  if (!isEcf31PostGlobalAdjustmentExemptAmountEvidence(candidate.exemptAmountEvidence) || !isEcf31AdditionalTaxClassificationEvidence(candidate.additionalTaxClassificationEvidence)) return failure("INVALID_ECF31_DERIVED_HEADER_TOTALS_EVIDENCE");
  const exemptAmountEvidence = candidate.exemptAmountEvidence; const additionalTaxClassificationEvidence = candidate.additionalTaxClassificationEvidence;
  if (additionalTaxClassificationEvidence.draft !== exemptAmountEvidence.draft || additionalTaxClassificationEvidence.entries.length !== exemptAmountEvidence.montoItemQuantizations.length || additionalTaxClassificationEvidence.entries.some((entry, index) => entry.source !== exemptAmountEvidence.montoItemQuantizations[index]?.sourceEvidence)) return failure("ECF31_DERIVED_HEADER_TOTALS_DRAFT_OR_LINEAGE_MISMATCH");
  if (additionalTaxClassificationEvidence.entries.some((entry) => entry.codes.length !== 0)) return failure("ECF31_DERIVED_HEADER_TOTALS_ADDITIONAL_TAX_UNSUPPORTED");
  const taxable = exemptAmountEvidence.draft.lineAmounts.some((line) => line.coreLine.billingIndicator >= 1 && line.coreLine.billingIndicator <= 3);
  if (taxable !== (candidate.taxableBaseEvidence !== undefined)) return failure(taxable ? "ECF31_DERIVED_HEADER_TOTALS_TAXABLE_PAIR_REQUIRED" : "ECF31_DERIVED_HEADER_TOTALS_TAXABLE_PAIR_FORBIDDEN");
  let taxableBaseEvidence: Ecf31PostGlobalAdjustmentTaxableBaseEvidence | undefined;
  let totalItbisEvidence: Ecf31TotalItbisEvidence | undefined;
  let totalsInput: Record<string, unknown> = { ...(exemptAmountEvidence.montoExento === undefined ? {} : { montoExento: exemptAmountEvidence.montoExento }) };
  if (taxable) {
    if (!isEcf31PostGlobalAdjustmentTaxableBaseEvidence(candidate.taxableBaseEvidence)) return failure("INVALID_ECF31_DERIVED_HEADER_TOTALS_TAXABLE_EVIDENCE");
    if (!isEcf31TotalItbisEvidence(candidate.totalItbisEvidence)) return failure("INVALID_ECF31_DERIVED_HEADER_TOTALS_TOTAL_ITBIS_EVIDENCE");
    taxableBaseEvidence = candidate.taxableBaseEvidence; totalItbisEvidence = candidate.totalItbisEvidence;
    const baseEvidence = taxableBaseEvidence;
    if (taxableBaseEvidence.priceInclusionEvidence.draft !== exemptAmountEvidence.draft || taxableBaseEvidence.priceInclusionEvidence.montoItemQuantizations.length !== exemptAmountEvidence.montoItemQuantizations.length || taxableBaseEvidence.priceInclusionEvidence.montoItemQuantizations.some((entry, index) => entry !== exemptAmountEvidence.montoItemQuantizations[index]) || totalItbisEvidence.taxableBaseEvidence !== taxableBaseEvidence || totalItbisEvidence.additionalTaxClassificationEvidence !== additionalTaxClassificationEvidence) return failure("ECF31_DERIVED_HEADER_TOTALS_QUANTIZATION_OR_TOTAL_ITBIS_LINEAGE_MISMATCH");
    const bases = Object.fromEntries(baseEvidence.priceInclusionEvidence.buckets.map(({ billingIndicator }) => [billingIndicator, baseEvidence.buckets.find((bucket) => bucket.billingIndicator === billingIndicator)?.taxableBase]));
    totalsInput = { ...totalsInput, ...(bases[1] === undefined ? {} : { montoGravadoI1: bases[1] }), ...(bases[2] === undefined ? {} : { montoGravadoI2: bases[2] }), ...(bases[3] === undefined ? {} : { montoGravadoI3: bases[3] }), ...(totalItbisEvidence.totalItbis1 === undefined ? {} : { totalItbis1: totalItbisEvidence.totalItbis1 }), ...(totalItbisEvidence.totalItbis2 === undefined ? {} : { totalItbis2: totalItbisEvidence.totalItbis2 }), ...(totalItbisEvidence.totalItbis3 === undefined ? {} : { totalItbis3: totalItbisEvidence.totalItbis3 }) };
  }
  const headerTotals = createEcf31HeaderTotalsEvidence(totalsInput);
  if (!headerTotals.ok) return failure("ECF31_DERIVED_HEADER_TOTALS_COMPOSITION_FAILED");
  const evidence = Object.freeze({ exemptAmountEvidence, additionalTaxClassificationEvidence, ...(taxableBaseEvidence === undefined ? {} : { taxableBaseEvidence }), ...(totalItbisEvidence === undefined ? {} : { totalItbisEvidence }), headerTotals: headerTotals.value, policyId: ECF31_DERIVED_HEADER_TOTALS_POLICY_ID }); evidenceValues.add(evidence); return { ok: true, value: evidence };
}

export function isEcf31DerivedHeaderTotalsEvidence(input: unknown): input is Ecf31DerivedHeaderTotalsEvidence { return typeof input === "object" && input !== null && evidenceValues.has(input as Ecf31DerivedHeaderTotalsEvidence); }

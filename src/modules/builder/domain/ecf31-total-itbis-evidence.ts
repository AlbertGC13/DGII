import type { Result } from "../../../shared/domain/result.js";
import { multiplyDecimals, parseNonnegativeAmount, quantizeNonnegativeAmountHalfUp } from "./exact-decimal.js";
import type { NonnegativeAmount } from "./exact-decimal.js";
import { isEcf31AdditionalTaxClassificationEvidence } from "./ecf31-additional-tax-classification-evidence.js";
import type { Ecf31AdditionalTaxClassificationEvidence } from "./ecf31-additional-tax-classification-evidence.js";
import { isEcf31PostGlobalAdjustmentTaxableBaseEvidence } from "./ecf31-post-global-adjustment-taxable-base-evidence.js";
import type { Ecf31PostGlobalAdjustmentTaxableBaseEvidence } from "./ecf31-post-global-adjustment-taxable-base-evidence.js";

export const ECF31_TOTAL_ITBIS_POLICY_ID = "ecf31-total-itbis-v1";

export type Ecf31TotalItbisEvidence = Readonly<{
  taxableBaseEvidence: Ecf31PostGlobalAdjustmentTaxableBaseEvidence;
  additionalTaxClassificationEvidence: Ecf31AdditionalTaxClassificationEvidence;
  totalItbis1?: NonnegativeAmount;
  totalItbis2?: NonnegativeAmount;
  totalItbis3?: NonnegativeAmount;
  policyId: typeof ECF31_TOTAL_ITBIS_POLICY_ID;
}>;
export type Ecf31TotalItbisEvidenceErrorCode =
  | "INVALID_ECF31_TOTAL_ITBIS_INPUT"
  | "INVALID_ECF31_TOTAL_ITBIS_TAXABLE_BASE_EVIDENCE"
  | "INVALID_ECF31_TOTAL_ITBIS_ADDITIONAL_TAX_CLASSIFICATION_EVIDENCE"
  | "ECF31_TOTAL_ITBIS_DRAFT_MISMATCH"
  | "ECF31_TOTAL_ITBIS_QUALIFYING_ISC_UNSUPPORTED"
  | "ECF31_TOTAL_ITBIS_OVERFLOW";
export type Ecf31TotalItbisEvidenceError = Readonly<{ code: Ecf31TotalItbisEvidenceErrorCode; message: string }>;

const MESSAGES: Readonly<Record<Ecf31TotalItbisEvidenceErrorCode, string>> = Object.freeze({
  INVALID_ECF31_TOTAL_ITBIS_INPUT: "TotalITBIS input is invalid.",
  INVALID_ECF31_TOTAL_ITBIS_TAXABLE_BASE_EVIDENCE: "TotalITBIS requires genuine post-global-adjustment taxable-base evidence.",
  INVALID_ECF31_TOTAL_ITBIS_ADDITIONAL_TAX_CLASSIFICATION_EVIDENCE: "TotalITBIS requires genuine additional-tax classification evidence.",
  ECF31_TOTAL_ITBIS_DRAFT_MISMATCH: "TotalITBIS evidence must use the same draft.",
  ECF31_TOTAL_ITBIS_QUALIFYING_ISC_UNSUPPORTED: "TotalITBIS1 is unsupported when qualifying ISC is present.",
  ECF31_TOTAL_ITBIS_OVERFLOW: "TotalITBIS exceeds the supported amount profile.",
});
const RATES = Object.freeze({
  1: (parseNonnegativeAmount("0.18") as Readonly<{ ok: true; value: NonnegativeAmount }>).value,
  2: (parseNonnegativeAmount("0.16") as Readonly<{ ok: true; value: NonnegativeAmount }>).value,
  3: (parseNonnegativeAmount("0") as Readonly<{ ok: true; value: NonnegativeAmount }>).value,
});
const evidenceValues = new WeakSet<Ecf31TotalItbisEvidence>();

function failure(code: Ecf31TotalItbisEvidenceErrorCode): Result<never, Ecf31TotalItbisEvidenceError> {
  return { ok: false, error: { code, message: MESSAGES[code] } };
}

function readInput(input: unknown): Readonly<{ taxableBaseEvidence: unknown; additionalTaxClassificationEvidence: unknown }> | undefined {
  try {
    if (typeof input !== "object" || input === null || Array.isArray(input)
      || (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)) return undefined;
    const keys = Reflect.ownKeys(input);
    if (keys.length !== 2 || !keys.includes("taxableBaseEvidence") || !keys.includes("additionalTaxClassificationEvidence")) return undefined;
    const taxableBaseEvidence = Object.getOwnPropertyDescriptor(input, "taxableBaseEvidence");
    const additionalTaxClassificationEvidence = Object.getOwnPropertyDescriptor(input, "additionalTaxClassificationEvidence");
    if (taxableBaseEvidence === undefined || additionalTaxClassificationEvidence === undefined
      || !("value" in taxableBaseEvidence) || !("value" in additionalTaxClassificationEvidence)
      || taxableBaseEvidence.enumerable !== true || additionalTaxClassificationEvidence.enumerable !== true) return undefined;
    return Object.freeze({ taxableBaseEvidence: taxableBaseEvidence.value as unknown, additionalTaxClassificationEvidence: additionalTaxClassificationEvidence.value as unknown });
  } catch { return undefined; }
}

export function createEcf31TotalItbisEvidence(input: unknown): Result<Ecf31TotalItbisEvidence, Ecf31TotalItbisEvidenceError> {
  const candidate = readInput(input);
  if (candidate === undefined) return failure("INVALID_ECF31_TOTAL_ITBIS_INPUT");
  if (!isEcf31PostGlobalAdjustmentTaxableBaseEvidence(candidate.taxableBaseEvidence)) return failure("INVALID_ECF31_TOTAL_ITBIS_TAXABLE_BASE_EVIDENCE");
  if (!isEcf31AdditionalTaxClassificationEvidence(candidate.additionalTaxClassificationEvidence)) return failure("INVALID_ECF31_TOTAL_ITBIS_ADDITIONAL_TAX_CLASSIFICATION_EVIDENCE");
  const taxableBaseEvidence = candidate.taxableBaseEvidence;
  const additionalTaxClassificationEvidence = candidate.additionalTaxClassificationEvidence;
  if (taxableBaseEvidence.priceInclusionEvidence.draft !== additionalTaxClassificationEvidence.draft) return failure("ECF31_TOTAL_ITBIS_DRAFT_MISMATCH");
  if (!additionalTaxClassificationEvidence.qualifyingIscAbsent) return failure("ECF31_TOTAL_ITBIS_QUALIFYING_ISC_UNSUPPORTED");
  const totals: Partial<Record<1 | 2 | 3, NonnegativeAmount>> = {};
  for (const { billingIndicator } of taxableBaseEvidence.priceInclusionEvidence.buckets) {
    const taxableBase = (taxableBaseEvidence.buckets[billingIndicator - 1] as Readonly<{ taxableBase: NonnegativeAmount }>).taxableBase;
    const total = quantizeNonnegativeAmountHalfUp(multiplyDecimals(taxableBase, RATES[billingIndicator]));
    if (!total.ok) return failure("ECF31_TOTAL_ITBIS_OVERFLOW");
    totals[billingIndicator] = total.value;
  }
  const evidence = Object.freeze({ taxableBaseEvidence, additionalTaxClassificationEvidence,
    ...(totals[1] === undefined ? {} : { totalItbis1: totals[1] }),
    ...(totals[2] === undefined ? {} : { totalItbis2: totals[2] }),
    ...(totals[3] === undefined ? {} : { totalItbis3: totals[3] }), policyId: ECF31_TOTAL_ITBIS_POLICY_ID });
  evidenceValues.add(evidence);
  return { ok: true, value: evidence };
}

export function isEcf31TotalItbisEvidence(input: unknown): input is Ecf31TotalItbisEvidence {
  return typeof input === "object" && input !== null && evidenceValues.has(input as Ecf31TotalItbisEvidence);
}

import type { Result } from "../../../shared/domain/result.js";
import { addDecimals, compareDecimals, parseNonnegativeAmount, revalidateNonnegativeAmount, subtractDecimals } from "./exact-decimal.js";
import type { ExactDecimal, NonnegativeAmount } from "./exact-decimal.js";
import { isEcf31GlobalAdjustmentReconciliationEvidence } from "./ecf31-global-adjustment-reconciliation.js";
import type { Ecf31GlobalAdjustmentReconciliationEvidence } from "./ecf31-global-adjustment-reconciliation.js";
import { isEcf31ItbisPriceInclusionEvidence } from "./ecf31-itbis-price-inclusion-evidence.js";
import type { Ecf31ItbisPriceInclusionEvidence } from "./ecf31-itbis-price-inclusion-evidence.js";

export const ECF31_POST_GLOBAL_ADJUSTMENT_TAXABLE_BASE_POLICY_ID = "ecf31-post-global-adjustment-taxable-base-v1";

type TaxableBillingIndicator = 1 | 2 | 3;
type Adjustment = Readonly<{ reconciliationEvidence: Ecf31GlobalAdjustmentReconciliationEvidence; billingIndicator: TaxableBillingIndicator }>;

export type Ecf31PostGlobalAdjustmentTaxableBaseEvidence = Readonly<{
  priceInclusionEvidence: Ecf31ItbisPriceInclusionEvidence;
  adjustments: readonly Adjustment[];
  buckets: readonly Readonly<{ billingIndicator: TaxableBillingIndicator; taxableBase: NonnegativeAmount }>[];
  policyId: typeof ECF31_POST_GLOBAL_ADJUSTMENT_TAXABLE_BASE_POLICY_ID;
}>;

export type Ecf31PostGlobalAdjustmentTaxableBaseEvidenceErrorCode =
  | "INVALID_ECF31_POST_GLOBAL_ADJUSTMENT_TAXABLE_BASE_INPUT"
  | "INVALID_ECF31_POST_GLOBAL_ADJUSTMENT_TAXABLE_BASE_COLLECTION"
  | "INVALID_ECF31_POST_GLOBAL_ADJUSTMENT_TAXABLE_BASE_PRICE_INCLUSION_EVIDENCE"
  | "INVALID_ECF31_POST_GLOBAL_ADJUSTMENT_TAXABLE_BASE_RECONCILIATION_EVIDENCE"
  | "INVALID_ECF31_POST_GLOBAL_ADJUSTMENT_TAXABLE_BASE_INDICATOR"
  | "ECF31_POST_GLOBAL_ADJUSTMENT_TAXABLE_BASE_NEGATIVE"
  | "ECF31_POST_GLOBAL_ADJUSTMENT_TAXABLE_BASE_OVERFLOW";

export type Ecf31PostGlobalAdjustmentTaxableBaseEvidenceError = Readonly<{ code: Ecf31PostGlobalAdjustmentTaxableBaseEvidenceErrorCode; message: string }>;

const MESSAGES: Readonly<Record<Ecf31PostGlobalAdjustmentTaxableBaseEvidenceErrorCode, string>> = Object.freeze({
  INVALID_ECF31_POST_GLOBAL_ADJUSTMENT_TAXABLE_BASE_INPUT: "Post-global-adjustment taxable base input is invalid.",
  INVALID_ECF31_POST_GLOBAL_ADJUSTMENT_TAXABLE_BASE_COLLECTION: "Post-global-adjustment taxable base requires a dense adjustment collection.",
  INVALID_ECF31_POST_GLOBAL_ADJUSTMENT_TAXABLE_BASE_PRICE_INCLUSION_EVIDENCE: "Post-global-adjustment taxable base requires genuine price-inclusion evidence.",
  INVALID_ECF31_POST_GLOBAL_ADJUSTMENT_TAXABLE_BASE_RECONCILIATION_EVIDENCE: "Post-global-adjustment taxable base requires genuine reconciliation evidence.",
  INVALID_ECF31_POST_GLOBAL_ADJUSTMENT_TAXABLE_BASE_INDICATOR: "Post-global-adjustment taxable base supports billing indicators one, two, and three only.",
  ECF31_POST_GLOBAL_ADJUSTMENT_TAXABLE_BASE_NEGATIVE: "Post-global-adjustment taxable base cannot be negative.",
  ECF31_POST_GLOBAL_ADJUSTMENT_TAXABLE_BASE_OVERFLOW: "Post-global-adjustment taxable base exceeds the supported amount profile.",
});
const zero = (parseNonnegativeAmount("0") as Readonly<{ ok: true; value: NonnegativeAmount }>).value;
const evidenceValues = new WeakSet<Ecf31PostGlobalAdjustmentTaxableBaseEvidence>();

function failure(code: Ecf31PostGlobalAdjustmentTaxableBaseEvidenceErrorCode): Result<never, Ecf31PostGlobalAdjustmentTaxableBaseEvidenceError> {
  return { ok: false, error: { code, message: MESSAGES[code] } };
}

function isArrayIndex(key: string): boolean {
  return /^(0|[1-9][0-9]*)$/.test(key) && Number(key) <= 4_294_967_294;
}

function readInput(input: unknown): Readonly<{ priceInclusionEvidence: unknown; adjustments: readonly unknown[] }> | undefined {
  try {
    if (typeof input !== "object" || input === null || Array.isArray(input)
      || (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)) return undefined;
    const keys = Reflect.ownKeys(input);
    if (keys.length !== 2) return undefined;
    const read = (key: "priceInclusionEvidence" | "adjustments"): unknown => {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      return descriptor !== undefined && "value" in descriptor && descriptor.enumerable === true ? descriptor.value : undefined;
    };
    if (!keys.includes("priceInclusionEvidence") || !keys.includes("adjustments")) return undefined;
    const adjustments = read("adjustments");
    if (!Array.isArray(adjustments)) return undefined;
    const keysOfAdjustments = Reflect.ownKeys(adjustments);
    const indices = keysOfAdjustments.filter((key) => typeof key === "string" && isArrayIndex(key));
    const length = Object.getOwnPropertyDescriptor(adjustments, "length");
    if (keysOfAdjustments.length !== indices.length + 1 || !keysOfAdjustments.includes("length") || length === undefined
      || !("value" in length) || !Number.isSafeInteger(length.value) || length.value !== indices.length) return undefined;
    const copied: unknown[] = [];
    for (let index = 0; index < indices.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(adjustments, String(index));
      if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) return undefined;
      copied.push(descriptor.value);
    }
    return Object.freeze({ priceInclusionEvidence: read("priceInclusionEvidence"), adjustments: Object.freeze(copied) });
  } catch { return undefined; }
}

function readAdjustment(input: unknown): Adjustment | undefined {
  try {
    if (typeof input !== "object" || input === null || Array.isArray(input)
      || (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)) return undefined;
    const keys = Reflect.ownKeys(input);
    if (keys.length !== 2 || !keys.includes("reconciliationEvidence") || !keys.includes("billingIndicator")) return undefined;
    const reconciliation = Object.getOwnPropertyDescriptor(input, "reconciliationEvidence");
    const indicator = Object.getOwnPropertyDescriptor(input, "billingIndicator");
    if (reconciliation === undefined || indicator === undefined || !("value" in reconciliation) || !("value" in indicator)
      || reconciliation.enumerable !== true || indicator.enumerable !== true) return undefined;
    return Object.freeze({ reconciliationEvidence: reconciliation.value as Ecf31GlobalAdjustmentReconciliationEvidence, billingIndicator: indicator.value as TaxableBillingIndicator });
  } catch { return undefined; }
}

export function createEcf31PostGlobalAdjustmentTaxableBaseEvidence(input: unknown): Result<Ecf31PostGlobalAdjustmentTaxableBaseEvidence, Ecf31PostGlobalAdjustmentTaxableBaseEvidenceError> {
  const candidate = readInput(input);
  if (candidate === undefined) return failure("INVALID_ECF31_POST_GLOBAL_ADJUSTMENT_TAXABLE_BASE_INPUT");
  if (!isEcf31ItbisPriceInclusionEvidence(candidate.priceInclusionEvidence)) return failure("INVALID_ECF31_POST_GLOBAL_ADJUSTMENT_TAXABLE_BASE_PRICE_INCLUSION_EVIDENCE");
  const adjustments: Adjustment[] = [];
  for (const adjustmentInput of candidate.adjustments) {
    const adjustment = readAdjustment(adjustmentInput);
    if (adjustment === undefined) return failure("INVALID_ECF31_POST_GLOBAL_ADJUSTMENT_TAXABLE_BASE_INPUT");
    if (!([1, 2, 3] as const).includes(adjustment.billingIndicator)) return failure("INVALID_ECF31_POST_GLOBAL_ADJUSTMENT_TAXABLE_BASE_INDICATOR");
    if (!isEcf31GlobalAdjustmentReconciliationEvidence(adjustment.reconciliationEvidence)) return failure("INVALID_ECF31_POST_GLOBAL_ADJUSTMENT_TAXABLE_BASE_RECONCILIATION_EVIDENCE");
    adjustments.push(adjustment);
  }
  const bases: Record<TaxableBillingIndicator, ExactDecimal> = { 1: zero, 2: zero, 3: zero };
  for (const bucket of candidate.priceInclusionEvidence.buckets) bases[bucket.billingIndicator] = bucket.preGlobalAdjustmentTaxableBase;
  for (const adjustment of adjustments) {
    bases[adjustment.billingIndicator] = adjustment.reconciliationEvidence.kind === "discount"
      ? subtractDecimals(bases[adjustment.billingIndicator], adjustment.reconciliationEvidence.reconciledSum)
      : addDecimals(bases[adjustment.billingIndicator], adjustment.reconciliationEvidence.reconciledSum);
  }
  const buckets: Ecf31PostGlobalAdjustmentTaxableBaseEvidence["buckets"][number][] = [];
  for (const billingIndicator of [1, 2, 3] as const) {
    if (compareDecimals(bases[billingIndicator], zero) < 0) return failure("ECF31_POST_GLOBAL_ADJUSTMENT_TAXABLE_BASE_NEGATIVE");
    const taxableBase = revalidateNonnegativeAmount(bases[billingIndicator]);
    if (!taxableBase.ok) return failure("ECF31_POST_GLOBAL_ADJUSTMENT_TAXABLE_BASE_OVERFLOW");
    buckets.push(Object.freeze({ billingIndicator, taxableBase: taxableBase.value }));
  }
  const evidence = Object.freeze({ priceInclusionEvidence: candidate.priceInclusionEvidence, adjustments: Object.freeze([...adjustments]), buckets: Object.freeze(buckets), policyId: ECF31_POST_GLOBAL_ADJUSTMENT_TAXABLE_BASE_POLICY_ID });
  evidenceValues.add(evidence);
  return { ok: true, value: evidence };
}

export function isEcf31PostGlobalAdjustmentTaxableBaseEvidence(input: unknown): input is Ecf31PostGlobalAdjustmentTaxableBaseEvidence {
  return typeof input === "object" && input !== null && evidenceValues.has(input as Ecf31PostGlobalAdjustmentTaxableBaseEvidence);
}

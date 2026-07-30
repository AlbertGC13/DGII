import type { Result } from "../../../shared/domain/result.js";
import { addDecimals, compareDecimals, parseNonnegativeAmount, revalidateNonnegativeAmount, subtractDecimals } from "./exact-decimal.js";
import type { ExactDecimal, NonnegativeAmount } from "./exact-decimal.js";
import { isEcf31CoreDraft } from "./ecf31-core-draft.js";
import type { Ecf31CoreDraft } from "./ecf31-core-draft.js";
import { isEcf31GlobalAdjustmentReconciliationEvidence } from "./ecf31-global-adjustment-reconciliation.js";
import type { Ecf31GlobalAdjustmentReconciliationEvidence } from "./ecf31-global-adjustment-reconciliation.js";
import { isEcf31MontoItemQuantizationEvidence } from "./ecf31-monto-item-quantization-evidence.js";
import type { Ecf31MontoItemQuantizationEvidence } from "./ecf31-monto-item-quantization-evidence.js";

export const ECF31_POST_GLOBAL_ADJUSTMENT_EXEMPT_AMOUNT_POLICY_ID = "ecf31-post-global-adjustment-exempt-amount-v1";

type Adjustment = Readonly<{ reconciliationEvidence: Ecf31GlobalAdjustmentReconciliationEvidence; billingIndicator: 4 }>;
type AdjustmentInput = Readonly<{ reconciliationEvidence: Ecf31GlobalAdjustmentReconciliationEvidence; billingIndicator: unknown }>;

export type Ecf31PostGlobalAdjustmentExemptAmountEvidence = Readonly<{
  draft: Ecf31CoreDraft;
  montoItemQuantizations: readonly Ecf31MontoItemQuantizationEvidence[];
  adjustments: readonly Adjustment[];
  montoExento?: NonnegativeAmount;
  policyId: typeof ECF31_POST_GLOBAL_ADJUSTMENT_EXEMPT_AMOUNT_POLICY_ID;
}>;

export type Ecf31PostGlobalAdjustmentExemptAmountEvidenceErrorCode =
  | "INVALID_ECF31_POST_GLOBAL_ADJUSTMENT_EXEMPT_AMOUNT_INPUT"
  | "INVALID_ECF31_POST_GLOBAL_ADJUSTMENT_EXEMPT_AMOUNT_DRAFT"
  | "INVALID_ECF31_POST_GLOBAL_ADJUSTMENT_EXEMPT_AMOUNT_COLLECTION"
  | "INVALID_ECF31_POST_GLOBAL_ADJUSTMENT_EXEMPT_AMOUNT_EVIDENCE"
  | "ECF31_POST_GLOBAL_ADJUSTMENT_EXEMPT_AMOUNT_MISMATCH"
  | "INVALID_ECF31_POST_GLOBAL_ADJUSTMENT_EXEMPT_AMOUNT_RECONCILIATION_EVIDENCE"
  | "ECF31_POST_GLOBAL_ADJUSTMENT_EXEMPT_AMOUNT_RECONCILIATION_LINEAGE_MISMATCH"
  | "INVALID_ECF31_POST_GLOBAL_ADJUSTMENT_EXEMPT_AMOUNT_INDICATOR"
  | "ECF31_POST_GLOBAL_ADJUSTMENT_EXEMPT_AMOUNT_NEGATIVE"
  | "ECF31_POST_GLOBAL_ADJUSTMENT_EXEMPT_AMOUNT_OVERFLOW";

export type Ecf31PostGlobalAdjustmentExemptAmountEvidenceError = Readonly<{ code: Ecf31PostGlobalAdjustmentExemptAmountEvidenceErrorCode; message: string }>;

const MESSAGES: Readonly<Record<Ecf31PostGlobalAdjustmentExemptAmountEvidenceErrorCode, string>> = Object.freeze({
  INVALID_ECF31_POST_GLOBAL_ADJUSTMENT_EXEMPT_AMOUNT_INPUT: "Post-global-adjustment exempt amount input is invalid.",
  INVALID_ECF31_POST_GLOBAL_ADJUSTMENT_EXEMPT_AMOUNT_DRAFT: "Post-global-adjustment exempt amount requires a genuine E-CF 31 core draft.",
  INVALID_ECF31_POST_GLOBAL_ADJUSTMENT_EXEMPT_AMOUNT_COLLECTION: "Post-global-adjustment exempt amount requires dense evidence collections.",
  INVALID_ECF31_POST_GLOBAL_ADJUSTMENT_EXEMPT_AMOUNT_EVIDENCE: "Post-global-adjustment exempt amount requires genuine MontoItem quantization evidence.",
  ECF31_POST_GLOBAL_ADJUSTMENT_EXEMPT_AMOUNT_MISMATCH: "MontoItem quantization evidence must match the draft lines in order.",
  INVALID_ECF31_POST_GLOBAL_ADJUSTMENT_EXEMPT_AMOUNT_RECONCILIATION_EVIDENCE: "Post-global-adjustment exempt amount requires genuine reconciliation evidence.",
  ECF31_POST_GLOBAL_ADJUSTMENT_EXEMPT_AMOUNT_RECONCILIATION_LINEAGE_MISMATCH: "Reconciliation evidence must use the MontoItem quantization lineage.",
  INVALID_ECF31_POST_GLOBAL_ADJUSTMENT_EXEMPT_AMOUNT_INDICATOR: "Post-global-adjustment exempt amount supports billing indicator four only.",
  ECF31_POST_GLOBAL_ADJUSTMENT_EXEMPT_AMOUNT_NEGATIVE: "Post-global-adjustment exempt amount cannot be negative.",
  ECF31_POST_GLOBAL_ADJUSTMENT_EXEMPT_AMOUNT_OVERFLOW: "Post-global-adjustment exempt amount exceeds the supported amount profile.",
});
const zero = (parseNonnegativeAmount("0") as Readonly<{ ok: true; value: NonnegativeAmount }>).value;
const evidenceValues = new WeakSet<Ecf31PostGlobalAdjustmentExemptAmountEvidence>();

function failure(code: Ecf31PostGlobalAdjustmentExemptAmountEvidenceErrorCode): Result<never, Ecf31PostGlobalAdjustmentExemptAmountEvidenceError> {
  return { ok: false, error: { code, message: MESSAGES[code] } };
}

function readDenseArray(input: unknown): readonly unknown[] | undefined {
  try {
    if (!Array.isArray(input)) return undefined;
    const keys = Reflect.ownKeys(input);
    const indices = keys.filter((key) => typeof key === "string" && /^(0|[1-9][0-9]*)$/.test(key));
    const length = Object.getOwnPropertyDescriptor(input, "length");
    if (keys.length !== indices.length + 1 || length === undefined || !("value" in length)
      || !Number.isSafeInteger(length.value) || length.value !== indices.length) return undefined;
    const values: unknown[] = [];
    for (let index = 0; index < indices.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
      if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) return undefined;
      values.push(descriptor.value);
    }
    return Object.freeze(values);
  } catch { return undefined; }
}

function readInput(input: unknown): Readonly<{ draft: unknown; montoItemQuantizations: readonly unknown[]; adjustments: readonly unknown[] }> | undefined {
  try {
    if (typeof input !== "object" || input === null || Array.isArray(input)
      || (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)) return undefined;
    const keys = Reflect.ownKeys(input);
    if (keys.length !== 3 || !keys.includes("draft") || !keys.includes("montoItemQuantizations") || !keys.includes("adjustments")) return undefined;
    const read = (key: "draft" | "montoItemQuantizations" | "adjustments") => {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      return descriptor !== undefined && "value" in descriptor && descriptor.enumerable === true ? descriptor.value as unknown : undefined;
    };
    const quantizations = readDenseArray(read("montoItemQuantizations"));
    const adjustments = readDenseArray(read("adjustments"));
    return quantizations === undefined || adjustments === undefined ? undefined : Object.freeze({ draft: read("draft"), montoItemQuantizations: quantizations, adjustments });
  } catch { return undefined; }
}

function readAdjustment(input: unknown): AdjustmentInput | undefined {
  try {
    if (typeof input !== "object" || input === null || Array.isArray(input)
      || (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)) return undefined;
    const keys = Reflect.ownKeys(input);
    if (keys.length !== 2 || !keys.includes("reconciliationEvidence") || !keys.includes("billingIndicator")) return undefined;
    const reconciliation = Object.getOwnPropertyDescriptor(input, "reconciliationEvidence");
    const indicator = Object.getOwnPropertyDescriptor(input, "billingIndicator");
    if (reconciliation === undefined || indicator === undefined || !("value" in reconciliation) || !("value" in indicator)
      || reconciliation.enumerable !== true || indicator.enumerable !== true) return undefined;
    return Object.freeze({ reconciliationEvidence: reconciliation.value as Ecf31GlobalAdjustmentReconciliationEvidence, billingIndicator: indicator.value as unknown });
  } catch { return undefined; }
}

export function createEcf31PostGlobalAdjustmentExemptAmountEvidence(input: unknown): Result<Ecf31PostGlobalAdjustmentExemptAmountEvidence, Ecf31PostGlobalAdjustmentExemptAmountEvidenceError> {
  const candidate = readInput(input);
  if (candidate === undefined) return failure("INVALID_ECF31_POST_GLOBAL_ADJUSTMENT_EXEMPT_AMOUNT_INPUT");
  const draft = candidate.draft;
  if (!isEcf31CoreDraft(draft)) return failure("INVALID_ECF31_POST_GLOBAL_ADJUSTMENT_EXEMPT_AMOUNT_DRAFT");
  const quantizations: Ecf31MontoItemQuantizationEvidence[] = [];
  for (const quantization of candidate.montoItemQuantizations) {
    if (!isEcf31MontoItemQuantizationEvidence(quantization)) return failure("INVALID_ECF31_POST_GLOBAL_ADJUSTMENT_EXEMPT_AMOUNT_EVIDENCE");
    quantizations.push(quantization);
  }
  if (quantizations.length !== draft.lineAmounts.length || quantizations.some((entry, index) => entry.sourceEvidence !== draft.lineAmounts[index])) {
    return failure("ECF31_POST_GLOBAL_ADJUSTMENT_EXEMPT_AMOUNT_MISMATCH");
  }
  let amount: ExactDecimal = zero;
  let hasBasis = false;
  for (const quantization of quantizations) {
    if (quantization.sourceEvidence.coreLine.billingIndicator === 4) {
      amount = addDecimals(amount, quantization.quantizedAmount);
      hasBasis = true;
    }
  }
  const adjustments: Adjustment[] = [];
  for (const adjustmentInput of candidate.adjustments) {
    const adjustment = readAdjustment(adjustmentInput);
    if (adjustment === undefined) return failure("INVALID_ECF31_POST_GLOBAL_ADJUSTMENT_EXEMPT_AMOUNT_INPUT");
    if (adjustment.billingIndicator !== 4) return failure("INVALID_ECF31_POST_GLOBAL_ADJUSTMENT_EXEMPT_AMOUNT_INDICATOR");
    if (!isEcf31GlobalAdjustmentReconciliationEvidence(adjustment.reconciliationEvidence)) return failure("INVALID_ECF31_POST_GLOBAL_ADJUSTMENT_EXEMPT_AMOUNT_RECONCILIATION_EVIDENCE");
    const sources = adjustment.reconciliationEvidence.initialEvidence.entries;
    if (sources.length !== quantizations.length || sources.some((entry, index) => entry.source !== quantizations[index])) {
      return failure("ECF31_POST_GLOBAL_ADJUSTMENT_EXEMPT_AMOUNT_RECONCILIATION_LINEAGE_MISMATCH");
    }
    amount = adjustment.reconciliationEvidence.kind === "discount"
      ? subtractDecimals(amount, adjustment.reconciliationEvidence.reconciledSum)
      : addDecimals(amount, adjustment.reconciliationEvidence.reconciledSum);
    hasBasis = true;
    adjustments.push(Object.freeze({ reconciliationEvidence: adjustment.reconciliationEvidence, billingIndicator: 4 }));
  }
  if (compareDecimals(amount, zero) < 0) return failure("ECF31_POST_GLOBAL_ADJUSTMENT_EXEMPT_AMOUNT_NEGATIVE");
  const montoExento = revalidateNonnegativeAmount(amount);
  if (!montoExento.ok) return failure("ECF31_POST_GLOBAL_ADJUSTMENT_EXEMPT_AMOUNT_OVERFLOW");
  const evidence = Object.freeze({ draft, montoItemQuantizations: Object.freeze([...quantizations]), adjustments: Object.freeze([...adjustments]),
    ...(hasBasis ? { montoExento: montoExento.value } : {}), policyId: ECF31_POST_GLOBAL_ADJUSTMENT_EXEMPT_AMOUNT_POLICY_ID });
  evidenceValues.add(evidence);
  return { ok: true, value: evidence };
}

export function isEcf31PostGlobalAdjustmentExemptAmountEvidence(input: unknown): input is Ecf31PostGlobalAdjustmentExemptAmountEvidence {
  return typeof input === "object" && input !== null && evidenceValues.has(input as Ecf31PostGlobalAdjustmentExemptAmountEvidence);
}

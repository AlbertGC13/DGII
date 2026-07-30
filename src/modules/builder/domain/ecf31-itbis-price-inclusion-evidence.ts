import type { Result } from "../../../shared/domain/result.js";
import { addDecimals, allocateProportionalAmountHalfUp, parseNonnegativeAmount, parsePositiveAmount, revalidateNonnegativeAmount } from "./exact-decimal.js";
import type { ExactDecimal, NonnegativeAmount, PositiveAmount } from "./exact-decimal.js";
import { isEcf31CoreDraft } from "./ecf31-core-draft.js";
import type { Ecf31CoreDraft } from "./ecf31-core-draft.js";
import { isEcf31MontoItemQuantizationEvidence } from "./ecf31-monto-item-quantization-evidence.js";
import type { Ecf31MontoItemQuantizationEvidence } from "./ecf31-monto-item-quantization-evidence.js";

export const ECF31_ITBIS_PRICE_INCLUSION_POLICY_ID = "ecf31-itbis-price-inclusion-v1";

type TaxableBillingIndicator = 1 | 2 | 3;

export type Ecf31ItbisPriceInclusionEvidence = Readonly<{
  draft: Ecf31CoreDraft;
  indicator: 0 | 1;
  montoItemQuantizations: readonly Ecf31MontoItemQuantizationEvidence[];
  buckets: readonly Readonly<{
    billingIndicator: TaxableBillingIndicator;
    montoItemSum: NonnegativeAmount;
    preGlobalAdjustmentTaxableBase: NonnegativeAmount;
  }>[];
  policyId: typeof ECF31_ITBIS_PRICE_INCLUSION_POLICY_ID;
}>;

export type Ecf31ItbisPriceInclusionEvidenceErrorCode =
  | "INVALID_ECF31_ITBIS_PRICE_INCLUSION_INPUT"
  | "INVALID_ECF31_ITBIS_PRICE_INCLUSION_DRAFT"
  | "INVALID_ECF31_ITBIS_PRICE_INCLUSION_COLLECTION"
  | "INVALID_ECF31_ITBIS_PRICE_INCLUSION_EVIDENCE"
  | "ECF31_ITBIS_PRICE_INCLUSION_MISMATCH"
  | "INVALID_ECF31_ITBIS_PRICE_INCLUSION_INDICATOR"
  | "ECF31_ITBIS_PRICE_INCLUSION_NO_TAXED_LINE"
  | "ECF31_ITBIS_PRICE_INCLUSION_OVERFLOW";

export type Ecf31ItbisPriceInclusionEvidenceError = Readonly<{
  code: Ecf31ItbisPriceInclusionEvidenceErrorCode;
  message: string;
}>;

const MESSAGES: Readonly<Record<Ecf31ItbisPriceInclusionEvidenceErrorCode, string>> = Object.freeze({
  INVALID_ECF31_ITBIS_PRICE_INCLUSION_INPUT: "ITBIS price-inclusion input is invalid.",
  INVALID_ECF31_ITBIS_PRICE_INCLUSION_DRAFT: "ITBIS price-inclusion requires a genuine E-CF 31 core draft.",
  INVALID_ECF31_ITBIS_PRICE_INCLUSION_COLLECTION: "ITBIS price-inclusion requires a nonempty dense quantization collection.",
  INVALID_ECF31_ITBIS_PRICE_INCLUSION_EVIDENCE: "ITBIS price-inclusion requires genuine MontoItem quantization evidence.",
  ECF31_ITBIS_PRICE_INCLUSION_MISMATCH: "MontoItem quantization evidence must match the draft lines in order.",
  INVALID_ECF31_ITBIS_PRICE_INCLUSION_INDICATOR: "ITBIS price-inclusion indicator must be zero or one.",
  ECF31_ITBIS_PRICE_INCLUSION_NO_TAXED_LINE: "ITBIS price-inclusion requires at least one taxable line.",
  ECF31_ITBIS_PRICE_INCLUSION_OVERFLOW: "ITBIS price-inclusion exceeds the supported amount profile.",
});
const ZERO = parseNonnegativeAmount("0") as Readonly<{ ok: true; value: NonnegativeAmount }>;
const ONE_HUNDRED = parsePositiveAmount("100") as Readonly<{ ok: true; value: PositiveAmount }>;
const ONE_HUNDRED_EIGHTEEN = parsePositiveAmount("118") as Readonly<{ ok: true; value: PositiveAmount }>;
const ONE_HUNDRED_SIXTEEN = parsePositiveAmount("116") as Readonly<{ ok: true; value: PositiveAmount }>;
const evidenceValues = new WeakSet<Ecf31ItbisPriceInclusionEvidence>();

function failure(code: Ecf31ItbisPriceInclusionEvidenceErrorCode): Result<never, Ecf31ItbisPriceInclusionEvidenceError> {
  return { ok: false, error: { code, message: MESSAGES[code] } };
}

function isCanonicalArrayIndex(key: string): boolean {
  return /^(0|[1-9][0-9]*)$/.test(key) && Number(key) <= 4_294_967_294;
}

function readInput(input: unknown): Readonly<{ draft: unknown; montoItemQuantizations: readonly unknown[]; indicator: unknown }> | undefined {
  try {
    if (typeof input !== "object" || input === null || Array.isArray(input)
      || (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)) return undefined;
    const keys = Reflect.ownKeys(input);
    if (keys.length !== 3) return undefined;
    let draft: unknown;
    let montoItemQuantizations: unknown;
    let indicator: unknown;
    for (const key of keys) {
      if (key !== "draft" && key !== "montoItemQuantizations" && key !== "indicator") return undefined;
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) return undefined;
      if (key === "draft") draft = descriptor.value;
      else if (key === "indicator") indicator = descriptor.value;
      else montoItemQuantizations = descriptor.value;
    }
    if (!Array.isArray(montoItemQuantizations)) return undefined;
    const keysOfQuantizations = Reflect.ownKeys(montoItemQuantizations);
    const numericKeys = keysOfQuantizations.filter((key) => typeof key === "string" && isCanonicalArrayIndex(key));
    if (keysOfQuantizations.length !== numericKeys.length + 1 || !keysOfQuantizations.includes("length")) return undefined;
    const lengthDescriptor = Object.getOwnPropertyDescriptor(montoItemQuantizations, "length");
    if (lengthDescriptor === undefined || !("value" in lengthDescriptor) || lengthDescriptor.enumerable !== false
      || typeof lengthDescriptor.value !== "number" || !Number.isSafeInteger(lengthDescriptor.value)
      || lengthDescriptor.value < 0 || lengthDescriptor.value !== numericKeys.length) return undefined;
    const copied: unknown[] = [];
    for (let index = 0; index < numericKeys.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(montoItemQuantizations, String(index));
      if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) return undefined;
      copied[index] = descriptor.value;
    }
    return Object.freeze({ draft, montoItemQuantizations: Object.freeze(copied), indicator });
  } catch {
    return undefined;
  }
}

function toTaxableBase(sum: ExactDecimal, indicator: 0 | 1, divisor: PositiveAmount): Result<NonnegativeAmount, unknown> {
  const amount = revalidateNonnegativeAmount(sum);
  if (!amount.ok || indicator === 0) return amount;
  return allocateProportionalAmountHalfUp(amount.value, ONE_HUNDRED.value, divisor);
}

export function createEcf31ItbisPriceInclusionEvidence(
  input: unknown,
): Result<Ecf31ItbisPriceInclusionEvidence, Ecf31ItbisPriceInclusionEvidenceError> {
  const candidate = readInput(input);
  if (candidate === undefined) return failure("INVALID_ECF31_ITBIS_PRICE_INCLUSION_INPUT");
  if (!isEcf31CoreDraft(candidate.draft)) return failure("INVALID_ECF31_ITBIS_PRICE_INCLUSION_DRAFT");
  if (candidate.indicator !== 0 && candidate.indicator !== 1) return failure("INVALID_ECF31_ITBIS_PRICE_INCLUSION_INDICATOR");
  if (candidate.montoItemQuantizations.length === 0) return failure("INVALID_ECF31_ITBIS_PRICE_INCLUSION_COLLECTION");
  const quantizations: Ecf31MontoItemQuantizationEvidence[] = [];
  for (const quantization of candidate.montoItemQuantizations) {
    if (!isEcf31MontoItemQuantizationEvidence(quantization)) return failure("INVALID_ECF31_ITBIS_PRICE_INCLUSION_EVIDENCE");
    quantizations.push(quantization);
  }
  if (quantizations.length !== candidate.draft.lineAmounts.length) return failure("ECF31_ITBIS_PRICE_INCLUSION_MISMATCH");
  for (const [index, quantization] of quantizations.entries()) {
    if (quantization.sourceEvidence !== candidate.draft.lineAmounts[index]) return failure("ECF31_ITBIS_PRICE_INCLUSION_MISMATCH");
  }

  const sums: Record<TaxableBillingIndicator, ExactDecimal> = { 1: ZERO.value, 2: ZERO.value, 3: ZERO.value };
  for (const quantization of quantizations) {
    const billingIndicator = quantization.sourceEvidence.coreLine.billingIndicator;
    if (billingIndicator === 1 || billingIndicator === 2 || billingIndicator === 3) {
      sums[billingIndicator] = addDecimals(sums[billingIndicator], quantization.quantizedAmount);
    }
  }
  const buckets: Ecf31ItbisPriceInclusionEvidence["buckets"][number][] = [];
  for (const [billingIndicator, divisor] of [[1, ONE_HUNDRED_EIGHTEEN.value], [2, ONE_HUNDRED_SIXTEEN.value], [3, ONE_HUNDRED.value]] as const) {
    if (sums[billingIndicator] === ZERO.value) continue;
    const montoItemSum = revalidateNonnegativeAmount(sums[billingIndicator]);
    const base = toTaxableBase(sums[billingIndicator], candidate.indicator, divisor);
    if (!montoItemSum.ok || !base.ok) return failure("ECF31_ITBIS_PRICE_INCLUSION_OVERFLOW");
    buckets.push(Object.freeze({ billingIndicator, montoItemSum: montoItemSum.value, preGlobalAdjustmentTaxableBase: base.value }));
  }
  if (buckets.length === 0) return failure("ECF31_ITBIS_PRICE_INCLUSION_NO_TAXED_LINE");
  const evidence = Object.freeze({
    draft: candidate.draft, indicator: candidate.indicator, montoItemQuantizations: Object.freeze([...quantizations]),
    buckets: Object.freeze([...buckets]), policyId: ECF31_ITBIS_PRICE_INCLUSION_POLICY_ID,
  });
  evidenceValues.add(evidence);
  return { ok: true, value: evidence };
}

export function isEcf31ItbisPriceInclusionEvidence(input: unknown): input is Ecf31ItbisPriceInclusionEvidence {
  return typeof input === "object" && input !== null && evidenceValues.has(input as Ecf31ItbisPriceInclusionEvidence);
}

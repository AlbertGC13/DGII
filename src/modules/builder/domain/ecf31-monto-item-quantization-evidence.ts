import type { Result } from "../../../shared/domain/result.js";
import { isEcf31LineAmountEvidence } from "./ecf31-line-amount-evidence.js";
import type { Ecf31LineAmountEvidence } from "./ecf31-line-amount-evidence.js";
import { quantizeNonnegativeAmountHalfUp } from "./exact-decimal.js";
import type { DecimalErrorCode } from "./decimal-error.js";
import type { ExactDecimal, NonnegativeAmount } from "./exact-decimal.js";

export const ECF31_MONTO_ITEM_QUANTIZATION_POLICY_ID = "ecf31-monto-item-half-up-v1";

export type Ecf31MontoItemQuantizationEvidence = Readonly<{
  sourceEvidence: Ecf31LineAmountEvidence;
  adjustedAmount: ExactDecimal;
  quantizedAmount: NonnegativeAmount;
  policyId: typeof ECF31_MONTO_ITEM_QUANTIZATION_POLICY_ID;
}>;

export type Ecf31MontoItemQuantizationEvidenceErrorCode =
  | "INVALID_MONTO_ITEM_QUANTIZATION_SOURCE"
  | DecimalErrorCode;

export type Ecf31MontoItemQuantizationEvidenceError = Readonly<{
  code: Ecf31MontoItemQuantizationEvidenceErrorCode;
  message: string;
}>;

const MESSAGES: Readonly<Record<Ecf31MontoItemQuantizationEvidenceErrorCode, string>> = Object.freeze({
  INVALID_MONTO_ITEM_QUANTIZATION_SOURCE: "MontoItem quantization requires genuine E-CF 31 line amount evidence.",
  INVALID_DECIMAL: "Value must be a genuine exact decimal.",
  INVALID_TYPE: "Decimal input must be a string.",
  INVALID_LEXICAL_FORM: "Decimal input does not use the required canonical-input syntax.",
  SCALE_EXCEEDED: "Decimal input exceeds the target scale.",
  PRECISION_EXCEEDED: "Decimal input exceeds the target precision.",
  OUT_OF_RANGE: "Decimal value is outside the target range.",
});
const evidenceValues = new WeakSet<Ecf31MontoItemQuantizationEvidence>();

function failure(code: Ecf31MontoItemQuantizationEvidenceErrorCode): Result<never, Ecf31MontoItemQuantizationEvidenceError> {
  return { ok: false, error: { code, message: MESSAGES[code] } };
}

// This owner-approved application policy defines the future MontoItem mapping point; it is not a verbatim DGII pipeline mandate.
export function createEcf31MontoItemQuantizationEvidence(input: unknown): Result<Ecf31MontoItemQuantizationEvidence, Ecf31MontoItemQuantizationEvidenceError> {
  if (!isEcf31LineAmountEvidence(input)) return failure("INVALID_MONTO_ITEM_QUANTIZATION_SOURCE");
  const quantizedAmount = quantizeNonnegativeAmountHalfUp(input.adjustedAmount);
  if (!quantizedAmount.ok) return failure(quantizedAmount.error.code);

  const evidence = Object.freeze({
    sourceEvidence: input,
    adjustedAmount: input.adjustedAmount,
    quantizedAmount: quantizedAmount.value,
    policyId: ECF31_MONTO_ITEM_QUANTIZATION_POLICY_ID,
  });
  evidenceValues.add(evidence);
  return { ok: true, value: evidence };
}

export function isEcf31MontoItemQuantizationEvidence(input: unknown): input is Ecf31MontoItemQuantizationEvidence {
  return typeof input === "object" && input !== null && evidenceValues.has(input as Ecf31MontoItemQuantizationEvidence);
}

import type { Result } from "../../../shared/domain/result.js";
import {
  compareDecimals,
  isExactDecimal,
  multiplyDecimals,
  revalidateNonnegativeAmount,
  revalidateNonnegativeQuantity,
  revalidateUnitPrice,
  subtractDecimals,
} from "./exact-decimal.js";
import type {
  ExactDecimal,
  NonnegativeAmount,
  NonnegativeQuantity,
  UnitPrice,
} from "./exact-decimal.js";

declare const lineSequenceBrand: unique symbol;

export type LineSequence = Readonly<{ readonly [lineSequenceBrand]: "LineSequence" }>;

export type LineCalculationEvidence = Readonly<{
  sequence: LineSequence;
  quantity: NonnegativeQuantity;
  unitPrice: UnitPrice;
  computedAmount: ExactDecimal;
  declaredAmount: NonnegativeAmount;
  delta: ExactDecimal;
}>;

export type TolerancePolicy = Readonly<{
  policyId: string;
  limit: ExactDecimal;
}>;

export type ToleranceAssessment = Readonly<{
  outcome: "within_tolerance" | "outside_tolerance";
  policyId: string;
  delta: ExactDecimal;
  absoluteDelta: ExactDecimal;
  limit: ExactDecimal;
}>;

export type LineCalculationEvidenceInput = Readonly<{
  sequence: LineSequence;
  quantity: NonnegativeQuantity;
  unitPrice: UnitPrice;
  declaredAmount: NonnegativeAmount;
}>;

export type LineCalculationEvidenceErrorCode =
  | "INVALID_SEQUENCE_TYPE"
  | "INVALID_SEQUENCE_LEXICAL_FORM"
  | "INVALID_SEQUENCE_RANGE"
  | "COLLECTION_STARTS_AFTER_ONE"
  | "COLLECTION_GAP"
  | "COLLECTION_DUPLICATE"
  | "COLLECTION_OUT_OF_ORDER"
  | "INVALID_LINE_EVIDENCE_INPUT"
  | "INVALID_LINE_EVIDENCE_SEQUENCE"
  | "INVALID_LINE_EVIDENCE_DECIMAL"
  | "INVALID_LINE_EVIDENCE_COLLECTION"
  | "INVALID_TOLERANCE_POLICY"
  | "EMPTY_TOLERANCE_POLICY_ID"
  | "NEGATIVE_TOLERANCE_LIMIT";

export type LineCalculationEvidenceError = Readonly<{
  code: LineCalculationEvidenceErrorCode;
  message: string;
}>;

const ERROR_MESSAGES: Readonly<Record<LineCalculationEvidenceErrorCode, string>> = Object.freeze({
  INVALID_SEQUENCE_TYPE: "Line sequence input must be a string.",
  INVALID_SEQUENCE_LEXICAL_FORM: "Line sequence input must be an unsigned integer string.",
  INVALID_SEQUENCE_RANGE: "Line sequence must be a positive safe integer.",
  COLLECTION_STARTS_AFTER_ONE: "Line collection must start at sequence one.",
  COLLECTION_GAP: "Line collection must use contiguous sequences.",
  COLLECTION_DUPLICATE: "Line collection must not repeat a sequence.",
  COLLECTION_OUT_OF_ORDER: "Line collection must be ordered by sequence.",
  INVALID_LINE_EVIDENCE_INPUT: "Line evidence input is invalid.",
  INVALID_LINE_EVIDENCE_SEQUENCE: "Line evidence sequence is invalid.",
  INVALID_LINE_EVIDENCE_DECIMAL: "Line evidence decimal operand is invalid.",
  INVALID_LINE_EVIDENCE_COLLECTION: "Line evidence collection is invalid.",
  INVALID_TOLERANCE_POLICY: "Tolerance policy is invalid.",
  EMPTY_TOLERANCE_POLICY_ID: "Tolerance policy identifier must not be empty.",
  NEGATIVE_TOLERANCE_LIMIT: "Tolerance limit must be nonnegative.",
});

const sequenceValues = new WeakMap<LineSequence, number>();
const evidenceValues = new WeakSet<LineCalculationEvidence>();
const MAX_SAFE_SEQUENCE = BigInt(Number.MAX_SAFE_INTEGER);

function failure(code: LineCalculationEvidenceErrorCode): Result<never, LineCalculationEvidenceError> {
  return { ok: false, error: { code, message: ERROR_MESSAGES[code] } };
}

function isRecord(input: unknown): input is Readonly<Record<string, unknown>> {
  return typeof input === "object" && input !== null;
}

function isLineSequence(input: unknown): input is LineSequence {
  return isRecord(input) && sequenceValues.has(input as LineSequence);
}

export function isLineCalculationEvidence(input: unknown): input is LineCalculationEvidence {
  return isRecord(input) && evidenceValues.has(input as LineCalculationEvidence);
}

function sequenceValue(sequence: LineSequence): number {
  return sequenceValues.get(sequence) as number;
}

export function parseLineSequence(input: unknown): Result<LineSequence, LineCalculationEvidenceError> {
  if (typeof input !== "string") return failure("INVALID_SEQUENCE_TYPE");
  if (!/^[0-9]+$/.test(input)) return failure("INVALID_SEQUENCE_LEXICAL_FORM");

  const value = BigInt(input);
  if (value === 0n || value > MAX_SAFE_SEQUENCE) return failure("INVALID_SEQUENCE_RANGE");

  const sequence = Object.freeze({}) as LineSequence;
  sequenceValues.set(sequence, Number(value));
  return { ok: true, value: sequence };
}

export function formatLineSequence(
  sequence: LineSequence,
): Result<string, LineCalculationEvidenceError> {
  if (!isLineSequence(sequence)) return failure("INVALID_LINE_EVIDENCE_SEQUENCE");
  return { ok: true, value: sequenceValue(sequence).toString() };
}

export function captureLineCalculationEvidence(
  input: LineCalculationEvidenceInput,
): Result<LineCalculationEvidence, LineCalculationEvidenceError> {
  try {
  if (!isRecord(input)) return failure("INVALID_LINE_EVIDENCE_INPUT");
  if (!isLineSequence(input.sequence)) return failure("INVALID_LINE_EVIDENCE_SEQUENCE");
  if (!isExactDecimal(input.quantity) || !isExactDecimal(input.unitPrice)
    || !isExactDecimal(input.declaredAmount)) return failure("INVALID_LINE_EVIDENCE_DECIMAL");

  const quantity = revalidateNonnegativeQuantity(input.quantity);
  const unitPrice = revalidateUnitPrice(input.unitPrice);
  const declaredAmount = revalidateNonnegativeAmount(input.declaredAmount);
  if (!quantity.ok || !unitPrice.ok || !declaredAmount.ok) return failure("INVALID_LINE_EVIDENCE_DECIMAL");

  const computedAmount = multiplyDecimals(quantity.value, unitPrice.value);
  const evidence = Object.freeze({
    sequence: input.sequence,
    quantity: quantity.value,
    unitPrice: unitPrice.value,
    computedAmount,
    declaredAmount: declaredAmount.value,
    delta: subtractDecimals(declaredAmount.value, computedAmount),
  });
  evidenceValues.add(evidence);
  return { ok: true, value: evidence };
  } catch { return failure("INVALID_LINE_EVIDENCE_INPUT"); }
}

export function validateLineCalculationEvidenceCollection(
  lines: readonly LineCalculationEvidence[],
): Result<readonly LineCalculationEvidence[], LineCalculationEvidenceError> {
  try {
  const input: unknown = lines;
  if (!Array.isArray(input)) return failure("INVALID_LINE_EVIDENCE_COLLECTION");
  if (input.length === 0) return { ok: true, value: Object.freeze([]) };

  const validated: LineCalculationEvidence[] = [];
  const seen = new Set<number>();
  let previous = 0;
  for (const [index, line] of input.entries()) {
    if (!isLineCalculationEvidence(line)) return failure("INVALID_LINE_EVIDENCE_COLLECTION");
    validated.push(line);
    const current = sequenceValue(line.sequence);
    if (index === 0 && current !== 1) return failure("COLLECTION_STARTS_AFTER_ONE");
    if (index > 0 && seen.has(current)) return failure("COLLECTION_DUPLICATE");
    if (index > 0 && current < previous) return failure("COLLECTION_OUT_OF_ORDER");
    seen.add(current);
    previous = current;
  }

  for (const [index, line] of validated.entries()) {
    if (sequenceValue(line.sequence) !== index + 1) return failure("COLLECTION_GAP");
  }

  return { ok: true, value: Object.freeze([...validated]) };
  } catch { return failure("INVALID_LINE_EVIDENCE_COLLECTION"); }
}

export function assessLineTolerance(
  evidence: LineCalculationEvidence,
  policy: TolerancePolicy,
): Result<ToleranceAssessment, LineCalculationEvidenceError> {
  try {
  if (!isLineCalculationEvidence(evidence)) return failure("INVALID_LINE_EVIDENCE_INPUT");
  if (!isRecord(policy) || typeof policy.policyId !== "string" || !isExactDecimal(policy.limit)) {
    return failure("INVALID_TOLERANCE_POLICY");
  }
  if (policy.policyId.trim().length === 0) return failure("EMPTY_TOLERANCE_POLICY_ID");

  const zero = subtractDecimals(evidence.delta, evidence.delta);
  if (compareDecimals(policy.limit, zero) < 0) return failure("NEGATIVE_TOLERANCE_LIMIT");

  const absoluteDelta = compareDecimals(evidence.delta, zero) < 0
    ? subtractDecimals(zero, evidence.delta)
    : evidence.delta;
  return {
    ok: true,
    value: Object.freeze({
      outcome: compareDecimals(absoluteDelta, policy.limit) <= 0 ? "within_tolerance" : "outside_tolerance",
      policyId: policy.policyId,
      delta: evidence.delta,
      absoluteDelta,
      limit: policy.limit,
    }),
  };
  } catch { return failure("INVALID_TOLERANCE_POLICY"); }
}

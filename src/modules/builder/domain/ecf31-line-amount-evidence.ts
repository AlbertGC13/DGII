import type { Result } from "../../../shared/domain/result.js";
import { isEcf31CoreLine } from "./ecf31-core-line.js";
import type { Ecf31CoreLine } from "./ecf31-core-line.js";
import {
  addDecimals,
  isExactDecimal,
  revalidateNonnegativeAmount,
  subtractDecimals,
} from "./exact-decimal.js";
import type { ExactDecimal, NonnegativeAmount } from "./exact-decimal.js";

export type Ecf31LineAmountEvidence = Readonly<{
  coreLine: Ecf31CoreLine;
  computedBase: ExactDecimal;
  declaredAmount: NonnegativeAmount;
  discountAmount: NonnegativeAmount;
  surchargeAmount: NonnegativeAmount;
  adjustedAmount: ExactDecimal;
  delta: ExactDecimal;
}>;

export type Ecf31LineAmountEvidenceErrorCode =
  | "INVALID_LINE_AMOUNT_INPUT"
  | "INVALID_LINE_AMOUNT_CORE_LINE"
  | "INVALID_LINE_AMOUNT_DECIMAL";

export type Ecf31LineAmountEvidenceError = Readonly<{
  code: Ecf31LineAmountEvidenceErrorCode;
  message: string;
}>;

const MESSAGES: Readonly<Record<Ecf31LineAmountEvidenceErrorCode, string>> = Object.freeze({
  INVALID_LINE_AMOUNT_INPUT: "E-CF 31 line amount input is invalid.",
  INVALID_LINE_AMOUNT_CORE_LINE: "E-CF 31 line amount requires a genuine core line.",
  INVALID_LINE_AMOUNT_DECIMAL: "E-CF 31 line amount adjustments must be valid nonnegative amounts.",
});
const evidenceValues = new WeakSet<Ecf31LineAmountEvidence>();

function failure(code: Ecf31LineAmountEvidenceErrorCode): Result<never, Ecf31LineAmountEvidenceError> {
  return { ok: false, error: { code, message: MESSAGES[code] } };
}

function isRecord(input: unknown): input is Readonly<Record<string, unknown>> {
  return typeof input === "object" && input !== null;
}

type Candidates = Readonly<{ coreLine: unknown; discountAmount: unknown; surchargeAmount: unknown }>;

function readCandidates(input: Readonly<Record<string, unknown>>): Candidates | undefined {
  try {
    return {
      coreLine: input["coreLine"],
      discountAmount: input["discountAmount"],
      surchargeAmount: input["surchargeAmount"],
    };
  } catch {
    return undefined;
  }
}

export function createEcf31LineAmountEvidence(
  input: unknown,
): Result<Ecf31LineAmountEvidence, Ecf31LineAmountEvidenceError> {
  if (!isRecord(input)) return failure("INVALID_LINE_AMOUNT_INPUT");

  const candidates = readCandidates(input);
  if (candidates === undefined) return failure("INVALID_LINE_AMOUNT_INPUT");
  if (!isEcf31CoreLine(candidates.coreLine)) return failure("INVALID_LINE_AMOUNT_CORE_LINE");
  if (!isExactDecimal(candidates.discountAmount) || !isExactDecimal(candidates.surchargeAmount)) {
    return failure("INVALID_LINE_AMOUNT_DECIMAL");
  }

  const discountAmount = revalidateNonnegativeAmount(candidates.discountAmount);
  const surchargeAmount = revalidateNonnegativeAmount(candidates.surchargeAmount);
  if (!discountAmount.ok || !surchargeAmount.ok) return failure("INVALID_LINE_AMOUNT_DECIMAL");

  const computedBase = candidates.coreLine.evidence.computedAmount;
  const declaredAmount = candidates.coreLine.evidence.declaredAmount;
  const adjustedAmount = addDecimals(subtractDecimals(computedBase, discountAmount.value), surchargeAmount.value);
  const evidence = Object.freeze({
    coreLine: candidates.coreLine,
    computedBase,
    declaredAmount,
    discountAmount: discountAmount.value,
    surchargeAmount: surchargeAmount.value,
    adjustedAmount,
    delta: subtractDecimals(declaredAmount, adjustedAmount),
  });
  evidenceValues.add(evidence);
  return { ok: true, value: evidence };
}

export function isEcf31LineAmountEvidence(input: unknown): input is Ecf31LineAmountEvidence {
  return isRecord(input) && evidenceValues.has(input as Ecf31LineAmountEvidence);
}

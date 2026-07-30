import type { Result } from "../../../shared/domain/result.js";
import {
  absoluteDecimal,
  addDecimals,
  compareDecimals,
  isExactDecimal,
  multiplyDecimalByCount,
  revalidateNonnegativeAmount,
  subtractDecimals,
  parseNonnegativeAmount,
} from "./exact-decimal.js";
import type { ExactDecimal, NonnegativeAmount } from "./exact-decimal.js";
import {
  validateLineCalculationEvidenceCollection,
} from "./line-calculation-evidence.js";
import type { Ecf31MontoItemQuantizationEvidence } from "./ecf31-monto-item-quantization-evidence.js";
import { isEcf31MontoItemQuantizationEvidence } from "./ecf31-monto-item-quantization-evidence.js";

export const ECF31_MONTO_ITEM_TOLERANCE_POLICY_ID = "ecf31-monto-item-tolerance-v1";

export type Ecf31MontoItemToleranceGateEntry = Readonly<{
  quantization: Ecf31MontoItemQuantizationEvidence;
  declaredAmount: NonnegativeAmount;
}>;

export type Ecf31MontoItemToleranceGateEvidence = Readonly<{
  entries: readonly Readonly<{
    quantization: Ecf31MontoItemQuantizationEvidence;
    declaredAmount: NonnegativeAmount;
    signedDelta: ExactDecimal;
    absoluteDelta: ExactDecimal;
  }>[];
  aggregateSignedDelta: ExactDecimal;
  aggregateAbsoluteDelta: ExactDecimal;
  maxGlobalTolerance: NonnegativeAmount;
  policyId: typeof ECF31_MONTO_ITEM_TOLERANCE_POLICY_ID;
}>;

export type Ecf31MontoItemToleranceGateErrorCode =
  | "INVALID_MONTO_ITEM_TOLERANCE_INPUT"
  | "INVALID_MONTO_ITEM_TOLERANCE_EVIDENCE"
  | "MONTO_ITEM_TOLERANCE_PER_LINE_EXCEEDED"
  | "MONTO_ITEM_TOLERANCE_OVERFLOW";

export type Ecf31MontoItemToleranceGateError = Readonly<{
  code: Ecf31MontoItemToleranceGateErrorCode;
  message: string;
}>;

const MESSAGES: Readonly<Record<Ecf31MontoItemToleranceGateErrorCode, string>> = Object.freeze({
  INVALID_MONTO_ITEM_TOLERANCE_INPUT: "MontoItem tolerance input is invalid.",
  INVALID_MONTO_ITEM_TOLERANCE_EVIDENCE: "MontoItem tolerance requires genuine quantization evidence and declared amounts.",
  MONTO_ITEM_TOLERANCE_PER_LINE_EXCEEDED: "MontoItem tolerance exceeds the permitted per-line difference.",
  MONTO_ITEM_TOLERANCE_OVERFLOW: "MontoItem tolerance arithmetic exceeds the supported amount profile.",
});
const tolerance = parseNonnegativeAmount("1") as Readonly<{ ok: true; value: NonnegativeAmount }>;
const evidenceValues = new WeakSet<Ecf31MontoItemToleranceGateEvidence>();

function failure(code: Ecf31MontoItemToleranceGateErrorCode): Result<never, Ecf31MontoItemToleranceGateError> {
  return { ok: false, error: { code, message: MESSAGES[code] } };
}

function hasOnlyKeys(input: unknown, expected: readonly string[]): input is Readonly<Record<string, unknown>> {
  try {
    if (typeof input !== "object" || input === null || Array.isArray(input)) return false;
    const keys = Object.keys(input);
    return keys.length === expected.length && expected.every((key) => keys.includes(key));
  } catch {
    return false;
  }
}

type Entries = Readonly<{ values: readonly unknown[]; count: number }>;

function readEntries(input: unknown): Entries | undefined {
  try {
    if (!hasOnlyKeys(input, ["entries"])) return undefined;
    const candidate = input["entries"];
    if (!Array.isArray(candidate)) return undefined;
    const count = candidate.length;
    if (!Number.isSafeInteger(count) || count < 1) {
      return undefined;
    }
    const values: unknown[] = [];
    for (let index = 0; index < count; index += 1) values[index] = candidate[index];
    return Object.freeze({ values: Object.freeze(values), count });
  } catch {
    return undefined;
  }
}

export function createEcf31MontoItemToleranceGateEvidence(
  input: unknown,
): Result<Ecf31MontoItemToleranceGateEvidence, Ecf31MontoItemToleranceGateError> {
  try {
    const inputEntries = readEntries(input);
    if (inputEntries === undefined) return failure("INVALID_MONTO_ITEM_TOLERANCE_INPUT");
    const parsedEntries: Ecf31MontoItemToleranceGateEntry[] = [];
    for (const entry of inputEntries.values) {
      if (!hasOnlyKeys(entry, ["quantization", "declaredAmount"])) {
        return failure("INVALID_MONTO_ITEM_TOLERANCE_EVIDENCE");
      }
      if (!isEcf31MontoItemQuantizationEvidence(entry["quantization"])) {
        return failure("INVALID_MONTO_ITEM_TOLERANCE_EVIDENCE");
      }
      if (!isExactDecimal(entry["declaredAmount"])) return failure("INVALID_MONTO_ITEM_TOLERANCE_EVIDENCE");
      const declaredAmount = revalidateNonnegativeAmount(entry["declaredAmount"]);
      if (!declaredAmount.ok) return failure("INVALID_MONTO_ITEM_TOLERANCE_EVIDENCE");
      parsedEntries.push({ quantization: entry["quantization"], declaredAmount: declaredAmount.value });
    }
    if (!validateLineCalculationEvidenceCollection(parsedEntries.map(
      (entry) => entry.quantization.sourceEvidence.coreLine.evidence,
    )).ok) return failure("INVALID_MONTO_ITEM_TOLERANCE_EVIDENCE");

    const perLine: Ecf31MontoItemToleranceGateEvidence["entries"][number][] = [];
    let calculatedSum: ExactDecimal = tolerance.value;
    let declaredSum: ExactDecimal = tolerance.value;
    calculatedSum = subtractDecimals(calculatedSum, calculatedSum);
    declaredSum = subtractDecimals(declaredSum, declaredSum);
    for (const entry of parsedEntries) {
      const signedDelta = subtractDecimals(entry.quantization.quantizedAmount, entry.declaredAmount);
      const absoluteDelta = (revalidateNonnegativeAmount(absoluteDecimal(signedDelta).value) as Readonly<{ ok: true; value: NonnegativeAmount }>).value;
      if (compareDecimals(absoluteDelta, tolerance.value) > 0) {
        return failure("MONTO_ITEM_TOLERANCE_PER_LINE_EXCEEDED");
      }
      calculatedSum = addDecimals(calculatedSum, entry.quantization.quantizedAmount);
      declaredSum = addDecimals(declaredSum, entry.declaredAmount);
      perLine.push(Object.freeze({ ...entry, signedDelta, absoluteDelta }));
    }
    const maxGlobalTolerance = multiplyDecimalByCount(tolerance.value, inputEntries.count).value;
    if (![calculatedSum, declaredSum, maxGlobalTolerance].every(
      (amount) => revalidateNonnegativeAmount(amount).ok,
    )) {
      return failure("MONTO_ITEM_TOLERANCE_OVERFLOW");
    }
    const validatedTolerance = maxGlobalTolerance as NonnegativeAmount;
    const aggregateSignedDelta = subtractDecimals(calculatedSum, declaredSum);
    const aggregateAbsoluteDelta = (revalidateNonnegativeAmount(absoluteDecimal(aggregateSignedDelta).value) as Readonly<{ ok: true; value: NonnegativeAmount }>).value;

    const evidence = Object.freeze({
      entries: Object.freeze([...perLine]),
      aggregateSignedDelta,
      aggregateAbsoluteDelta,
      maxGlobalTolerance: validatedTolerance,
      policyId: ECF31_MONTO_ITEM_TOLERANCE_POLICY_ID,
    });
    evidenceValues.add(evidence);
    return { ok: true, value: evidence };
  } catch {
    return failure("INVALID_MONTO_ITEM_TOLERANCE_INPUT");
  }
}

export function isEcf31MontoItemToleranceGateEvidence(
  input: unknown,
): input is Ecf31MontoItemToleranceGateEvidence {
  return typeof input === "object" && input !== null && evidenceValues.has(input as Ecf31MontoItemToleranceGateEvidence);
}

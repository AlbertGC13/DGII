import type { Result } from "../../../shared/domain/result.js";
import {
  addDecimals,
  allocateProportionalAmountHalfUp,
  isExactDecimal,
  revalidateNonnegativeAmount,
  revalidatePositiveAmount,
  subtractDecimals,
} from "./exact-decimal.js";
import type { ExactDecimal, NonnegativeAmount, PositiveAmount } from "./exact-decimal.js";
import {
  validateLineCalculationEvidenceCollection,
} from "./line-calculation-evidence.js";
import {
  isEcf31MontoItemQuantizationEvidence,
} from "./ecf31-monto-item-quantization-evidence.js";
import type { Ecf31MontoItemQuantizationEvidence } from "./ecf31-monto-item-quantization-evidence.js";

export const ECF31_GLOBAL_ADJUSTMENT_INITIAL_POLICY_ID = "ecf31-proportional-global-adjustment-initial-v1";

export type Ecf31GlobalAdjustmentInitialEvidence = Readonly<{
  globalAmount: PositiveAmount;
  entries: readonly Readonly<{
    source: Ecf31MontoItemQuantizationEvidence;
    basis: NonnegativeAmount;
    initialAllocation: NonnegativeAmount;
  }>[];
  totalBasis: PositiveAmount;
  allocatedSum: NonnegativeAmount;
  signedResidue: ExactDecimal;
  policyId: typeof ECF31_GLOBAL_ADJUSTMENT_INITIAL_POLICY_ID;
}>;

export type Ecf31GlobalAdjustmentInitialEvidenceErrorCode =
  | "INVALID_ECF31_GLOBAL_ADJUSTMENT_INITIAL_INPUT"
  | "INVALID_ECF31_GLOBAL_ADJUSTMENT_INITIAL_EVIDENCE"
  | "ECF31_GLOBAL_ADJUSTMENT_ZERO_BASIS"
  | "ECF31_GLOBAL_ADJUSTMENT_INITIAL_OVERFLOW";

export type Ecf31GlobalAdjustmentInitialEvidenceError = Readonly<{
  code: Ecf31GlobalAdjustmentInitialEvidenceErrorCode;
  message: string;
}>;

const MESSAGES: Readonly<Record<Ecf31GlobalAdjustmentInitialEvidenceErrorCode, string>> = Object.freeze({
  INVALID_ECF31_GLOBAL_ADJUSTMENT_INITIAL_INPUT: "Global adjustment initial allocation input is invalid.",
  INVALID_ECF31_GLOBAL_ADJUSTMENT_INITIAL_EVIDENCE: "Global adjustment initial allocation requires genuine quantization evidence.",
  ECF31_GLOBAL_ADJUSTMENT_ZERO_BASIS: "Global adjustment initial allocation requires a positive total basis.",
  ECF31_GLOBAL_ADJUSTMENT_INITIAL_OVERFLOW: "Global adjustment initial allocation exceeds the supported amount profile.",
});
const evidenceValues = new WeakSet<Ecf31GlobalAdjustmentInitialEvidence>();

function failure(code: Ecf31GlobalAdjustmentInitialEvidenceErrorCode): Result<never, Ecf31GlobalAdjustmentInitialEvidenceError> {
  return { ok: false, error: { code, message: MESSAGES[code] } };
}

function readOuter(input: unknown): Readonly<{ globalAmount: unknown; lines: unknown }> | undefined {
  try {
    if (typeof input !== "object" || input === null || Array.isArray(input)) return undefined;
    if (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null) return undefined;
    const keys = Reflect.ownKeys(input);
    if (keys.length !== 2) return undefined;
    let globalAmount: unknown;
    let lines: unknown;
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      if (key !== "globalAmount" && key !== "lines") return undefined;
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (descriptor === undefined || !("value" in descriptor) || "get" in descriptor || "set" in descriptor
        || descriptor.enumerable !== true) return undefined;
      if (key === "globalAmount") globalAmount = descriptor.value;
      else lines = descriptor.value;
    }
    return Object.freeze({ globalAmount, lines });
  } catch {
    return undefined;
  }
}

function isCanonicalArrayIndex(key: string): boolean {
  return /^(0|[1-9][0-9]*)$/.test(key) && Number(key) <= 4_294_967_294;
}

function readInput(input: unknown): Readonly<{ globalAmount: unknown; lines: readonly unknown[] }> | undefined {
  try {
    const outer = readOuter(input);
    if (outer === undefined || !Array.isArray(outer.lines)) return undefined;
    const sourceLines = outer.lines;
    const ownKeys = Reflect.ownKeys(sourceLines);
    let numericKeyCount = 0;
    let structuralLength = 0;
    for (let position = 0; position < ownKeys.length; position += 1) {
      const key = ownKeys[position];
      if (key === "length") {
        const descriptor = Object.getOwnPropertyDescriptor(sourceLines, key);
        structuralLength = descriptor?.value as number;
      } else if (typeof key !== "string" || !isCanonicalArrayIndex(key)) {
        return undefined;
      } else {
        numericKeyCount += 1;
      }
    }
    if (numericKeyCount < 1 || structuralLength !== numericKeyCount) return undefined;
    const lines: unknown[] = [];
    for (let index = 0; index < numericKeyCount; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(sourceLines, String(index));
      if (descriptor === undefined || !("value" in descriptor) || "get" in descriptor || "set" in descriptor
        || descriptor.enumerable !== true) return undefined;
      lines[index] = descriptor.value;
    }
    return Object.freeze({ globalAmount: outer.globalAmount, lines: Object.freeze(lines) });
  } catch {
    return undefined;
  }
}

function allocateInitial(
  globalAmount: PositiveAmount,
  basis: NonnegativeAmount,
  totalBasis: PositiveAmount,
): Result<NonnegativeAmount, unknown> {
  return allocateProportionalAmountHalfUp(globalAmount, basis, totalBasis);
}

export function createEcf31GlobalAdjustmentInitialEvidence(
  input: unknown,
): Result<Ecf31GlobalAdjustmentInitialEvidence, Ecf31GlobalAdjustmentInitialEvidenceError> {
  const candidate = readInput(input);
  if (candidate === undefined) return failure("INVALID_ECF31_GLOBAL_ADJUSTMENT_INITIAL_INPUT");
  if (!isExactDecimal(candidate.globalAmount)) return failure("INVALID_ECF31_GLOBAL_ADJUSTMENT_INITIAL_INPUT");
  const globalAmount = revalidatePositiveAmount(candidate.globalAmount);
  if (!globalAmount.ok) return failure("INVALID_ECF31_GLOBAL_ADJUSTMENT_INITIAL_INPUT");

  const sources: Ecf31MontoItemQuantizationEvidence[] = [];
  for (const line of candidate.lines) {
    if (!isEcf31MontoItemQuantizationEvidence(line)) {
      return failure("INVALID_ECF31_GLOBAL_ADJUSTMENT_INITIAL_EVIDENCE");
    }
    sources.push(line);
  }
  if (!validateLineCalculationEvidenceCollection(sources.map((source) => source.sourceEvidence.coreLine.evidence)).ok) {
    return failure("INVALID_ECF31_GLOBAL_ADJUSTMENT_INITIAL_EVIDENCE");
  }

  let totalBasis: ExactDecimal = subtractDecimals(globalAmount.value, globalAmount.value);
  for (const source of sources) totalBasis = addDecimals(totalBasis, source.quantizedAmount);
  const validTotalBasis = revalidatePositiveAmount(totalBasis);
  if (!validTotalBasis.ok) {
    return validTotalBasis.error.code === "OUT_OF_RANGE"
      ? failure("ECF31_GLOBAL_ADJUSTMENT_ZERO_BASIS")
      : failure("ECF31_GLOBAL_ADJUSTMENT_INITIAL_OVERFLOW");
  }

  const entries: Ecf31GlobalAdjustmentInitialEvidence["entries"][number][] = [];
  let allocatedSum: ExactDecimal = subtractDecimals(globalAmount.value, globalAmount.value);
  for (const source of sources) {
    const initialAllocation = allocateInitial(globalAmount.value, source.quantizedAmount, validTotalBasis.value);
    if (!initialAllocation.ok) return failure("ECF31_GLOBAL_ADJUSTMENT_INITIAL_OVERFLOW");
    allocatedSum = addDecimals(allocatedSum, initialAllocation.value);
    entries.push(Object.freeze({
      source,
      basis: source.quantizedAmount,
      initialAllocation: initialAllocation.value,
    }));
  }
  const validAllocatedSum = revalidateNonnegativeAmount(allocatedSum);
  if (!validAllocatedSum.ok) return failure("ECF31_GLOBAL_ADJUSTMENT_INITIAL_OVERFLOW");

  const evidence = Object.freeze({
    globalAmount: globalAmount.value,
    entries: Object.freeze([...entries]),
    totalBasis: validTotalBasis.value,
    allocatedSum: validAllocatedSum.value,
    signedResidue: subtractDecimals(globalAmount.value, validAllocatedSum.value),
    policyId: ECF31_GLOBAL_ADJUSTMENT_INITIAL_POLICY_ID,
  });
  evidenceValues.add(evidence);
  return { ok: true, value: evidence };
}

export function isEcf31GlobalAdjustmentInitialEvidence(
  input: unknown,
): input is Ecf31GlobalAdjustmentInitialEvidence {
  return typeof input === "object" && input !== null && evidenceValues.has(input as Ecf31GlobalAdjustmentInitialEvidence);
}

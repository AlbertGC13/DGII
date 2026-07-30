import type { Result } from "../../../shared/domain/result.js";
import {
  addDecimals, compareDecimals, formatDecimal, parseNonnegativeAmount,
  revalidateNonnegativeAmount, subtractDecimals,
} from "./exact-decimal.js";
import type { ExactDecimal, NonnegativeAmount } from "./exact-decimal.js";
import {
  isEcf31GlobalAdjustmentInitialEvidence,
} from "./ecf31-global-adjustment-initial-evidence.js";
import type { Ecf31GlobalAdjustmentInitialEvidence } from "./ecf31-global-adjustment-initial-evidence.js";
import { formatLineSequence } from "./line-calculation-evidence.js";
import type { Ecf31MontoItemQuantizationEvidence } from "./ecf31-monto-item-quantization-evidence.js";

export const ECF31_GLOBAL_ADJUSTMENT_RECONCILIATION_POLICY_ID = "ecf31-global-adjustment-reconciliation-v1";

export type Ecf31GlobalAdjustmentReconciliationEvidence = Readonly<{
  kind: "discount" | "charge";
  initialEvidence: Ecf31GlobalAdjustmentInitialEvidence;
  entries: readonly Readonly<{
    source: Ecf31MontoItemQuantizationEvidence;
    basis: NonnegativeAmount;
    initialAllocation: NonnegativeAmount;
    reconciliationDelta: ExactDecimal;
    finalAllocation: NonnegativeAmount;
    resultingAmount: NonnegativeAmount;
  }>[];
  reconciledSum: NonnegativeAmount;
  originalResidue: ExactDecimal;
  policyId: typeof ECF31_GLOBAL_ADJUSTMENT_RECONCILIATION_POLICY_ID;
}>;

export type Ecf31GlobalAdjustmentReconciliationErrorCode =
  | "INVALID_ECF31_GLOBAL_ADJUSTMENT_RECONCILIATION_INPUT"
  | "INVALID_ECF31_GLOBAL_ADJUSTMENT_INITIAL_EVIDENCE"
  | "ECF31_GLOBAL_ADJUSTMENT_DISCOUNT_EXCEEDS_BASIS"
  | "ECF31_GLOBAL_ADJUSTMENT_RECONCILIATION_IMPOSSIBLE"
  | "ECF31_GLOBAL_ADJUSTMENT_RECONCILIATION_OVERFLOW";

export type Ecf31GlobalAdjustmentReconciliationError = Readonly<{
  code: Ecf31GlobalAdjustmentReconciliationErrorCode;
  message: string;
}>;

type WorkingEntry = {
  source: Ecf31MontoItemQuantizationEvidence;
  basis: NonnegativeAmount;
  initialAllocation: NonnegativeAmount;
  sequence: number;
  finalAllocation: NonnegativeAmount;
  reconciliationDelta: ExactDecimal;
};

const MESSAGES: Readonly<Record<Ecf31GlobalAdjustmentReconciliationErrorCode, string>> = Object.freeze({
  INVALID_ECF31_GLOBAL_ADJUSTMENT_RECONCILIATION_INPUT: "Global adjustment reconciliation input is invalid.",
  INVALID_ECF31_GLOBAL_ADJUSTMENT_INITIAL_EVIDENCE: "Global adjustment reconciliation requires genuine initial evidence.",
  ECF31_GLOBAL_ADJUSTMENT_DISCOUNT_EXCEEDS_BASIS: "Global discount exceeds the available basis.",
  ECF31_GLOBAL_ADJUSTMENT_RECONCILIATION_IMPOSSIBLE: "Global adjustment reconciliation cannot reach the requested amount.",
  ECF31_GLOBAL_ADJUSTMENT_RECONCILIATION_OVERFLOW: "Global adjustment reconciliation exceeds the supported amount profile.",
});
const evidenceValues = new WeakSet<Ecf31GlobalAdjustmentReconciliationEvidence>();
const cent = (parseNonnegativeAmount("0.01") as Readonly<{ ok: true; value: NonnegativeAmount }>).value;
const zeroAmount = (parseNonnegativeAmount("0") as Readonly<{ ok: true; value: NonnegativeAmount }>).value;

function failure(code: Ecf31GlobalAdjustmentReconciliationErrorCode): Result<never, Ecf31GlobalAdjustmentReconciliationError> {
  return { ok: false, error: { code, message: MESSAGES[code] } };
}

function readInput(input: unknown): Readonly<{ kind: unknown; initialEvidence: unknown }> | undefined {
  try {
    if (typeof input !== "object" || input === null || Array.isArray(input)) return undefined;
    if (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null) return undefined;
    const keys = Reflect.ownKeys(input);
    if (keys.length !== 2) return undefined;
    let kind: unknown;
    let initialEvidence: unknown;
    for (const key of keys) {
      if (key !== "kind" && key !== "initialEvidence") return undefined;
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) return undefined;
      if (key === "kind") kind = descriptor.value;
      else initialEvidence = descriptor.value;
    }
    return Object.freeze({ kind, initialEvidence });
  } catch {
    return undefined;
  }
}

function hasCapacity(entry: WorkingEntry, kind: "discount" | "charge", direction: 1 | -1): boolean {
  return direction < 0
    ? compareDecimals(entry.finalAllocation, zeroAmount) > 0
    : kind === "charge" || compareDecimals(entry.finalAllocation, entry.basis) < 0;
}

function residueCentCount(residue: ExactDecimal): bigint {
  const text = formatDecimal(residue);
  const unsigned = text.startsWith("-") ? text.slice(1) : text;
  const [integral = "0", fraction = ""] = unsigned.split(".");
  return BigInt(integral) * 100n + BigInt(fraction.padEnd(2, "0"));
}

export function createEcf31GlobalAdjustmentReconciliationEvidence(
  input: unknown,
): Result<Ecf31GlobalAdjustmentReconciliationEvidence, Ecf31GlobalAdjustmentReconciliationError> {
  const candidate = readInput(input);
  if (candidate === undefined || (candidate.kind !== "discount" && candidate.kind !== "charge")) {
    return failure("INVALID_ECF31_GLOBAL_ADJUSTMENT_RECONCILIATION_INPUT");
  }
  if (!isEcf31GlobalAdjustmentInitialEvidence(candidate.initialEvidence)) {
    return failure("INVALID_ECF31_GLOBAL_ADJUSTMENT_INITIAL_EVIDENCE");
  }
  const initial = candidate.initialEvidence;
  if (candidate.kind === "discount" && compareDecimals(initial.globalAmount, initial.totalBasis) > 0) {
    return failure("ECF31_GLOBAL_ADJUSTMENT_DISCOUNT_EXCEEDS_BASIS");
  }

  const zero = subtractDecimals(initial.globalAmount, initial.globalAmount);
  const entries: WorkingEntry[] = [];
  for (const entry of initial.entries) {
    const sequence = formatLineSequence(entry.source.sourceEvidence.coreLine.evidence.sequence);
    entries.push({ ...entry, sequence: Number(sequence.value), finalAllocation: entry.initialAllocation, reconciliationDelta: zero });
  }
  const priority = [...entries];
  priority.sort((left, right) => {
    const basis = compareDecimals(right.basis, left.basis);
    return basis === 0 ? left.sequence - right.sequence : basis;
  });

  let residue = initial.signedResidue;
  const direction: 1 | -1 = compareDecimals(residue, zero) >= 0 ? 1 : -1;
  let remainingCents = residueCentCount(residue);
  while (remainingCents > 0n) {
    let progressed = false;
    for (const entry of priority) {
      if (!hasCapacity(entry, candidate.kind, direction)) continue;
      const finalAllocation = direction > 0
        ? addDecimals(entry.finalAllocation, cent)
        : subtractDecimals(entry.finalAllocation, cent);
      const validFinalAllocation = revalidateNonnegativeAmount(finalAllocation);
      if (!validFinalAllocation.ok) return failure("ECF31_GLOBAL_ADJUSTMENT_RECONCILIATION_OVERFLOW");
      entry.finalAllocation = validFinalAllocation.value;
      entry.reconciliationDelta = direction > 0
        ? addDecimals(entry.reconciliationDelta, cent)
        : subtractDecimals(entry.reconciliationDelta, cent);
      residue = direction > 0 ? subtractDecimals(residue, cent) : addDecimals(residue, cent);
      remainingCents -= 1n;
      progressed = true;
      if (remainingCents === 0n) break;
    }
    if (!progressed) return failure("ECF31_GLOBAL_ADJUSTMENT_RECONCILIATION_IMPOSSIBLE");
  }

  let reconciledSum: ExactDecimal = zero;
  const output = [] as Ecf31GlobalAdjustmentReconciliationEvidence["entries"][number][];
  for (const entry of entries) {
    if (candidate.kind === "discount" && compareDecimals(entry.finalAllocation, entry.basis) > 0) {
      return failure("ECF31_GLOBAL_ADJUSTMENT_RECONCILIATION_IMPOSSIBLE");
    }
    const resultingAmount = candidate.kind === "discount"
      ? subtractDecimals(entry.basis, entry.finalAllocation)
      : addDecimals(entry.basis, entry.finalAllocation);
    const validResultingAmount = revalidateNonnegativeAmount(resultingAmount);
    if (!validResultingAmount.ok) return failure("ECF31_GLOBAL_ADJUSTMENT_RECONCILIATION_OVERFLOW");
    reconciledSum = addDecimals(reconciledSum, entry.finalAllocation);
    output.push(Object.freeze({
      source: entry.source,
      basis: entry.basis,
      initialAllocation: entry.initialAllocation,
      reconciliationDelta: entry.reconciliationDelta,
      finalAllocation: entry.finalAllocation,
      resultingAmount: validResultingAmount.value,
    }));
  }
  if (compareDecimals(residue, zero) !== 0 || compareDecimals(reconciledSum, initial.globalAmount) !== 0) {
    return failure("ECF31_GLOBAL_ADJUSTMENT_RECONCILIATION_OVERFLOW");
  }
  const reconciledTotal = revalidateNonnegativeAmount(initial.globalAmount) as Result<NonnegativeAmount, unknown>;
  if (!reconciledTotal.ok) return failure("ECF31_GLOBAL_ADJUSTMENT_RECONCILIATION_OVERFLOW");
  const evidence = Object.freeze({
    kind: candidate.kind,
    initialEvidence: initial,
    entries: Object.freeze(output),
    reconciledSum: reconciledTotal.value,
    originalResidue: initial.signedResidue,
    policyId: ECF31_GLOBAL_ADJUSTMENT_RECONCILIATION_POLICY_ID,
  });
  evidenceValues.add(evidence);
  return { ok: true, value: evidence };
}

export function isEcf31GlobalAdjustmentReconciliationEvidence(
  input: unknown,
): input is Ecf31GlobalAdjustmentReconciliationEvidence {
  return typeof input === "object" && input !== null && evidenceValues.has(input as Ecf31GlobalAdjustmentReconciliationEvidence);
}

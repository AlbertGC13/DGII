import type { Result } from "../../../shared/domain/result.js";
import { formatDecimal, parseNonnegativeAmount } from "../domain/exact-decimal.js";
import {
  createEcf31LineAmountEvidence,
  isEcf31LineAmountEvidence,
} from "../domain/ecf31-line-amount-evidence.js";
import type { Ecf31LineAmountEvidence } from "../domain/ecf31-line-amount-evidence.js";
import {
  createEcf31MontoItemQuantizationEvidence,
  ECF31_MONTO_ITEM_QUANTIZATION_POLICY_ID,
  isEcf31MontoItemQuantizationEvidence,
} from "../domain/ecf31-monto-item-quantization-evidence.js";
import type { Ecf31MontoItemQuantizationEvidence } from "../domain/ecf31-monto-item-quantization-evidence.js";
import {
  restoreEcf31CoreLine,
  serializeEcf31CoreLine,
} from "./ecf31-core-line-snapshot-codec.js";
import type { Ecf31CoreLineSnapshot } from "./ecf31-core-line-snapshot-codec.js";

export type Ecf31LineAdjustmentEvidence = Readonly<{
  lineAmount: Ecf31LineAmountEvidence;
  quantization: Ecf31MontoItemQuantizationEvidence;
}>;

export type Ecf31LineAdjustmentSnapshot = Readonly<{
  schema: "ecf31-line-adjustment";
  version: 1;
  coreLine: Ecf31CoreLineSnapshot;
  discountAmount: string;
  surchargeAmount: string;
  adjustedAmount: string;
  adjustedDelta: string;
  quantizedAmount: string;
  policyId: typeof ECF31_MONTO_ITEM_QUANTIZATION_POLICY_ID;
}>;

export type Ecf31LineAdjustmentSnapshotError = Readonly<{
  code: "INVALID_ECF31_LINE_ADJUSTMENT" | "INVALID_ECF31_LINE_ADJUSTMENT_SNAPSHOT";
  message: string;
}>;

const MESSAGES = Object.freeze({
  INVALID_ECF31_LINE_ADJUSTMENT: "E-CF 31 line adjustment evidence must be genuine and matched.",
  INVALID_ECF31_LINE_ADJUSTMENT_SNAPSHOT: "E-CF 31 line adjustment snapshot is invalid.",
} satisfies Record<Ecf31LineAdjustmentSnapshotError["code"], string>);
const SNAPSHOT_KEYS = [
  "schema", "version", "coreLine", "discountAmount", "surchargeAmount", "adjustedAmount",
  "adjustedDelta", "quantizedAmount", "policyId",
];
const PAIR_KEYS = ["lineAmount", "quantization"];
const evidenceValues = new WeakSet<Ecf31LineAdjustmentEvidence>();

function failure(
  code: Ecf31LineAdjustmentSnapshotError["code"],
): Result<never, Ecf31LineAdjustmentSnapshotError> {
  return { ok: false, error: { code, message: MESSAGES[code] } };
}

function readExactRecord(input: unknown, allowedKeys: readonly string[]): Record<string, unknown> | undefined {
  if (typeof input !== "object" || input === null) return undefined;

  try {
    if (Object.getPrototypeOf(input) !== Object.prototype) return undefined;
    const keys = Reflect.ownKeys(input);
    if (keys.length !== allowedKeys.length || keys.some((key) => typeof key !== "string" || !allowedKeys.includes(key))) {
      return undefined;
    }
    const values: Record<string, unknown> = {};
    for (const key of allowedKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return undefined;
      values[key] = descriptor.value;
    }
    return values;
  } catch {
    return undefined;
  }
}

export function isEcf31LineAdjustmentEvidence(input: unknown): input is Ecf31LineAdjustmentEvidence {
  return typeof input === "object" && input !== null && evidenceValues.has(input as Ecf31LineAdjustmentEvidence);
}

export function serializeEcf31LineAdjustment(
  input: unknown,
): Result<Ecf31LineAdjustmentSnapshot, Ecf31LineAdjustmentSnapshotError> {
  const pair = readExactRecord(input, PAIR_KEYS);
  if (pair === undefined || !isEcf31LineAmountEvidence(pair["lineAmount"])
    || !isEcf31MontoItemQuantizationEvidence(pair["quantization"])
    || pair["quantization"].sourceEvidence !== pair["lineAmount"]) {
    return failure("INVALID_ECF31_LINE_ADJUSTMENT");
  }

  const coreLine = serializeEcf31CoreLine(pair["lineAmount"].coreLine) as { value: Ecf31CoreLineSnapshot };
  return {
    ok: true,
    value: Object.freeze({
      schema: "ecf31-line-adjustment" as const,
      version: 1 as const,
      coreLine: coreLine.value,
      discountAmount: formatDecimal(pair["lineAmount"].discountAmount),
      surchargeAmount: formatDecimal(pair["lineAmount"].surchargeAmount),
      adjustedAmount: formatDecimal(pair["lineAmount"].adjustedAmount),
      adjustedDelta: formatDecimal(pair["lineAmount"].delta),
      quantizedAmount: formatDecimal(pair["quantization"].quantizedAmount),
      policyId: pair["quantization"].policyId,
    }),
  };
}

export function restoreEcf31LineAdjustment(
  input: unknown,
): Result<Ecf31LineAdjustmentEvidence, Ecf31LineAdjustmentSnapshotError> {
  const snapshot = readExactRecord(input, SNAPSHOT_KEYS);
  if (
    snapshot === undefined
    || snapshot["schema"] !== "ecf31-line-adjustment"
    || snapshot["version"] !== 1
    || typeof snapshot["discountAmount"] !== "string"
    || typeof snapshot["surchargeAmount"] !== "string"
    || typeof snapshot["adjustedAmount"] !== "string"
    || typeof snapshot["adjustedDelta"] !== "string"
    || typeof snapshot["quantizedAmount"] !== "string"
    || snapshot["policyId"] !== ECF31_MONTO_ITEM_QUANTIZATION_POLICY_ID
  ) return failure("INVALID_ECF31_LINE_ADJUSTMENT_SNAPSHOT");

  const coreLine = restoreEcf31CoreLine(snapshot["coreLine"]);
  const discountAmount = parseNonnegativeAmount(snapshot["discountAmount"]);
  const surchargeAmount = parseNonnegativeAmount(snapshot["surchargeAmount"]);
  if (!coreLine.ok || !discountAmount.ok || !surchargeAmount.ok
    || formatDecimal(discountAmount.value) !== snapshot["discountAmount"]
    || formatDecimal(surchargeAmount.value) !== snapshot["surchargeAmount"]) {
    return failure("INVALID_ECF31_LINE_ADJUSTMENT_SNAPSHOT");
  }

  const lineAmount = createEcf31LineAmountEvidence({
    coreLine: coreLine.value,
    discountAmount: discountAmount.value,
    surchargeAmount: surchargeAmount.value,
  });
  if (!lineAmount.ok || formatDecimal(lineAmount.value.adjustedAmount) !== snapshot["adjustedAmount"]
    || formatDecimal(lineAmount.value.delta) !== snapshot["adjustedDelta"]) {
    return failure("INVALID_ECF31_LINE_ADJUSTMENT_SNAPSHOT");
  }

  const quantization = createEcf31MontoItemQuantizationEvidence(lineAmount.value);
  if (!quantization.ok || formatDecimal(quantization.value.quantizedAmount) !== snapshot["quantizedAmount"]) {
    return failure("INVALID_ECF31_LINE_ADJUSTMENT_SNAPSHOT");
  }

  const evidence = Object.freeze({ lineAmount: lineAmount.value, quantization: quantization.value });
  evidenceValues.add(evidence);
  return { ok: true, value: evidence };
}
